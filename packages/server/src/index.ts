import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  AVATARS: R2Bucket; // 关联的 Cloudflare R2 存储库
  ROOM_DO: DurableObjectNamespace;
  WX_APPID?: string;
  WX_SECRET?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// 开启跨域，便于本地开发小程序进行联机调试
app.use('/api/*', cors());

// ==================== 统一 API 响应包装 ====================

const jsonOk = (data: any) => {
  return new Response(
    JSON.stringify({ code: 0, message: 'success', data }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};

const jsonErr = (code: number, message: string) => {
  return new Response(
    JSON.stringify({ code, message, data: null }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};

// ==================== 身份验证与自动注册中间件 ====================

async function authenticate(request: Request, db: D1Database) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    throw new Error('未携带登录授权凭证');
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    throw new Error('授权凭证为空');
  }

  // 1. 查询用户
  let user = await db
    .prepare('SELECT id, openid, nickname, avatar_url, created_at FROM users WHERE openid = ?')
    .bind(token)
    .first<any>();

  // 2. 如果不存在，自动进行静默降级注册
  if (!user) {
    const randomNum = Math.floor(1000 + Math.random() * 9000).toString(); // 模拟昵称：玩家_xxxx (xxxx为随机数字)
    const defaultName = `玩家_${randomNum}`;
    await db
      .prepare('INSERT INTO users (openid, nickname) VALUES (?, ?)')
      .bind(token, defaultName)
      .run();

    user = await db
      .prepare('SELECT id, openid, nickname, avatar_url, created_at FROM users WHERE openid = ?')
      .bind(token)
      .first<any>();
  }

  return user;
}

// 微信登录 code 换取 openid (降级免证书开发模式)
async function fetchOpenId(code: string, bindings: Bindings): Promise<string> {
  const appid = bindings.WX_APPID || '';
  const secret = bindings.WX_SECRET || '';

  console.log(`[fetchOpenId] appid='${appid}', secretLength=${secret.length}, code='${code}'`);

  if (!appid || !secret || code.startsWith('test_') || code === 'the code is a mock one') {
    console.log(`[fetchOpenId] falling back to mock openid because conditions met: appid_empty=${!appid}, secret_empty=${!secret}`);
    return `mock_openid_${code}`;
  }

  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;
  try {
    const response = await fetch(url);
    const body = (await response.json()) as any;
    if (body.openid) {
      return body.openid;
    } else {
      console.error('微信验证接口返回错误:', body);
    }
  } catch (e) {
    console.error('微信 Code 校验请求失败', e);
  }
  return `mock_openid_${code}`;
}

// ==================== API 路由处理 ====================

// 1. 微信登录 / 注册
app.post('/api/user/login', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.code) {
      return jsonErr(400, '缺失微信Code');
    }

    const openid = await fetchOpenId(body.code, c.env);
    
    // 获取或自动注册用户
    const user = await dbGetOrCreateUser(c.env.DB, openid);

    return jsonOk({
      token: openid,
      user
    });
  } catch (err: any) {
    return jsonErr(500, err.message || '内部服务错误');
  }
});

// 1.1 获取当前登录用户信息
app.get('/api/user/me', async (c) => {
  try {
    const user = await authenticate(c.req.raw, c.env.DB);
    return jsonOk(user);
  } catch (err: any) {
    return jsonErr(401, err.message || '未授权');
  }
});

// 2. 更新个人信息
app.post('/api/user/update', async (c) => {
  try {
    const user = await authenticate(c.req.raw, c.env.DB);
    const body = await c.req.json();
    const nickname = body.nickname || '';
    const avatarUrl = body.avatar_url || null;

    if (!nickname.trim()) {
      return jsonErr(400, '昵称不能为空');
    }

    await c.env.DB
      .prepare('UPDATE users SET nickname = ?, avatar_url = ? WHERE openid = ?')
      .bind(nickname, avatarUrl, user.openid)
      .run();

    const updatedUser = await c.env.DB
      .prepare('SELECT id, openid, nickname, avatar_url, created_at FROM users WHERE openid = ?')
      .bind(user.openid)
      .first<any>();

    return jsonOk(updatedUser);
  } catch (err: any) {
    return jsonErr(401, err.message || '未授权操作');
  }
});

