const app = getApp();
import * as echarts from '../../components/ec-canvas/echarts';

// 格式化 UTC 时间字符串为本地时区时间 (YYYY-MM-DD HH:mm)
function formatLocalTime(utcString) {
  if (!utcString) return '';
  // 转换 "YYYY-MM-DD HH:MM:SS" 为 "YYYY-MM-DDTHH:MM:SSZ" 强制以 UTC 时区进行解析
  const isoStr = utcString.replace(' ', 'T') + 'Z';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) {
    const dFallback = new Date(utcString);
    if (isNaN(dFallback.getTime())) return utcString;
    return formatZeroPadding(dFallback);
  }
  return formatZeroPadding(d);
}

function formatZeroPadding(d) {
  const pad = (n) => n < 10 ? '0' + n : n;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    roomId: 0,
    roomCode: '',
    isOwner: false,
    roomInfo: {},
    players: [],
    transactions: [],
    localVersion: 0,

    // UI 显示控制
    showQRCode: false,
    qrCodeUrl: '',
    showTeaModal: false,
    showScoreModal: false,
    showSettleReport: false,

    // 茶水参数设置输入
    inputTotalTea: '',
    inputPerTxTea: '',
    inputTeaMode: 0, // 0: 固定金额, 1: 百分比
    teaProgress: 0,

    // 记分参数
    selectedPlayer: null, // 被点击的玩家(得分人)
    payers: [],           // 候选的付分人列表
    selectedPayerId: 0,   // 选中的付分人用户ID
    inputScore: '',
    deductTeaChecked: true,

    // 结算数据
    sortedPlayers: [],
    mvpPlayer: null,
    myUserId: 0,
    isRefreshing: false,
    activeBillTab: 'total',
    personalTransactions: [],
    hasViewedSettle: false,

    // 个人信息编辑数据
    avatarUrl: '',
    nickname: '',
    onlineUserIds: [],
    scoreFieldFocus: false,
    isLoadingData: true,
    roomStatus: 0,
    lineColors: ['#ff6b6b', '#0b9b77', '#0096c7', '#f4a261', '#9b5de5', '#ff9f1c', '#4361ee', '#7209b7'],
    settleSchemes: [],
    selectedTeaRecipientId: null, // 茶水费结算对象，默认为 null（不结算）
    isTrendExpanded: false,
    ec: {
      lazyLoad: true
    }
  },

  socketTask: null, // 用于实时同步的 WebSocket 实例

  onLoad: function (options) {
    // 1. 设置导航适配高度
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      roomId: parseInt(options.room_id) || 0,
      roomCode: options.room_code || '',
      isOwner: options.is_owner === 'true',
      roomStatus: parseInt(options.status) || 0,
      qrCodeUrl: '',
      myUserId: app.globalData.userInfo ? app.globalData.userInfo.id : 0
    });
  },

  onShow: function () {
    // 1. 页面切回前台、从后台恢复、解锁屏幕时，立即主动拉取一次最新数据，保证状态最新
    this.pollRoomData();
    // 2. 仅在进行中房间才建立 WebSocket 实时推送长连接，避免对已结束房间的无意义网络开销
    if (this.data.roomStatus !== 1) {
      this.connectWebSocket();
    }
  },

  onHide: function () {
    // 页面隐藏、切后台或熄屏时，关闭 WebSocket 连接以省电并释放服务器资源
    this.closeWebSocket();
  },

  onUnload: function () {
    // 页面关闭销毁时，彻底关闭并释放 WebSocket 连接
    this.closeWebSocket();
  },

  // 微信转发/分享房间设置 (分享到聊天窗口)
  onShareAppMessage: function (options) {
    const isSettled = this.data.roomStatus === 1 || (this.data.roomInfo && this.data.roomInfo.status === 1);
    
    if (isSettled) {
      // 动态获取大赢家/MVP 昵称
      const sorted = [...this.data.players].sort((a, b) => b.score - a.score);
      const mvpName = sorted[0] && sorted[0].score > 0 ? sorted[0].nickname : '';
      let title = `📊 房间 [${this.data.roomCode}] 对账单已出炉，快来核对明细！`;
      if (mvpName) {
        title = `🏆 房间 [${this.data.roomCode}] 结算：大赢家是【${mvpName}】！快来核对账单吧！`;
      }
      return {
        title: title,
        path: `/pages/index/index?room_code=${this.data.roomCode}`
      };
    }
    
    // 进行中房间的分享文案 (无论从右上角菜单还是“邀请微信好友”按钮触发)
    return {
      title: `🎮 邀请你加入我的记账房: ${this.data.roomCode}，来联机对局吧！`,
      path: `/pages/index/index?room_code=${this.data.roomCode}`
    };
  },

  // 建立 WebSocket 连接实现 0 延迟实时推送
  connectWebSocket: function () {
    this.closeWebSocket(); // 确保安全，先关闭已有的连接

    const apiProtocol = app.globalData.apiUrl.startsWith('https') ? 'wss' : 'ws';
    // 防御处理：去除开头协议和结尾的斜杠，防止出现双斜线导致微信 WS 解析失败
    const domain = app.globalData.apiUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const wsUrl = `${apiProtocol}://${domain}/api/room/ws?room_id=${this.data.roomId}&token=${app.globalData.token}`;

    console.log('正在建立 WebSocket 实时同步连接:', wsUrl);

    // 建立小程序 WebSocket
    const socketTask = wx.connectSocket({
      url: wsUrl,
      success: () => {
        console.log('WebSocket 发起连接成功');
      },
      fail: (err) => {
        console.error('WebSocket 发起连接失败', err);
      }
    });

    this.socketTask = socketTask;

    socketTask.onOpen(() => {
      console.log('WebSocket 连接已成功建立');
    });

    socketTask.onMessage((res) => {
      try {
        const data = JSON.parse(res.data);
        if (data.type === 'online_status') {
          console.log('收到在线状态变更推送:', data);
          this.setData({
            onlineUserIds: data.onlineUserIds || []
          });
        } else if (data.type === 'update') {
          console.log('收到房间实时更新推送:', data);
          // 计算茶水钱进度百分比
          let progress = 0;
          const room = data.room;
          if (room.total_tea_money > 0) {
            progress = Math.min(100, Math.floor((room.accumulated_tea_money / room.total_tea_money) * 100));
          }

          const myId = app.globalData.userInfo ? app.globalData.userInfo.id : 0;
          
          const formattedRoom = room ? {
            ...room,
            accumulated_tea_money: this.sanitizeScore(room.accumulated_tea_money)
          } : {};
          const formattedPlayers = (data.players || []).map(p => ({
            ...p,
            score: this.sanitizeScore(p.score)
          })).sort((a, b) => {
            if (a.user_id === myId) return -1;
            if (b.user_id === myId) return 1;
            return 0;
          });
          const formattedTransactions = (data.transactions || []).map(t => ({
            ...t,
            tea_deducted: this.sanitizeScore(t.tea_deducted),
            created_at: formatLocalTime(t.created_at)
          }));
          const personalTxs = formattedTransactions.filter(t => t.from_user_id === myId || t.to_user_id === myId);

          const isJustSettled = this.data.roomInfo.status === 0;

          this.setData({
            roomInfo: formattedRoom,
            players: formattedPlayers,
            transactions: formattedTransactions,
            personalTransactions: personalTxs,
            localVersion: room.version,
            teaProgress: progress,
            inputTotalTea: room.total_tea_money || '',
            inputPerTxTea: room.tea_money_per_tx || '',
            myUserId: myId,
            isOwner: room.owner_id === myId,
            roomStatus: room.status,
            isLoadingData: false, // 数据加载成功，隐藏全屏加载态
            ...(data.onlineUserIds ? { onlineUserIds: data.onlineUserIds } : {})
          }, () => {
            this.drawTrendChart();
          });

          if (room.status === 1) {
            this.closeWebSocket();
            if (!this.data.hasViewedSettle && !this.data.showSettleReport) {
              this.showSettleReportPage(formattedPlayers);
            }
          }
        }
      } catch (err) {
        console.error('解析 WebSocket 推送数据失败', err);
      }
    });

    socketTask.onClose((res) => {
      console.log('WebSocket 连接已断开', res);
      // 如果不是我们主动清空的，说明是异常断开（比如网络瞬断），尝试自动重连
      if (this.socketTask === socketTask) {
        this.socketTask = null;
        // 如果页面依然处于可见状态，尝试延时自动重连
        if (!this.reconnectTimer && this.data.roomId) {
          console.log('检测到非主动断开，准备 3 秒后尝试自动重连...');
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            // 确保页面可见且没有正在进行的连接才进行重连
            if (!this.socketTask) {
              this.connectWebSocket();
            }
          }, 3000);
        }
      }
    });

    socketTask.onError((err) => {
      console.error('WebSocket 连接发生异常', err);
      this.socketTask = null;
    });
  },

  // 关闭并释放 WebSocket 连接
  closeWebSocket: function () {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socketTask) {
      this.socketTask.close({
        success: () => {
          console.log('主动关闭 WebSocket 成功');
        }
      });
      this.socketTask = null;
    }
  },

  // 主动拉取核心请求 (比如在 onShow 切前台时，主动获取一次分数，保证数据绝对正确)
  pollRoomData: function () {
    if (!this.data.roomId) return;

    app.request({
      url: `/api/room/poll?room_id=${this.data.roomId}&local_version=${this.data.localVersion}`,
      method: 'GET'
    }).then(res => {
      // 只有在后端通知有数据更新时，才更新 data，减少小程序 DOM 刷新开销
      if (res.has_update) {
        const room = res.room;
        const players = res.players || [];
        const transactions = res.transactions || [];

        // 计算茶水钱进度百分比
        let progress = 0;
        if (room.total_tea_money > 0) {
          progress = Math.min(100, Math.floor((room.accumulated_tea_money / room.total_tea_money) * 100));
        }

        const myId = app.globalData.userInfo ? app.globalData.userInfo.id : 0;
        
        const formattedRoom = room ? {
          ...room,
          accumulated_tea_money: this.sanitizeScore(room.accumulated_tea_money)
        } : {};
        const formattedPlayers = (players || []).map(p => ({
          ...p,
          score: this.sanitizeScore(p.score)
        })).sort((a, b) => {
          if (a.user_id === myId) return -1;
          if (b.user_id === myId) return 1;
          return 0;
        });
        const formattedTransactions = (transactions || []).map(t => ({
          ...t,
          tea_deducted: this.sanitizeScore(t.tea_deducted),
          created_at: formatLocalTime(t.created_at)
        }));
        const personalTxs = formattedTransactions.filter(t => t.from_user_id === myId || t.to_user_id === myId);

        const isJustSettled = this.data.roomInfo.status === 0;

        this.setData({
          roomInfo: formattedRoom,
          players: formattedPlayers,
          transactions: formattedTransactions,
          personalTransactions: personalTxs,
          localVersion: room.version,
          teaProgress: progress,
          inputTotalTea: room.total_tea_money || '',
          inputPerTxTea: room.tea_money_per_tx || '',
          myUserId: myId,
          isOwner: room.owner_id === myId,
          roomStatus: room.status,
          hasViewedSettle: res.has_viewed_settle === 1,
          onlineUserIds: res.onlineUserIds || [],
          isLoadingData: false
        }, () => {
          this.drawTrendChart();
        });

        // 核心检查：如果房间已结算
        if (room.status === 1) {
          this.closeWebSocket();
          if (!this.data.hasViewedSettle && !this.data.showSettleReport) {
            this.showSettleReportPage(formattedPlayers);
          }
        }
      } else {
        this.setData({
          hasViewedSettle: res.has_viewed_settle === 1,
          onlineUserIds: res.onlineUserIds || [],
          isLoadingData: false // 数据加载成功，隐藏全屏加载态
        });
        if (this.data.roomInfo && this.data.roomInfo.status === 1) {
          this.closeWebSocket();
          if (!this.data.hasViewedSettle && !this.data.showSettleReport) {
            this.showSettleReportPage(this.data.players);
          }
        }
      }
    }).catch(err => {
      console.error('房间数据同步失败', err);
      this.setData({ isLoadingData: false });
    });
  },

  // 结算海报数据生成与展示
  showSettleReportPage: function (players) {
    // 拷贝并按积分从高到低排序
    const sorted = [...players].sort((a, b) => b.score - a.score);
    const mvp = sorted[0] && sorted[0].score > 0 ? sorted[0] : null;
    const settleSchemes = this.calculateSettleSchemes(players);

    this.setData({
      sortedPlayers: sorted.map(p => ({
        ...p,
        score: this.sanitizeScore(p.score)
      })),
      mvpPlayer: mvp ? {
        ...mvp,
        score: this.sanitizeScore(mvp.score)
      } : null,
      settleSchemes: settleSchemes,
      showSettleReport: true
    });
  },

  // 计算极简对账结算方案 (最小次数支付算法 - 采用整数运算规避精度误差)
  calculateSettleSchemes: function (players) {
    const teaMoney = parseFloat(this.data.roomInfo.accumulated_tea_money) || 0;
    // 放大 100 倍为整数运算，彻底规避 JS 浮点数精度问题 (例如 0.03 - 0.02 != 0.01)
    const teaMoneyInt = Math.round(teaMoney * 100);
    
    // 构造账目参与人
    const debtors = [];
    const creditors = [];

    // 获取当前选中的茶水收取人 ID
    const recipientId = this.data.selectedTeaRecipientId;

    // 将真实玩家进行分类并转换为整数
    players.forEach(p => {
      const score = this.sanitizeScore(p.score);
      let scoreInt = Math.round(score * 100);
      
      // 如果当前玩家被选为茶水接收者，将其积分加上茶水费以配平总账
      if (recipientId !== null && p.user_id === recipientId) {
        scoreInt += teaMoneyInt;
      }

      if (scoreInt < 0) {
        debtors.push({ name: p.nickname, amount: -scoreInt });
      } else if (scoreInt > 0) {
        creditors.push({ name: p.nickname, amount: scoreInt });
      }
    });

    // 如果未选择茶水收取人，且有茶水费，将茶水金库作为虚拟债权人加入以配平账目
    if (recipientId === null && teaMoneyInt > 0) {
      creditors.push({ name: '茶水金库', amount: teaMoneyInt });
    }

    const paths = [];
    
    // 按金额从大到小排序以达到极简合并效果
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    let dIdx = 0;
    let cIdx = 0;

    const dList = debtors.map(d => ({ ...d }));
    const cList = creditors.map(c => ({ ...c }));

    while (dIdx < dList.length && cIdx < cList.length) {
      const debtor = dList[dIdx];
      const creditor = cList[cIdx];

      if (debtor.amount <= 0) {
        dIdx++;
        continue;
      }
      if (creditor.amount <= 0) {
        cIdx++;
        continue;
      }

      const amount = Math.min(debtor.amount, creditor.amount);
      
      paths.push({
        from: debtor.name,
        to: creditor.name,
        amount: amount / 100 // 最终输出时再还原回浮点数，保持分值可读性
      });

      debtor.amount -= amount;
      creditor.amount -= amount;

      if (debtor.amount <= 0) dIdx++;
      if (creditor.amount <= 0) cIdx++;
    }

    // 过滤掉流向“茶水金库”的路径（因为茶水费不参与玩家间的结算，仅以提醒文字存在）
    return paths.filter(path => path.to !== '茶水金库');
  },

  // 手动强制同步刷新分数 (无视版本对比直接全量覆盖刷新)
  forceRefreshData: function () {
    if (this.data.isRefreshing || !this.data.roomId) return;
    this.setData({ isRefreshing: true });
    
    app.request({
      // 传入 local_version = -1，强制后端直接下发最新完整数据，避开对比缓存优化
      url: `/api/room/poll?room_id=${this.data.roomId}&local_version=-1`,
      method: 'GET'
    }).then(res => {
      this.setData({ isRefreshing: false });
      
      const room = res.room;
      const players = res.players || [];
      const transactions = res.transactions || [];
      
      let progress = 0;
      if (room.total_tea_money > 0) {
        progress = Math.min(100, Math.floor((room.accumulated_tea_money / room.total_tea_money) * 100));
      }
      
      const myId = app.globalData.userInfo ? app.globalData.userInfo.id : 0;
      
      const formattedRoom = room ? {
        ...room,
        accumulated_tea_money: this.sanitizeScore(room.accumulated_tea_money)
      } : {};
      const formattedPlayers = (players || []).map(p => ({
        ...p,
        score: this.sanitizeScore(p.score)
      })).sort((a, b) => {
        if (a.user_id === myId) return -1;
        if (b.user_id === myId) return 1;
        return 0;
      });
      const formattedTransactions = (transactions || []).map(t => ({
        ...t,
        tea_deducted: this.sanitizeScore(t.tea_deducted),
        created_at: formatLocalTime(t.created_at)
      }));
      const personalTxs = formattedTransactions.filter(t => t.from_user_id === myId || t.to_user_id === myId);
      
      const isJustSettled = this.data.roomInfo.status === 0;

      this.setData({
        roomInfo: formattedRoom,
        players: formattedPlayers,
        transactions: formattedTransactions,
        personalTransactions: personalTxs,
        localVersion: room.version,
        teaProgress: progress,
        inputTotalTea: room.total_tea_money || '',
        inputPerTxTea: room.tea_money_per_tx || '',
        myUserId: myId,
        isOwner: room.owner_id === myId,
        hasViewedSettle: res.has_viewed_settle === 1,
        roomStatus: room.status,
        isLoadingData: false
      }, () => {
        this.drawTrendChart();
      });
      
      wx.showToast({ title: '分数已同步', icon: 'success', duration: 800 });
      
      // 如果房间已结算，同样处理弹窗
      if (room.status === 1) {
        this.closeWebSocket();
        if (!this.data.hasViewedSettle && !this.data.showSettleReport) {
          this.showSettleReportPage(formattedPlayers);
        }
      }
    }).catch(err => {
      this.setData({ isRefreshing: false, isLoadingData: false });
      console.error('手动刷新分数失败', err);
    });
  },

  // 切换账单显示 Tab (总账单 / 个人账单)
  switchBillTab: function (e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeBillTab: tab });
  },

  // 关闭结算海报弹窗
  onCloseSettleReport: function () {
    this.setData({
      showSettleReport: false,
      hasViewedSettle: true,
      selectedTeaRecipientId: null // 关闭时重置选择器为默认不结算
    });
    this.reportSettleViewed();
  },

  // 退出房间回到首页大厅
  exitRoomToHome: function () {
    this.setData({
      hasViewedSettle: true,
      selectedTeaRecipientId: null // 退出时重置选择器
    });
    this.reportSettleViewed();
    wx.reLaunch({
      url: '/pages/index/index'
    });
  },

  // 向服务器上报结算单已读状态
  reportSettleViewed: function () {
    if (!this.data.roomId) return;
    app.request({
      url: '/api/room/view-settle',
      method: 'POST',
      data: { room_id: this.data.roomId }
    }).catch(err => {
      console.error('上报结算单已读失败:', err);
    });
  },

  // 返回上一页
  goBack: function () {
    if (this.data.roomInfo && this.data.roomInfo.status === 1) {
      wx.navigateBack({ delta: 1 });
    } else {
      wx.showModal({
        title: '退出房间',
        content: '退出后，你仍可通过输入房间号或扫码再次进入此房间。确认退出？',
        success: (res) => {
          if (res.confirm) {
            wx.navigateBack({ delta: 1 });
          }
        }
      });
    }
  },

  // 二维码弹窗管理
  showQRCodePopup: function () {
    this.setData({ showQRCode: true });
    
    // 如果已经加载了有效的二维码地址，免去重复载入
    if (this.data.qrCodeUrl && this.data.qrCodeUrl.startsWith('http')) {
      return;
    }

    // 自适应感知当前小程序的运行环境 (develop-开发版 / trial-体验版 / release-正式版)
    const accountInfo = wx.getAccountInfoSync();
    const envVersion = accountInfo.miniProgram.envVersion || 'release';

    wx.showLoading({ title: '加载中...', mask: true });
    app.request({
      url: `/api/room/qrcode?room_code=${this.data.roomCode}&env_version=${envVersion}`,
      method: 'GET'
    }).then(res => {
      wx.hideLoading();
      if (res && res.qrCodeUrl) {
        this.setData({ qrCodeUrl: res.qrCodeUrl });
      }
    }).catch(err => {
      wx.hideLoading();
      console.error('获取微信小程序码失败', err);
    });
  },

  onCloseQRCode: function () {
    this.setData({ showQRCode: false });
  },

  copyRoomCode: function () {
    wx.setClipboardData({
      data: this.data.roomCode,
      success: () => {
        wx.showToast({ title: '房号已复制', icon: 'success' });
      }
    });
  },

  // 茶水设置弹窗管理
  showTeaPopup: function () {
    this.setData({
      showTeaModal: true,
      inputTotalTea: this.data.roomInfo.total_tea_money || '',
      inputPerTxTea: this.data.roomInfo.tea_money_per_tx || '',
      inputTeaMode: this.data.roomInfo.tea_mode || 0
    });
  },

  onCloseTeaPopup: function () {
    this.setData({ 
      showTeaModal: false,
      keyboardHeight: 0
    });
  },

  onTotalTeaChange: function (e) {
    const rawVal = String(e.detail);
    // 允许输入最多两位小数的浮点数
    let val = rawVal.replace(/[^\d.]/g, '');
    const parts = val.split('.');
    if (parts.length > 2) {
      val = parts[0] + '.' + parts.slice(1).join('');
    }
    if (parts[1] && parts[1].length > 2) {
      val = parts[0] + '.' + parts[1].substring(0, 2);
    }
    this.setData({ inputTotalTea: val });
  },

  changeTeaMode: function (e) {
    const mode = parseInt(e.currentTarget.dataset.mode);
    this.setData({
      inputTeaMode: mode,
      inputPerTxTea: '' // 切换模式时清空已输入的每笔数值，防止格式错乱
    });
  },

  onPerTxTeaChange: function (e) {
    const rawVal = String(e.detail);
    // 无论固定金额还是百分比模式，均允许输入最多两位小数的浮点数
    let val = rawVal.replace(/[^\d.]/g, '');
    const parts = val.split('.');
    if (parts.length > 2) {
      val = parts[0] + '.' + parts.slice(1).join('');
    }
    if (parts[1] && parts[1].length > 2) {
      val = parts[0] + '.' + parts[1].substring(0, 2);
    }
    this.setData({ inputPerTxTea: val });
  },

  submitTeaConfig: function () {
    const totalStr = String(this.data.inputTotalTea).trim();
    const perStr = String(this.data.inputPerTxTea).trim();
    const mode = this.data.inputTeaMode;

    // 校验输入非空时必须是合法正数
    if (totalStr !== '' && (!/^\d+(\.\d+)?$/.test(totalStr) || parseFloat(totalStr) <= 0)) {
      wx.showToast({ title: '总茶水钱必须是正数', icon: 'none' });
      return;
    }
    if (perStr !== '' && (!/^\d+(\.\d+)?$/.test(perStr) || parseFloat(perStr) <= 0)) {
      wx.showToast({ title: '每笔扣除必须是正数', icon: 'none' });
      return;
    }

    const total = totalStr === '' ? 0 : parseFloat(totalStr);
    const per = perStr === '' ? 0 : parseFloat(perStr);

    if (mode === 0 && per > total && total > 0) {
      wx.showToast({ title: '每笔扣除不能大于总茶水钱', icon: 'none' });
      return;
    }
    if (mode === 1 && per > 100) {
      wx.showToast({ title: '百分比不能超过100%', icon: 'none' });
      return;
    }

    app.request({
      url: '/api/room/set-tea',
      method: 'POST',
      data: {
        room_id: this.data.roomId,
        total_tea_money: total,
        tea_money_per_tx: per,
        tea_mode: mode
      },
      loading: true,
      loadingTitle: '正在保存配置...'
    }).then(() => {
      this.setData({ showTeaModal: false });
    }).catch(() => {});
  },

  // 房主发起结算房间并结束游戏
  confirmSettleRoom: function () {
    // 拦截：如果房间内只有 1 名玩家，即使有茶水费也不允许结算
    if (this.data.players.length <= 1) {
      wx.showModal({
        title: '结算提示',
        content: '当前房间内只有 1 名玩家，无法生成结算单。是否直接返回游戏大厅？',
        confirmText: '返回大厅',
        cancelText: '留在房间',
        success: (res) => {
          if (res.confirm) {
            this.exitRoomToHome();
          }
        }
      });
      return;
    }

    // 拦截：如果未产生计分流水（对局没有发生过分值变化）
    if (this.data.transactions.length === 0) {
      wx.showModal({
        title: '结算提示',
        content: '当前房间未产生分值，无法生成结算单。是否直接返回游戏大厅？',
        confirmText: '返回大厅',
        cancelText: '留在房间',
        success: (res) => {
          if (res.confirm) {
            this.exitRoomToHome();
          }
        }
      });
      return;
    }

    wx.showModal({
      title: '结算并结束',
      content: '结束游戏后，房间内所有人的积分将被锁定封盘，并生成最终成绩单，确认结算？',
      success: (res) => {
        if (res.confirm) {
          app.request({
            url: '/api/room/settle',
            method: 'POST',
            data: { room_id: this.data.roomId },
            loading: true,
            loadingTitle: '正在结算...'
          }).then(() => {
            // 立即展示结算海报，无需等待轮询或推送延迟！
            this.showSettleReportPage(this.data.players);
          }).catch(() => {});
        }
      }
    });
  },

  // 记分操作：点击玩家头像
  onPlayerTap: function (e) {
    const clickedPlayer = e.currentTarget.dataset.user;
    
    // 如果房间已经结算，禁止再记分
    if (this.data.roomInfo.status === 1) return;

    const myId = this.data.myUserId;
    const isPureTea = clickedPlayer.user_id === myId; // 判断点击的是否是当前用户自己 (缴纳茶水费)

    if (isPureTea) {
      // 1. 如果是缴纳茶水费，找到自己在列表里的最新积分
      const myPlayer = this.data.players.find(p => p.user_id === myId) || clickedPlayer;
      
      this.setData({
        selectedPlayer: clickedPlayer,
        isPureTea: true,
        myCurrentScore: this.sanitizeScore(myPlayer.score) || 0,
        selectedPayerId: myId,
        inputScore: '',
        deductTeaChecked: false, // 缴纳茶水不显示扣除茶水开关
        showScoreModal: true,
        scoreFieldFocus: false, // 先置为 false
        avatarUrl: app.globalData.userInfo ? (app.globalData.userInfo.avatar_url || '') : (myPlayer.avatar_url || ''),
        nickname: app.globalData.userInfo ? (app.globalData.userInfo.nickname || '') : (myPlayer.nickname || '')
      });
    } else {
      // 2. 如果点击的是其他玩家，默认且强制指定由我（当前用户）给他付分
      this.setData({
        selectedPlayer: clickedPlayer,
        isPureTea: false,
        selectedPayerId: myId,
        inputScore: '',
        // 如果茶水没满，默认开启扣茶水费
        deductTeaChecked: this.data.roomInfo.tea_money_per_tx > 0 && this.data.roomInfo.accumulated_tea_money < this.data.roomInfo.total_tea_money,
        showScoreModal: true,
        scoreFieldFocus: false, // 先置为 false
      });
    }

    // 延迟等待弹出过渡完成，以保证微信内自动调起键盘成功率
    setTimeout(() => {
      this.setData({
        scoreFieldFocus: true
      });
    }, 320);
  },

  onCloseScorePopup: function () {
    this.setData({ 
      showScoreModal: false,
      keyboardHeight: 0,
      scoreFieldFocus: false
    });
  },

  onScoreValueChange: function (e) {
    this.setData({ inputScore: e.detail });
  },

  onTeaSwitchChange: function (e) {
    this.setData({ deductTeaChecked: e.detail });
  },

  // 提交分数
  submitScore: function () {
    const amount = parseFloat(this.data.inputScore) || 0;
    if (amount <= 0) {
      wx.showToast({ title: '请输入正确的正数分值', icon: 'none' });
      return;
    }

    const myId = this.data.myUserId;
    if (!myId) {
      wx.showToast({ title: '登录信息已失效，请重新登录', icon: 'none' });
      return;
    }

    // 1. 如果是点击自己（纯交茶水费）
    if (this.data.isPureTea) {
      const room = this.data.roomInfo;
      // 在点击确认时做拦截（允许点击弹起窗，但如果茶水已满或不需要则禁止提交分值）
      if (room.total_tea_money <= 0) {
        wx.showToast({ title: '本房间未设置茶水规则，无需缴纳', icon: 'none' });
        return;
      }
      if (room.accumulated_tea_money >= room.total_tea_money) {
        wx.showToast({ title: '本房间茶水费已收满，无需缴纳', icon: 'none' });
        return;
      }

      app.request({
        url: '/api/room/score',
        method: 'POST',
        data: {
          room_id: this.data.roomId,
          from_user_id: myId,
          to_user_id: 0, // to_user_id 传 0 代表纯扣茶水费
          amount: amount,
          deduct_tea: false
        },
        loading: true,
        loadingTitle: '正在缴纳茶水...'
      }).then(() => {
        this.setData({ showScoreModal: false });
        // 成功后，下一秒的轮询自动更新页面分数
      }).catch(() => {});

    } else {
      // 2. 普通记分（我付分给得分人）
      app.request({
        url: '/api/room/score',
        method: 'POST',
        data: {
          room_id: this.data.roomId,
          from_user_id: myId, // 付款人锁死为自己
          to_user_id: this.data.selectedPlayer.user_id, // 得分人
          amount: amount,
          deduct_tea: this.data.deductTeaChecked
        },
        loading: true,
        loadingTitle: '正在记账...'
      }).then(() => {
        this.setData({ showScoreModal: false });
        // 成功后，下一秒的轮询自动更新页面分数
      }).catch(() => {});
    }
  },

  // 撤销计分操作
  onUndoTap: function (e) {
    const tx = e.currentTarget.dataset.tx;
    
    // 如果房间已经结算，禁止撤销
    if (this.data.roomInfo.status === 1) return;

    wx.showModal({
      title: '撤销记账',
      content: `确定撤销 [${tx.from_nickname} ➔ ${tx.to_nickname} +${tx.amount}分] 这笔交易吗？分数和茶水钱都将退回。`,
      success: (res) => {
        if (res.confirm) {
          app.request({
            url: '/api/room/undo',
            method: 'POST',
            data: {
              room_id: this.data.roomId,
              transaction_id: tx.id
            },
            loading: true,
            loadingTitle: '正在撤销...'
          }).then(() => {
            wx.showToast({ title: '撤销成功', icon: 'success' });
            // 下一秒轮询自动同步更新
          }).catch(() => {});
        }
      }
    });
  },

  // 微信快捷选择头像回调 (最新规范)
  onChooseAvatar: function (e) {
    const { avatarUrl } = e.detail;
    
    // 调用微信底层的上传接口将本地临时头像上传至 Cloudflare R2 存储库中
    wx.showLoading({ title: '上传头像中...', mask: true });
    wx.uploadFile({
      url: `${app.globalData.apiUrl}/api/upload`,
      filePath: avatarUrl,
      name: 'file',
      header: {
        'Authorization': `Bearer ${app.globalData.token}`
      },
      success: (res) => {
        wx.hideLoading();
        try {
          const apiRes = JSON.parse(res.data);
          if (apiRes.code === 0 && apiRes.data?.avatarUrl) {
            const onlineUrl = apiRes.data.avatarUrl;
            this.setData({ avatarUrl: onlineUrl });
          } else {
            wx.showToast({ title: apiRes.message || '头像保存失败', icon: 'none' });
          }
        } catch (err) {
          wx.showToast({ title: '解析上传数据失败', icon: 'none' });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        wx.showToast({ title: '网络上传失败，请检查网络', icon: 'none' });
      }
    });
  },

  // 微信快捷填入昵称失去焦点回调 (最新规范)
  onNicknameBlur: function (e) {
    const nickname = e.detail.value;
    this.setData({ 
      nickname,
      keyboardHeight: 0
    });
  },

  onNicknameInput: function (e) {
    this.setData({
      nickname: e.detail.value
    });
  },

  // 保存个人信息并且刷新房间信息
  saveProfile: function () {
    // 延迟 100ms 执行保存，给 input 失去焦点(bindblur)的 setData 留出充足的时间更新 Data 中的 nickname
    setTimeout(() => {
      const nickname = this.data.nickname ? this.data.nickname.trim() : '';
      const avatarUrl = this.data.avatarUrl;
      
      if (!nickname) {
        wx.showToast({ title: '昵称不能为空', icon: 'none' });
        return;
      }
      
      wx.showLoading({ title: '保存中...', mask: true });
      
      app.request({
        url: '/api/user/update',
        method: 'POST',
        data: {
          nickname: nickname,
          avatar_url: avatarUrl
        }
      }).then(updatedUser => {
        wx.hideLoading();
        app.globalData.userInfo = updatedUser;
        wx.setStorageSync('userInfo', updatedUser);
        wx.showToast({ title: '保存成功', icon: 'success' });
        
        // 更新当前页面数据以反映新改的个人信息，不直接修改本地 players 数组，完全走后端网络广播同步
        this.setData({
          myUserId: updatedUser.id,
          nickname: updatedUser.nickname || '',
          avatarUrl: updatedUser.avatar_url || ''
        });

        // 触发后端广播更新，这样其他人的屏幕也会立即看到我的新头像和昵称！
        app.request({
          url: '/api/room/broadcast-update',
          method: 'POST',
          data: {
            room_id: this.data.roomId
          }
        }).catch((err) => {
          console.error('触发修改个人信息广播失败', err);
        });
      }).catch(err => {
        wx.hideLoading();
        wx.showToast({ title: '保存失败', icon: 'none' });
        console.error('手动保存个人信息失败', err);
      });
    }, 100);
  },

  onInputFocus: function (e) {
    const keyboardHeight = e.detail.height || 0;
    this.setData({
      keyboardHeight: keyboardHeight
    });
  },

  onInputBlur: function () {
    this.setData({
      keyboardHeight: 0
    });
  },

  // 格式化数字，解决 JS 小数精度显示异常问题（如 -55.599999999999994 -> -55.6）
  sanitizeScore: function (num) {
    if (num === null || num === undefined) return 0;
    const parsed = parseFloat(num);
    if (isNaN(parsed)) return 0;
    // 保留最多两位小数，并去除末尾无用的 0
    return Math.round(parsed * 100) / 100;
  },

  // 快捷分值标签点击回调
  onQuickScoreTap: function (e) {
    const val = e.currentTarget.dataset.val;
    this.setData({
      inputScore: val
    });
  },

  // 绘制局势走势折线图 (ECharts 2D)
  drawTrendChart: function () {
    if (this.data.roomStatus !== 1 || !this.data.isTrendExpanded) return;

    const players = this.data.players || [];
    if (players.length === 0) return;

    wx.nextTick(() => {
      const chartComponent = this.selectComponent('#trendChartDom');
      if (!chartComponent) {
        console.warn('未找到 ECharts 组件，跳过局势走势图绘制');
        return;
      }

      if (this.chartInstance) {
        // 实例已存在，直接热更新配置，极速渲染
        try {
          this.chartInstance.setOption(this.getChartOption(), true);
        } catch (err) {
          console.error('更新 ECharts 失败', err);
        }
      } else {
        // 实例不存在，LazyLoad 初始化
        chartComponent.init((canvas, width, height, dpr) => {
          try {
            const chart = echarts.init(canvas, null, {
              width: width,
              height: height,
              devicePixelRatio: dpr
            });
            canvas.setChart(chart);
            this.chartInstance = chart;
            chart.setOption(this.getChartOption());
            return chart;
          } catch (err) {
            console.error('初始化 ECharts 失败', err);
          }
        });
      }
    });
  },

  // 获取 ECharts 的配置项及动态系列数据
  getChartOption: function () {
    const players = this.data.players || [];
    const transactions = this.data.transactions || [];
    
    // 过滤已撤销的交易，按时间正序排列（从早到晚）
    const validTxs = [...transactions]
      .filter(t => t.is_undone !== 1)
      .reverse();

    // 统计每一轮之后各玩家的分值累计变化
    const playerHistory = {};
    const currentScores = {};
    players.forEach(p => {
      playerHistory[p.user_id] = [0];
      currentScores[p.user_id] = 0;
    });

    validTxs.forEach(tx => {
      const amount = parseFloat(tx.amount) || 0;
      const teaDeducted = parseFloat(tx.tea_deducted) || 0;

      if (currentScores[tx.from_user_id] !== undefined) {
        currentScores[tx.from_user_id] -= amount;
      }
      if (tx.to_user_id && currentScores[tx.to_user_id] !== undefined) {
        currentScores[tx.to_user_id] += (amount - teaDeducted);
      }

      players.forEach(p => {
        playerHistory[p.user_id].push(currentScores[p.user_id]);
      });
    });

    const rounds = Array.from({ length: validTxs.length + 1 }, (_, i) => `R${i}`);

    // 高端配色体系
    const lineColors = this.data.lineColors;

    // 组装折线系列数据，开启 smooth 使曲线自然平滑
    const series = players.map((p, idx) => {
      return {
        name: p.nickname,
        type: 'line',
        data: playerHistory[p.user_id],
        smooth: true,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: {
          width: 3,
          color: lineColors[idx % lineColors.length]
        },
        itemStyle: {
          color: lineColors[idx % lineColors.length]
        }
      };
    });

    return {
      color: lineColors,
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'line',
          lineStyle: {
            color: '#b2c4c1',
            width: 1,
            type: 'dashed'
          }
        },
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        textStyle: {
          color: '#596c68',
          fontSize: 11
        },
        borderWidth: 0,
        extraCssText: 'box-shadow: 0 4rpx 20rpx rgba(11, 155, 119, 0.15); border-radius: 16rpx;'
      },
      legend: {
        data: players.map(p => p.nickname),
        top: 5,
        left: 'center',
        itemWidth: 12,
        itemHeight: 8,
        textStyle: {
          color: '#809a96',
          fontSize: 10,
          fontFamily: 'sans-serif'
        }
      },
      grid: {
        left: '4%',
        right: '5%', // 还原右边距，让折线图在右侧充盈显示
        bottom: '5%',
        top: '22%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: rounds,
        axisLine: {
          lineStyle: {
            color: '#eef3f1'
          }
        },
        axisLabel: {
          color: '#809a96',
          fontSize: 10
        }
      },
      yAxis: {
        type: 'value',
        axisLine: {
          show: false
        },
        axisTick: {
          show: false
        },
        splitLine: {
          lineStyle: {
            color: '#eef3f1'
          }
        },
        axisLabel: {
          color: '#809a96',
          fontSize: 10
        }
      },
      series: series
    };
  },

  // 手风琴折叠收起控制，并在展开时完成图表首次初始化
  toggleTrendChart: function () {
    const nextState = !this.data.isTrendExpanded;
    this.setData({
      isTrendExpanded: nextState
    }, () => {
      if (nextState) {
        // 当展开动作触发时，延时 150ms 等待 CSS 高度动画进行到合适程度后，再初始化 ECharts 以防尺寸测算为 0
        setTimeout(() => {
          this.drawTrendChart();
        }, 150);
      }
    });
  },

  // 主动触发打开结算单弹窗
  onOpenSettleReport: function () {
    this.showSettleReportPage(this.data.players);
  },

  // 茶水金库结算对象选中事件
  onSelectTeaRecipient: function (e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      selectedTeaRecipientId: id
    }, () => {
      // 重新计算结算方案以在 UI 中实时呈现更新
      const settleSchemes = this.calculateSettleSchemes(this.data.players);
      this.setData({
        settleSchemes: settleSchemes
      });
    });
  }
});
