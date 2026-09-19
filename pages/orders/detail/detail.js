/**
 * 商城（购物）订单详情页
 *
 * 数据源：GET /app-api/transport/product-order/trace?id=<订单ID>
 *        与「我的订单」列表同一份数据，额外带上承运司机 / 交付站点 / 装车妥投凭证。
 * 入口：快递页「我的购物」列表、我的订单列表 —— 点订单卡片即进本页。
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')
const productImg = require('../../../utils/product-img')
const { formatBackendTime } = require('../../../utils/util')

Page({
  data: {
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    iconColor: '#1F5E9E',
    iconClay: '#C75B2A',
    loading: true,
    orderId: '',
    order: null,
    items: [],
    totalText: '0.00',
    createTimeText: '',
    loadTimeText: '',
    deliverTimeText: '',
    statusText: '',
    arrivedText: '',
    steps: []
  },

  onLoad(options) {
    appearance.apply(this)
    const id = options && options.id
    if (!id) {
      wx.showToast({ title: '缺少订单编号', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }
    this.setData({ orderId: id })
  },

  onShow() {
    appearance.apply(this)
    // 司机装车/妥投后回到本页要看到最新进度
    if (this.data.orderId) this.loadDetail()
  },

  onPullDownRefresh() {
    this.loadDetail().then((ok) => {
      wx.stopPullDownRefresh()
      if (ok !== false) wx.showToast({ title: '已刷新', icon: 'success', duration: 1000 })
    })
  },

  async loadDetail() {
    this.setData({ loading: true })
    try {
      const order = await api.getProductOrderTrace(this.data.orderId)
      this.renderOrder(order || {})
      return true
    } catch (e) {
      // 错误提示已由 api.js 统一处理；订单不存在/网络失败时展示可重试的错误态
      this.setData({ order: null, items: [] })
      return false
    } finally {
      this.setData({ loading: false })
    }
  },

  renderOrder(order) {
    const loadTimeText = formatBackendTime(order.loadTime)
    const deliverTimeText = formatBackendTime(order.deliverTime)
    const items = (order.items || []).map((g) => ({
      ...g,
      imageUrl: productImg.resolve({ name: g.productName, image: g.productImage }),
      amountText: g.amount != null ? Number(g.amount).toFixed(2) : '-'
    }))
    this.setData({
      order,
      items,
      statusText: order.statusName || '—',
      totalText: order.totalAmount != null ? Number(order.totalAmount).toFixed(2) : '0.00',
      createTimeText: formatBackendTime(order.createTime),
      loadTimeText,
      deliverTimeText,
      arrivedText: this.buildArrivedText(order),
      steps: this.buildSteps(order, loadTimeText, deliverTimeText)
    })
  },

  /** 当前配送状态一句话（司机已到达 / 已装车 / 已妥投） */
  buildArrivedText(order) {
    const driver = order.driverName ? `${order.driverName}${order.driverMobile ? ' ' + order.driverMobile : ''}` : ''
    if (order.deliverTime) return `${driver || '司机'}已妥投交付，感谢使用`
    if (order.loadTime) return `${driver || '司机'}已装车核验，正在配送中`
    if (order.driverArrived) {
      return `${driver || '司机'}已到达${order.deliverStationName || '交付站点'}，请前往领取`
    }
    if (order.vehiclePlate) return `承运车辆 ${order.vehiclePlate} 已出发，配送到${order.deliverStationName || '交付站点'}`
    return '商家还未发货，可稍后在「快递 - 我的购物」查看进度'
  },

  /** 配送进度时间线（下单 → 派车 → 装车 → 到站 → 妥投） */
  buildSteps(order, loadTimeText, deliverTimeText) {
    const createTimeText = formatBackendTime(order.createTime)
    return [
      { name: '已下单', done: true, time: createTimeText },
      { name: order.vehiclePlate ? `商家发货 · ${order.vehiclePlate} 承运` : '商家发货 · 等待派车', done: !!order.vehiclePlate, time: '' },
      { name: '司机装车核验', done: !!order.loadTime, time: loadTimeText },
      {
        name: order.deliverStationName ? `到达交付站点 · ${order.deliverStationName}` : '到达交付站点',
        done: !!order.driverArrived || !!order.deliverTime,
        time: ''
      },
      { name: '已妥投签收', done: !!order.deliverTime, time: deliverTimeText }
    ]
  },

  /** 看承运车辆轨迹（复用商品溯源页） */
  goToTrace() {
    wx.navigateTo({ url: `/pages/goods/trace/trace?id=${this.data.orderId}` })
  },

  /** 看司机核验凭证大图（装车/妥投两张一起，可左右翻） */
  previewProof(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const order = this.data.order || {}
    const urls = [order.loadPhotoUrl, order.deliverPhotoUrl].filter(Boolean)
    wx.previewImage({ urls: urls.length ? urls : [url], current: url })
  },

  /** 复制订单号（司机扫码/客服核对要用） */
  copyOrderNo() {
    const no = this.data.order && this.data.order.orderNo
    if (!no) return
    wx.setClipboardData({
      data: no,
      success: () => wx.showToast({ title: '订单号已复制', icon: 'success' })
    })
  }
})
