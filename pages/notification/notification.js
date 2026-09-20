/**
 * 消息通知中心 —— 订单事件驱动通知列表，支持标记已读
 * 接口：transport/notification/page、unread-count、read、read-all
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')
const feedback = require('../../utils/feedback')
const { formatBackendTime, navThrottled } = require('../../utils/util')

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

  /** 司机模式缺 driverId 时补拉一次档案（工作台首屏未加载完就点铃铛的时序空洞） */
  async ensureDriverId() {
    if (!this.data.driverMode || this.driverId) return
    try {
      const profile = await api.getDriverProfile()
      this.driverId = profile && profile.driverId
      if (this.driverId) getApp().globalData.driverId = this.driverId
    } catch (e) { /* 拉不到档案：走列表错误态，不混用用户消息接口 */ }
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
    return this.ensureDriverId().then(() => Promise.all([this.loadList(), this.loadUnread()]))
  },

  async loadUnread() {
    // 司机模式拿不到 driverId 时不降级打用户消息接口（两边消息口径不同，混用会串数据）
    if (this.data.driverMode && !this.driverId) return false
    try {
      const count = this.data.driverMode && this.driverId
        ? await api.getDriverUnreadCount(this.driverId)
        : await api.getNotificationUnreadCount()
      this.setData({ unreadCount: count || 0 })
    } catch (e) { /* api 容错toast */ }
  },

  async loadList() {
    // 司机模式拿不到 driverId：亮错误态给重试入口，不降级打用户消息接口
    if (this.data.driverMode && !this.driverId) {
      this.setData({ loadError: true })
      return false
    }
    // 序号守卫（而非 loading 早退）：连切「全部/未读」时旧响应直接丢弃；
    // 旧实现 loading 早退会把新筛选的加载整个吞掉，且旧响应盖在新筛选下
    const seq = (this._reqSeq = (this._reqSeq || 0) + 1)
    this.setData({ loading: true })
    try {
      const params = { pageNo: this.data.pageNo, pageSize: this.data.pageSize }
      if (this.data.filter === 'UNREAD') params.readStatus = 0
      const res = this.data.driverMode && this.driverId
        ? await api.pageDriverMessages({ ...params, driverId: this.driverId })
        : await api.pageMyNotifications(params)
      if (seq !== this._reqSeq) return false
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

  /** 点消息：标记已读；带订单的按消息来源跳到对应订单视图 */
  onTapItem(e) {
    // 长按复制单号后松手会补发一次 tap，吞掉避免误标已读/误跳详情
    if (this._suppressTapUntil && Date.now() < this._suppressTapUntil) {
      this._suppressTapUntil = 0
      return
    }
    const { id, orderId, orderNo } = e.currentTarget.dataset
    const idx = this.data.list.findIndex((n) => n.id === id)
    const item = idx >= 0 ? this.data.list[idx] : null
    if (item && item.readStatus === 0) {
      // 弱网不等已读接口：先本地标读（路径更新单条字段，不整表替换、列表不闪）；
      // 接口失败也不阻塞跳转——原实现失败同样标读，口径一致
      this.setData({
        [`list[${idx}].readStatus`]: 1,
        unreadCount: Math.max(0, this.data.unreadCount - 1)
      })
      const markRead = this.data.driverMode && this.driverId
        ? api.readDriverMessage(id, this.driverId)
        : api.readNotification(id)
      markRead.catch(() => { /* api 容错toast */ })
    }
    if (!orderId && !orderNo) return
    if (navThrottled(this)) return
    // 司机消息（任务/交接提醒）里的 orderId 是货运单 id，没有对应的村民端页面：回工作台看任务
    if (this.data.driverMode) {
      wx.navigateBack()
      return
    }
    // 寄件（货运）事件通知（审核/入池/调度/发车/交接/妥投）：按业务单号进「快递 → 单号查询」，
    // 与「我的订单 → 寄货订单」同一套 parcelIntent 口径；商品溯源页（product-order/trace?id=）接不住货运单 id
    if (orderNo) {
      getApp().globalData.parcelIntent = { type: 'track', no: orderNo }
      wx.switchTab({ url: '/pages/parcel/parcel' })
      return
    }
    // 兜底：只有数字 id 没有单号时维持原跳转（商城订单溯源页路由参数名是 id；防连点避免叠两层页面）
    wx.navigateTo({ url: '/pages/goods/trace/trace?id=' + orderId })
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

