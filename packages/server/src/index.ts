import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  AVATARS: R2Bucket; // 关联的 Cloudflare R2 存储库
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

  if (!appid || !secret || code.startsWith('test_') || code === 'the code is a mock one') {
    return `mock_openid_${code}`;
  }

  const url = `https://api.weixin.qq.com/sns/jscode2session?appid={appid}&secret={secret}&js_code={code}&grant_type=authorization_code`;
  try {
    const response = await fetch(url);
    const body = (await response.json()) as any;
    if (body.openid) {
      return body.openid;
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

// 5. 创建房间并自动加入
app.post('/api/room/create', async (c) => {
  try {
    const user = await authenticate(c.req.raw, c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    
    // 如果有传入头像昵称，顺便同步
    if (body.nickname) {
      await c.env.DB
        .prepare('UPDATE users SET nickname = ?, avatar_url = ? WHERE openid = ?')
        .bind(body.nickname, body.avatar_url || null, user.openid)
        .run();
    }

    // 随机生成 6 位不重复的房间号
    let roomCode = '';
    for (let i = 0; i < 10; i++) {
      const tempCode = Math.floor(100000 + Math.random() * 900000).toString();
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
    }

    return jsonOk(room);
  } catch (err: any) {
    return jsonErr(401, err.message || '操作失败');
  }
});

// 7. 设置/修改茶水钱
app.post('/api/room/set-tea', async (c) => {
  try {
    await authenticate(c.req.raw, c.env.DB);
    const body = await c.req.json();
    const { room_id, total_tea_money, tea_money_per_tx } = body;

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE rooms SET total_tea_money = ?, tea_money_per_tx = ?, version = version + 1 WHERE id = ?')
        .bind(total_tea_money, tea_money_per_tx, room_id)
    ]);

    return jsonOk({ status: 'ok' });
  } catch (err: any) {
    return jsonErr(401, err.message || '操作失败');
  }
});

// 8. 记分 (零和交易事务及茶水自动扣除)
app.post('/api/room/score', async (c) => {
  try {
    await authenticate(c.req.raw, c.env.DB);
    const body = await c.req.json();
    const { room_id, from_user_id, to_user_id, amount, deduct_tea } = body;

    if (amount <= 0) {
      return jsonErr(400, '记分值必须大于0');
    }
    if (from_user_id === to_user_id) {
      return jsonErr(400, '不能给自己记分');
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

    // 计算应扣除的茶水钱
    let teaDeducted = 0;
    if (deduct_tea && room.tea_money_per_tx > 0) {
      const remainingTea = room.total_tea_money - room.accumulated_tea_money;
      if (remainingTea > 0) {
        teaDeducted = Math.min(room.tea_money_per_tx, remainingTea, amount);
      }
    }

    const finalScoreChange = amount - teaDeducted;

    // 使用 D1 Batch 原子性批处理执行，确保记分事务零和守恒
    const statements = [
      // 1. 付分人扣分
      c.env.DB.prepare('UPDATE room_users SET score = score - ? WHERE room_id = ? AND user_id = ?')
        .bind(amount, room_id, from_user_id),
      // 2. 得分人得分
      c.env.DB.prepare('UPDATE room_users SET score = score + ? WHERE room_id = ? AND user_id = ?')
        .bind(finalScoreChange, room_id, to_user_id),
      // 3. 记录记分交易流水
      c.env.DB.prepare('INSERT INTO transactions (room_id, from_user_id, to_user_id, amount, tea_deducted, is_undone) VALUES (?, ?, ?, ?, ?, 0)')
        .bind(room_id, from_user_id, to_user_id, amount, teaDeducted),
      // 4. 房间版本递增
      c.env.DB.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?')
        .bind(room_id)
    ];

    // 5. 如果产生茶水，累加茶水蓄水池
    if (teaDeducted > 0) {
      statements.push(
        c.env.DB.prepare('UPDATE rooms SET accumulated_tea_money = accumulated_tea_money + ? WHERE id = ?')
          .bind(teaDeducted, room_id)
      );
    }

    await c.env.DB.batch(statements);

    return jsonOk({ status: 'ok' });
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
      // 2. 原得分人积分扣除
      c.env.DB.prepare('UPDATE room_users SET score = score - ? WHERE room_id = ? AND user_id = ?')
        .bind(finalScoreChange, room_id, tx.to_user_id),
      // 3. 标记流水状态为已撤销
      c.env.DB.prepare('UPDATE transactions SET is_undone = 1 WHERE id = ?')
        .bind(transaction_id),
      // 4. 版本递增
      c.env.DB.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?')
        .bind(room_id)
    ];

    // 5. 如果当初扣了茶水，回滚茶水钱
    if (teaDeducted > 0) {
      statements.push(
        c.env.DB.prepare('UPDATE rooms SET accumulated_tea_money = accumulated_tea_money - ? WHERE id = ?')
          .bind(teaDeducted, room_id)
      );
    }

    await c.env.DB.batch(statements);

    return jsonOk({ status: 'ok' });
  } catch (err: any) {
    return jsonErr(401, err.message || '操作失败');
  }
});

// 10. 智能对账轮询 (1秒1次低消耗设计)
app.get('/api/room/poll', async (c) => {
  try {
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
                t.to_user_id, u2.nickname as to_nickname, \
                t.amount, t.tea_deducted, t.created_at \
         FROM transactions t \
         JOIN users u1 ON t.from_user_id = u1.id \
         JOIN users u2 ON t.to_user_id = u2.id \
         WHERE t.room_id = ? AND t.is_undone = 0 \
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
                ru.score as final_score, r.accumulated_tea_money, r.created_at \
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

export default app;
