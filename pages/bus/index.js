/**
 * 实时公交页（农村客货邮版"车来了"）
 *
 * 结构：定位状态 → 地图（第一视觉焦点，含"我的位置"/公交站/运行车辆/线路）→ 附近线路（最多 6 条）
 *       → 正在运行车辆列表。数据源与首页完全同源：/bus/nearby（现实公交 + 项目线路 + 模拟车辆分层）
 *       + /bus/lines（项目线路几何）。
 *
 * 关键约束：
 * - 定位只走 utils/location.js（页面禁止直接调 wx.getLocation），统一 GCJ-02；
 * - 车辆每 15s 刷新，只更新 markers/列表，不重置地图中心与 polyline；
 * - 车辆坐标变化由 utils/bus-motion.js 统一插值平滑移动（单定时器，onHide/onUnload 清理）；
 * - 用户拖动地图后不再抢回中心，直到点「回到我的位置」。
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')
const location = require('../../utils/location')
const transitAmap = require('../../utils/transit-amap')
const motion = require('../../utils/bus-motion')
const { navThrottled } = require('../../utils/util')
const { DEFAULT_MAP_CENTER } = require('../../utils/config')

/** 车辆/定位刷新间隔（保留原 15s） */
const REFRESH_MS = 15000
/** 附近线路默认展示条数（其余点「全部线路」） */
const MAX_NEARBY_LINES = 6
/** 地图站点 marker 上限（防止几十个站点铺满地图） */
const MAX_STATION_MARKERS = 20
/** 我的位置 marker id */
const MARKER_ME = 1
/** 站点 marker id 起始（1000 + index） */
const MARKER_STATION_BASE = 1000
/** 车辆 marker id 起始（2000 + busId），便于点击时反查 */
const MARKER_BUS_BASE = 2000

