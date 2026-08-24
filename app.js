App({
  onLaunch: function () {
    // 登录态由各页面自行检查 storage 并处理跳转，这里无需初始化
  },

  globalData: {
    currentVillage: '云山村',
    // 统一用户定位（LocationService 结果，含真实经纬度；currentVillage 只是展示文本）
    userLocation: null,
    elderlyMode: wx.getStorageSync('elderlyMode') || false,
    themeColor: wx.getStorageSync('themeColor') || 'green'
  }
})
