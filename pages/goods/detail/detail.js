/**
 * 商品详情页 - 从后端获取真实商品数据
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')

Page({
  data: {
    product: null,
    statusBarHeight: 20,
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: ''
  },

  onLoad(options) {
    const win = wx.getWindowInfo()
    this.setData({ statusBarHeight: win.statusBarHeight || 20 })
    appearance.apply(this)

    const id = options.id
    if (id) {
      this.loadDetail(id)
    } else {
      wx.showToast({ title: '缺少商品编号', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
    }
  },

  onShow() {
    // 同步老年模式 / 主题色
    appearance.apply(this)
  },

  /** 加载商品详情 */
  async loadDetail(id) {
    try {
      const p = await api.getProduct(id)
      if (p) {
        this.setData({ product: { ...p, price: Number(p.price).toFixed(2) } })
      }
    } catch (e) {
      // 错误提示已由 api.js 统一处理
      setTimeout(() => wx.navigateBack(), 1200)
    }
  },

  /** 返回上一页 */
  goBack() {
    wx.navigateBack()
  },

  /** 加入购物车（占位） */
  addCart() {
    wx.showToast({ title: '购物车功能开发中', icon: 'none' })
  },

  /** 立即购买（占位） */
  buyNow() {
    wx.showToast({ title: '下单功能开发中', icon: 'none' })
  }
})
