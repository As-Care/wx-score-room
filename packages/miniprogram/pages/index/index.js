const app = getApp();

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    avatarUrl: '',
    nickname: '',
    showJoinModal: false,
    roomCodeInput: '',
    inputFocus: false,
    keyboardHeight: 0,
    showExistingRoomModal: false,
    existingRoomCode: '',
    existingRoomId: '',
    existingRoomExpireMinutes: 30,
    announcement: ''
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

  onShow: function () {
    this.fetchSystemConfig();
  },

  fetchSystemConfig: function () {
    app.request({
      url: '/api/config',
      method: 'GET'
    }).then(res => {
      this.setData({
        announcement: res.announcement || ''
      });
      app.globalData.maintenanceMode = res.maintenance_mode === 1;
    }).catch(err => {
      console.error('获取系统配置失败', err);
    });
  },

  // 分享给好友
  onShareAppMessage: function () {
    return {
      title: '📝 打牌记账，轻松记分对账小助手',
      path: '/pages/index/index',
      imageUrl: 'https://score-room.carelife.top/common/wx-score-room-logo.png'
    };
  },

  // 分享到朋友圈
  onShareTimeline: function () {
    return {
      title: '📝 打牌记账，轻松记分对账小助手',
      query: '',
      imageUrl: 'https://score-room.carelife.top/common/wx-score-room-logo.png'
    };
  },

  // 静默登录并初始化用户信息 (优先读取缓存 Token 以防开发降级时 OpenID 重新生成)
  initUserSession: function () {
    return new Promise((resolve) => {
      const cachedToken = app.globalData.token || wx.getStorageSync('token');
      
      if (cachedToken) {
        // 1. 本地有凭证，直接向后端获取已存的用户数据，这可以避免微信 code 每次编译都不同导致降级重新生成新 openid 的问题
        app.request({
          url: '/api/user/me',
          method: 'GET'
        }).then(user => {
          app.globalData.token = cachedToken;
          app.globalData.userInfo = user;
          wx.setStorageSync('userInfo', user);
          
          this.setData({
            avatarUrl: user.avatar_url || '',
            nickname: user.nickname || ''
          });
          resolve();
        }).catch(() => {
          // 如果凭证失效了，清空并重新走微信登录获取 openid
          wx.removeStorageSync('token');
          wx.removeStorageSync('userInfo');
          app.globalData.token = '';
          app.globalData.userInfo = null;
          this.executeFreshLogin().then(resolve);
        });
      } else {
        // 2. 本地无凭证，走微信正常 login 流程
        this.executeFreshLogin().then(resolve);
      }
    });
  },

  // 微信新鲜登录换取凭证
  executeFreshLogin: function () {
    return new Promise((resolve) => {
      app.login().then(user => {
        this.setData({
          avatarUrl: user.avatar_url || '',
          nickname: user.nickname || ''
        });
        resolve();
      }).catch(() => {
        // 本地没有 Token 且登录失败，开发假数据降级
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
    this.setData({ nickname });
  },

  onNicknameInput: function (e) {
    this.setData({
      nickname: e.detail.value
    });
  },

  // 显式保存个人信息，弹出提示并持久化到数据库
  saveProfile: function () {
    // 延迟 100ms 执行保存，给 input 失去焦点(bindblur)的 setData 留出充足的时间更新 Data 中的 nickname
    setTimeout(() => {
      if (!this.checkSessionReady()) return;
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
      }).catch(err => {
        wx.hideLoading();
        wx.showToast({ title: '保存失败', icon: 'none' });
        console.error('手动保存个人信息失败', err);
      });
    }, 100);
  },

  // 创建房间并自动进入
  onCreateRoom: function (forceNew = false) {
    if (app.globalData.maintenanceMode) {
      wx.showModal({
        title: '系统维护中',
        content: '系统当前正在例行维护中，期间暂停创建房间。请稍后再试！',
        showCancel: false
      });
      return;
    }
    if (!this.checkSessionReady()) return;
    if (!this.data.nickname.trim()) {
      wx.showToast({ title: '请先设置您的昵称', icon: 'none' });
      return;
    }

    app.request({
      url: '/api/room/create',
      method: 'POST',
      data: {
        nickname: this.data.nickname,
        avatar_url: this.data.avatarUrl,
        force_new: forceNew === true
      },
      loading: true,
      loadingTitle: '正在创建房间...'
    }).then(res => {
      if (res.status === 'existing_single_room') {
        this.setData({
          showExistingRoomModal: true,
          existingRoomCode: res.room_code,
          existingRoomId: res.room_id,
          existingRoomExpireMinutes: res.expire_minutes !== undefined ? res.expire_minutes : 30
        });
      } else {
        this.setData({ showExistingRoomModal: false });
        wx.navigateTo({
          url: `/pages/room/index?room_id=${res.id}&room_code=${res.room_code}&is_owner=true`
        });
      }
    }).catch(() => {});
  },

  // 续用未开始的单人房
  useExistingRoom: function () {
    this.setData({ showExistingRoomModal: false });
    wx.navigateTo({
      url: `/pages/room/index?room_id=${this.data.existingRoomId}&room_code=${this.data.existingRoomCode}&is_owner=true`
    });
  },

  // 放弃旧房，强行新建房间
  createNewRoomForce: function () {
    this.setData({ showExistingRoomModal: false });
    this.onCreateRoom(true);
  },

  // 关闭已有未开始房间提示弹窗
  onCloseExistingRoomPopup: function () {
    this.setData({ showExistingRoomModal: false });
  },

  // 显示手动输入房间号弹窗
  showJoinPopup: function () {
    if (!this.checkSessionReady()) return;
    if (!this.data.nickname.trim()) {
      wx.showToast({ title: '请先设置您的昵称', icon: 'none' });
      return;
    }
    this.setData({
      showJoinModal: true,
      roomCodeInput: '',
      inputFocus: false
    });
    // 延迟等待弹出过渡完成，以保证微信内自动调起键盘成功率
    setTimeout(() => {
      this.setData({
        inputFocus: true
      });
    }, 320);
  },

  onCloseJoinPopup: function () {
    this.setData({
      showJoinModal: false,
      inputFocus: false,
      keyboardHeight: 0
    });
  },

  // 监听键盘高度聚焦
  onInputFocus: function (e) {
    this.setData({
      keyboardHeight: e.detail.height || 0
    });
  },

  // 监听键盘高度失焦
  onInputBlur: function () {
    this.setData({
      keyboardHeight: 0
    });
  },

  focusInput: function () {
    this.setData({ inputFocus: true });
  },

  // 监听隐藏的真实输入框
  onRoomCodeInput: function (e) {
    const val = e.detail.value.toUpperCase();
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
    if (app.globalData.maintenanceMode) {
      wx.showModal({
        title: '系统维护中',
        content: '系统当前正在例行维护中，期间暂停加入房间。请稍后再试！',
        showCancel: false
      });
      return;
    }
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
    if (!this.checkSessionReady()) return;
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
    if (!this.checkSessionReady()) return;
    wx.navigateTo({
      url: '/pages/profile/index'
    });
  },

  // 辅助验证登录凭证是否就绪，拦截未登录时的误操作
  checkSessionReady: function () {
    if (!app.globalData.token) {
      wx.showToast({ title: '正在建立连接，请稍后...', icon: 'none' });
      return false;
    }
    return true;
  }
});
