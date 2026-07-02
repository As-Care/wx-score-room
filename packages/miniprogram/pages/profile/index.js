const app = getApp();

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
    userInfo: null,
    activeTab: 0, // 0: 历史对局, 1: 我的战友
    historyRooms: [],
    friendsList: [],
    rawFriendsList: [],
    sortAscending: false,
    wins: 0,
    losses: 0,
    totalGames: 0,
    winRate: 0,
    totalScore: 0,

    // 分页与加载状态管理
    page: 1,
    limit: 20,
    hasMore: true,
    isLoading: false
  },

  onLoad: function () {
    // 1. 设置导航和个人基础信息
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      userInfo: app.globalData.userInfo
    });

    // 2. 拉取战绩数据 (初次加载，isRefresh=true, isPullDown=false)
    this.loadProfileData(true, false);
  },

  // 监听微信下拉刷新
  onPullDownRefresh: function () {
    this.loadProfileData(true, true);
  },

  // 监听微信触底加载下一页
  onReachBottom: function () {
    // 仅在“对局历史”选项卡，且还有更多数据、且当前未在请求中时，才触发分页请求
    if (this.data.activeTab === 0 && this.data.hasMore && !this.data.isLoading) {
      this.loadProfileData(false, false);
    }
  },

  // 获取并格式化战绩与战友关系数据 (isRefresh 代表是重新加载第一页，还是继续追加下一页)
  loadProfileData: function (isRefresh = false, isPullDown = false) {
    if (this.data.isLoading) return;

    let targetPage = this.data.page;
    if (isRefresh) {
      targetPage = 1;
      this.setData({
        page: 1,
        hasMore: true
      });
    }

    // 如果不是刷新，且已经明确没有下一页数据了，直接拦截
    if (!isRefresh && !this.data.hasMore) return;

    this.setData({ isLoading: true });

    const limit = this.data.limit;

    app.request({
      url: `/api/user/history?page=${targetPage}&limit=${limit}`,
      method: 'GET',
      // 下拉刷新或者加载下一页时不弹出全屏灰色 loading 弹窗，保证极致流畅
      loading: targetPage === 1 && !isRefresh,
      loadingTitle: '正在加载战绩...'
    }).then(data => {
      // 格式化时间戳
      const formattedHistory = (data.history || []).map(item => {
        if (item.created_at) {
          return { ...item, created_at: formatLocalTime(item.created_at) };
        }
        return item;
      });

      // 提取后端根据全量数据聚合出的 summary 信息
      const summary = data.summary || { total: 0, wins: 0, losses: 0, total_score: 0 };
      const wins = summary.wins;
      const losses = summary.losses;
      const total = summary.total;
      const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
      const totalScore = summary.total_score;

      const newRooms = isRefresh ? formattedHistory : [...this.data.historyRooms, ...formattedHistory];
      const hasMoreData = formattedHistory.length === limit;

      const myId = app.globalData.userInfo ? app.globalData.userInfo.id : 0;
      const meItem = {
        friend_id: myId,
        nickname: (app.globalData.userInfo ? app.globalData.userInfo.nickname : '我') + ' (我)',
        avatar_url: app.globalData.userInfo ? app.globalData.userInfo.avatar_url : '',
        play_count: total,
        net_score: totalScore,
        isMe: true
      };

      const rawFriends = data.friends || [];
      const fullList = [...rawFriends, meItem];

      // 计算绝对排行 (始终按总积分从大到小排列)
      const rankedList = [...fullList].sort((a, b) => b.net_score - a.net_score);
      rankedList.forEach((item, index) => {
        item.rank = index + 1;
      });

      const sortAsc = this.data.sortAscending;
      const sortedFriends = [...rankedList].sort((a, b) => {
        return sortAsc ? (a.net_score - b.net_score) : (b.net_score - a.net_score);
      });

      this.setData({
        historyRooms: newRooms,
        friendsList: sortedFriends,
        rawFriendsList: rankedList,
        wins: wins,
        losses: losses,
        totalGames: total,
        winRate: winRate,
        totalScore: totalScore,
        hasMore: hasMoreData,
        isLoading: false,
        page: targetPage + 1
      });

      if (isRefresh) {
        wx.stopPullDownRefresh();
      }
      if (isPullDown) {
        wx.showToast({ title: '战绩已刷新', icon: 'success', duration: 800 });
      }
    }).catch(err => {
      this.setData({ isLoading: false });
      console.error('拉取战绩数据失败', err);
      if (isRefresh) {
        wx.stopPullDownRefresh();
      }
    });
  },

  // 切换选项卡
  switchTab: function (e) {
    const index = parseInt(e.currentTarget.dataset.index);
    if (index === 1 && this.data.activeTab === 1) {
      this.toggleSortOrder();
      return;
    }
    this.setData({
      activeTab: index
    });
  },

  toggleSortOrder: function () {
    const newOrder = !this.data.sortAscending;
    this.setData({
      sortAscending: newOrder
    });
    this.sortFriendsList();
  },

  sortFriendsList: function () {
    const sortAsc = this.data.sortAscending;
    const sorted = [...this.data.rawFriendsList].sort((a, b) => {
      return sortAsc ? (a.net_score - b.net_score) : (b.net_score - a.net_score);
    });
    this.setData({
      friendsList: sorted
    });
  },

  goBack: function () {
    wx.navigateBack({ delta: 1 });
  },

  goToRoom: function (e) {
    const roomId = e.currentTarget.dataset.roomId;
    const roomCode = e.currentTarget.dataset.roomCode;
    const roomStatus = e.currentTarget.dataset.roomStatus || 0;
    wx.navigateTo({
      url: `/pages/room/index?room_id=${roomId}&room_code=${roomCode}&status=${roomStatus}`
    });
  }
});
