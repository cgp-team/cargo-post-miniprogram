/**
 * 司机工作台 - 核心页面
 * 三种状态：待发车(idle) / 行驶中(driving) / 到站停靠(stopped)
 * 数据来源：真实后端（司机档案/今日班次/待装车任务/调度任务）
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')

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

  /** 从真实班次初始化当前班次、站点、地图、运力 */
  initFromShifts(shifts) {
    if (!shifts.length) return
    // 优先在途班次，否则取第一班
    const current = shifts.find((s) => s.status === 1) || shifts[0]
    const stops = current.stops || []
    if (!stops.length) return

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
      cargoUsed: usedPct
    })
    this.updateComputedStyles()
    // 真实站点序列（含坐标），供行驶模拟
    this.shiftStops = stops
  },

  /**
   * 发车 - 从idle切换到driving
   */
  startDrive() {
    this.setData({
      status: 'driving',
      currentStopIndex: 0,
      progressPercent: 0
    })

    wx.showToast({
      title: '车辆已出发',
      icon: 'success',
      duration: 1500
    })

    // 模拟行驶动画（实际接入GPS）
    this.simulateDriving()
  },

  /**
   * 模拟行驶过程 (开发演示用，真实站点序列)
   */
  simulateDriving() {
    const totalStops = this.data.totalStops
    const stops = this.shiftStops || []
    const names = stops.map((s) => s.stationName)
    let currentIdx = 0
    // 清除旧定时器
    if (this.driveTimer) clearInterval(this.driveTimer)

    const timer = setInterval(() => {
      // 到站停靠时暂停推进
      if (this.data.status === 'stopped') return

      currentIdx++
      if (currentIdx >= totalStops) {
        clearInterval(timer)
        this.driveTimer = null
        return
      }

      const percent = Math.round((currentIdx / (totalStops - 1)) * 100)

      this.setData({
        currentStopIndex: currentIdx,
        currentStation: names[currentIdx - 1] || names[0],
        nextStation: names[currentIdx],
        nextStationDistance: Math.round(Math.random() * 3000 + 500),
        progressPercent: percent,
        speed: Math.round(Math.random() * 30 + 30)
      })
      this.updateComputedStyles()

      // 到站自动切换
      if (currentIdx > 0 && currentIdx < totalStops - 1) {
        setTimeout(() => {
          if (this.data.pendingPickups.length > 0) {
            this.setData({ status: 'stopped' })
          }
        }, 2000)
      }
    }, 5000)

    this.driveTimer = timer
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
   * 扫码装车
   */
  scanToLoad() {
    wx.scanCode({
      scanType: ['qrCode', 'barCode'],
      success: (res) => {
        console.log('扫码结果:', res.result)
        wx.showToast({
          title: '装车确认成功',
          icon: 'success'
        })

        // 返回行驶状态
        setTimeout(() => {
          this.setData({ status: 'driving' })
        }, 1500)
      },
      fail: () => {
        wx.showToast({
          title: '已取消扫码',
          icon: 'none'
        })
      }
    })
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
    if (this.driveTimer) {
      clearInterval(this.driveTimer)
    }
  }
})
