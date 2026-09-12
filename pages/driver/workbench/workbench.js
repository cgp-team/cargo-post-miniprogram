/**
 * 司机工作台 - 核心页面
 * 三种状态：待发车(idle) / 行驶中(driving) / 到站停靠(stopped)
 * 数据来源：真实后端（司机档案/今日班次/待装车任务/调度任务）
 * 写操作：发车 / 到站 / 装车确认 / 妥投 / 位置上报，全程状态真实落库
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')
const feedback = require('../../../utils/feedback')
const nav = require('../../../utils/nav')
const location = require('../../../utils/location')

/** 位置上报间隔（毫秒） */
const LOCATION_REPORT_INTERVAL = 10000
/** 位置监控间隔（毫秒）：统一查询后端 position，自动判断 REAL/SIMULATED */
const POSITION_MONITOR_INTERVAL = 3000
/** 到站判定半径（米）：进入该范围提示到站（任务书默认 50m） */
const ARRIVE_RADIUS_METERS = 50

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

    // 连续任务导航（任务段途经点）
    navTotalStops: 0,
    navStopIndex: 0,
    navStationName: '',
    // 多段联运：待确认的换乘交接数量（>0 时工作台显示交接入口）
    pendingHandoverCount: 0,
    navPickupCount: 0,
    navDeliverCount: 0,
    navBoardCount: 0,
    navAlightCount: 0,
    navActionTotal: 0,
    targetIndex: 0,
    canArrive: false,

    // 位置来源：由后端 Driver Position API 自动决定（REAL / SIMULATED / NONE）
    locationSource: 'NONE',

    // 行李舱运力
    cargoCapacity: 0,        // 空余仓位百分比
    cargoUsed: 0,            // 已用仓位百分比

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

    // 路线概览地图（所有状态下显示）
    routeMapMarkers: [],
    routeMapPolyline: [],

    // 地图中心（兜底坐标，onLoad 时用司机实时定位覆盖）
    mapLatitude: 30.32,
    mapLongitude: 108.21,

    loaded: false,
    driverUnreadCount: 0
  },

  onLoad() {
    const sysInfo = wx.getWindowInfo()
    this.setData({ headerSafeStyle: 'height: ' + (sysInfo.statusBarHeight || 20) + 'px;' })
    appearance.apply(this)
    this.initMapCenter()
    this.loadAll()
  },

  /** 地图中心跟随司机当前位置，定位失败保留兜底坐标 */
  async initMapCenter() {
    // 统一走 LocationService 的设备定位（GCJ-02），页面不再直接调 wx.getLocation
    try {
      const loc = await location.getDeviceLocationGcj02()
      if (loc && loc.success) {
        this.setData({ mapLatitude: loc.latitude, mapLongitude: loc.longitude })
      }
    } catch (e) {
      // 权限被拒或定位失败时使用兜底坐标
    }
  },

  onShow() {
    appearance.apply(this)
    // 从其他页返回时若在途（行驶中或到站停靠），确保上报定时器在跑
    if ((this.data.status === 'driving' || this.data.status === 'stopped') && !this.locationTimer) {
      this.startLocationReport()
    }
  },

  /** 加载司机身份 + 班次 + 任务 */
  async loadAll() {
    try {
      // 身份由后端按登录会员解析，前端不再传手机号/driverId
      const profile = await api.getDriverProfile()
      if (!profile) {
        wx.showToast({ title: '未找到司机档案，请联系管理员', icon: 'none', duration: 2500 })
        // 加载司机未读消息数
      api.getDriverUnreadCount(profile.driverId).then((count) => {
        this.setData({ driverUnreadCount: count || 0 })
      }).catch(() => {})
      this.setData({ loaded: true })
        return
      }
      this.driverId = profile.driverId
      const [shifts, pickups, tasks, route] = await Promise.all([
        api.getDriverShifts().catch(() => []),
        api.getDriverPickups().catch(() => []),
        api.getDriverTasks(profile.driverId).catch(() => []),
        api.getDriverRoute(profile.driverId).catch(() => null)
      ])
      // 多段联运：待确认交接数量（无多段/接口异常时为 0，不阻断工作台）
      const handovers = await api.getDriverHandovers(profile.driverId).catch(() => [])
      this.setData({
        driverName: profile.name || '',
        plateNo: profile.plateNo || '',
        cargoLimit: profile.cargoCapacity || 0,
        pendingPickups: pickups || [],
        tasks: tasks || [],
        // Phase 8：完整任务段（按方案分组、站点聚合动作）——司机看到整个运营任务而非"下一站"
        taskSegment: this.buildTaskSegment(tasks || []),
        // Phase 9：司机路线真实道路 polyline + 偏航判定（只报警不自动改方案）
        deviated: !!(route && route.deviated),
        deviationMeters: route && route.deviationMeters != null ? route.deviationMeters : 0,
        pendingHandoverCount: (handovers || []).length,
        driverUnreadCount: 0
      })
      this.driverRoutePolyline = route && route.polyline && route.polyline.length >= 2
        ? route.polyline.map((p) => ({ longitude: p.longitude, latitude: p.latitude }))
        : null
      // 连续任务导航：合并 route(坐标/顺序/真实道路) + tasks(取/派明细) 得 navPoints
      const navPoints = nav.buildNavPoints(route || null, tasks || [])
      this.navPoints = navPoints
      if (navPoints.length >= 2) {
        this.initFromNav(navPoints, shifts || [])
      } else {
        this.initFromShifts(shifts || [])
      }
      // 加载司机未读消息数
      api.getDriverUnreadCount(profile.driverId).then((count) => {
        this.setData({ driverUnreadCount: count || 0 })
      }).catch(() => {})
      this.setData({ loaded: true })
    } catch (e) {
      // 加载司机未读消息数
      api.getDriverUnreadCount(profile.driverId).then((count) => {
        this.setData({ driverUnreadCount: count || 0 })
      }).catch(() => {})
      this.setData({ loaded: true })
    }
  },

  /**
   * 完整任务段：按 planId 分组、按 visitSequence 排序，同站聚合动作（乘客/货运同站执行）。
   * 来源 = 后端 /driver/tasks（后端为任务状态的最终来源，前端仅展示）。
   */
  buildTaskSegment(tasks) {
    if (!tasks || !tasks.length) return []
    const byPlan = {}
    tasks.forEach((t) => {
      const key = String(t.planId)
      if (!byPlan[key]) {
        byPlan[key] = { planId: t.planId, taskWindowStart: t.taskWindowStart, taskWindowEnd: t.taskWindowEnd, stops: [] }
      }
      byPlan[key].stops.push(t)
    })
    return Object.values(byPlan).map((seg) => {
      seg.stops.sort((a, b) => (a.visitSequence || 0) - (b.visitSequence || 0))
      const stationMap = {}
      seg.stops.forEach((s) => {
        const sk = String(s.stationId || '')
        if (!stationMap[sk]) {
          stationMap[sk] = {
            stationName: s.stationName || '',
            status: s.status,
            statusName: s.statusName || '待执行',
            actions: []
          }
        }
        stationMap[sk].actions.push({
          actionName: s.actionName || '',
          orderNo: s.orderNo || '',
          quantity: s.quantity,
          statusName: s.statusName || ''
        })
      })
      seg.stops = Object.values(stationMap)
      return seg
    })
  },

  /**
   * 选班次：与本次派单任务段（navPoints）站点重合度最高者优先；
   * 同分时在途(1)优先、其次未发车(0)，最后按原顺序。无班次返回 null。
   * 目的：司机在重庆邮电大学片区执行任务时，发车/表头都用同片区的班次，不串到别的线路。
   */
  pickShiftForNav(navPoints, shifts) {
    const list = shifts || []
    if (!list.length) return null
    const targetIds = (navPoints || []).map((p) => String(p.stationId)).filter(Boolean)
    if (!targetIds.length) return list.find((s) => s.status === 1) || list[0]
    let best = null
    list.forEach((s) => {
      const stopIds = ((s && s.stops) || []).map((x) => String(x.stationId))
      const overlap = stopIds.filter((id) => targetIds.indexOf(id) >= 0).length
      const score = overlap * 10 + (s.status === 1 ? 2 : s.status === 0 ? 1 : 0)
      if (!best || score > best.score) best = { shift: s, score, overlap }
    })
    // 完全无重合（例如派单站点不在任何班次线路上）→ 回退原逻辑，保证仍能出方案
    if (!best || best.overlap === 0) return list.find((s) => s.status === 1) || list[0]
    return best.shift
  },

  /**
   * 连续任务导航初始化：以算法任务段经停点（navPoints）为导航数据源。
   * 班次信息仍用于发车/到站（shiftId）+ 运力展示，但地图/下一站/进度走任务段。
   */
  initFromNav(navPoints, shifts) {
    // 班次选择：优先"经停站与本次派单任务段重合度最高"的班次（片区一致），
    // 否则退化为在途班次/首个班次 —— 避免出现"任务在重庆邮电大学片区、发车却是成都线路"的错配
    const current = this.pickShiftForNav(navPoints, shifts)
    if (current) {
      this.shiftId = current.shiftId
      const cap = this.data.cargoLimit
      const used = (current.loadedCount != null ? current.loadedCount : this.data.pendingPickups.length) || 0
      const pct = cap > 0 ? Math.max(0, Math.round((cap - used) / cap * 100)) : 100
      const usedPct = cap > 0 ? Math.min(100, Math.round(used / cap * 100)) : 0
      this.setData({
        routeName: current.routeName || current.shiftCode,
        cargoCapacity: pct,
        cargoUsed: usedPct,
        eta: this.calcEta(current)
      })
    }

    // 恢复进度：优先后端任务状态（第一个"有作业"且 PENDING 的站），回退班次 currentStationId。
    // 跳过发车场站本身（只有 DEPART/RETURN、没有取派/上下客的经停）——发车后不该说"下一站=出发点"。
    const pendingIdx = (p) => (p.status == null ? 0 : p.status) === 0
    const firstWorkIdx = navPoints.findIndex((p) => pendingIdx(p) && (p.actionTotal || 0) > 0)
    const pendIdx = firstWorkIdx >= 0 ? firstWorkIdx : navPoints.findIndex(pendingIdx)
    const lastDone = navPoints.length > 0 && navPoints[navPoints.length - 1].status === 7
    let resumeIdx = pendIdx >= 0 ? pendIdx : (lastDone ? navPoints.length : 0)
    if (resumeIdx === 0 && current && current.currentStationId != null) {
      const matched = navPoints.findIndex((p) => p.stationId === current.currentStationId)
      if (matched > 0) resumeIdx = matched
    }
    resumeIdx = Math.min(resumeIdx, navPoints.length - 1)

    this.applyNavView(resumeIdx)

    if (current && current.status === 1 && resumeIdx < navPoints.length) {
      this.setData({ status: 'driving' })
      this.startLocationReport()
    }
  },

  /** 统一渲染导航视图（下一站/进度/markers/polyline），targetIndex 是唯一事实来源 */
  applyNavView(targetIndex) {
    const points = this.navPoints || []
    const total = points.length
    const idx = Math.min(targetIndex, total - 1)
    const t = points[idx] || {}
    this.setData({
      targetIndex: idx,
      currentStopIndex: idx,
      totalStops: total,
      navTotalStops: total,
      navStopIndex: total ? idx + 1 : 0,
      navStationName: t.stationName || '',
      navPickupCount: t.pickupCount || 0,
      navDeliverCount: t.deliverCount || 0,
      navBoardCount: t.boardCount || 0,
      navAlightCount: t.alightCount || 0,
      navActionTotal: t.actionTotal || 0,
      navReturnPoint: !!t.isReturn,
      nextStation: t.stationName || '',
      currentStation: idx > 0 ? (points[idx - 1] || {}).stationName : '',
      progressPercent: total > 1 ? Math.round(idx / (total - 1) * 100) : 0,
      markers: this.buildNavMarkers(idx),
      polyline: this.buildNavPolyline(),
      routeMapMarkers: this.buildRouteOverviewMarkers(idx),
      routeMapPolyline: this.buildRouteOverviewPolyline(),
      canArrive: false
    })
  },

  /** 任务段途经点 markers：目标高亮 / 已过灰 / 未到正常；动作用 callout 文字+背景色区分 */
  buildNavMarkers(targetIndex) {
    const theme = appearance.THEMES[this.data.themeColor] || appearance.THEMES.green
    return (this.navPoints || []).map((p, i) => {
      const isTarget = i === targetIndex
      const passed = i < targetIndex
      const hasCargo = p.pickupCount > 0 || p.deliverCount > 0
      let content = p.stationName || ''
      if (p.pickupCount) content += ' ??' + p.pickupCount
      if (p.deliverCount) content += ' ??' + p.deliverCount
      if (p.boardCount) content += ' ??' + p.boardCount
      if (p.alightCount) content += ' ??' + p.alightCount
      return {
        id: i,
        latitude: p.latitude,
        longitude: p.longitude,
        iconPath: passed ? '/images/marker-end.png'
          : isTarget ? '/images/marker-start.png' : '/images/marker-stop.png',
        width: isTarget ? 32 : 26,
        height: isTarget ? 32 : 26,
        callout: {
          content,
          color: '#fff',
          fontSize: isTarget ? 14 : 11,
          bgColor: passed ? '#666' : isTarget ? (theme.primary || '#2E7D32') : hasCargo ? (theme.clay || '#C75B2A') : '#444',
          padding: 6,
          borderRadius: 8,
          display: isTarget ? 'ALWAYS' : 'BYCLICK'
        }
      }
    })
  },

  /** 导航 polyline：真实道路优先，兜底站连线 */
  buildNavPolyline() {
    const points = (this.driverRoutePolyline && this.driverRoutePolyline.length >= 2)
      ? this.driverRoutePolyline
      : (this.navPoints || []).map((p) => ({ latitude: p.latitude, longitude: p.longitude }))
    const accent = (appearance.THEMES[this.data.themeColor] || appearance.THEMES.green).accent
    return [{ points, color: accent, width: 6, arrowLine: true }]
  },

    /** 路线概览地图markers：带序号的站点标注，颜色区分已过/当前/下一站/未到 */
    buildRouteOverviewMarkers(targetIndex) {
      const points = this.navPoints || []
      if (!points.length) return []
      const ti = Math.min(targetIndex || 0, points.length - 1)
      return points.map((p, i) => {
        const isPassed = i < ti
        const isCurrent = i === ti
        const isNext = i === ti + 1
        let bgColor = '#42A5F5'
        if (isPassed) bgColor = '#9E9E9E'
        else if (isCurrent) bgColor = '#FF9800'
        else if (isNext) bgColor = '#1976D2'
        const label = (i + 1) + '. ' + (p.stationName || '')
        return {
          id: 2000 + i,
          latitude: p.latitude,
          longitude: p.longitude,
          width: (isCurrent || isNext) ? 34 : 26,
          height: (isCurrent || isNext) ? 34 : 26,
          iconPath: '/images/marker-stop.png',
          callout: {
            content: label,
            color: '#ffffff',
            bgColor: bgColor,
            padding: 8,
            borderRadius: 10,
            display: 'ALWAYS',
            fontSize: 13,
            anchorX: 0,
            anchorY: -16
          }
        }
      })
    },

    /** 路线概览polyline：真实道路优先，兜底站点连线 */
    buildRouteOverviewPolyline() {
      const points = (this.driverRoutePolyline && this.driverRoutePolyline.length >= 2)
        ? this.driverRoutePolyline
        : (this.navPoints || []).map((p) => ({ latitude: p.latitude, longitude: p.longitude }))
      if (!points || points.length < 2) return []
      return [{
        points: points,
        color: '#2E7D32',
        width: 5,
        arrowLine: true
      }]
    },

    /** 导航到下一站：调用微信内置导航 */
    navigateToNextStop() {
      const points = this.navPoints || []
      const ti = Math.min(this.data.targetIndex || 0, points.length - 1)
      const target = points[ti]
      if (!target || target.latitude == null || target.longitude == null) {
        wx.showToast({ title: '暂无导航目标', icon: 'none' })
        return
      }
      wx.openLocation({
        latitude: target.latitude,
        longitude: target.longitude,
        name: target.stationName || '下一站',
        scale: 16
      })
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
    // Phase 9：地图轨迹优先用后端返回的真实道路 polyline（RoadSegments），否则退化为站点连线（兜底）
    const routePoints = this.driverRoutePolyline && this.driverRoutePolyline.length >= 2
      ? this.driverRoutePolyline
      : stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude }))
    const polyline = [{
      points: routePoints,
      color: (appearance.THEMES[this.data.themeColor] || appearance.THEMES.green).accent,
      width: 6,
      arrowLine: true
    }]

    // 运力：已装件数以后端执行记录 loadedCount 为准（真实落库），空余 = (上限 - 已装) / 上限
    const cap = this.data.cargoLimit
    const used = (current.loadedCount != null ? current.loadedCount : this.data.pendingPickups.length) || 0
    const pct = cap > 0 ? Math.max(0, Math.round((cap - used) / cap * 100)) : 100
    const usedPct = cap > 0 ? Math.min(100, Math.round(used / cap * 100)) : 0

    // 重进小程序时按后端当前站点恢复进度（在途不丢站）
    let resumeIndex = 0
    if (current.currentStationId != null) {
      const idx = stops.findIndex((s) => s.stationId === current.currentStationId)
      if (idx >= 0) resumeIndex = idx
    }
    const resumePercent = stops.length > 1 ? Math.round(resumeIndex / (stops.length - 1) * 100) : 0

    this.setData({
      routeName: current.routeName || current.shiftCode,
      startStation: stops[0].stationName,
      endStation: stops[stops.length - 1].stationName,
      totalStops: stops.length,
      currentStopIndex: resumeIndex,
      progressPercent: resumePercent,
      currentStation: resumeIndex > 0 ? stops[resumeIndex - 1].stationName : '',
      nextStation: stops[Math.min(resumeIndex, stops.length - 1)].stationName,
      markers,
      polyline,
      cargoCapacity: pct,
      cargoUsed: usedPct,
      eta: this.calcEta(current)
    })

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
    if (!this.driverId || !this.shiftId || this.submitting) return
    this.submitting = true
    try {
      await api.driverDepart(this.driverId, this.shiftId)
    } catch (e) {
      this.submitting = false
      return // request 已 toast 错误信息
    }
    this.submitting = false
    feedback.tap()
    // 连续任务导航：发车后从首个有效站开始；首站为纯经停时跳到下一有效站
    if (this.navPoints && this.navPoints.length >= 2) {
      const startIdx = (this.navPoints[0] && !(this.navPoints[0].actionTotal > 0) && this.navPoints.length > 1) ? 1 : 0
      this.applyNavView(startIdx)
    }
    this.setData({ status: 'driving', progressPercent: 0 })
    wx.showToast({ title: '车辆已出发', icon: 'success', duration: 1500 })
    this.startLocationReport()
  },

  /**
   * 统一位置监控：查询后端 Driver Position API，自动判断位置来源。
   * - SIMULATED：使用后端模拟引擎坐标，不上报真实 GPS（避免 REAL 顶掉模拟）
   * - REAL：使用 wx.getLocation 真实 GPS 并上报
   * - NONE：等待下次轮询
   */
  startLocationReport() {
    if (this.locationTimer) clearInterval(this.locationTimer)
    this.monitorTick()
    this.locationTimer = setInterval(() => this.monitorTick(), POSITION_MONITOR_INTERVAL)
  },

  /** 单次位置监控：查询后端 → 判断来源 → 更新导航 */
  async monitorTick() {
    if (!this.driverId) return
    try {
      const pos = await api.getDriverPosition(this.driverId)
      if (!pos) return

      const source = pos.dataSource || 'NONE'
      this.setData({ locationSource: source })

      if (source === 'SIMULATED' && pos.simRunning && pos.simLatitude != null && pos.simLongitude != null) {
        // SIMULATED：使用模拟引擎坐标，不上报真实 GPS
        this.updateNavByCoord(pos.simLatitude, pos.simLongitude, 0)
      } else if (source === 'REAL' && pos.latitude != null && pos.longitude != null) {
        // REAL：使用后端已上报的真实坐标更新导航
        this.updateNavByCoord(pos.latitude, pos.longitude, 0)
        // 同时继续上报最新 GPS（保持上报链路活跃）
        this.reportRealLocation()
      } else {
        // NONE 或无有效坐标：尝试用真实 GPS
        this.reportRealLocation()
      }
    } catch (e) {
      // 静默，等待下一轮
    }
  },

  /** 上报真实 GPS（仅 REAL 状态调用） */
  async reportRealLocation() {
    // 统一走 LocationService（GCJ-02，与站点表/高德/地图一致），避免页面各自调 wx.getLocation
    try {
      const loc = await location.getDeviceLocationGcj02()
      if (!loc || !loc.success) return // 权限问题由 onLocationFail 处理
      api.reportDriverLocation({
        driverId: this.driverId,
        shiftId: this.shiftId,
        longitude: loc.longitude,
        latitude: loc.latitude,
        speedKmh: 0 // LocationService 不返回速度；车辆速度由后端按里程/时长估算
      }).catch(() => {})
    } catch (e) {
      // 静默，等待下一轮
    }
  },

  /** 订阅派单通知：拉模板列表 → wx.requestSubscribeMessage 授权（一次性模板，派单前需再次订阅） */
  async subscribeDispatch() {
    try {
      const templates = await api.getSubscribeTemplateList()
      if (!templates || !templates.length) {
        wx.showToast({ title: '暂无可用订阅模板', icon: 'none' })
        return
      }
      const tpl = templates.find((t) => t.title === '派单通知') || templates[0]
      wx.requestSubscribeMessage({
        tmplIds: [tpl.id],
        success: (res) => {
          if (res[tpl.id] === 'accept') {
            wx.showToast({ title: '订阅成功', icon: 'success' })
          } else {
            wx.showToast({ title: '未订阅', icon: 'none' })
          }
        },
        fail: () => wx.showToast({ title: '订阅失败', icon: 'none' })
      })
    } catch (e) {
      wx.showToast({ title: '订阅失败', icon: 'none' })
    }
  },

  /** 定位失败：权限被拒时提示并停止上报，其余静默等待下个周期 */
  onLocationFail(err) {
    const msg = (err && err.errMsg) || ''
    if (msg.indexOf('auth deny') >= 0 || msg.indexOf('auth denied') >= 0 || msg.indexOf('authorize') >= 0) {
      if (this.locationTimer) {
        clearInterval(this.locationTimer)
        this.locationTimer = null
      }
      wx.showModal({
        title: '需要定位权限',
        content: '行驶中需获取位置上报监控中心，请在设置中开启定位权限',
        confirmText: '去设置',
        success: (r) => {
          if (r.confirm) wx.openSetting()
        }
      })
    }
  },

  /** 收到一次真实定位：上报后端 + 驱动导航（由 monitorTick 中 REAL 分支调用） */
  onLocation(res) {
    const speedKmh = Math.round((res.speed || 0) * 3.6)
    api.reportDriverLocation({
      driverId: this.driverId,
      shiftId: this.shiftId,
      longitude: res.longitude,
      latitude: res.latitude,
      speedKmh
    }).catch(() => {})
    this.updateNavByCoord(res.latitude, res.longitude, speedKmh)
  },

  /** 纯导航推进：给定坐标更新地图中心/下一站距离/进度/到站（模拟模式与真实 GPS 共用） */
  updateNavByCoord(latitude, longitude, speedKmh) {
    // 地图跟随当前位置
    this.setData({ mapLatitude: longitude, mapLongitude: latitude })

    if (this.data.status !== 'driving') {
      this.setData({ speed: speedKmh })
      return
    }

    const points = this.navPoints || []
    // 无任务段导航时回退旧班次站点逻辑
    if (points.length < 2) {
      const stops = this.shiftStops || []
      if (stops.length < 2) { this.setData({ speed: speedKmh }); return }
      const nextIdx = Math.min(this.data.currentStopIndex + 1, stops.length - 1)
      const next = stops[nextIdx]
      const dist = Math.round(distanceMeters(latitude, longitude, next.latitude, next.longitude))
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
      return
    }

    // 任务段导航
    const ti = Math.min(this.data.targetIndex, points.length - 1)
    const target = points[ti]
    const dist = Math.round(distanceMeters(latitude, longitude, target.latitude, target.longitude))

    // 纯经停站（无任何取/派/上下客动作）：进半径自动跳过，保证连续行驶
    if (dist <= ARRIVE_RADIUS_METERS && !(target.actionTotal > 0)) {
      const next = ti + 1
      if (next < points.length) {
        this.applyNavView(next)
        this.setData({ speed: speedKmh, nextStationDistance: 0 })
      } else {
        this.setData({ speed: speedKmh })
      }
      return
    }

    // 距目标 ≤50m → 点亮「到达」按钮
    if (dist <= ARRIVE_RADIUS_METERS) this.setData({ canArrive: true })
    else if (this.data.canArrive) this.setData({ canArrive: false })

    // 进度：站间按距离线性插值
    const prev = points[ti - 1] || target
    const segLen = distanceMeters(prev.latitude, prev.longitude, target.latitude, target.longitude)
    const ratio = segLen > 0 ? Math.max(0, Math.min(1, 1 - dist / segLen)) : 0
    const percent = Math.round(((ti - 1 + ratio) / (points.length - 1)) * 100)

    this.setData({
      speed: speedKmh,
      nextStation: target.stationName,
      nextStationDistance: dist,
      progressPercent: percent
    })
  },

  /**
   * 确认到站 - 调后端记录；终点站自动完成任务段
   */
  async arriveAtStation() {
    const points = this.navPoints || []
    const useNav = points.length >= 2
    if (!this.driverId || !this.shiftId || this.submitting) return

    let stationId
    let ti
    if (useNav) {
      ti = Math.min(this.data.targetIndex, points.length - 1)
      stationId = points[ti].stationId
    } else {
      const stops = this.shiftStops || []
      if (!stops.length) return
      ti = Math.min(this.data.currentStopIndex + 1, stops.length - 1)
      stationId = stops[ti].stationId
    }

    this.submitting = true
    try {
      await api.driverArrive(this.driverId, this.shiftId, stationId)
    } catch (e) {
      this.submitting = false
      return
    }
    this.submitting = false
    feedback.tap()

    if (useNav && points[ti]) points[ti].reached = true

    const totalLen = useNav ? points.length : (this.shiftStops || []).length
    const isTerminal = ti === totalLen - 1
    if (isTerminal) {
      // 任务段/班次完成
      if (this.locationTimer) {
        clearInterval(this.locationTimer)
        this.locationTimer = null
      }
      this.setData({ status: 'idle', currentStopIndex: ti, progressPercent: 100, speed: 0, canArrive: false })
      wx.showToast({ title: '本次任务完成', icon: 'success', duration: 2000 })
      this.loadAll()
      return
    }
    this.setData({
      status: 'stopped',
      currentStopIndex: ti,
      currentStation: useNav ? points[ti].stationName : (this.shiftStops || [])[ti].stationName,
      canArrive: false,
      markers: useNav ? this.buildNavMarkers(ti) : this.data.markers,
        routeMapMarkers: useNav ? this.buildRouteOverviewMarkers(ti) : this.data.routeMapMarkers
    })
  },

  /** 站内作业完成后推进到下一站（幂等：仅 stopped 态执行，防扫码连点重复推进） */
  continueToNextStation() {
    if (this.data.status !== 'stopped') return
    const points = this.navPoints || []
    if (points.length >= 2) {
      const next = this.data.targetIndex + 1
      if (next >= points.length) {
        this.setData({ status: 'idle', progressPercent: 100 })
        wx.showToast({ title: '本次任务完成', icon: 'success', duration: 2000 })
        this.loadAll()
        return
      }
      this.applyNavView(next)
      this.setData({ status: 'driving', nextStationDistance: 0 })
    } else {
      this.setData({ status: 'driving' })
    }
    this.startLocationReport()
  },

  /** 单段跳转系统地图（可选高德 App 车道级导航）：跳当前目标站 */
  openAmapNav() {
    const points = this.navPoints || []
    const t = points.length >= 2 ? points[Math.min(this.data.targetIndex, points.length - 1)] : null
    if (!t || t.latitude == null || t.longitude == null) {
      wx.showToast({ title: '暂无导航目标', icon: 'none' })
      return
    }
    wx.openLocation({ latitude: t.latitude, longitude: t.longitude, name: t.stationName || '任务点', scale: 16 })
  },

  /**
   * 扫码装车：匹配待装订单并调后端确认（货运散件强制司机收件拍照，快递总站核对凭证）
   */
  scanToLoad() {
    this.scanOrder(async (order) => {
      // 商城订单：同样拍照核验，走商城订单接口（订单仍为已发货，标记"已装车/配送中"）
      if (order.bizType === 'PRODUCT') {
        const productPhoto = await this.takeCargoPhoto()
        return api.driverProductLoad(this.driverId, order.orderId, productPhoto)
      }
      let photoUrl = ''
      if (order.orderType !== 3) { // 邮快件有快递面单，不强制拍照
        photoUrl = await this.takeCargoPhoto()
      }
      return api.driverPickupConfirm(this.driverId, order.orderId, photoUrl)
    }, '装车确认成功')
  },

  /**
   * 扫码妥投：匹配待装订单并调后端完成派送
   */
  scanToDeliver() {
    this.scanOrder(async (order) => {
      // 商城订单：妥投即交付完成（拍交付凭证 → 订单转已完成，用户端可见"已送达"）
      if (order.bizType === 'PRODUCT') {
        const proof = await this.takeCargoPhoto()
        return api.driverProductDeliver(this.driverId, order.orderId, proof)
      }
      return api.driverDeliver(this.driverId, order.orderId)
    }, '妥投成功')
  },

  /**
   * 取件核销：扫收件人取件码二维码，司机确认取件（邮快件下行）
   */
  scanToVerify() {
    if (this.submitting) return
    wx.scanCode({
      scanType: ['qrCode', 'barCode'],
      success: async (res) => {
        const code = (res.result || '').trim()
        const order = this.data.pendingPickups.find((p) => p.pickupCode === code || p.orderNo === code)
        if (!order) {
          wx.showToast({ title: '未匹配到待取快递', icon: 'none', duration: 2000 })
          return
        }
        this.submitting = true
        try {
          await api.driverPickupVerify(this.driverId, order.orderId, order.pickupCode)
        } catch (e) {
          this.submitting = false
          return
        }
        this.submitting = false
        feedback.tap()
        wx.showToast({ title: '取件核销成功', icon: 'success' })
        const pickups = this.data.pendingPickups.filter((p) => p.orderId !== order.orderId)
        this.refreshCargo(pickups)
      },
      fail: () => wx.showToast({ title: '已取消扫码', icon: 'none' })
    })
  },

  /** 拍照并上传，返回照片 URL（货运装车强制，快递总站核对凭证） */
  takeCargoPhoto() {
    return new Promise((resolve, reject) => {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera'],
        success: async (res) => {
          if (!res.tempFiles || !res.tempFiles[0]) {
            reject(new Error('no photo'))
            return
          }
          const temp = res.tempFiles[0].tempFilePath
          wx.showLoading({ title: '上传照片…', mask: true })
          try {
            const url = await api.uploadFile(temp)
            wx.hideLoading()
            resolve(url)
          } catch (e) {
            wx.hideLoading()
            wx.showToast({ title: '照片上传失败，请重拍', icon: 'none' })
            reject(e)
          }
        },
        fail: () => reject(new Error('cancelled'))
      })
    })
  },

  /** 扫码并匹配待办订单，执行 action 后刷新列表 */
  scanOrder(action, successText) {
    if (this.submitting) return
    wx.scanCode({
      scanType: ['qrCode', 'barCode'],
      success: (res) => this.handleScannedCode((res.result || '').trim(), action, successText),
      // 现场扫码不可用（光线/摄像头/二维码破损）时的兜底：手动输入单号，流程不中断
      fail: () => this.promptManualOrderNo(action, successText)
    })
  },

  /** 手输单号兜底（wx.showModal editable，需基础库 2.17.1+） */
  promptManualOrderNo(action, successText) {
    wx.showModal({
      title: '手动输入单号',
      editable: true,
      placeholderText: '扫码不可用时，输入订单号',
      success: (res) => {
        if (!res.confirm) {
          wx.showToast({ title: '已取消', icon: 'none' })
          return
        }
        const no = String(res.content || '').trim()
        if (!no) return
        this.handleScannedCode(no, action, successText)
      }
    })
  },

  /** 扫码/手输得到单号后统一处理：匹配待办 → 执行动作 → 刷新 → 推进下一站 */
  async handleScannedCode(no, action, successText) {
    if (!no) return
    const order = this.data.pendingPickups.find((p) => p.orderNo === no)
    if (!order) {
      wx.showToast({ title: '未匹配到待办订单', icon: 'none', duration: 2000 })
      return
    }
    this.submitting = true
    try {
      await action(order)
    } catch (e) {
      this.submitting = false
      return
    }
    this.submitting = false
    feedback.tap()
    wx.showToast({ title: successText, icon: 'success' })
    const pickups = this.data.pendingPickups.filter((p) => p.orderId !== order.orderId)
    this.refreshCargo(pickups)
    // 装车完成继续行驶（连续任务导航：推进到下一站）
    setTimeout(() => {
      this.continueToNextStation()
    }, 1500)
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
  },

  /**
   * 跳过装车，继续行驶
   */
  /** 多段联运：进入货物交接页（拍照确认换乘交接） */
  goHandover() {
    feedback.tap()
    wx.navigateTo({ url: '/pages/driver/handover/handover' })
  },

  skipLoading() {
    this.continueToNextStation()
    wx.showToast({
      title: '继续行驶',
      icon: 'none'
    })
  },

  onHide() {
    // 切后台时停掉位置上报定时器，onShow 恢复在途时重启，避免后台持续定位耗电
    if (this.locationTimer) {
      clearInterval(this.locationTimer)
      this.locationTimer = null
    }
  },

  onUnload() {
    if (this.locationTimer) {
      clearInterval(this.locationTimer)
      this.locationTimer = null
    }
  }
})








