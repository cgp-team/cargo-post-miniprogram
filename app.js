App({
  onLaunch: function () {
    // 检查登录状态
    const token = wx.getStorageSync('token')
    if (!token) {
      // 未登录，由页面自行处理跳转
    }
  },

  globalData: {
    userInfo: null,
    token: null,
    currentVillage: '云山村',
    villageList: ['云山村', '大湾村', '青山镇', '竹林乡', '溪口村', '双河镇'],
    elderlyMode: wx.getStorageSync('elderlyMode') || false,
    themeColor: wx.getStorageSync('themeColor') || 'green'
  }
})