Page({
  behaviors: [require('../../behaviors/page-base')],
  data: {
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    statusBarHeight: 20,
    loading: true,
    hasError: false,
    // 定位状态
    locationText: '正在定位…',
    locationLevel: '',
    locationAccuracy: null,
    radiusExpanded: false,
    nearbyLocatedText: '',
    // 附近（现实公交 + 项目线路 + 车辆）
    nearbyStations: [],
    nearbyStationCount: 0,
    nearbyLines: [],
    nearbyLineCount: 0,
    showAllLines: false,
    visibleLines: [],
    vehicles: [],
    // 线路（项目线路几何 + 车辆）
    lines: [],
    activeLineKey: 'NEARBY',
    // 地图
    // 初始中心用 config.DEFAULT_MAP_CENTER 兜底（定位失败时的默认中心），
    // 真实定位/最近站点到达后会被覆盖（优先级：用户位置 → 最近站点 → 项目线路首站）
    mapCenter: DEFAULT_MAP_CENTER,
    mapScale: 14,
    markers: [],
    polyline: []
  },

  onLoad() {
    this._initPageBase()
    // 定位变化（缓存秒出→后台刷新到真实位置）→ 更新地图中心 + 重查附近公交
    this._offLocationChange = location.onLocationChange((loc) => {
      // 页面在后台时不查公交（省电省流量）；onShow 会补一次刷新
      if (this._pageHidden) return
      this._applyLocation(loc)
      this.loadNearby()
    })
    this._animator = motion.createAnimator((progressed) => {
      this._renderMarkers(progressed)
    }, () => this._markers)
    this.loadLines()
    this.loadNearby()
  },

  onShow() {
    this._applyAppearance()
    this._pageHidden = false
    // 首次 onShow 紧接 onLoad（刚加载过），跳过避免双发；从详情页等返回时才补刷新
    if (this._entered) this.loadNearby()
    this._entered = true
    this.startTimer()
  },

  onHide() {
    this._pageHidden = true
    this.stopTimer()
    this._destroyAnimator()
  },

  onUnload() {
    this.stopTimer()
    this._destroyAnimator()
    if (this._offLocationChange) {
      this._offLocationChange()
      this._offLocationChange = null
    }
  },

  // ==================== 定时刷新（15s，只更新车辆/marker） ====================

  startTimer() {
    this.stopTimer()
    this._timer = setInterval(() => {
      // 静默轮询：失败不弹 toast、不闪错误态（弱网行车时每 15s 弹窗不可接受）
      this.loadNearby({ silent: true })
      this.loadLines({ silent: true })
    }, REFRESH_MS)
  },

  stopTimer() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  _destroyAnimator() {
    if (this._animator) this._animator.destroy()
  },

  // ==================== 定位 ====================

  /** 应用定位结果：状态文案（已定位 · 精度 XXm / 精度较低·已扩大搜索范围 / 无法获取当前位置） */
  _applyLocation(loc) {
    if (!loc || !loc.success) {
      this.setData({
        locationText: '无法获取当前位置',
        locationLevel: 'UNKNOWN',
        locationAccuracy: null,
        radiusExpanded: false
      })
      return
    }
    const accuracyText = location.accuracyText(loc)
    const expanded = location.isCoarseAccuracy(loc)
    // 定位对象本体只放 this._userLocation，不进 data（wxml 不绑定它，进 data 会随每次 setData 序列化到视图层）
    this.setData({
      locationText: expanded
        ? `定位精度较低（约 ${accuracyText}）· 已扩大搜索范围`
        : (accuracyText ? `已定位 · 精度 ${accuracyText}` : '已定位'),
      locationLevel: loc.level || '',
      locationAccuracy: typeof loc.accuracy === 'number' ? Math.round(loc.accuracy) : null,
      radiusExpanded: expanded
    })
    this._userLocation = loc
    if (!this._userPanned) this._centerOnUser()
  },

  /** 地图中心回到用户位置（用户拖动过地图则不抢回） */
  _centerOnUser() {
    const loc = this._userLocation
    if (!loc || !loc.success) return
    this.setData({
      mapCenter: { latitude: loc.latitude, longitude: loc.longitude },
      mapScale: this.data.mapScale || 14
    })
  },

  /** 手动重新定位（跳过缓存） */
  async locateMe() {
    wx.showLoading({ title: '定位中…', mask: true })
    try {
      const loc = await location.refreshLocation()
      wx.hideLoading()
      this._userPanned = false
      this._applyLocation(loc)
      if (!loc || !loc.success) {
        wx.showToast({ title: '定位失败，请检查定位权限', icon: 'none' })
        return
      }
      await this.loadNearby()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '定位失败，请稍后重试', icon: 'none' })
    }
  },

  /**
   * 手动选择位置（定位不准时的纠正）：粗定位（未开精确位置/室内/WiFi）误差可达公里级，
   * 会出现"人在南岸区、公交按渝中区查"的情况；地图点选后按新坐标重查附近公交。
   */
  async manualPickLocation() {
    try {
      const loc = await location.chooseLocation()
      if (!loc || !loc.success) return // 用户取消
      this._userPanned = false
      this._applyLocation(loc)
      await this.loadNearby()
      wx.showToast({ title: `已使用：${loc.name || loc.address || '所选位置'}`.slice(0, 30), icon: 'none' })
    } catch (e) {
      wx.showToast({ title: '选择位置失败，请重试', icon: 'none' })
    }
  },

  // ==================== 附近公交（与首页同源） ====================

  async loadNearby(options) {
    const silent = !!(options && options.silent)
    // 请求序号：15s 轮询/定位变化/手动选点可并发触发，旧响应直接丢弃，不得覆盖新数据
    const seq = (this._nearbySeq = (this._nearbySeq || 0) + 1)
    const stale = () => seq !== this._nearbySeq || this._pageHidden
    try {
      const loc = await location.getCurrentLocation()
      if (stale()) return
      this._applyLocation(loc)
      const hasCoords = !!(loc && loc.success
        && typeof loc.latitude === 'number' && typeof loc.longitude === 'number')
      const district = hasCoords ? '' : ((loc && loc.district) || '')
      const radius = hasCoords ? location.nearbyRadius(loc.accuracy, loc.level) : null
      const raw = await api.getNearbyRealtimeBuses(
        hasCoords ? loc.latitude : null,
        hasCoords ? loc.longitude : null,
        radius,
        district || null,
        silent ? { silent: true } : undefined
      )
      if (stale()) return
      // 客户端现实公交层补充（后端已有现实层时内部直接跳过，不重复请求高德）
      const data = await transitAmap.enrichNearby(
        raw,
        hasCoords ? loc.latitude : null,
        hasCoords ? loc.longitude : null
      )
      if (stale()) return
      const stations = transitAmap.dedupeStations((data && data.nearbyStations) || [])
      const lines = (data && data.lines) || []
      const buses = (data && data.buses) || []
      const inServiceFlag = data && data.inService != null ? data.inService : null
      // 不在运营时间：不展示车辆卡片（凌晨把一堆"待发车"卡片铺出来会让人误以为正在运行），
      // 只保留"当前不在运营时间 + 下一班几点"的说明。
      const visibleBuses = inServiceFlag === false ? [] : buses
      const visibleLines = this._buildVisibleLines(lines, stations)
      this.setData({
        nearbyStations: stations,
        nearbyStationCount: stations.length,
        nearbyLines: lines,
        nearbyLineCount: (data && data.lineCount) || lines.length,
        visibleLines: this.data.showAllLines ? visibleLines : visibleLines.slice(0, MAX_NEARBY_LINES),
        vehicles: visibleBuses.map((b, i) => this._formatVehicle(b, i)),
        nearbyLocatedText: hasCoords
          ? '根据当前位置展示'
          : (district ? `根据${district}展示` : '定位不可用'),
        // 运营时段（无车时如实展示"当前不在运营时间 + 下一班几点"，不留空白）
        inService: inServiceFlag,
        serviceWindowText: (data && data.serviceWindowText) || '',
        nextDepartureText: (data && data.nextDepartureTime) || '',
        runningEmptyText: this._runningEmptyText(data, buses),
        hasError: false,
        loading: false
      })
      this._stations = stations
      this._buses = visibleBuses
      this._moveVehicles(visibleBuses)
      // 地图中心优先级：用户位置 → 最近站点 → 项目线路首站
      if (!this._userPanned && !(loc && loc.success) && stations.length) {
        this.setData({ mapCenter: { latitude: stations[0].latitude, longitude: stations[0].longitude } })
      }
    } catch (e) {
      if (stale()) return
      // 静默轮询失败保留旧数据（弱网抖动不该把已展示的线路/车辆闪成错误态）
      if (silent) return
      this.setData({ hasError: true, loading: false })
    }
  },

  /** 附近线路：现实线路 + 项目线路分别标注来源；同名去重；按名称稳定排序 */
  /**
   * "正在运行"空态文案：有线路但没车时，如实说明是不是运营时间之外。
   * 运营时段/下一班来自后端（按附近线路的启用班次推导）。
   */
  _runningEmptyText(data, buses) {
    if (buses && buses.length) return ''
    const window = (data && data.serviceWindowText) || this.data.serviceWindowText
    const next = (data && data.nextDepartureTime) || this.data.nextDepartureText
    const inService = data && data.inService != null ? data.inService : this.data.inService
    if (inService === false) {
      return `当前不在运营时间${window ? `（服务时段 ${window}）` : ''}${next ? `，下一班 ${next} 发车` : ''}`
    }
    if (inService === true) {
      return '班次正在运行中，附近暂时没有车辆经过，稍后会自动刷新'
    }
    return '附近暂无正在运行的车辆'
  },

  _buildVisibleLines(lines, stations) {
    const result = []
    const seen = {}
    ;(lines || []).forEach((l) => {
      const name = l.routeName
      if (!name || seen[name]) return
      seen[name] = true
      result.push({
        key: `${l.dataSource || 'PROJECT_TRANSIT'}:${name}`,
        name,
        dataSource: l.dataSource || 'PROJECT_TRANSIT',
        startStation: l.startStation,
        endStation: l.endStation
      })
    })
    // 现实站点里带出的线路（高德 POI 的途经线路）也补进列表，标注现实公交
    ;(stations || []).forEach((s) => {
      ;(s.lines || []).forEach((name) => {
        if (!name || seen[name]) return
        seen[name] = true
        result.push({ key: `REAL_TRANSIT:${name}`, name, dataSource: 'REAL_TRANSIT' })
      })
    })
    return result
  },

  toggleAllLines() {
    const showAll = !this.data.showAllLines
    const all = this._buildVisibleLines(this.data.nearbyLines, this._stations || [])
    this.setData({
      showAllLines: showAll,
      visibleLines: showAll ? all : all.slice(0, MAX_NEARBY_LINES)
    })
  },

  /** 点击附近线路：切到该线路（项目线路按需拉取真实道路轨迹，失败回退站点连线） */
  async selectNearbyLine(e) {
    const key = e.currentTarget.dataset.key
    const name = e.currentTarget.dataset.name
    const source = e.currentTarget.dataset.source
    const primary = (appearance.THEMES[this.data.themeColor] || appearance.THEMES.green).primary

    // 请求序号：道路轨迹按需拉取期间用户可能改点其他线路，旧响应不得覆盖新选中的 polyline
    const seq = (this._lineSeq = (this._lineSeq || 0) + 1)

    // 再次点击同一条线路：取消选中，回到"附近线路"总览
    if (key === this.data.activeLineKey || key === 'NEARBY') {
      this.setData({ activeLineKey: 'NEARBY', polyline: [] })
      return
    }

    // 现实线路（高德 POI 途经线路）暂无道路几何：用附近现实站点的顺序连线，并明确标注为现实公交
    if (source === 'REAL_TRANSIT') {
      const pts = (this._stations || [])
        .filter((s) => (s.lines || []).indexOf(name) >= 0)
        .slice(0, 30)
        .map((s) => ({ latitude: s.latitude, longitude: s.longitude }))
      this.setData({
        activeLineKey: key,
        polyline: pts.length >= 2 ? [{ points: pts, color: '#C75B2A', width: 4, arrowLine: true }] : [],
        mapCenter: pts.length ? pts[0] : this.data.mapCenter,
        mapScale: 13
      })
      return
    }

    // 项目线路：优先真实道路 polyline（后端高德路网），回退到站点直线
    const line = (this.data.lines || []).find((l) => l.routeName === name)
    if (!line) {
      this.setData({ activeLineKey: key, polyline: [] })
      return
    }
    // 真实道路轨迹：点开时按需查询（后端 5 分钟缓存，避免整页 15 条线路逐站打高德导致超时）
    let road = line.roadPolyline
    if ((!road || road.length < 2) && line.routeId) {
      try {
        const fetched = await api.getBusLinePolyline(line.routeId)
        if (seq !== this._lineSeq) return // 等待期间用户已改选其他线路
        if (fetched && fetched.length >= 2) road = fetched
      } catch (err) {
        if (seq !== this._lineSeq) return
        road = null
      }
    }
    const pts = ((road && road.length >= 2) ? road : (line.points || []))
      .filter((p) => p && p.longitude != null && p.latitude != null)
      .map((p) => ({ latitude: p.latitude, longitude: p.longitude }))
    this.setData({
      activeLineKey: key,
      polyline: pts.length >= 2 ? [{ points: pts, color: primary, width: 4, arrowLine: true }] : [],
      mapCenter: pts.length ? pts[0] : this.data.mapCenter,
      mapScale: 13
    })
  },

  // ==================== 项目线路几何（地图 polyline 来源） ====================

  async loadLines(options) {
    if (this._linesLoading) return
    this._linesLoading = true
    try {
      // 带坐标只取附近线路：主城全量线网几百条，全量下发会让小程序超时
      const loc = this._userLocation
      // 半径按定位精度自适应（5~15km）：主城线网 200+ 条，半径给太大仍会下发过多数据
      const lineRadius = loc && loc.success
        ? location.nearbyRadius(loc.accuracy, loc.level)
        : null
      const lines = (await api.getRealtimeBusLines(
        loc && loc.success ? loc.latitude : null,
        loc && loc.success ? loc.longitude : null,
        lineRadius,
        options && options.silent ? { silent: true } : undefined
      )) || []
      this.setData({ lines })
      // 无用户定位时，用项目线路首站兜底地图中心（不用 103/30 这类无意义默认值）
      if (!this.data.mapCenter) {
        const first = lines.map((l) => (l.points || [])[0]).find((p) => p && p.latitude != null)
        if (first) this.setData({ mapCenter: { latitude: first.latitude, longitude: first.longitude } })
      }
      if (!(options && options.silent)) this._renderMarkers(null)
      this.setData({ hasError: false })
    } catch (e) {
      if (!(options && options.silent)) this.setData({ hasError: true })
    } finally {
      this._linesLoading = false
    }
  },

  // ==================== 车辆与地图 ====================

  _formatVehicle(b, index) {
    const hasEta = typeof b.etaMinutes === 'number' && b.etaMinutes >= 0
    const simulated = b.locationSource === 'SIMULATED' || b.dataSource === 'SIMULATED'
    const nextStation = b.nextStation || ''
    const currentStation = b.currentStation || ''
    const running = b.status === 'RUNNING'
    // 用户视角：优先回答"离我最近的那一站，这车还有几分钟到"（后端按线路站点序算好）
    const nearestName = b.nearestStationName || ''
    const nearestEta = typeof b.nearestStationEtaMinutes === 'number' ? b.nearestStationEtaMinutes : null
    // 卡片主文案：永远有内容，且区分"在途"与"待发/收车"——
    // 待发车的 etaMinutes 是"距发车分钟"，不能写成"到下一站分钟"（否则会出现"预计 464 分钟到达"）
    const stationText = nearestName
      ? (nearestEta != null
        ? `离你最近的「${nearestName}」还有 ${b.stopsToNearestStation || 0} 站`
        : `将经过离你最近的「${nearestName}」`)
      : (running && nextStation
        ? `下一站：${nextStation}`
        : (currentStation
          ? `${running ? '当前停靠' : '待发车'}：${currentStation}`
          : (b.endStation ? `已到终点站：${b.endStation}` : '位置待更新')))
    // 卡片左侧大数字：在途才显示"到下一站分钟"；待发显示"待发"（等待时长写在下方小字里）
    // 待发车的"距发车分钟"来自后端 waitDepartureMinutes（etaMinutes 只在在途时才有值）
    const waitMinutes = !running && typeof b.waitDepartureMinutes === 'number' ? b.waitDepartureMinutes : null
    return {
      busId: b.busId,
      plateNo: b.plateNo || '班车',
      routeName: b.routeName || '线路未知',
      shiftCode: b.shiftCode || '',
      statusText: b.status === 'RUNNING' ? '行驶中'
        : (b.status === 'IDLE' ? '待发/停靠' : (b.status === 'ARRIVED' ? '已到站' : '无位置')),
      nextStation: nextStation || (currentStation || b.endStation || '—'),
      currentStation,
      stationText,
      running,
      distanceKm: typeof b.distanceToNextStationKm === 'number' ? b.distanceToNextStationKm : null,
      // 班次模拟车辆的预计到站：按班次计划时长推算，文案用"预计"而不是"演示"，
      // 车上显示的是真实线路上的推算位置（线路/站点均来自真实公交线网）
      etaNumber: nearestEta != null ? nearestEta
        : (running ? (hasEta ? b.etaMinutes : '—') : (b.status === 'ARRIVED' ? '—' : '待发')),
      etaUnit: nearestEta != null ? '分钟' : (running && hasEta ? '分钟' : ''),
      waitMinutes,
      etaText: nearestEta != null ? `约 ${nearestEta} 分钟到「${nearestName}」`
        : (running && hasEta ? `约 ${b.etaMinutes} 分钟到下一站`
          : (waitMinutes != null ? `${waitMinutes} 分钟后发车`
            : (b.status === 'ARRIVED' ? '已到终点站' : '待发车'))),
      // 列表按"距用户直线距离"升序，第一条即离用户最近的车辆
      isNearest: index === 0,
      simulated,
      isReal: b.locationSource === 'REAL_FRESH' || b.dataSource === 'REAL',
      sourceText: b.locationSource === 'REAL_FRESH' ? '实时'
        : (b.locationSource === 'REAL_STALE' ? '位置可能过期' : (simulated ? '位置推算' : '位置暂不可用')),
      longitude: b.longitude,
      latitude: b.latitude
    }
  },

  /** 刷新车辆位置：只把"目标位置"交给动画层，由它统一插值（不整页 setData） */
  _moveVehicles(buses) {
    const targets = (buses || [])
      .filter((b) => b.latitude != null && b.longitude != null)
      .map((b) => ({
        id: MARKER_BUS_BASE + b.busId,
        current: this._lastVehiclePos && this._lastVehiclePos[b.busId],
        to: { latitude: b.latitude, longitude: b.longitude },
        meta: { busId: b.busId }
      }))
    const next = {}
    ;(buses || []).forEach((b) => {
      if (b.latitude != null) next[b.busId] = { latitude: b.latitude, longitude: b.longitude }
    })
    this._lastVehiclePos = next
    if (this._animator) this._animator.setTargets(targets)
  },

  /** 生成 markers：我的位置 + 附近站点 + 车辆（模拟位置用橙色车标，真实上报绿色） */
  _renderMarkers(progressed) {
    const markers = []
    const loc = this._userLocation
    if (loc && loc.success) {
      markers.push({
        id: MARKER_ME,
        longitude: loc.longitude,
        latitude: loc.latitude,
        iconPath: '/images/marker-me.png',
        width: 36,
        height: 36,
        zIndex: 9
      })
    }
    const center = this.data.mapCenter || (loc && loc.success ? { latitude: loc.latitude, longitude: loc.longitude } : null)
    for (const m of this._stationMarkers(center)) markers.push(m)
    // 车辆：动画帧优先，其次原始坐标
    const byId = {}
    ;(progressed || []).forEach((p) => { byId[p.id] = p })
    ;(this._buses || []).forEach((b) => {
      if (b.latitude == null || b.longitude == null) return
      const id = MARKER_BUS_BASE + b.busId
      const frame = byId[id]
      const simulated = b.locationSource === 'SIMULATED' || b.dataSource === 'SIMULATED'
      markers.push({
        id,
        longitude: frame ? frame.longitude : b.longitude,
        latitude: frame ? frame.latitude : b.latitude,
        iconPath: simulated ? '/images/marker-bus-sim.png' : '/images/marker-bus-real.png',
        width: 34,
        height: 34,
        zIndex: 8,
        callout: {
          content: `${b.plateNo || '班车'}${simulated ? ' · 位置推算' : ' · 实时'}\n下一站：${b.nextStation || '—'}`,
          color: '#ffffff',
          bgColor: simulated ? '#C75B2A' : '#2E7D32',
          fontSize: 11,
          borderRadius: 8,
          padding: 6,
          display: 'BYCLICK'
        }
      })
    })
    this._commitMarkers(markers)
  },

  /**
   * 站点 markers（带缓存）：动画帧每 100ms 调一次 _renderMarkers，
   * 站点列表与地图中心没变就不重排不重造（排序 + 最多 20 个 label 对象纯属重复劳动）。
   */
  _stationMarkers(center) {
    const stations = this._stations || []
    const key = center ? `${center.latitude},${center.longitude}` : ''
    const cache = this._stationCache
    if (cache && cache.stations === stations && cache.key === key) return cache.markers
    const nearStations = center
      ? stations.slice().sort((a, b) => this._dist(center, a) - this._dist(center, b)).slice(0, MAX_STATION_MARKERS)
      : stations.slice(0, MAX_STATION_MARKERS)
    const markers = nearStations.map((s, i) => {
      // 自建站点（客货邮驿站/村邮站）单独标注：后期村民要用自建线路寄货，地图上必须能认出来
      const isSelfBuilt = (s.dataSource || 'PROJECT_TRANSIT') === 'PROJECT_TRANSIT'
      return {
        id: MARKER_STATION_BASE + i,
        longitude: s.longitude,
        latitude: s.latitude,
        iconPath: '/images/marker-stop.png',
        width: 22,
        height: 22,
        zIndex: 5,
        // 最近的 8 个站点带名称标签：避免"地图上站点乱标、看不出是哪个站"
        label: i < 8 && s.name
          ? {
              content: isSelfBuilt ? `驿站·${s.name}` : s.name,
              color: isSelfBuilt ? '#7A4B12' : '#1F3B57',
              fontSize: 10,
              bgColor: isSelfBuilt ? '#FFF6E8' : '#FFFFFF',
              borderRadius: 3,
              padding: 2,
              anchorX: -14,
              anchorY: -8
            }
          : undefined
      }
    })
    this._stationCache = { stations, key, markers }
    return markers
  },

  /**
   * 提交 markers：id 序列不变且仅经纬度变化时走路径更新（markers[i].latitude），
   * 否则全量替换。动画帧（100ms 一帧）若整表替换，marker 会闪且每帧都把
   * callout/label 等静态对象序列化一遍；路径更新只发变化的坐标数字。
   */
  _commitMarkers(markers) {
    this._markers = markers
    const prev = this.data.markers || []
    let sameShape = prev.length === markers.length
    if (sameShape) {
      for (let i = 0; i < markers.length; i++) {
        if (!prev[i] || prev[i].id !== markers[i].id) { sameShape = false; break }
      }
    }
    if (!sameShape) {
      this.setData({ markers })
      return
    }
    const patch = {}
    let changed = false
    for (let i = 0; i < markers.length; i++) {
      const p = prev[i]
      const m = markers[i]
      // 静态属性（图标/callout/label 文案）变化走路径更新不可靠，退化整表替换
      if (p.iconPath !== m.iconPath || p.zIndex !== m.zIndex
        || (p.callout ? p.callout.content : '') !== (m.callout ? m.callout.content : '')
        || (p.label ? p.label.content : '') !== (m.label ? m.label.content : '')) {
        this.setData({ markers })
        return
      }
      if (p.latitude !== m.latitude) { patch[`markers[${i}].latitude`] = m.latitude; changed = true }
      if (p.longitude !== m.longitude) { patch[`markers[${i}].longitude`] = m.longitude; changed = true }
    }
    if (changed) this.setData(patch)
  },

  _dist(center, s) {
    const dLat = (s.latitude || 0) - center.latitude
    const dLng = (s.longitude || 0) - center.longitude
    return dLat * dLat + dLng * dLng
  },

  /**
   * 地图拖动/缩放：只有"用户手动操作"才标记为已拖动，之后不再自动抢回中心。
   * 注意：设置 longitude/latitude 触发的程序化 regionchange 也会带 type=begin，
   * 若按 type 判断会把首次定位当成用户拖动，导致地图永远停在兜底中心（定位看着"不准"）。
   */
  onRegionChange(e) {
    if (e.causedBy === 'drag' || e.causedBy === 'scale') {
      this._userPanned = true
    }
  },

  /** 点击 marker：车辆 → 详情；我的位置 → 回到中心 */
  onMarkerTap(e) {
    const markerId = e.detail && e.detail.markerId
    if (markerId === MARKER_ME) {
      this._userPanned = false
      this._centerOnUser()
      return
    }
    if (markerId >= MARKER_BUS_BASE) {
      if (navThrottled(this)) return // 防连点叠两层详情页
      wx.navigateTo({ url: `/pages/bus/detail?id=${markerId - MARKER_BUS_BASE}` })
    }
  },

  goToBusDetail(e) {
    const busId = e.currentTarget.dataset.bus
    if (busId == null) return
    if (navThrottled(this)) return
    wx.navigateTo({ url: `/pages/bus/detail?id=${busId}` })
  },

  /** 分享实时公交：落到本页，标题带品牌钩子 */
  onShareAppMessage() {
    return {
      title: '咱村的客货邮——公交带货、快递进村、农产品出山',
      path: '/pages/bus/index'
    }
  },

  onPullDownRefresh() {
    Promise.all([this.loadLines(), this.loadNearby()]).finally(() => wx.stopPullDownRefresh())
  }
})