// 3. 上传头像图片至 Cloudflare R2 存储库
app.post('/api/upload', async (c) => {
  try {
    const user = await authenticate(c.req.raw, c.env.DB);
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || !(file instanceof File)) {
      return jsonErr(400, '未检测到上传文件');
    }

    // 生成在 R2 中的唯一 key (openid_时间戳.jpg)
    const fileExt = file.name ? file.name.split('.').pop() : 'jpg';
    const key = `avatars/${user.openid}_${Date.now()}.${fileExt}`;

    // 将头像数据写入 R2 桶
    await c.env.AVATARS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || 'image/jpeg' }
    });

    // 使用你给存储桶配置的自定义域名访问头像，享受高速 CDN 缓存并节省 Worker 额度
    const avatarUrl = `https://score-room.ashang.cloud/${key}`;

    return jsonOk({ avatarUrl });
  } catch (err: any) {
    return jsonErr(500, err.message || '文件上传失败');
  }
});

// 4. 代理访问 R2 存储的头像资源
app.get('/api/avatar/avatars/:filename', async (c) => {
  try {
    const filename = c.req.param('filename');
    const key = `avatars/${filename}`;
    const object = await c.env.AVATARS.get(key);

    if (!object) {
      return c.text('Avatar Not Found', 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=86400'); // 开启缓存 1 天

    return new Response(object.body, { headers });
  } catch (err) {
    return c.text('Internal Server Error', 500);
  }
});

// 4.1 微信小程序码生成与 R2 缓存接口 (带优雅兜底与运行环境自适应)
app.get('/api/room/qrcode', async (c) => {
  try {
    const roomCode = c.req.query('room_code');
    const envVersion = c.req.query('env_version') || 'release'; // 获取前端感知到的当前小程序所处环境

    if (!roomCode) {
      return jsonErr(400, '缺失房间号');
    }

    const appid = c.env.WX_APPID || '';
    const secret = c.env.WX_SECRET || '';

    // 防御校验，确保传给微信接口的环境参数合法 (必须是 develop / trial / release)
    let wechatEnv = 'release';
    if (['develop', 'trial', 'release'].includes(envVersion)) {
      wechatEnv = envVersion;
    }

    // 缓存 Key 拼装加入运行环境，彻底隔开开发、体验、正式版，防止串环境扫码错乱
    const cacheKey = `qrcodes/${roomCode}_${wechatEnv}.png`;
    const originUrl = `https://score-room.ashang.cloud/${cacheKey}`;

    // 1. 优先查 R2 缓存，若已有该房间码则直接返回
    const cachedObject = await c.env.AVATARS.get(cacheKey);
    if (cachedObject) {
      return jsonOk({ qrCodeUrl: originUrl });
    }

    // 2. 降级判断：如未配小程序凭证或为本地假环境，直接返回标准普通方形微信二维码（用户手机依然可扫码入房）
    if (!appid || !secret || appid.startsWith('test') || appid === 'touristappid') {
      const fallbackUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent('https://wx-score-room.ashang.cloud?room_code=' + roomCode)}`;
      return jsonOk({ qrCodeUrl: fallbackUrl });
    }

    // 3. 获取微信 Access Token
    const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = (await tokenRes.json()) as any;
    if (!tokenData.access_token) {
      throw new Error('Access Token 获取失败');
    }

    const accessToken = tokenData.access_token;

    // 4. 调用微信官方 getwxacodeunlimit 接口获取菊花小程序码
    const qrcodeUrl = `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${accessToken}`;
    const qrcodeRes = await fetch(qrcodeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scene: `code=${roomCode}`, // 场景值为房间号
        page: 'pages/index/index', // 首页
        width: 280,
        check_path: false, // 设为 false，开发/体验阶段跳过微信侧的路径发布校验
        env_version: wechatEnv // 动态使用前端传入的环境参数，实现体验版/生产版完美适配
      })
    });

    // 微信错误判断
    const contentType = qrcodeRes.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      const errJson = (await qrcodeRes.json()) as any;
      throw new Error(`微信生成失败: ${JSON.stringify(errJson)}`);
    }

    const arrayBuffer = await qrcodeRes.arrayBuffer();

    // 5. 存入 R2 bucket 持久化
    await c.env.AVATARS.put(cacheKey, arrayBuffer, {
      httpMetadata: { contentType: 'image/png' }
    });

    return jsonOk({ qrCodeUrl: originUrl });
  } catch (err: any) {
    console.error('微信生成小程序码失败，执行安全降级：', err);
    // 降级兜底返回普通二维码
    const fallbackUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent('https://wx-score-room.ashang.cloud?room_code=' + roomCode)}`;
    return jsonOk({ qrCodeUrl: fallbackUrl });
  }
});

// 5. 创建房间并自动加入
app.post('/api/room/create', async (c) => {
  try {
    await ensureSchema(c.env.DB);
    const user = await authenticate(c.req.raw, c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    
    // 如果有传入头像昵称，顺便同步
    if (body.nickname) {
      await c.env.DB
        .prepare('UPDATE users SET nickname = ?, avatar_url = ? WHERE openid = ?')
        .bind(body.nickname, body.avatar_url || null, user.openid)
        .run();
    }

    // 随机生成 6 位不重复的房间号 (大写英文+数字，排除容易看错混淆的 0, O, 1, I)
    let roomCode = '';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 10; i++) {
      let tempCode = '';
      for (let j = 0; j < 6; j++) {
        tempCode += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const existing = await c.env.DB
        .prepare('SELECT id FROM rooms WHERE room_code = ?')
        .bind(tempCode)
        .first();
      if (!existing) {
        roomCode = tempCode;
        break;
      }
    }

    if (!roomCode) {
      return jsonErr(500, '生成房间号失败，请稍后重试');
    }

    // 利用 D1 batch 事务一次性创建房间并将房主拉进房间
    const createResult = await c.env.DB.prepare(
      'INSERT INTO rooms (room_code, owner_id, version, status) VALUES (?, ?, 1, 0)'
    ).bind(roomCode, user.id).run();

    const roomId = createResult.meta.last_row_id;

    await c.env.DB.prepare(
      'INSERT INTO room_users (room_id, user_id, score) VALUES (?, ?, 0)'
    ).bind(roomId, user.id).run();

    const room = await c.env.DB
      .prepare('SELECT * FROM rooms WHERE id = ?')
      .bind(roomId)
      .first<any>();

    return jsonOk(room);
  } catch (err: any) {
    return jsonErr(401, err.message || '操作失败');
  }
});

// 6. 加入房间
app.post('/api/room/join', async (c) => {
  try {
    await ensureSchema(c.env.DB);
    const user = await authenticate(c.req.raw, c.env.DB);
    const body = await c.req.json();
    const roomCode = body.room_code;

    if (!roomCode) {
      return jsonErr(400, '房间号不能为空');
    }

    if (body.nickname) {
      await c.env.DB
        .prepare('UPDATE users SET nickname = ?, avatar_url = ? WHERE openid = ?')
        .bind(body.nickname, body.avatar_url || null, user.openid)
        .run();
    }

    const room = await c.env.DB
      .prepare('SELECT * FROM rooms WHERE room_code = ?')
      .bind(roomCode)
      .first<any>();

    if (!room) {
      return jsonErr(404, '房间不存在');
    }

    if (room.status === 1) {
      return jsonErr(403, '该房间对局已结算结束');
    }

    // 检查是否已经在房间中
    const member = await c.env.DB
      .prepare('SELECT score FROM room_users WHERE room_id = ? AND user_id = ?')
      .bind(room.id, user.id)
      .first();

    if (!member) {
      // D1 Batch: 插入玩家，递增版本号
      await c.env.DB.batch([
        c.env.DB.prepare('INSERT INTO room_users (room_id, user_id, score) VALUES (?, ?, 0)').bind(room.id, user.id),
        c.env.DB.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?').bind(room.id)
      ]);
      await broadcastRoomUpdate(room.id, c.env.DB, c.env.ROOM_DO);
    }

    return jsonOk(room);
  } catch (err: any) {
    return jsonErr(401, err.message || '操作失败');
  }
});

// 7. 设置/修改茶水钱
app.post('/api/room/set-tea', async (c) => {
  try {
    await ensureSchema(c.env.DB);
    await authenticate(c.req.raw, c.env.DB);
    const body = await c.req.json();
    const { room_id, total_tea_money, tea_money_per_tx, tea_mode } = body;

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE rooms SET total_tea_money = ?, tea_money_per_tx = ?, tea_mode = ?, version = version + 1 WHERE id = ?')
        .bind(total_tea_money, tea_money_per_tx, tea_mode || 0, room_id)
    ]);
    await broadcastRoomUpdate(room_id, c.env.DB, c.env.ROOM_DO);

    return jsonOk({ status: 'ok' });
  } catch (err: any) {
    return jsonErr(401, err.message || '操作失败');
  }
});

// 8. 记分 (支持普通记分和自己交茶水费，兼具零和事务及撤销兼容)
app.post('/api/room/score', async (c) => {
  try {
    await ensureSchema(c.env.DB);
    await authenticate(c.req.raw, c.env.DB);
    const body = await c.req.json();
    const { room_id, from_user_id, to_user_id, amount, deduct_tea } = body;

    if (amount <= 0) {
      return jsonErr(400, '输入分值必须大于0');
    }

    const room = await c.env.DB
      .prepare('SELECT * FROM rooms WHERE id = ?')
      .bind(room_id)
      .first<any>();

    if (!room) {
      return jsonErr(404, '房间不存在');
    }
    if (room.status === 1) {
      return jsonErr(403, '房间对局已结算锁定');
    }

    // 区分是“纯给茶水费（自己点自己头像）”还是“普通记分”
    const isPureTea = (to_user_id === 0 || to_user_id === from_user_id);

    if (isPureTea) {
      // 1. 如果是缴纳茶水费，校验茶水费是否已满或不需要
      if (room.total_tea_money <= 0) {
        return jsonErr(400, '本房间未设置茶水规则，无需缴纳');
      }
      if (room.accumulated_tea_money >= room.total_tea_money) {
        return jsonErr(400, '本房间茶水费已收齐，无需缴纳');
      }

      // 计算能交的最大值，防止超出总额
      const remainingTea = room.total_tea_money - room.accumulated_tea_money;
      const actualTea = Math.min(amount, remainingTea);

      // 确保 id = 0 的“茶水金库”系统用户存在，以防止外键约束失败
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO users (id, openid, nickname, avatar_url) VALUES (0, 'system_tea_vault', '茶水金库', '')"
      ).run();

      const statements = [
        // 缴纳人扣除分值 (即使分数为0扣后变负数也允许)
        c.env.DB.prepare('UPDATE room_users SET score = score - ? WHERE room_id = ? AND user_id = ?')
          .bind(actualTea, room_id, from_user_id),
        // 累加房间茶水
        c.env.DB.prepare('UPDATE rooms SET accumulated_tea_money = accumulated_tea_money + ?, version = version + 1 WHERE id = ?')
          .bind(actualTea, room_id),
        // 流水记录：to_user_id 记录为 0 代表流向茶水池，tea_deducted 等于实际缴纳值
        c.env.DB.prepare('INSERT INTO transactions (room_id, from_user_id, to_user_id, amount, tea_deducted, is_undone) VALUES (?, ?, 0, ?, ?, 0)')
          .bind(room_id, from_user_id, actualTea, actualTea)
      ];

      await c.env.DB.batch(statements);
      await broadcastRoomUpdate(room_id, c.env.DB, c.env.ROOM_DO);
      return jsonOk({ status: 'ok' });
    } else {
      // 2. 普通记分（由 from_user_id 付分给 to_user_id）
      // 计算应扣除的茶水钱
      let teaDeducted = 0;
      if (deduct_tea && room.tea_money_per_tx > 0) {
        const remainingTea = room.total_tea_money - room.accumulated_tea_money;
        if (remainingTea > 0) {
          if (room.tea_mode === 1) {
            // 百分比模式：按百分比扣除，最多保留两位小数
            const calculated = amount * (room.tea_money_per_tx / 100);
            teaDeducted = Math.min(calculated, remainingTea, amount);
            // 保留最多两位小数
            teaDeducted = Math.round(teaDeducted * 100) / 100;
          } else {
            // 固定金额模式
            teaDeducted = Math.min(room.tea_money_per_tx, remainingTea, amount);
          }
        }
      }

      const finalScoreChange = amount - teaDeducted;

      const statements = [
        // 付分人扣分
        c.env.DB.prepare('UPDATE room_users SET score = score - ? WHERE room_id = ? AND user_id = ?')
          .bind(amount, room_id, from_user_id),
        // 得分人得分
        c.env.DB.prepare('UPDATE room_users SET score = score + ? WHERE room_id = ? AND user_id = ?')
          .bind(finalScoreChange, room_id, to_user_id),
        // 记录记分交易流水
        c.env.DB.prepare('INSERT INTO transactions (room_id, from_user_id, to_user_id, amount, tea_deducted, is_undone) VALUES (?, ?, ?, ?, ?, 0)')
          .bind(room_id, from_user_id, to_user_id, amount, teaDeducted),
        // 房间版本递增
        c.env.DB.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?')
          .bind(room_id)
      ];

      if (teaDeducted > 0) {
        statements.push(
          c.env.DB.prepare('UPDATE rooms SET accumulated_tea_money = accumulated_tea_money + ? WHERE id = ?')
            .bind(teaDeducted, room_id)
        );
      }

      await c.env.DB.batch(statements);
      await broadcastRoomUpdate(room_id, c.env.DB, c.env.ROOM_DO);
      return jsonOk({ status: 'ok' });
    }
  } catch (err: any) {
    return jsonErr(401, err.message || '操作失败');
  }
});

