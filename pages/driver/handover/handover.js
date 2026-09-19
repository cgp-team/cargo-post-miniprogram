/**
 * 司机端 —— 多段联运货物交接
 * 接口：transport/driver/handovers、handover/confirm、legs
 *
 * 场景：A 车把货送到换乘站 → B 车到场接货，双方任一司机拍照确认交接，
 *       后端推进 Leg1=已交接、Leg2=运输中，订单推进「部分完成/完成」。
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')
const feedback = require('../../../utils/feedback')
const { formatBackendTime } = require('../../../utils/util')

Page({
  data: {
    driverId: null,
    handovers: [],
    legs: [],
    currentLeg: null,
    legActions: [],
    loading: false,
    loadError: false,
    submitting: false,
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: ''
  },

  onLoad() {
    appearance.apply(this)
    this.initDriver()
  },

  onShow() {
    appearance.apply(this)
  },

  onPullDownRefresh() {
    this.loadAll().finally(() => wx.stopPullDownRefresh())
  },

  async initDriver() {
    try {
      const profile = await api.getDriverProfile()
      this.setData({ driverId: profile && profile.driverId, loadError: false })
      await this.loadAll()
    } catch (e) {
      // 身份都没拉到时亮错误态（重试入口走 initDriver 全流程）
      this.setData({ loadError: true })
      wx.showToast({ title: '网络不太好，请点重新加载', icon: 'none' })
    }
  },

  loadAll() {
    if (!this.data.driverId) return Promise.resolve()
    this.setData({ loading: true, loadError: false })
    // 三路请求各自兜底；全部失败说明是网络问题，亮错误态而不是冒充"暂无待交接"
    let failed = 0
    return Promise.all([
      api.getDriverHandovers(this.data.driverId).catch(() => { failed += 1; return [] }),
      api.getDriverLegs(this.data.driverId).catch(() => { failed += 1; return [] }),
      api.getDriverCurrentLeg(this.data.driverId).catch(() => { failed += 1; return null })
    ]).then(([handovers, legs, currentLeg]) => {
      this.setData({
        handovers: (handovers || []).map((h) => ({ ...h, handoverTimeText: formatBackendTime(h.handoverTime) })),
        legs: (legs || []).map((l) => ({
          ...l,
          etaText: formatBackendTime(l.estimatedArrival),
          progressText: `第${l.legSequence}段：${l.fromStationName || ''} → ${l.toStationName || ''}`
        })),
        currentLeg: currentLeg
          ? {
              ...currentLeg,
              etaText: formatBackendTime(currentLeg.estimatedArrival),
              routeText: `${currentLeg.fromStationName || ''} → ${currentLeg.toStationName || ''}`
            }
          : null,
        legActions: this.buildLegActions(currentLeg),
        loadError: failed === 3
      })
    }).finally(() => this.setData({ loading: false }))
  },

  /** 司机端按钮状态机（需求 §58）：按当前段状态给出可用操作 */
  buildLegActions(leg) {
    if (!leg) return []
    const status = leg.status
    const actions = []
    if (status === 1) actions.push({ action: 'accept', label: '接受任务' })
    else if (status === 2) actions.push({ action: 'navigate', label: '开始导航' })
    else if (status === 4) actions.push({ action: 'arrive-origin', label: '已到达取货点' })
    else if (status === 5) actions.push({ action: 'load', label: '开始装货' })
    else if (status === 6) actions.push({ action: 'start', label: '开始运输' })
    else if (status === 7) actions.push({ action: 'arrive-dest', label: '已到达终点' })
    else if (status === 8 && leg.handoverRequired) actions.push({ action: 'handover-start', label: '开始交接' })
    else if (status === 8) actions.push({ action: 'complete', label: '完成配送' })
    else if (status === 9) actions.push({ action: 'handover-confirm', label: '确认接货（完成交接）' })
    else if (status === 10) actions.push({ action: 'complete', label: '完成配送/取货' })
    return actions
  },

  /** 执行当前段操作（交接确认需拍照） */
  async onLegAction(e) {
    if (this.data.submitting) return
    const action = e.currentTarget.dataset.action
    const leg = this.data.currentLeg
    if (!leg) return
    let photoUrl = ''
    if (action === 'handover-confirm') {
      try {
        photoUrl = await this.takePhoto()
      } catch (err) {
        return // 交接确认必须拍照留证
      }
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '处理中…', mask: true })
    try {
      await api.driverLegAction(action, { driverId: this.data.driverId, legId: leg.id, photoUrl: photoUrl || undefined })
      wx.hideLoading()
      feedback.tap()
      wx.showToast({ title: '操作成功', icon: 'success' })
      await this.loadAll()
    } catch (err) {
      wx.hideLoading()
    } finally {
      this.setData({ submitting: false })
    }
  },

  /** 拍照（相机优先，失败退回相册） */
  takePhoto() {
    return new Promise((resolve, reject) => {
      wx.chooseImage({
        count: 1,
        sourceType: ['camera', 'album'],
        success: async (res) => {
          if (!res.tempFilePaths || !res.tempFilePaths[0]) {
            reject(new Error('no photo'))
            return
          }
          wx.showLoading({ title: '上传照片…', mask: true })
          try {
            const url = await api.uploadFile(res.tempFilePaths[0])
            wx.hideLoading()
            resolve(url)
          } catch (e) {
            wx.hideLoading()
            wx.showToast({ title: '照片上传失败，请重试', icon: 'none' })
            reject(e)
          }
        },
        fail: () => reject(new Error('cancelled'))
      })
    })
  },

  async onConfirm(e) {
    if (this.data.submitting) return
    const handoverId = e.currentTarget.dataset.id
    let photoUrl = ''
    try {
      photoUrl = await this.takePhoto()
    } catch (err) {
      // 允许无照片确认（现场光线差不阻断交接），但与有照片区分
      const res = await new Promise((resolve) => {
        wx.showModal({
          title: '未上传照片',
          content: '未拍照也可确认交接，是否继续？',
          confirmText: '继续确认',
          confirmColor: '#C75B2A',
          success: (r) => resolve(r.confirm)
        })
      })
      if (!res) return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '确认交接…', mask: true })
    try {
      await api.confirmDriverHandover({
        driverId: this.data.driverId,
        handoverId,
        photoUrl: photoUrl || undefined
      })
      wx.hideLoading()
      feedback.tap()
      wx.showToast({ title: '交接完成', icon: 'success' })
      await this.loadAll()
    } catch (err) {
      wx.hideLoading()
    } finally {
      this.setData({ submitting: false })
    }
  },

  /** 长按复制订单号（与对方司机/调度电话核对时报单号）；系统自带「已复制」提示 */
  copyOrderNo(e) {
    const no = e.currentTarget.dataset.no
    if (!no) return
    try {
      wx.setClipboardData({ data: String(no) })
    } catch (err) {
      // 桩环境/低版本静默降级
    }
  },

  onSwitchTab(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'workbench') wx.redirectTo({ url: '/pages/driver/workbench/workbench' })
    else if (key === 'routes') wx.redirectTo({ url: '/pages/driver/routes/routes' })
    else if (key === 'earnings') wx.redirectTo({ url: '/pages/driver/earnings/earnings' })
  }
})
