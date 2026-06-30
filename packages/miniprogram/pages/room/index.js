const app = getApp();

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
    myUserId: 0
  },

  intervalId: null, // 用于轮询的定时器 ID

  onLoad: function (options) {
    // 1. 设置导航适配高度
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      roomId: parseInt(options.room_id) || 0,
      roomCode: options.room_code || '',
      isOwner: options.is_owner === 'true',
      qrCodeUrl: '',
      myUserId: app.globalData.userInfo ? app.globalData.userInfo.id : 0
    });

    // 2. 立即拉取一次房间数据
    this.pollRoomData();

    // 3. 启动 1 秒 1 次的智能轮询
    this.startPolling();
  },

  onUnload: function () {
    // 页面销毁时，务必清除定时器，释放资源
    this.stopPolling();
  },

  // 微信转发/分享房间设置 (分享到聊天窗口)
  onShareAppMessage: function () {
    return {
      title: `🎮 邀请你加入我的计分房: ${this.data.roomCode}，来联机对局吧！`,
      path: `/pages/index/index?room_code=${this.data.roomCode}`,
      imageUrl: '/images/share-card.png' // 如果没有该图片，微信会自动截屏当前页面
    };
  },

  // 启动智能轮询
  startPolling: function () {
    this.stopPolling(); // 确保安全，先清除之前的
    this.intervalId = setInterval(() => {
      this.pollRoomData();
    }, 1000);
  },

  // 清除轮询
  stopPolling: function () {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  },

  // 轮询核心请求
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

        this.setData({
          roomInfo: room,
          players: players,
          transactions: transactions,
          localVersion: room.version,
          teaProgress: progress,
          inputTotalTea: room.total_tea_money || '',
          inputPerTxTea: room.tea_money_per_tx || '',
          myUserId: app.globalData.userInfo ? app.globalData.userInfo.id : 0
        });

        // 核心检查：如果房间已结算，自动停止轮询并弹出结算大赢家海报
        if (room.status === 1) {
          this.stopPolling();
          this.showSettleReportPage(players);
        }
      }
    }).catch(err => {
      console.error('房间轮询同步失败', err);
    });
  },

  // 结算海报数据生成与展示
  showSettleReportPage: function (players) {
    // 拷贝并按积分从高到低排序
    const sorted = [...players].sort((a, b) => b.score - a.score);
    const mvp = sorted.length > 0 ? sorted[0] : null;

    this.setData({
      sortedPlayers: sorted,
      mvpPlayer: mvp,
      showSettleReport: true
    });
  },

  // 退出房间回到首页大厅
  exitRoomToHome: function () {
    wx.reLaunch({
      url: '/pages/index/index'
    });
  },

  // 返回上一页
  goBack: function () {
    wx.showModal({
      title: '退出房间',
      content: '退出后，你仍可通过输入房间号或扫码再次进入此房间。确认退出？',
      success: (res) => {
        if (res.confirm) {
          wx.navigateBack({ delta: 1 });
        }
      }
    });
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
      inputPerTxTea: this.data.roomInfo.tea_money_per_tx || ''
    });
  },

  onCloseTeaPopup: function () {
    this.setData({ showTeaModal: false });
  },

  onTotalTeaChange: function (e) {
    // 强制正则过滤掉所有非数字字符（包含负号、小数点、字母等），防范源头输入错误
    const val = String(e.detail).replace(/[^\d]/g, '');
    this.setData({ inputTotalTea: val });
  },

  onPerTxTeaChange: function (e) {
    // 强制正则过滤掉所有非数字字符（包含负号、小数点、字母等），防范源头输入错误
    const val = String(e.detail).replace(/[^\d]/g, '');
    this.setData({ inputPerTxTea: val });
  },

  submitTeaConfig: function () {
    const totalStr = String(this.data.inputTotalTea).trim();
    const perStr = String(this.data.inputPerTxTea).trim();

    // 校验输入非空时必须是大于0的正整数
    if (totalStr !== '' && (!/^\d+$/.test(totalStr) || parseInt(totalStr) <= 0)) {
      wx.showToast({ title: '总茶水钱必须是正数', icon: 'none' });
      return;
    }
    if (perStr !== '' && (!/^\d+$/.test(perStr) || parseInt(perStr) <= 0)) {
      wx.showToast({ title: '每笔扣除必须是正数', icon: 'none' });
      return;
    }

    const total = totalStr === '' ? 0 : parseInt(totalStr);
    const per = perStr === '' ? 0 : parseInt(perStr);

    if (per > total && total > 0) {
      wx.showToast({ title: '每笔扣除不能大于总茶水钱', icon: 'none' });
      return;
    }

    app.request({
      url: '/api/room/set-tea',
      method: 'POST',
      data: {
        room_id: this.data.roomId,
        total_tea_money: total,
        tea_money_per_tx: per
      },
      loading: true,
      loadingTitle: '正在保存配置...'
    }).then(() => {
      this.setData({ showTeaModal: false });
      // 成功后，下一秒的轮询会自动同步状态
    }).catch(() => {});
  },

  // 房主发起结算房间并结束游戏
  confirmSettleRoom: function () {
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
            // 结算成功后，下一秒的轮询自动触发结算海报展示
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
        myCurrentScore: myPlayer.score || 0,
        selectedPayerId: myId,
        inputScore: '',
        deductTeaChecked: false, // 缴纳茶水不显示扣除茶水开关
        showScoreModal: true
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
        showScoreModal: true
      });
    }
  },

  onCloseScorePopup: function () {
    this.setData({ showScoreModal: false });
  },

  onScoreValueChange: function (e) {
    this.setData({ inputScore: e.detail });
  },

  onTeaSwitchChange: function (e) {
    this.setData({ deductTeaChecked: e.detail });
  },

  // 提交分数
  submitScore: function () {
    const amount = parseInt(this.data.inputScore) || 0;
    if (amount <= 0) {
      wx.showToast({ title: '请输入正确的正整数分值', icon: 'none' });
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
        loadingTitle: '正在记分...'
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
      title: '撤销计分',
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
  }
});