// 9. 撤销记分 (积分、茶水一键回滚)
app.post('/api/room/undo', async (c) => {
  try {
    await authenticate(c.req.raw, c.env.DB);
    const body = await c.req.json();
    const { room_id, transaction_id } = body;

    const tx = await c.env.DB
      .prepare('SELECT * FROM transactions WHERE id = ?')
      .bind(transaction_id)
      .first<any>();

    if (!tx) {
      return jsonErr(404, '交易记录不存在');
    }
    if (tx.is_undone === 1) {
      return jsonErr(400, '该交易记录已被撤销');
    }

    const room = await c.env.DB
      .prepare('SELECT * FROM rooms WHERE id = ?')
      .bind(room_id)
      .first<any>();

    if (!room) {
      return jsonErr(404, '房间不存在');
    }
    if (room.status === 1) {
      return jsonErr(403, '房间已结算，不可撤销');
    }

    const originalAmount = tx.amount;
    const teaDeducted = tx.tea_deducted;
    const finalScoreChange = originalAmount - teaDeducted;

    // D1 Batch 执行撤销回滚事务
    const statements = [
      // 1. 原付分人积分退回
      c.env.DB.prepare('UPDATE room_users SET score = score + ? WHERE room_id = ? AND user_id = ?')
        .bind(originalAmount, room_id, tx.from_user_id),
      // 2. 标记流水状态为已撤销
      c.env.DB.prepare('UPDATE transactions SET is_undone = 1 WHERE id = ?')
        .bind(transaction_id),
      // 3. 版本递增
      c.env.DB.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?')
        .bind(room_id)
    ];

    // 如果原交易中存在得分人 (to_user_id > 0)，原得分人扣除对应积分
    if (tx.to_user_id && tx.to_user_id > 0) {
      statements.push(
        c.env.DB.prepare('UPDATE room_users SET score = score - ? WHERE room_id = ? AND user_id = ?')
          .bind(finalScoreChange, room_id, tx.to_user_id)
      );
    }

    // 如果当初扣了茶水，回滚茶水钱
    if (teaDeducted > 0) {
      statements.push(
        c.env.DB.prepare('UPDATE rooms SET accumulated_tea_money = accumulated_tea_money - ? WHERE id = ?')
          .bind(teaDeducted, room_id)
      );
    }

    await c.env.DB.batch(statements);
    await broadcastRoomUpdate(room_id, c.env.DB, c.env.ROOM_DO);

    return jsonOk({ status: 'ok' });
  } catch (err: any) {
    return jsonErr(401, err.message || '操作失败');
  }
});

