/**
 * 我的页 - 个人中心 + 卖家入口
 * 含【我要寄货】核心功能入口（适配农户适老化大按钮设计）
 */
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const feedback = require('../../utils/feedback')
const { navThrottled } = require('../../utils/util')

Page({
  behaviors: [require('../../behaviors/page-base')],
  data: {
    userInfo: {},
    isLoggedIn: false,
    role: 'consumer',
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: ''
  },

  onLoad() {
    this._initPageBase()
    this.loadUserInfo()
  },

  onShow() {
    this.loadUserInfo()
    // 同步老年模式 / 主题色（改动后回来立即生效）
    this._applyAppearance()
  },

  loadUserInfo() {
    const cached = wx.getStorageSync('userInfo')
    const loggedIn = !!(cached && auth.isLogin())
    const next = loggedIn ? cached : null
    // onShow 每次进页都调：内容没变就跳过 setData，避免无谓的整页 diff
    const prev = this.data.isLoggedIn ? this.data.userInfo : null
    if (loggedIn === this.data.isLoggedIn
        && JSON.stringify(prev || null) === JSON.stringify(next || null)) return
    this.setData({ userInfo: next || {}, isLoggedIn: loggedIn })
  },

  /** 我要寄货 - 进入农户寄货流程 */
  goToSend() {
    if (!auth.requireLogin()) return
    if (navThrottled(this)) return
    wx.navigateTo({ url: '/pages/send/send' })
  },

  /** 我的订单（商城购买订单） */
  goToOrders() {
    if (!auth.requireLogin()) return
    if (navThrottled(this)) return
    wx.navigateTo({ url: '/pages/orders/orders' })
  },

  /** 我的寄货记录（parcel 是 tab 页，用 switchTab + globalData 传意图） */
  goToMySend() {
    if (!auth.requireLogin()) return
    getApp().globalData.parcelIntent = 'my'
    wx.switchTab({ url: '/pages/parcel/parcel' })
  },

  /** 我的购物（商城买到的商品由大巴司机送到交付站点；快递页"我的购物"tab 看进度） */
  goToMyShopping() {
    if (!auth.requireLogin()) return
    getApp().globalData.parcelIntent = 'shopping'
    wx.switchTab({ url: '/pages/parcel/parcel' })
  },

  /** 设置 */
  goToSettings() {
    if (navThrottled(this)) return
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  /** 切换为司机模式 */
  switchToDriver() {
    if (!auth.requireLogin()) return
    wx.reLaunch({ url: '/pages/driver/workbench/workbench' })
  },

  /** 退出登录（先调后端注销 token，再清本地缓存） */
  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      confirmText: '退出登录',
      confirmColor: '#C75B2A',
      success: async (res) => {
        if (res.confirm) {
          try { await api.logout() } catch (e) { /* 注销失败不阻塞本地退出 */ }
          wx.removeStorageSync('token')
          wx.removeStorageSync('userInfo')
          wx.removeStorageSync('refreshToken')
          wx.removeStorageSync('userId')
          this.setData({ userInfo: {}, isLoggedIn: false })
          feedback.tap()
          wx.reLaunch({ url: '/pages/login/login' })
        }
      }
    })
  },

  /** 长按预览头像（点按仍进个人资料页，不冲突） */
  previewAvatar() {
    const url = this.data.userInfo && this.data.userInfo.avatar
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  /** 编辑个人资料 */
  goToProfile() {
    if (!auth.requireLogin()) return
    if (navThrottled(this)) return
    wx.navigateTo({ url: '/pages/mine/profile/profile' })
  },

  /** 收货地址管理 */
  goToAddress() {
    if (!auth.requireLogin()) return
    if (navThrottled(this)) return
    wx.navigateTo({ url: '/pages/mine/address/address' })
  },

  /** 意见反馈 */
  goToFeedback() {
    if (!auth.requireLogin()) return
    if (navThrottled(this)) return
    wx.navigateTo({ url: '/pages/mine/feedback/feedback' })
  },

  /** 消息通知中心 */
  goToNotification() {
    if (!auth.requireLogin()) return
    if (navThrottled(this)) return
    wx.navigateTo({ url: '/pages/notification/notification' })
  },

  /** 去登录 */
  goToLogin() {
    wx.reLaunch({ url: '/pages/login/login' })
  }
})
