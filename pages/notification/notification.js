/**
 * 消息通知中心 —— 订单事件驱动通知列表，支持标记已读
 * 接口：transport/notification/page、unread-count、read、read-all
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')
const { formatBackendTime } = require('../../utils/util')

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
    unreadCount: 0
  },

  onLoad() {
    appearance.apply(this)
    this.reload()
  },

  onShow() {
    appearance.apply(this)
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh())
  },

  reload() {
    this.setData({ pageNo: 1, list: [], total: 0, hasMore: true })
    return Promise.all([this.loadList(), this.loadUnread()])
  },

  async loadUnread() {
    try {
      const count = await api.getNotificationUnreadCount()
      this.setData({ unreadCount: count || 0 })
    } catch (e) { /* api 已 toast */ }
  },

  async loadList() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const params = { pageNo: this.data.pageNo, pageSize: this.data.pageSize }
      if (this.data.filter === 'UNREAD') params.readStatus = 0
      const res = await api.pageMyNotifications(params)
      const list = (res.list || []).map((n) => ({
        ...n,
        createTimeText: formatBackendTime(n.createTime)
      }))
      const merged = this.data.pageNo === 1 ? list : this.data.list.concat(list)
      this.setData({
        list: merged,
        total: res.total || 0,
        hasMore: merged.length < (res.total || 0)
      })
    } catch (e) { /* api 已 toast */ } finally {
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
    const { id } = e.currentTarget.dataset
    const item = this.data.list.find((n) => n.id === id)
    if (item && item.readStatus === 0) {
      try {
        await api.readNotification(id)
      } catch (err) { /* api 已 toast */ }
      const list = this.data.list.map((n) => (n.id === id ? { ...n, readStatus: 1 } : n))
      this.setData({ list, unreadCount: Math.max(0, this.data.unreadCount - 1) })
    }
    const orderId = item && item.orderId
    if (orderId) {
      wx.switchTab({ url: '/pages/parcel/parcel' })
    }
  },

  async onReadAll() {
    try {
      await api.readAllNotifications()
      wx.showToast({ title: '已全部标为已读', icon: 'success' })
      this.reload()
    } catch (e) { /* api 已 toast */ }
  }
})