// 10. 智能对账轮询 (1秒1次低消耗设计)
app.get('/api/room/poll', async (c) => {
  try {
    await ensureSchema(c.env.DB);
    await authenticate(c.req.raw, c.env.DB);
    const roomId = parseInt(c.req.query('room_id') || '0');
    const localVersion = parseInt(c.req.query('local_version') || '0');

    if (!roomId) {
      return jsonErr(400, '缺失房间ID');
    }

    const room = await c.env.DB
      .prepare('SELECT * FROM rooms WHERE id = ?')
      .bind(roomId)
      .first<any>();

    if (!room) {
      return jsonErr(404, '房间不存在');
    }

    // 核心提效：版本号对齐，直接响应 no_update
    if (room.version === localVersion) {
      return jsonOk({
        has_update: false,
        room: null,
        players: null,
        transactions: null
      });
    }

    // 获取完整房间数据并推送
    const players = await c.env.DB
      .prepare(
        'SELECT ru.user_id, u.nickname, u.avatar_url, ru.score \
         FROM room_users ru \
         JOIN users u ON ru.user_id = u.id \
         WHERE ru.room_id = ?'
      )
      .bind(roomId)
      .all<any>();

    const transactions = await c.env.DB
      .prepare(
        'SELECT t.id, t.from_user_id, u1.nickname as from_nickname, \
                t.to_user_id, COALESCE(u2.nickname, \'茶水金库\') as to_nickname, \
                t.amount, t.tea_deducted, t.is_undone, t.created_at \
         FROM transactions t \
         JOIN users u1 ON t.from_user_id = u1.id \
         LEFT JOIN users u2 ON t.to_user_id = u2.id \
         WHERE t.room_id = ? \
         ORDER BY t.id DESC'
      )
      .bind(roomId)
      .all<any>();

    return jsonOk({
      has_update: true,
      room,
      players: players.results,
      transactions: transactions.results
    });
  } catch (err: any) {
    return jsonErr(401, err.message || '同步失败');
  }
});

