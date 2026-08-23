/**
 * 商品详情页 - 从后端获取真实商品数据 + 弹窗下单
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')
const productImg = require('../../../utils/product-img')
const feedback = require('../../../utils/feedback')
const auth = require('../../../utils/auth')

Page({
  data: {
    product: null,
    statusBarHeight: 20,
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    // 下单弹窗
    showOrderPop: false,
    quantity: 1,
    receiverName: '',
    receiverMobile: '',
    receiverAddress: '',
    remark: '',
    totalAmount: '0.00'
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
        this.setData({
          product: { ...p, price: Number(p.price).toFixed(2), imageUrl: productImg.resolve(p) }
        })
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

  /** 立即购买 → 弹窗下单 */
  buyNow() {
    if (!this.data.product) return
    // 未登录拦截（统一入口）
    if (!auth.requireLogin({ content: '登录后才能下单购买' })) return
    // 初始化弹窗（收货电话预填登录手机号）
    const userInfo = wx.getStorageSync('userInfo') || {}
    this.setData({
      quantity: 1,
      receiverName: userInfo.nickname || '',
      receiverMobile: userInfo.mobile || '',
      receiverAddress: '',
      remark: '',
      totalAmount: this.calcAmount(1),
      showOrderPop: true
    })
  },

  /** 关闭弹窗 */
  closeOrderPop() {
    this.setData({ showOrderPop: false })
  },

  /** 弹窗内容点击阻止穿透 */
  noop() {},

  quantityMinus() {
    const q = Math.max(1, this.data.quantity - 1)
    this.setData({ quantity: q, totalAmount: this.calcAmount(q) })
  },

  quantityPlus() {
    const max = this.data.product.stock || 99
    const q = Math.min(max, this.data.quantity + 1)
    this.setData({ quantity: q, totalAmount: this.calcAmount(q) })
  },

  onReceiverNameInput(e) { this.setData({ receiverName: e.detail.value }) },
  onReceiverMobileInput(e) { this.setData({ receiverMobile: e.detail.value }) },
  onReceiverAddressInput(e) { this.setData({ receiverAddress: e.detail.value }) },
  onRemarkInput(e) { this.setData({ remark: e.detail.value }) },

  /** 计算合计金额 */
  calcAmount(q) {
    if (!this.data.product) return '0.00'
    return (Number(this.data.product.price) * q).toFixed(2)
  },

  /** 提交订单 */
  async submitOrder() {
    const { quantity, receiverName, receiverMobile, receiverAddress, remark, product } = this.data
    if (!receiverName.trim()) {
      wx.showToast({ title: '请输入收货人姓名', icon: 'none' })
      return
    }
    if (!/^[\d-]{5,20}$/.test(receiverMobile.trim())) {
      wx.showToast({ title: '请输入正确的联系电话', icon: 'none' })
      return
    }
    if (!receiverAddress.trim()) {
      wx.showToast({ title: '请输入收货地址', icon: 'none' })
      return
    }
    wx.showLoading({ title: '提交中…', mask: true })
    try {
      const userInfo = wx.getStorageSync('userInfo') || {}
      const res = await api.createProductOrder({
        productId: product.id,
        quantity,
        receiverName: receiverName.trim(),
        receiverMobile: receiverMobile.trim(),
        receiverAddress: receiverAddress.trim(),
        remark: remark.trim(),
        userMobile: userInfo.mobile || ''
      })
      wx.hideLoading()
      feedback.tap()
      this.setData({ showOrderPop: false })
      wx.showModal({
        title: '下单成功',
        content: `订单号：${res.orderNo}\n货到付款，请等待商家发货`,
        showCancel: false,
        confirmText: '查看订单',
        success: () => {
          // redirectTo：避免订单页叠在详情页之上造成返回栈混乱；
          // 若本页来自商城列表，返回时仍回到列表，体验更顺。
          wx.redirectTo({ url: '/pages/orders/orders' })
        }
      })
    } catch (e) {
      wx.hideLoading()
      // 错误提示已由 api.js 统一处理
    }
  }
})
