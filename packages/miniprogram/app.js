App({
  // 全局变量配置
  globalData: {
    // 后端服务器地址，本地调试用 http://127.0.0.1:8787，部署后替换为 Cloudflare Workers 域名
    apiUrl: 'https://wx-score-room.carelife.top',
    token: '',
    userInfo: null,
    // 状态栏和胶囊菜单信息，用于自定义导航栏的适配
    statusBarHeight: 20,
    navBarHeight: 44,
    menuButtonRect: null
  },

  onLaunch: function (options) {
    // 1. 获取系统信息，计算自定义导航栏高度
    const systemInfo = wx.getSystemInfoSync();
    this.globalData.statusBarHeight = systemInfo.statusBarHeight || 20;
    
    // 获取微信胶囊按钮的尺寸和位置
    if (wx.getMenuButtonBoundingClientRect) {
      const menuButton = wx.getMenuButtonBoundingClientRect();
      this.globalData.menuButtonRect = menuButton;
      // 导航栏高度 = (胶囊顶部距离 - 状态栏高度) * 2 + 胶囊高度
      this.globalData.navBarHeight = (menuButton.top - systemInfo.statusBarHeight) * 2 + menuButton.height;
    } else {
      this.globalData.navBarHeight = 44;
    }

    // 2. 从本地缓存中读取登录凭证和用户信息
    const token = wx.getStorageSync('token');
    const userInfo = wx.getStorageSync('userInfo');
    if (token) {
      this.globalData.token = token;
    }
    if (userInfo) {
      this.globalData.userInfo = userInfo;
    }
  },

  // 统一封装请求方法，内置 Loading、Auth 头、错误提示及自动注册逻辑
  request: function (options) {
    const that = this;
    const { url, method = 'GET', data = {}, loading = false, loadingTitle = '加载中...' } = options;

    if (loading) {
      wx.showLoading({ title: loadingTitle, mask: true });
    }

    return new Promise((resolve, reject) => {
      // 构造请求头
      const header = {
        'content-type': 'application/json'
      };
      if (that.globalData.token) {
        header['Authorization'] = `Bearer ${that.globalData.token}`;
      }

      wx.request({
        url: `${that.globalData.apiUrl}${url}`,
        method: method,
        data: data,
        header: header,
        success: (res) => {
          if (loading) wx.hideLoading();

          // 处理 HTTP 状态码
          if (res.statusCode === 401) {
            // Token 失效或未登录，跳转至首页重新登录
            wx.removeStorageSync('token');
            wx.removeStorageSync('userInfo');
            that.globalData.token = '';
            that.globalData.userInfo = null;
            
            wx.reLaunch({
              url: '/pages/index/index',
              success: () => {
                wx.showToast({ title: '登录状态已失效，请重新登录', icon: 'none' });
              }
            });
            reject(new Error('Unauthorized'));
            return;
          }

          if (res.statusCode >= 400) {
            wx.showToast({
              title: res.data?.message || `服务器错误(${res.statusCode})`,
              icon: 'none'
            });
            reject(new Error(res.data?.message || 'Server error'));
            return;
          }

          // 处理业务状态码 (code = 0 表示成功)
          const apiRes = res.data;
          if (apiRes.code === 0) {
            resolve(apiRes.data);
          } else {
            wx.showToast({
              title: apiRes.message || '请求失败',
              icon: 'none'
            });
            reject(new Error(apiRes.message || 'Business error'));
          }
        },
        fail: (err) => {
          if (loading) wx.hideLoading();
          wx.showToast({
            title: '网络请求失败，请检查网络连接',
            icon: 'none'
          });
          reject(err);
        }
      });
    });
  },

  // 微信授权一键登录 (微信最新登录流程：通过 wx.login 获取 code，后端降级兼容免证书)
  login: function (mockCode = '') {
    const that = this;
    return new Promise((resolve, reject) => {
      // 提供 Mock 登录方便本地脱离 AppID 调试
      if (mockCode) {
        that.request({
          url: '/api/user/login',
          method: 'POST',
          data: { code: mockCode },
          loading: true,
          loadingTitle: '正在登录...'
        }).then(data => {
          // 保存凭证
          wx.setStorageSync('token', data.token);
          wx.setStorageSync('userInfo', data.user);
          that.globalData.token = data.token;
          that.globalData.userInfo = data.user;
          resolve(data.user);
        }).catch(err => reject(err));
        return;
      }

      // 正规微信登录流程
      wx.login({
        success: (res) => {
          if (res.code) {
            that.request({
              url: '/api/user/login',
              method: 'POST',
              data: { code: res.code },
              loading: true,
              loadingTitle: '正在登录...'
            }).then(data => {
              // 保存凭证
              wx.setStorageSync('token', data.token);
              wx.setStorageSync('userInfo', data.user);
              that.globalData.token = data.token;
              that.globalData.userInfo = data.user;
              resolve(data.user);
            }).catch(err => reject(err));
          } else {
            reject(new Error(res.errMsg || '获取微信Code失败'));
          }
        },
        fail: (err) => reject(err)
      });
    });
  }
});
