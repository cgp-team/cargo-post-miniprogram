/**
 * 我的页 - 个人中心 + 卖家入口
 * 含【我要寄货】核心功能入口（适配农户适老化大按钮设计）
 */
const appearance = require('../../utils/appearance')
const api = require('../../utils/api')
const feedback = require('../../utils/feedback')
const auth = require('../../utils/auth')

Page({
  data: {
    userInfo: {},
    isLoggedIn: false,
    role: 'consumer',
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    themeList: [
      { key: 'green', name: appearance.THEMES.green.name, color: appearance.THEMES.green.primary },
      { key: 'orange', name: appearance.THEMES.orange.name, color: appearance.THEMES.orange.primary },
      { key: 'blue', name: appearance.THEMES.blue.name, color: appearance.THEMES.blue.primary },
      { key: 'red', name: appearance.THEMES.red.name, color: appearance.THEMES.red.primary }
    ]
  },

  onLoad() {
    const sys = wx.getWindowInfo()
    this.setData({ statusBarHeight: sys.statusBarHeight || 20 })
    appearance.apply(this)
    this.loadUserInfo()
  },

  onShow() {
    this.loadUserInfo()
    // 同步老年模式 / 主题色（改动后回来立即生效）
    appearance.apply(this)
  },

  loadUserInfo() {
    const userInfo = wx.getStorageSync('userInfo')
    if (userInfo && auth.isLogin()) {
      this.setData({ userInfo, isLoggedIn: true })
    }
  },

  /** 我要寄货 - 进入农户寄货流程 */
  goToSend() {
    if (!auth.requireLogin()) return
    wx.navigateTo({ url: '/pages/send/send' })
  },

  /** 我的账本 */
  goToLedger() {
    wx.showToast({ title: '账本功能开发中', icon: 'none' })
  },

  /** 我的订单（商城购买订单） */
  goToOrders() {
    if (!auth.requireLogin()) return
    wx.navigateTo({ url: '/pages/orders/orders' })
  },

  /** 我的寄货记录（parcel 是 tab 页，用 switchTab + globalData 传意图） */
  goToMySend() {
    if (!auth.requireLogin()) return
    getApp().globalData.parcelIntent = 'my'
    wx.switchTab({ url: '/pages/parcel/parcel' })
  },

  /** 公交收藏 */
  goToBusFavorites() {
    wx.showToast({ title: '公交收藏开发中', icon: 'none' })
  },

  /** 设置 */
  goToSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  /** 切换为司机模式 */
  switchToDriver() {
    wx.reLaunch({ url: '/pages/driver/workbench/workbench' })
  },

  /** 退出登录（先调后端注销 token，再清本地缓存） */
  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: async (res) => {
        if (res.confirm) {
          try { await api.logout() } catch (e) { /* 注销失败不阻塞本地退出 */ }
          wx.removeStorageSync('token')
          wx.removeStorageSync('userInfo')
          wx.removeStorageSync('refreshToken')
          wx.removeStorageSync('userId')
          this.setData({ userInfo: {}, isLoggedIn: false })
          wx.reLaunch({ url: '/pages/login/login' })
        }
      }
    })
  },

  /** 编辑个人资料 */
  goToProfile() {
    if (!auth.requireLogin()) return
    wx.navigateTo({ url: '/pages/mine/profile/profile' })
  },

  /** 收货地址管理 */
  goToAddress() {
    if (!auth.requireLogin()) return
    wx.navigateTo({ url: '/pages/mine/address/address' })
  },

  /** 意见反馈 */
  goToFeedback() {
    if (!auth.requireLogin()) return
    wx.navigateTo({ url: '/pages/mine/feedback/feedback' })
  },

  /** 老年人模式 */
  toggleElderly() {
    const next = !this.data.elderlyMode
    feedback.tap()
    wx.setStorageSync('elderlyMode', next)
    getApp().globalData.elderlyMode = next
    // 立即刷新本页显示（字体随 class 切换）
    appearance.apply(this)
  },

  /** 主题颜色 */
  switchTheme(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.themeColor) return
    feedback.tap()
    wx.setStorageSync('themeColor', key)
    getApp().globalData.themeColor = key
    // 立即刷新本页主题变量
    appearance.apply(this)
  },

  /** 去登录 */
  goToLogin() {
    wx.reLaunch({ url: '/pages/login/login' })
  }
})
