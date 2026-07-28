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
    token: null
  }
})