// 11. 房主结算对局
app.post('/api/room/settle', async (c) => {
  try {
    const user = await authenticate(c.req.raw, c.env.DB);
    const body = await c.req.json();
    const { room_id } = body;

    const room = await c.env.DB
      .prepare('SELECT owner_id FROM rooms WHERE id = ?')
      .bind(room_id)
      .first<any>();

    if (!room) {
      return jsonErr(404, '房间不存在');
    }

    if (room.owner_id !== user.id) {
      return jsonErr(403, '只有房主才可以进行游戏结算');
    }

    await c.env.DB
      .prepare('UPDATE rooms SET status = 1, version = version + 1 WHERE id = ?')
      .bind(room_id)
      .run();
    await broadcastRoomUpdate(room_id, c.env.DB, c.env.ROOM_DO);

    return jsonOk({ status: 'ok' });
  } catch (err: any) {
    return jsonErr(401, err.message || '操作失败');
  }
});

// 12. 个人中心战绩历史查询 (过滤没有得分/茶水的“空对局”房间)
app.get('/api/user/history', async (c) => {
  try {
    const user = await authenticate(c.req.raw, c.env.DB);

    // 查询参与的房间历史记录 (过滤没有有效未撤销记分流水的空对局房间)
    const history = await c.env.DB
      .prepare(
        'SELECT r.id as room_id, r.room_code, u.nickname as owner_nickname, \
                ru.score as final_score, r.accumulated_tea_money, r.created_at, \
                r.status as room_status, \
                (SELECT group_concat(u2.nickname, \'、\') \
                 FROM room_users ru2 \
                 JOIN users u2 ON ru2.user_id = u2.id \
                 WHERE ru2.room_id = r.id) as player_names \
         FROM room_users ru \
         JOIN rooms r ON ru.room_id = r.id \
         JOIN users u ON r.owner_id = u.id \
         WHERE ru.user_id = ? \
           AND EXISTS (SELECT 1 FROM transactions t WHERE t.room_id = r.id AND t.is_undone = 0) \
         ORDER BY r.id DESC'
      )
      .bind(user.id)
      .all<any>();

    // 共同游戏过战友聚合排名
    const friends = await c.env.DB
      .prepare(
        'SELECT fu.user_id as friend_id, u.nickname, u.avatar_url, \
                COUNT(DISTINCT ru.room_id) as play_count, \
                SUM(ru.score) as net_score \
         FROM room_users ru \
         JOIN room_users fu ON ru.room_id = fu.room_id \
         JOIN users u ON fu.user_id = u.id \
         WHERE ru.user_id = ? AND fu.user_id != ? \
         GROUP BY fu.user_id, u.nickname, u.avatar_url \
         ORDER BY play_count DESC'
      )
      .bind(user.id, user.id)
      .all<any>();

    return jsonOk({
      history: history.results,
      friends: friends.results
    });
  } catch (err: any) {
    return jsonErr(401, err.message || '未授权操作');
  }
});

