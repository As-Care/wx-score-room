const app = getApp();

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    avatarUrl: '',
    nickname: '',
    showJoinModal: false,
    roomCodeInput: '',
    inputFocus: false
  },

  onLoad: function (options) {
    // 1. 获取导航栏适配尺寸
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight
    });

    // 2. 初始化登录和获取个人信息
    this.initUserSession().then(() => {
      // 3. 检查是否是通过“扫码/分享”携带参数进入的
      this.checkShareOptions(options);
    });
  },

  // 静默登录并初始化用户信息
  initUserSession: function () {
    return new Promise((resolve) => {
      const userInfo = app.globalData.userInfo;
      if (userInfo) {
        this.setData({
          avatarUrl: userInfo.avatar_url || '',
          nickname: userInfo.nickname || ''
        });
      }

      // 无论缓存有无，均静默登录一次获取/刷新 token
      app.login().then(user => {
        this.setData({
          avatarUrl: user.avatar_url || '',
          nickname: user.nickname || ''
        });
        resolve();
      }).catch(() => {
        // 如果登录失败且本地没有 token，则伪造一个开发 token 保证流程可用
        if (!app.globalData.token) {
          const devToken = 'test_' + Math.random().toString(36).substring(2, 8);
          app.login(devToken).then(user => {
            this.setData({
              avatarUrl: user.avatar_url || '',
              nickname: user.nickname || ''
            });
            resolve();
          });
        } else {
          resolve();
        }
      });
    });
  },

  // 检查扫码/链接分享携带进来的房间号参数
  checkShareOptions: function (options) {
    let roomCode = options.room_code;
    
    // 如果是微信小程序码扫码进入，参数会放在 scene 中
    if (options.scene) {
      const scene = decodeURIComponent(options.scene);
      // 约定 scene 格式为 "code=123456" 或直接是 "123456"
      if (scene.includes('code=')) {
        roomCode = scene.split('code=')[1];
      } else {
        roomCode = scene;
      }
    }

    if (roomCode) {
      wx.showModal({
        title: '加入房间',
        content: `是否立即加入房间 ${roomCode}？`,
        success: (res) => {
          if (res.confirm) {
            this.executeJoinRoom(roomCode);
          }
        }
      });
    }
  },

  // 微信快捷选择头像回调 (最新规范)
  onChooseAvatar: function (e) {
    const { avatarUrl } = e.detail;
    this.setData({ avatarUrl });
    this.updateUserProfile(this.data.nickname, avatarUrl);
  },

  // 微信快捷填入昵称失去焦点回调 (最新规范)
  onNicknameBlur: function (e) {
    const nickname = e.detail.value;
    this.setData({ nickname });
    this.updateUserProfile(nickname, this.data.avatarUrl);
  },

  onNicknameInput: function (e) {
    this.setData({
      nickname: e.detail.value
    });
  },

  // 提交个人信息更新到后端
  updateUserProfile: function (nickname, avatarUrl) {
    if (!nickname) return;
    
    app.request({
      url: '/api/user/update',
      method: 'POST',
      data: {
        nickname: nickname,
        avatar_url: avatarUrl
      }
    }).then(updatedUser => {
      app.globalData.userInfo = updatedUser;
      wx.setStorageSync('userInfo', updatedUser);
    }).catch(err => {
      console.error('更新用户信息失败', err);
    });
  },

  // 创建房间并自动进入
  onCreateRoom: function () {
    if (!this.data.nickname.trim()) {
      wx.showToast({ title: '请先设置您的昵称', icon: 'none' });
      return;
    }

    app.request({
      url: '/api/room/create',
      method: 'POST',
      data: {
        nickname: this.data.nickname,
        avatar_url: this.data.avatarUrl
      },
      loading: true,
      loadingTitle: '正在创建房间...'
    }).then(room => {
      wx.navigateTo({
        url: `/pages/room/index?room_id=${room.id}&room_code=${room.room_code}&is_owner=true`
      });
    }).catch(() => {});
  },

  // 显示手动输入房间号弹窗
  showJoinPopup: function () {
    if (!this.data.nickname.trim()) {
      wx.showToast({ title: '请先设置您的昵称', icon: 'none' });
      return;
    }
    this.setData({
      showJoinModal: true,
      roomCodeInput: '',
      inputFocus: true
    });
  },

  onCloseJoinPopup: function () {
    this.setData({
      showJoinModal: false,
      inputFocus: false
    });
  },

  focusInput: function () {
    this.setData({ inputFocus: true });
  },

  // 监听隐藏的真实输入框
  onRoomCodeInput: function (e) {
    const val = e.detail.value;
    this.setData({ roomCodeInput: val });
    
    // 输入满6位自动提交
    if (val.length === 6) {
      this.submitJoinRoom();
    }
  },

  // 提交手动输入的房号
  submitJoinRoom: function () {
    const code = this.data.roomCodeInput;
    if (code.length < 6) return;
    
    this.setData({ showJoinModal: false, inputFocus: false });
    this.executeJoinRoom(code);
  },

  // 统一执行加入房间的 HTTP 请求与跳转
  executeJoinRoom: function (roomCode) {
    app.request({
      url: '/api/room/join',
      method: 'POST',
      data: {
        room_code: roomCode,
        nickname: this.data.nickname,
        avatar_url: this.data.avatarUrl
      },
      loading: true,
      loadingTitle: '正在加入房间...'
    }).then(room => {
      const isOwner = room.owner_id === app.globalData.userInfo?.id;
      wx.navigateTo({
        url: `/pages/room/index?room_id=${room.id}&room_code=${room.room_code}&is_owner=${isOwner}`
      });
    }).catch(() => {});
  },

  // 拉起扫码
  onScanCode: function () {
    if (!this.data.nickname.trim()) {
      wx.showToast({ title: '请先设置您的昵称', icon: 'none' });
      return;
    }

    wx.scanCode({
      scanType: ['qrCode'],
      success: (res) => {
        const resultUrl = res.result;
        // 支持两种扫码格式：纯6位房号数字，或者带 room_code=xxxx 参数的 URL
        let roomCode = '';
        if (/^\d{6}$/.test(resultUrl)) {
          roomCode = resultUrl;
        } else if (resultUrl.includes('room_code=')) {
          const match = resultUrl.match(/room_code=(\d{6})/);
          if (match) roomCode = match[1];
        } else if (resultUrl.includes('code=')) {
          const match = resultUrl.match(/code=(\d{6})/);
          if (match) roomCode = match[1];
        }

        if (roomCode) {
          this.executeJoinRoom(roomCode);
        } else {
          wx.showToast({ title: '未识别出合规的房间号', icon: 'none' });
        }
      },
      fail: () => {
        // 取消扫码不报错
      }
    });
  },

  goToProfile: function () {
    wx.navigateTo({
      url: '/pages/profile/index'
    });
  }
});
