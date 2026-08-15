/**
 * 快递/寄货追踪页 - 接后端真实数据
 * tab0 我的寄货（pageMySendOrders），tab1 单号查询（trackParcel）
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')
const qrcodeRender = require('../../utils/qrcode-render')

/** 运输订单状态流（对应 TransportOrderStatusEnum） */
const STATUS_FLOW = [
  { status: 0, label: '待调度', desc: '寄货已提交，等待调度归集' },
  { status: 1, label: '已入池', desc: '订单已进入调度订单池' },
  { status: 2, label: '已分配', desc: '已分配班次车辆' },
  { status: 3, label: '已发车', desc: '车辆已发车，运输中' },
  { status: 4, label: '已完成', desc: '货物已送达目的地' },
  { status: 5, label: '已取消', desc: '订单已取消' }
]

Page({
  data: {
    userInfo: {},
    currentVillage: '云山村',
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    statusBarHeight: 20,
    activeTab: 0, // 0=我的寄货 1=单号查询
    trackingNo: '',
    // 我的寄货
    sendList: [],
    pageNo: 1,
    pageSize: 10,
    total: 0,
    hasMore: true,
    loading: false,
    // 乘车安排（村民到站通知）
    arrangements: [],
    // 单号查询结果
    trackResult: null,
    noResult: false
  },

  onLoad(options) {
    const sys = wx.getWindowInfo()
    this.setData({ statusBarHeight: sys.statusBarHeight || 20 })
    const userInfo = wx.getStorageSync('userInfo')
    const app = getApp()
    this.setData({
      userInfo: userInfo || {},
      currentVillage: app.globalData.currentVillage || '云山村'
    })
    appearance.apply(this)
    // 「我的」→「我的寄货」默认进寄货列表（switchTab 通过 globalData 传意图）
    if ((options && options.tab === 'my') || app.globalData.parcelIntent === 'my') {
      app.globalData.parcelIntent = ''
      this.setData({ activeTab: 0 })
    }
    this.reloadSendList()
  },

  onShow() {
    const app = getApp()
    this.setData({ currentVillage: app.globalData.currentVillage || '云山村' })
    // 同步老年模式 / 主题色
    appearance.apply(this)
    // 从「我的寄货」切过来时进入寄货列表 tab
    if (app.globalData.parcelIntent === 'my') {
      app.globalData.parcelIntent = ''
      this.setData({ activeTab: 0 })
      this.reloadSendList()
      return
    }
    if (this.data.activeTab === 0) {
      this.reloadSendList()
    }
    this.loadArrangements()
  },

  /** 我的乘车安排（客运订单已派车，含承运车辆与实时位置入口） */
  async loadArrangements() {
    try {
      const arrangements = (await api.getMyArrangements()) || []
      this.setData({ arrangements })
    } catch (e) { /* api 已 toast */ }
  },

  /** 跳实时公交（查看车辆位置） */
  goToBusTracking() {
    wx.navigateTo({ url: '/pages/bus/index' })
  },

  onPullDownRefresh() {
    if (this.data.activeTab === 0) {
      this.reloadSendList().finally(() => wx.stopPullDownRefresh())
    } else {
      wx.stopPullDownRefresh()
    }
  },

  onReachBottom() {
    if (this.data.activeTab === 0) this.loadMore()
  },

  /** 切换 tab */
  switchTab(e) {
    const idx = Number(e.currentTarget.dataset.index)
    if (idx === this.data.activeTab) return
    this.setData({ activeTab: idx })
    if (idx === 0) this.reloadSendList()
  },

  onTrackingInput(e) {
    this.setData({ trackingNo: e.detail.value })
  },

  /** 单号查询 */
  async searchParcel() {
    const no = this.data.trackingNo.trim()
    if (!no) {
      wx.showToast({ title: '请输入运单号', icon: 'none' })
      return
    }
    wx.showLoading({ title: '查询中…', mask: true })
    try {
      const res = await api.trackParcel(no)
      wx.hideLoading()
      res.timeline = this.buildTimeline(res.status)
      this.setData({ trackResult: res, noResult: false }, () => this.drawParcelQr())
    } catch (e) {
      wx.hideLoading()
      this.setData({ trackResult: null, noResult: true })
    }
  },

  /** 查询成功后绘制查件二维码（邮快件用取件码，司机扫码核销） */
  drawParcelQr() {
    wx.nextTick(() => {
      const query = wx.createSelectorQuery().in(this)
      query.select('#parcelQrCanvas').fields({ node: true, size: true }).exec((res) => {
        if (!res[0] || !res[0].node || !this.data.trackResult) return
        const t = this.data.trackResult
        // 邮快件用取件码（司机核销凭码），货运用订单号
        qrcodeRender.draw(res[0].node, t.pickupCode || t.orderNo, res[0].width)
      })
    })
  },

  /** 复制单号 */
  copyTrackNo() {
    if (!this.data.trackResult) return
    wx.setClipboardData({ data: this.data.trackResult.orderNo })
  },

  reloadSendList() {
    this.setData({ pageNo: 1, sendList: [], total: 0, hasMore: true })
    return this.loadSendList()
  },

  async loadSendList() {
    this.setData({ loading: true })
    try {
      const res = await api.pageMySendOrders({ pageNo: this.data.pageNo, pageSize: this.data.pageSize })
      const list = (res.list || []).map((o) => ({
        ...o,
        statusName: o.statusName || this.statusText(o.status)
      }))
      const merged = this.data.pageNo === 1 ? list : this.data.sendList.concat(list)
      const total = res.total || 0
      this.setData({
        sendList: merged,
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
    this.loadSendList()
  },

  statusText(s) {
    const item = STATUS_FLOW.find((i) => i.status === s)
    return item ? item.label : ''
  },

  statusColor(s) {
    return { 0: '#C75B2A', 1: '#C75B2A', 2: '#1565C0', 3: '#1565C0', 4: '#2E7D32', 5: '#999' }[s] || '#666'
  },

  trackProgress(s) {
    return { 0: 15, 1: 30, 2: 45, 3: 70, 4: 100, 5: 15 }[s] || 10
  },

  /** 按状态生成时间轴 */
  buildTimeline(status) {
    return STATUS_FLOW.map((step) => ({
      label: step.label,
      desc: step.desc,
      // 已取消：仅展示前两个节点；否则当前状态及之前均为完成
      done: status === 5 ? step.status <= 1 : step.status <= (status == null ? -1 : status)
    }))
  },

  formatTime(t) {
    return (t || '').replace('T', ' ').substring(0, 16)
  },

  /** 切换村庄 */
  switchVillage() {
    const villages = ['云山村', '大湾村', '青山镇', '竹林乡', '溪口村', '双河镇']
    wx.showActionSheet({
      itemList: villages,
      success: (res) => {
        getApp().globalData.currentVillage = villages[res.tapIndex]
        this.setData({ currentVillage: villages[res.tapIndex] })
      }
    })
  }
})
