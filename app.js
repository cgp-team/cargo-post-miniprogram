App({
  onLaunch: function () {
    // 登录态由各页面自行检查 storage 并处理跳转，这里无需初始化
  },

  globalData: {
    currentVillage: '云山村',
    elderlyMode: wx.getStorageSync('elderlyMode') || false,
    themeColor: wx.getStorageSync('themeColor') || 'green'
  }
})
