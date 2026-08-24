/**
 * 快递/寄货追踪页 - 接后端真实数据
 * tab0 我的寄货（pageMySendOrders），tab1 单号查询（trackParcel）
 */
const api = require('../../utils/api')
const qrcodeRender = require('../../utils/qrcode-render')
const { formatBackendTime, VILLAGES } = require('../../utils/util')

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
  behaviors: [require('../../behaviors/page-base')],
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
    this._initPageBase()
    const userInfo = wx.getStorageSync('userInfo')
    const app = getApp()
    this.setData({
      userInfo: userInfo || {},
      currentVillage: app.globalData.currentVillage || '云山村'
    })
    // 「我的」→「我的寄货」默认进寄货列表（switchTab 通过 globalData 传意图）
    if ((options && options.tab === 'my') || app.globalData.parcelIntent === 'my') {
      app.globalData.parcelIntent = ''
      this.setData({ activeTab: 0 })
    }
    // 首屏列表由 onShow 统一加载，避免 onLoad/onShow 双请求
  },

  onShow() {
    const app = getApp()
    this.setData({ currentVillage: app.globalData.currentVillage || '云山村' })
    // 同步老年模式 / 主题色
    this._applyAppearance()
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

  /** 车来取货/送货提醒文案：承运车辆实时位置 → 距目标站点分钟（无实时位置返回空） */
  buildCarrierText(o) {
    if (!o || o.carrierEtaMinutes == null || o.carrierEtaMinutes <= 0) return ''
    const station = o.targetStation || '站点'
    const dist = o.carrierDistanceKm != null ? `（约 ${o.carrierDistanceKm} km）` : ''
    return `${o.vehiclePlate || '班车'} 距${station}约 ${o.carrierEtaMinutes} 分钟${dist}`
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
      // WXML 不支持调用 Page 方法，进度/时间/颜色在此预计算后绑定
      res.progress = this.trackProgress(res.status)
      res.createTimeText = formatBackendTime(res.createTime)
      res.statusClass = this.statusClass(res.status)
      res.etaText = this.buildEtaText(res)
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
    wx.setClipboardData({
      data: this.data.trackResult.orderNo,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  },

  /** 列表项取件码：点击明文复制（司机核销凭码） */
  copyPickupCode(e) {
    const code = e.currentTarget.dataset.code
    if (code) {
      wx.setClipboardData({
        data: String(code),
        success: () => wx.showToast({ title: '已复制', icon: 'success' })
      })
    }
  },

  /** 列表项取件码明文显隐切换（默认打码降层级） */
  toggleCode(e) {
    const idx = e.currentTarget.dataset.index
    const item = this.data.sendList[idx]
    if (!item) return
    this.setData({ [`sendList[${idx}].showCode`]: !item.showCode })
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
        statusName: o.statusName || this.statusText(o.status),
        statusClass: this.statusClass(o.status),
        showCode: false,
        createTimeText: formatBackendTime(o.createTime),
        carrierText: this.buildCarrierText(o)
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

  /** 运输状态 → 语义 class（chip 配色在 wxss，不再内联色值） */
  statusClass(s) {
    return {
      0: 'status-pending', 1: 'status-pending',
      2: 'status-shipping', 3: 'status-shipping',
      4: 'status-done', 5: 'status-done'
    }[s] || 'status-done'
  },

  trackProgress(s) {
    return { 0: 15, 1: 30, 2: 45, 3: 70, 4: 100, 5: 15 }[s] || 10
  },

  /** 到达预估文案：优先「预计 HH:mm 到达 X站」，否则「约 N 分钟后到达 X站」 */
  buildEtaText(res) {
    if (!res) return ''
    // 车来取货/送货提醒：承运车辆实时位置估算优先（距目标站点分钟）
    if (res.carrierEtaMinutes != null && res.carrierEtaMinutes > 0) {
      return this.buildCarrierText(res)
    }
    const station = res.targetStation || ''
    if (res.estimatedArrivalTime) {
      const t = typeof res.estimatedArrivalTime === 'number' ? new Date(res.estimatedArrivalTime) : null
      if (t) {
        const p = (n) => (n < 10 ? '0' + n : '' + n)
        return `预计 ${p(t.getHours())}:${p(t.getMinutes())} 到达${station ? ' ' + station : ''}`
      }
      return `预计 ${String(res.estimatedArrivalTime).replace('T', ' ').substring(5, 16)} 到达${station ? ' ' + station : ''}`
    }
    if (res.etaMinutes != null && res.etaMinutes > 0) {
      return `约 ${res.etaMinutes} 分钟后到达${station ? ' ' + station : ''}`
    }
    return ''
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

  /** 切换村庄 */
  switchVillage() {
    wx.showActionSheet({
      itemList: VILLAGES,
      success: (res) => {
        getApp().globalData.currentVillage = VILLAGES[res.tapIndex]
        this.setData({ currentVillage: VILLAGES[res.tapIndex] })
      }
    })
  }
})
