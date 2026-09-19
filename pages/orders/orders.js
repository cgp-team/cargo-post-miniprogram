/**
 * 我的订单页 - 农产品商城订单列表（真实后端数据）
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')
const productImg = require('../../utils/product-img')
const feedback = require('../../utils/feedback')
const { formatBackendTime, navThrottled } = require('../../utils/util')

/** 寄货订单状态（TransportOrderStatusEnum）：文案与「快递」页保持一致 */
const SEND_STATUS = {
  0: '已创建', 6: '待审核', 7: '待客户操作', 8: '待入池',
  1: '已入池', 2: '已分配', 3: '已发车', 4: '已完成', 5: '已取消'
}
const SEND_STATUS_CLASS = {
  0: 'status-pending', 6: 'status-pending', 7: 'status-pending', 8: 'status-pending', 1: 'status-pending',
  2: 'status-shipping', 3: 'status-shipping', 4: 'status-done', 5: 'status-done'
}

Page({
  data: {
    // 订单来源：商城订单（默认，行为不变）/ 寄货订单（与「快递」页同一批数据）
    sourceTabs: [
      { key: 'PRODUCT', name: '商城订单' },
      { key: 'SEND', name: '寄货订单' }
    ],
    source: 'PRODUCT',
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
    loadError: false,
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
    this.reload().then((ok) => {
      wx.stopPullDownRefresh()
      if (ok !== false) wx.showToast({ title: '已刷新', icon: 'success', duration: 1000 })
    })
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
    const { source, activeTab, pageNo, pageSize } = this.data
    // 序号守卫：连切来源/状态 tab 时旧请求的响应直接丢弃，不得覆盖新筛选的结果
    const seq = (this._reqSeq = (this._reqSeq || 0) + 1)
    this.setData({ loading: true })
    try {
      if (source === 'SEND') {
        await this.loadSendOrders(seq)
        return true
      }
      // 不传 status: undefined —— wx.request 会把它序列化成字符串 "undefined"，
      // 后端 ProductOrderPageReqVO.status(Integer) 绑定失败报
      // Failed to convert property value ... For input string: "undefined"
      const params = { pageNo, pageSize }
      if (activeTab !== '') {
        params.status = activeTab
      }
      const res = await api.pageMyProductOrders(params)
      if (seq !== this._reqSeq) return false
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
        hasMore: merged.length < total,
        loadError: false
      })
      return true
    } catch (e) {
      // 错误提示已由 api.js 统一处理；标记错误态（列表为空时给"重新加载"入口），并避免下拉误弹"已刷新"
      if (seq === this._reqSeq) this.setData({ loadError: true })
      return false
    } finally {
      // 过期的在途请求不得把 loading 收回——更新的请求还在跑
      if (seq === this._reqSeq) this.setData({ loading: false })
    }
  },

  loadMore() {
    if (this.data.loading || !this.data.hasMore) return
    this.setData({ pageNo: this.data.pageNo + 1 })
    this.loadOrders()
  },

  /** 切换订单来源（商城 / 寄货） */
  switchSource(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.source) return
    // 寄货订单的状态语义与商城不同，切来源时状态筛选重置为「全部」
    this.setData({ source: key, activeTab: '' })
    this.reload()
  },

  /** 寄货订单列表（transport_order）：字段映射到同一张卡片，点卡片进快递页物流详情 */
  async loadSendOrders(seq) {
    const { pageNo } = this.data
    const res = await api.pageMySendOrders({ pageNo, pageSize: this.data.pageSize })
    if (seq !== this._reqSeq) return // 已有更新的请求在途，丢弃旧响应
    const list = (res.list || []).map((o) => ({
      source: 'SEND',
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      statusName: o.statusName || SEND_STATUS[o.status] || '',
      statusClass: SEND_STATUS_CLASS[o.status] || 'status-done',
      createTime: o.createTime || '',
      createTimeText: formatBackendTime(o.createTime),
      goodsName: o.goodsName || '寄货',
      itemCount: o.itemCount || 1,
      goodsWeight: o.goodsWeight,
      items: []
    }))
    const total = res.total || 0
    const merged = pageNo === 1 ? list : this.data.list.concat(list)
    this.setData({ list: merged, total, hasMore: merged.length < total, loadError: false })
  },

  /**
   * 点订单卡片看详情：
   * · 商城订单 → 「产地溯源」订单详情（承运司机 + 到站/交付凭证）；
   * · 寄货订单 → 切到「快递」页并展开该单物流详情（时间轴/多段联运/取件码/地图）。
   */
  openOrderDetail(e) {
    if (this._justCopiedUntil && Date.now() < this._justCopiedUntil) return
    if (navThrottled(this)) return
    const dataset = e.currentTarget.dataset || {}
    if (dataset.source === 'SEND') {
      if (!dataset.no) return
      getApp().globalData.parcelIntent = { type: 'track', no: dataset.no }
      wx.switchTab({ url: '/pages/parcel/parcel' })
      return
    }
    if (!dataset.id) return
    // 商城订单 → 订单详情页（商品清单/收货信息/承运司机/配送进度与装车妥投凭证）
    wx.navigateTo({ url: `/pages/orders/detail/detail?id=${dataset.id}` })
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
      confirmText: '确认取消',
      cancelText: '再想想',
      confirmColor: '#C75B2A',
      success: async (res) => {
        if (!res.confirm || this._cancelling) return
        this._cancelling = true
        try {
          await api.cancelProductOrder(id)
          feedback.tap()
          wx.showToast({ title: '已取消', icon: 'success' })
          this.reload()
        } catch (e) { /* 错误已 toast */ } finally {
          this._cancelling = false
        }
      }
    })
  },

  /** 长按单号复制（时间戳守卫：长按松手会补发一次 tap，避免误跳详情；不用 setTimeout，页面销毁无残留） */
  copyOrderNo(e) {
    const no = e.currentTarget.dataset.no
    if (!no) return
    this._justCopiedUntil = Date.now() + 500
    wx.setClipboardData({
      data: no,
      success: () => wx.showToast({ title: '单号已复制', icon: 'success' })
    })
  },

  /** 商品溯源（大巴轨迹） */
  goToTrace(e) {
    if (navThrottled(this)) return
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/goods/trace/trace?id=${id}` })
  },

  /** 空态引导：去山货集市逛逛（商城 tab） */
  goShopping() {
    wx.switchTab({ url: '/pages/goods/goods' })
  }
})
