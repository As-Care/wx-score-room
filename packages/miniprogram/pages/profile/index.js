const app = getApp();

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    userInfo: null,
    activeTab: 0, // 0: 历史对局, 1: 我的战友
    historyRooms: [],
    friendsList: []
  },

  onLoad: function () {
    // 1. 设置导航和个人基础信息
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      userInfo: app.globalData.userInfo
    });

    // 2. 拉取战绩数据
    this.loadProfileData();
  },

  // 获取并格式化历史对局与战友关系数据
  loadProfileData: function () {
    app.request({
      url: '/api/user/history',
      method: 'GET',
      loading: true,
      loadingTitle: '正在加载战绩...'
    }).then(data => {
      // 格式化时间戳，使时间更加美白易读
      const formattedHistory = (data.history || []).map(item => {
        if (item.created_at) {
          // 数据库默认时间为 UTC 字符串，处理为 "YYYY-MM-DD HH:MM" 格式
          const date = item.created_at.replace('T', ' ').substring(0, 16);
          return { ...item, created_at: date };
        }
        return item;
      });

      this.setData({
        historyRooms: formattedHistory,
        friendsList: data.friends || []
      });
    }).catch(err => {
      console.error('拉取战绩数据失败', err);
    });
  },

  // 切换选项卡
  switchTab: function (e) {
    const index = e.currentTarget.dataset.index;
    this.setData({
      activeTab: index
    });
  },

  goBack: function () {
    wx.navigateBack({ delta: 1 });
  }
});
