/**
 * 司机工作台 - 核心页面
 * 三种状态：待发车(idle) / 行驶中(driving) / 到站停靠(stopped)
 * 数据来源：真实后端（司机档案/今日班次/待装车任务/调度任务）
 * 写操作：发车 / 到站 / 装车确认 / 妥投 / 位置上报，全程状态真实落库
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')

/** 位置上报间隔（毫秒） */
const LOCATION_REPORT_INTERVAL = 10000
/** 到站判定半径（米）：进入该范围提示到站 */
const ARRIVE_RADIUS_METERS = 300

/** 两点间球面距离（米） */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * 6371000 * Math.asin(Math.sqrt(a))
}

Page({
  data: {
    // 状态栏高度（自定义导航栏用）
    statusBarHeight: 20,
    headerSafeStyle: 'height: 20px;',

    // 当前状态: 'idle' | 'driving' | 'stopped'
    status: 'idle',

    // 司机/车辆
    driverName: '',
    plateNo: '',
    cargoLimit: 0,

    // 班次信息
    routeName: '',
    startStation: '',
    endStation: '',
    currentStation: '',
    nextStation: '',
    nextStationDistance: 0,

    // 进度条
    totalStops: 0,
    currentStopIndex: 0,
    progressPercent: 0,
    progressFillStyle: 'width: 0%;',
    progressDotStyle: 'left: 0%;',

    // 行李舱运力
    cargoCapacity: 0,        // 空余仓位百分比
    cargoUsed: 0,            // 已用仓位百分比
    cargoFillStyle: 'height: 0%;',
    cargoUsedStyle: 'bottom: 0%;',

    // 语音播报
    voiceText: '',

    // 到站任务（真实货运订单）
    pendingPickups: [],

    // 调度任务（算法派单结果，预留）
    tasks: [],

    // 行驶数据
    speed: 0,
    eta: '',

    // 地图标记点
    markers: [],
    polyline: [],

    loaded: false
  },

  onLoad() {
    const sysInfo = wx.getWindowInfo()
    this.setData({ headerSafeStyle: 'height: ' + (sysInfo.statusBarHeight || 20) + 'px;' })
    appearance.apply(this)
    this.loadAll()
  },

  onShow() {
    appearance.apply(this)
    // 从其他页返回时若在途，确保上报定时器在跑
    if (this.data.status === 'driving' && !this.locationTimer) {
      this.startLocationReport()
    }
  },

  /** 加载司机身份 + 班次 + 任务 */
  async loadAll() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    const mobile = userInfo.mobile || ''
    try {
      const profile = mobile ? await api.getDriverProfile(mobile) : null
      if (!profile) {
        wx.showToast({ title: '未找到司机档案，请联系管理员', icon: 'none', duration: 2500 })
        this.setData({ loaded: true })
        return
      }
      this.driverId = profile.driverId
      const [shifts, pickups, tasks] = await Promise.all([
        api.getDriverShifts().catch(() => []),
        api.getDriverPickups().catch(() => []),
        api.getDriverTasks(profile.driverId).catch(() => [])
      ])
      this.setData({
        driverName: profile.name || '',
        plateNo: profile.plateNo || '',
        cargoLimit: profile.cargoCapacity || 0,
        pendingPickups: pickups || [],
        tasks: tasks || []
      })
      this.initFromShifts(shifts || [])
      this.setData({ loaded: true })
    } catch (e) {
      this.setData({ loaded: true })
    }
  },

  /** 从真实班次初始化当前班次、站点、地图、运力；在途班次恢复行驶状态 */
  initFromShifts(shifts) {
    if (!shifts.length) return
    // 优先在途班次，否则取第一班
    const current = shifts.find((s) => s.status === 1) || shifts[0]
    const stops = current.stops || []
    if (!stops.length) return

    this.shiftId = current.shiftId
    this.shiftStops = stops

    const markers = stops.map((s, i) => ({
      id: i,
      latitude: s.latitude,
      longitude: s.longitude,
      title: s.stationName,
      iconPath: '',
      width: 20,
      height: 20,
      callout: { content: s.stationName, fontSize: 12, padding: 4, display: 'ALWAYS' }
    }))
    const polyline = [{
      points: stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
      color: '#4CAF50',
      width: 6,
      arrowLine: true
    }]

    // 运力：空余百分比 = (件数上限 - 待装车数) / 上限
    const cap = this.data.cargoLimit
    const used = this.data.pendingPickups.length
    const pct = cap > 0 ? Math.max(0, Math.round((cap - used) / cap * 100)) : 100
    const usedPct = cap > 0 ? Math.min(100, Math.round(used / cap * 100)) : 0

    this.setData({
      routeName: current.routeName || current.shiftCode,
      startStation: stops[0].stationName,
      endStation: stops[stops.length - 1].stationName,
      totalStops: stops.length,
      currentStopIndex: 0,
      progressPercent: 0,
      markers,
      polyline,
      cargoCapacity: pct,
      cargoUsed: usedPct,
      eta: this.calcEta(current)
    })
    this.updateComputedStyles()

    // 班次已在途：恢复行驶状态（重进小程序不丢进度）
    if (current.status === 1) {
      this.setData({ status: 'driving' })
      this.startLocationReport()
    }
  },

  /** 预计到达时间 = 计划发车 + 计划时长 */
  calcEta(shift) {
    if (!shift.plannedDepartureTime || !shift.plannedDurationMinutes) return ''
    const parts = shift.plannedDepartureTime.split(':')
    if (parts.length < 2) return ''
    const total = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10) + shift.plannedDurationMinutes
    const hh = String(Math.floor(total / 60) % 24).padStart(2, '0')
    const mm = String(total % 60).padStart(2, '0')
    return `${hh}:${mm}`
  },

  /**
   * 发车 - 调后端创建执行记录，成功后进入行驶中并开始位置上报
   */
  async startDrive() {
    if (!this.driverId || !this.shiftId) return
    try {
      await api.driverDepart(this.driverId, this.shiftId)
    } catch (e) {
      return // request 已 toast 错误信息
    }
    this.setData({
      status: 'driving',
      currentStopIndex: 0,
      progressPercent: 0
    })
    this.updateComputedStyles()
    wx.showToast({ title: '车辆已出发', icon: 'success', duration: 1500 })
    this.startLocationReport()
  },

  /** 启动位置上报定时器：真实 GPS 位置驱动进度与监控中心 */
  startLocationReport() {
    if (this.locationTimer) clearInterval(this.locationTimer)
    const tick = () => {
      wx.getLocation({
        type: 'gcj02',
        success: (res) => this.onLocation(res),
        fail: () => {} // 定位失败静默，等待下个周期
      })
    }
    tick()
    this.locationTimer = setInterval(tick, LOCATION_REPORT_INTERVAL)
  },

  /** 收到一次真实定位：上报后端 + 更新速度/下一站距离/进度 */
  onLocation(res) {
    const stops = this.shiftStops || []
    const speedKmh = Math.round((res.speed || 0) * 3.6)
    api.reportDriverLocation({
      driverId: this.driverId,
      shiftId: this.shiftId,
      longitude: res.longitude,
      latitude: res.latitude,
      speedKmh
    }).catch(() => {})

    if (this.data.status !== 'driving' || stops.length < 2) {
      this.setData({ speed: speedKmh })
      return
    }

    // 下一站 = 当前序号的下一站；距离足够近时提示可确认到站
    const nextIdx = Math.min(this.data.currentStopIndex + 1, stops.length - 1)
    const next = stops[nextIdx]
    const dist = Math.round(distanceMeters(res.latitude, res.longitude, next.latitude, next.longitude))

    // 进度：站间按距离线性插值
    const prev = stops[nextIdx - 1]
    const segLen = distanceMeters(prev.latitude, prev.longitude, next.latitude, next.longitude)
    const ratio = segLen > 0 ? Math.max(0, Math.min(1, 1 - dist / segLen)) : 0
    const percent = Math.round(((nextIdx - 1 + ratio) / (stops.length - 1)) * 100)

    this.setData({
      speed: speedKmh,
      currentStation: prev.stationName,
      nextStation: next.stationName,
      nextStationDistance: dist,
      progressPercent: percent
    })
    this.updateComputedStyles()
  },

  /**
   * 确认到站 - 调后端记录；终点站自动完成班次
   */
  async arriveAtStation() {
    const stops = this.shiftStops || []
    if (!this.driverId || !this.shiftId || !stops.length) return
    const nextIdx = Math.min(this.data.currentStopIndex + 1, stops.length - 1)
    const station = stops[nextIdx]
    try {
      await api.driverArrive(this.driverId, this.shiftId, station.stationId)
    } catch (e) {
      return
    }
    const isTerminal = nextIdx === stops.length - 1
    if (isTerminal) {
      // 班次完成
      if (this.locationTimer) {
        clearInterval(this.locationTimer)
        this.locationTimer = null
      }
      this.setData({
        status: 'idle',
        currentStopIndex: nextIdx,
        progressPercent: 100,
        speed: 0
      })
      this.updateComputedStyles()
      wx.showToast({ title: '班次已完成', icon: 'success', duration: 2000 })
      this.loadAll() // 刷新班次与任务
      return
    }
    this.setData({
      status: 'stopped',
      currentStopIndex: nextIdx,
      currentStation: station.stationName
    })
    this.updateComputedStyles()
  },

  /**
   * 更新所有计算样式
   */
  updateComputedStyles() {
    this.setData({
      progressFillStyle: 'width: ' + this.data.progressPercent + '%;',
      progressDotStyle: 'left: ' + this.data.progressPercent + '%;',
      cargoFillStyle: 'height: ' + this.data.cargoCapacity + '%;',
      cargoUsedStyle: 'bottom: ' + this.data.cargoUsed + '%;'
    })
  },

  /**
   * 运力滑块变化（slider组件）
   */
  onCapacityChange(e) {
    const value = e.detail.value || e.currentTarget.dataset.value
    if (value !== undefined) {
      this.setData({ cargoCapacity: value })
      this.updateComputedStyles()
    }
  },

  /**
   * 确认发布运力
   */
  publishCapacity() {
    const cap = this.data.cargoCapacity
    wx.showToast({
      title: `已发布 ${cap}% 仓位`,
      icon: 'success'
    })
  },

  /**
   * 扫码装车：匹配待装订单并调后端确认
   */
  scanToLoad() {
    this.scanOrder((order) => api.driverPickupConfirm(this.driverId, order.orderId), '装车确认成功')
  },

  /**
   * 扫码妥投：匹配待装订单并调后端完成派送
   */
  scanToDeliver() {
    this.scanOrder((order) => api.driverDeliver(this.driverId, order.orderId), '妥投成功')
  },

  /** 扫码并匹配待办订单，执行 action 后刷新列表 */
  scanOrder(action, successText) {
    wx.scanCode({
      scanType: ['qrCode', 'barCode'],
      success: async (res) => {
        const no = (res.result || '').trim()
        const order = this.data.pendingPickups.find((p) => p.orderNo === no)
        if (!order) {
          wx.showToast({ title: '未匹配到待办订单', icon: 'none', duration: 2000 })
          return
        }
        try {
          await action(order)
        } catch (e) {
          return
        }
        wx.showToast({ title: successText, icon: 'success' })
        const pickups = this.data.pendingPickups.filter((p) => p.orderId !== order.orderId)
        this.refreshCargo(pickups)
        // 装车完成继续行驶
        setTimeout(() => {
          if (this.data.status === 'stopped') {
            this.setData({ status: 'driving' })
          }
        }, 1500)
      },
      fail: () => {
        wx.showToast({ title: '已取消扫码', icon: 'none' })
      }
    })
  },

  /** 装车/妥投后刷新待办列表与行李舱运力 */
  refreshCargo(pickups) {
    const cap = this.data.cargoLimit
    const used = pickups.length
    const pct = cap > 0 ? Math.max(0, Math.round((cap - used) / cap * 100)) : 100
    const usedPct = cap > 0 ? Math.min(100, Math.round(used / cap * 100)) : 0
    this.setData({
      pendingPickups: pickups,
      cargoCapacity: pct,
      cargoUsed: usedPct
    })
    this.updateComputedStyles()
  },

  /**
   * 跳过装车，继续行驶
   */
  skipLoading() {
    this.setData({ status: 'driving' })
    wx.showToast({
      title: '继续行驶',
      icon: 'none'
    })
  },

  /**
   * 语音播报开关
   */
  toggleVoice() {
    wx.showToast({
      title: '语音播报已开启',
      icon: 'none'
    })
  },

  onUnload() {
    if (this.locationTimer) {
      clearInterval(this.locationTimer)
      this.locationTimer = null
    }
  }
})