// ==================== 数据库辅助方法 ====================

async function ensureSchema(db: D1Database) {
  try {
    await db.prepare("ALTER TABLE rooms ADD COLUMN tea_mode INTEGER DEFAULT 0").run();
  } catch (e) {
    // 列已存在，忽略
  }
}

async function dbGetOrCreateUser(db: D1Database, openid: string) {
  let user = await db
    .prepare('SELECT id, openid, nickname, avatar_url, created_at FROM users WHERE openid = ?')
    .bind(openid)
    .first<any>();

  if (!user) {
    const randomNum = Math.floor(1000 + Math.random() * 9000).toString(); // 模拟昵称：玩家_xxxx (xxxx为随机数字)
    const defaultName = `玩家_${randomNum}`;
    await db
      .prepare('INSERT INTO users (openid, nickname) VALUES (?, ?)')
      .bind(openid, defaultName)
      .run();

    user = await db
      .prepare('SELECT id, openid, nickname, avatar_url, created_at FROM users WHERE openid = ?')
      .bind(openid)
      .first<any>();
  }

  return user;
}

// ==================== 实时广播及 WebSocket 同步方案 ====================

// 实时广播更新给房间内所有在线玩家
async function broadcastRoomUpdate(roomId: any, db: D1Database, roomDoNamespace: DurableObjectNamespace) {
  try {
    const cleanRoomId = typeof roomId === 'string' ? parseInt(roomId) : roomId;
    if (isNaN(cleanRoomId)) return;

    // 1. 获取最新房间状态
    const room = await db
      .prepare('SELECT * FROM rooms WHERE id = ?')
      .bind(cleanRoomId)
      .first<any>();

    if (!room) return;

    // 2. 获取最新成员列表
    const players = await db
      .prepare(
        'SELECT ru.user_id, u.nickname, u.avatar_url, ru.score \
         FROM room_users ru \
         JOIN users u ON ru.user_id = u.id \
         WHERE ru.room_id = ?'
      )
      .bind(cleanRoomId)
      .all<any>();

    // 3. 获取最新流水列表
    const transactions = await db
      .prepare(
        'SELECT t.id, t.from_user_id, u1.nickname as from_nickname, \
                t.to_user_id, COALESCE(u2.nickname, \'茶水金库\') as to_nickname, \
                t.amount, t.tea_deducted, t.is_undone, t.created_at \
         FROM transactions t \
         JOIN users u1 ON t.from_user_id = u1.id \
         LEFT JOIN users u2 ON t.to_user_id = u2.id \
         WHERE t.room_id = ? \
         ORDER BY t.id DESC'
      )
      .bind(cleanRoomId)
      .all<any>();

    let teaProgress = 0;
    if (room.total_tea_money > 0) {
      teaProgress = Math.min(100, Math.floor((room.accumulated_tea_money / room.total_tea_money) * 100));
    }

    const payload = {
      type: 'update',
      room,
      players: players.results || [],
      transactions: transactions.results || [],
      teaProgress
    };

    // 4. 寻址并调用 Durable Object 实例进行广播
    const id = roomDoNamespace.idFromName(String(cleanRoomId));
    const stub = roomDoNamespace.get(id);
    await stub.fetch(new Request('https://do/broadcast', {
      method: 'POST',
      body: JSON.stringify(payload)
    }));
  } catch (err) {
    console.error('实时广播通知失败', err);
  }
}

