const appearance = require('../../utils/appearance')

Page({
  data: {
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    themeList: [
      { key: 'green', name: appearance.THEMES.green.name, color: appearance.THEMES.green.primary, desc: '默认主题' },
      { key: 'orange', name: appearance.THEMES.orange.name, color: appearance.THEMES.orange.primary, desc: '热情温暖' },
      { key: 'blue', name: appearance.THEMES.blue.name, color: appearance.THEMES.blue.primary, desc: '沉稳冷静' }
    ]
  },

  onLoad() {
    appearance.apply(this)
  },

  onShow() {
    // 从其它入口（如我的页）改完设置后回来保持同步
    appearance.apply(this)
  },

  /** 老年人模式 — 整行点击切换 */
  toggleElderly() {
    const next = !this.data.elderlyMode
    wx.setStorageSync('elderlyMode', next)
    getApp().globalData.elderlyMode = next
    // 立即刷新本页显示
    appearance.apply(this)
  },

  /** 主题颜色 — 点击整行切换 */
  switchTheme(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.themeColor) return
    wx.setStorageSync('themeColor', key)
    getApp().globalData.themeColor = key
    // 立即刷新本页主题变量
    appearance.apply(this)
  }
})
