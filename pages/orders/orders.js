/**
 * 我的订单页 - 农产品商城订单列表（真实后端数据）
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')
const productImg = require('../../utils/product-img')
const feedback = require('../../utils/feedback')
const { formatBackendTime } = require('../../utils/util')

Page({
  data: {
    statusTabs: [
      { key: '', name: '全部' },
      { key: 0, name: '待发货' },
      { key: 1, name: '已发货' },
      { key: 2, name: '已完成' },
      { key: 3, name: '已取消' }
    ],
    activeTab: '',
    list: [],
    pageNo: 1,
    pageSize: 10,
    total: 0,
    loading: false,
    hasMore: true,
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: ''
  },

  onLoad() {
    appearance.apply(this)
  },

  onShow() {
    appearance.apply(this)
    this.reload()
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    this.loadMore()
  },

  /** 切换状态 tab */
  switchTab(e) {
    // dataset 可能回传字符串（如 '0'），统一归一为数字或 ''（全部），
    // 保证 status 参数始终是数字，避免后端 Integer 绑定失败
    const raw = e.currentTarget.dataset.key
    const num = Number(raw)
    const key = raw === '' || raw === undefined || raw === null || isNaN(num) ? '' : num
    if (key === this.data.activeTab) return
    this.setData({ activeTab: key })
    this.reload()
  },

  reload() {
    this.setData({ pageNo: 1, list: [], total: 0, hasMore: true })
    return this.loadOrders()
  },

  async loadOrders() {
    const { activeTab, pageNo, pageSize } = this.data
    this.setData({ loading: true })
    try {
      // 不传 status: undefined —— wx.request 会把它序列化成字符串 "undefined"，
      // 后端 ProductOrderPageReqVO.status(Integer) 绑定失败报
      // Failed to convert property value ... For input string: "undefined"
      const params = { pageNo, pageSize }
      if (activeTab !== '') {
        params.status = activeTab
      }
      const res = await api.pageMyProductOrders(params)
      const list = (res.list || []).map((o) => ({
        ...o,
        statusClass: this.statusClass(o.status),
        // 配送提示：已发货=司机配送中（点溯源看司机/轨迹/到站提醒），已完成=已送达
        deliveryHint: o.status === 1 ? '司机配送中 · 点「产地溯源」看司机与到站提醒'
          : (o.status === 2 ? '已送达 · 点「产地溯源」看交付凭证' : ''),
        createTimeText: formatBackendTime(o.createTime),
        items: (o.items || []).map((g) => ({
          ...g,
          imageUrl: productImg.resolve({ name: g.productName, image: g.productImage })
        }))
      }))
      const total = res.total || 0
      const merged = pageNo === 1 ? list : this.data.list.concat(list)
      this.setData({
        list: merged,
        total,
        hasMore: merged.length < total
      })
    } catch (e) {
      // 错误提示已由 api.js 统一处理
    } finally {
      this.setData({ loading: false })
    }
  },

  loadMore() {
    if (this.data.loading || !this.data.hasMore) return
    this.setData({ pageNo: this.data.pageNo + 1 })
    this.loadOrders()
  },

  /** 订单状态 → 语义 class（chip 配色在 wxss，不再内联色值）：0 待发货 1 已发货 2 已完成 3 已取消 */
  statusClass(s) {
    return { 0: 'status-pending', 1: 'status-shipping', 2: 'status-done', 3: 'status-done' }[s] || 'status-done'
  },

  /** 取消订单（仅待发货） */
  cancelOrder(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '取消订单',
      content: '确定取消该订单吗？',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.cancelProductOrder(id)
          feedback.tap()
          wx.showToast({ title: '已取消', icon: 'success' })
          this.reload()
        } catch (e) { /* 错误已 toast */ }
      }
    })
  },

  /** 商品溯源（大巴轨迹） */
  goToTrace(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/goods/trace/trace?id=${id}` })
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
