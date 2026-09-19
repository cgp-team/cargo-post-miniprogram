/**
 * 消息通知中心 —— 订单事件驱动通知列表，支持标记已读
 * 接口：transport/notification/page、unread-count、read、read-all
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')
const feedback = require('../../utils/feedback')
const { formatBackendTime } = require('../../utils/util')

// 事件类型图标映射
const EVENT_ICONS = {
  ORDER_CREATED: '📝',
  REVIEW_PASSED: '✔',
  REVIEW_REJECTED: '🚫',
  POOLED: '📥',
  DISPATCHED: '🧠',
  PLAN_ISSUED: '📋',
  DEPARTED: '🚌',
  LEG_DEPARTED: '🚚',
  LEG_ARRIVED: '🏁',
  HANDOVER_CREATED: '🔁',
  HANDOVER_CONFIRMED: '✓',
  ARRIVED: '📍',
  ORDER_ARRIVED: '📦',
  COMPLETED: '🎉',
  CANCELLED: '✖',
  EXCEPTION: '⚠️',
  ORDER_EXCEPTION: '⚠️',
  DRIVER_ARRIVED: '🚏',
  LEG_ASSIGNED: '📌',
  LEG_ACCEPTED: '✓',
  PLAN_CREATED: '🗺️'
}

Page({
  data: {
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    filter: 'ALL', // ALL | UNREAD
    list: [],
    pageNo: 1,
    pageSize: 10,
    total: 0,
    hasMore: true,
    loading: false,
    loadError: false,
    unreadCount: 0,
    driverMode: false
  },

  onLoad(options) {
    appearance.apply(this)
    const driverMode = options && options.driverMode === '1'
    this.setData({ driverMode })
    if (driverMode) {
      const app = getApp()
      this.driverId = app.globalData && app.globalData.driverId
    }
    this.reload()
  },

  onShow() {
    appearance.apply(this)
  },

  onPullDownRefresh() {
    this.reload().then((rs) => {
      wx.stopPullDownRefresh()
      if (rs && rs[0] !== false) wx.showToast({ title: '已刷新', icon: 'success', duration: 1000 })
    })
  },

  reload() {
    this.setData({ pageNo: 1, list: [], total: 0, hasMore: true })
    return Promise.all([this.loadList(), this.loadUnread()])
  },

  async loadUnread() {
    try {
      const count = this.data.driverMode && this.driverId
        ? await api.getDriverUnreadCount(this.driverId)
        : await api.getNotificationUnreadCount()
      this.setData({ unreadCount: count || 0 })
    } catch (e) { /* api 容错toast */ }
  },

  async loadList() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const params = { pageNo: this.data.pageNo, pageSize: this.data.pageSize }
      if (this.data.filter === 'UNREAD') params.readStatus = 0
      const res = this.data.driverMode && this.driverId
        ? await api.pageDriverMessages({ ...params, driverId: this.driverId })
        : await api.pageMyNotifications(params)
      const list = (res.list || []).map((n) => ({
        ...n,
        icon: EVENT_ICONS[n.eventType] || '🔔',
        createTimeText: formatBackendTime(n.createTime)
      }))
      const merged = this.data.pageNo === 1 ? list : this.data.list.concat(list)
      this.setData({
        list: merged,
        total: res.total || 0,
        hasMore: merged.length < (res.total || 0),
        loadError: false
      })
      return true
    } catch (e) {
      // 错误提示已由 api.js 统一处理；标记错误态（列表为空时给"重新加载"入口），并避免下拉误弹"已刷新"
      this.setData({ loadError: true })
      return false
    } finally {
      this.setData({ loading: false })
    }
  },

  loadMore() {
    if (this.data.loading || !this.data.hasMore) return
    this.setData({ pageNo: this.data.pageNo + 1 })
    this.loadList()
  },

  onReachBottom() {
    this.loadMore()
  },

  onFilter(e) {
    const filter = e.currentTarget.dataset.filter
    if (filter === this.data.filter) return
    this.setData({ filter })
    this.reload()
  },

  /** 点消息：标记已读；带订单的跳包裹追踪 */
  async onTapItem(e) {
    // 长按复制单号后松手会补发一次 tap，吞掉避免误标已读/误跳详情
    if (this._suppressTapUntil && Date.now() < this._suppressTapUntil) {
      this._suppressTapUntil = 0
      return
    }
    const { id, orderId } = e.currentTarget.dataset
    const item = this.data.list.find((n) => n.id === id)
    if (item && item.readStatus === 0) {
      try {
        this.data.driverMode && this.driverId
          ? await api.readDriverMessage(id, this.driverId)
          : await api.readNotification(id)
      } catch (err) { /* api 容错toast */ }
      const list = this.data.list.map((n) => (n.id === id ? { ...n, readStatus: 1 } : n))
      this.setData({ list, unreadCount: Math.max(0, this.data.unreadCount - 1) })
    }
    // 跳转到订单追踪页
    if (orderId) {
      wx.navigateTo({ url: '/pages/goods/trace/trace?orderId=' + orderId })
    }
  },

  /** 长按复制单号；系统自带「已复制」提示 */
  copyOrderNo(e) {
    const no = e.currentTarget.dataset.no
    if (!no) return
    this._suppressTapUntil = Date.now() + 600
    try {
      wx.setClipboardData({ data: String(no) })
    } catch (err) {
      // 桩环境/低版本静默降级
    }
  },

  async onReadAll() {
    if (this._readingAll) return
    // 司机消息无「全部已读」接口（后端仅用户侧 read-all），如实提示逐条点读
    if (this.data.driverMode) {
      wx.showToast({ title: '司机消息请逐条点击已读', icon: 'none' })
      return
    }
    this._readingAll = true
    try {
      await api.readAllNotifications()
      feedback.tap()
      wx.showToast({ title: '已全部标为已读', icon: 'success' })
      this.reload()
    } catch (e) { /* api 容错toast */ } finally {
      this._readingAll = false
    }
  }
})