// 供前端在特定修改（如房间内改头像昵称后）手动触发实时同步广播的 API
app.post('/api/room/broadcast-update', async (c) => {
  try {
    await authenticate(c.req.raw, c.env.DB);
    const body = await c.req.json();
    const { room_id } = body;
    if (!room_id) {
      return jsonErr(400, '缺失房间ID');
    }
    await broadcastRoomUpdate(room_id, c.env.DB, c.env.ROOM_DO);
    return jsonOk({ status: 'ok' });
  } catch (err: any) {
    return jsonErr(401, err.message || '操作失败');
  }
});

// WebSocket 握手代理端点 (带房间鉴权校验)
app.get('/api/room/ws', async (c) => {
  const roomId = c.req.query('room_id');
  const token = c.req.query('token');

  if (!roomId || !token) {
    return c.text('Missing room_id or token', 400);
  }

  const parsedRoomId = parseInt(roomId);
  if (isNaN(parsedRoomId)) {
    return c.text('Invalid room_id', 400);
  }

  // 1. 鉴权检验
  let user;
  try {
    user = await c.env.DB
      .prepare('SELECT id FROM users WHERE openid = ?')
      .bind(token)
      .first<any>();
  } catch (e) {
    return c.text('Unauthorized', 401);
  }

  if (!user) {
    return c.text('Unauthorized', 401);
  }

  // 2. 检验是否是该房间成员，防止串房监听
  const member = await c.env.DB
    .prepare('SELECT 1 FROM room_users WHERE room_id = ? AND user_id = ?')
    .bind(parsedRoomId, user.id)
    .first();

  if (!member) {
    return c.text('Forbidden', 403);
  }

  // 3. 寻址 Durable Object 建立 WebSocket
  const id = c.env.ROOM_DO.idFromName(String(parsedRoomId));
  const stub = c.env.ROOM_DO.get(id);

  return stub.fetch(c.req.raw);
});

// Durable Object 房间房间网关类 (利用 WebSocket Hibernation API 节省计算时长 Duration)
export class RoomDO implements DurableObject {
  state: DurableObjectState;

  constructor(state: DurableObjectState, env: Bindings) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 内部接口：触发广播
    if (url.pathname === '/broadcast') {
      const body = await request.text();
      const websockets = this.state.getWebSockets();
      for (const ws of websockets) {
        try {
          ws.send(body);
        } catch (e) {
          // 忽略已断连的套接字
        }
      }
      return new Response('OK');
    }

    // 外部接口：建立 WebSocket 升级
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // 接受并使连接“休眠”挂起，极大程度节省计算 GB-s 消耗
    this.state.acceptWebSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // 以下方法属于 WebSocket Hibernation 必须的生命周期回调
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // 微信小程序客户端不需要上传命令，这里用作心跳维持或记录
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    ws.close();
  }

  async webSocketError(ws: WebSocket, error: any): Promise<void> {
    ws.close();
  }
}

export default app;
