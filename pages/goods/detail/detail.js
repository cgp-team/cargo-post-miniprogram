/**
 * 商品详情页 - 从后端获取真实商品数据 + 弹窗下单
 */
const api = require('../../../utils/api')
const productImg = require('../../../utils/product-img')
const feedback = require('../../../utils/feedback')
const auth = require('../../../utils/auth')
const util = require('../../../utils/util')

Page({
  behaviors: [require('../../../behaviors/page-base')],
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
    totalAmount: '0.00',
    submitting: false
  },

  onLoad(options) {
    this._initPageBase()

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
    this._applyAppearance()
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

  /** 立即购买 → 弹窗下单 */
  buyNow() {
    if (!this.data.product) return
    // 已售罄不响应
    if (this.data.product.stock === 0) return
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
    const stock = this.data.product.stock
    const max = typeof stock === 'number' ? stock : 99
    if (max <= 0) return
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

  /** 预览商品主图 */
  previewImage() {
    const url = this.data.product && this.data.product.imageUrl
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  /** 提交订单 */
  async submitOrder() {
    if (this.data.submitting) return
    const { quantity, receiverName, receiverMobile, receiverAddress, remark, product } = this.data
    if (!receiverName.trim()) {
      wx.showToast({ title: '请输入收货人姓名', icon: 'none' })
      return
    }
    if (!util.validatePhone(receiverMobile.trim())) {
      wx.showToast({ title: '请输入正确的联系电话', icon: 'none' })
      return
    }
    if (!receiverAddress.trim()) {
      wx.showToast({ title: '请输入收货地址', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
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
      if (!res || !res.orderNo) {
        throw { msg: '服务未返回订单号，请稍后重试' }
      }
      wx.hideLoading()
      feedback.tap()
      this.setData({ showOrderPop: false, submitting: false })
      wx.showModal({
        title: '下单成功',
        content: `订单号：${res.orderNo}\n货到付款，请等待商家发货`,
        showCancel: false,
        confirmText: '查看订单',
        confirmColor: '#C75B2A',
        success: () => {
          // redirectTo：避免订单页叠在详情页之上造成返回栈混乱；
          // 若本页来自商城列表，返回时仍回到列表，体验更顺。
          wx.redirectTo({ url: '/pages/orders/orders' })
        }
      })
    } catch (e) {
      wx.hideLoading()
      this.setData({ submitting: false })
      // 401 已由 api.js 统一提示并跳登录（登录后回到本页，收货信息保留在弹窗 data 中）
      if (e && e.code === 401) return
      // 其余失败给出可读原因：api.js 的 toast 只闪现一次，这里用弹窗把后端原因说清楚，避免"一串失败"
      const reason = (e && e.msg) || (e && e.errMsg) || '网络异常或服务暂时不可用'
      wx.showModal({
        title: '下单失败',
        content: `${reason}\n可稍后重试；如持续失败，请把此提示反馈给平台客服。`,
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#C75B2A'
      })
    }
  }
})
