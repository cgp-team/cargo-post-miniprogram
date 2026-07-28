App({
  onLaunch: function () {
    // 检查登录状态
    const token = wx.getStorageSync('token')
    const userInfo = wx.getStorageSync('userInfo')

    if (token && userInfo) {
      // 已登录，跳转到首页（index不是tabBar页面，用reLaunch）
      // 注意：首次启动时login页还在加载中，这里不强制跳转
      // 由login页面自行检查登录状态决定是否跳转
    }
  },

  globalData: {
    userInfo: null,
    token: null,
    baseUrl: 'http://localhost:3000/api' // 后端API地址
  }
})
