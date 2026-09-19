/**
 * 实时公交车辆详情：车辆信息 + 进度 + 经停站点状态（已过/当前/待达）
 * 数据源：GET /app-api/transport/bus/lines（按 busId 匹配车辆及其线路站点）
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')
const location = require('../../utils/location')

const REFRESH_MS = 15000
/** 地图兜底中心：重庆邮电大学（南山·南岸区），定位/车辆位置到达后覆盖 */
const DEFAULT_MAP_CENTER = { latitude: 29.5325, longitude: 106.5765 }

Page({
  data: {
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    bus: null,
    stops: [],
    progress: 0,
    loading: true,
    loadError: '',
    // 地图：车辆实时位置 + 线路 polyline + 我的位置
    mapCenter: DEFAULT_MAP_CENTER,
    mapScale: 14,
    markers: [],
    polyline: [],
    sourceText: '',
    // 头部信息（保证不空白）：当前站 / 下一站 / 预计到下一站 / 运行说明
    currentStationText: '',
    nextStationText: '',
    etaText: '',
    stateText: ''
  },

  async onLoad(options) {
    appearance.apply(this)
    this.setData({ busId: options.id })
    await this.loadDetail()
  },

  onShow() {
    this.startTimer()
  },

  onHide() {
    this.stopTimer()
  },

  onUnload() {
    this.stopTimer()
  },

  /** 每 15s 静默刷新，保持车辆状态接近实时（失败不弹 toast、不清空已展示数据） */
  startTimer() {
    this.stopTimer()
    this._timer = setInterval(() => this.loadDetail({ silent: true }), REFRESH_MS)
  },

  stopTimer() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  async loadDetail(options) {
    const silent = !!(options && options.silent)
    // 请求序号：15s 轮询与下拉刷新可并发（弱网下单次链路含 3 个串行请求，可能超 15s），
    // 旧响应直接丢弃，不得覆盖新数据（否则进度/位置来回跳）
    const seq = (this._detailSeq = (this._detailSeq || 0) + 1)
    const stale = () => seq !== this._detailSeq
    try {
      // 我的位置（统一 LocationService，页面不直接调 wx.getLocation）；先定位再拉线路，
      // 这样 /bus/lines 只返回附近线路（主城线网几百条，全量下发会超时）
      let me = null
      try {
        const loc = await location.getCurrentLocation()
        if (loc && loc.success) me = { latitude: loc.latitude, longitude: loc.longitude }
      } catch (e) {
        me = null
      }
      if (stale()) return
      const lines = (await api.getRealtimeBusLines(
        me ? me.latitude : null, me ? me.longitude : null, 15000,
        silent ? { silent: true } : undefined
      )) || []
      if (stale()) return
      const busId = Number(this.data.busId)
      let found = null
      let points = []
      for (const line of lines) {
        const bus = (line.buses || []).find((b) => Number(b.busId) === busId)
        if (bus) {
          found = bus
          points = line.points || []
          this._line = line
          break
        }
      }
      if (!found) {
        // 静默刷新时车辆暂时查不到（下线/移出半径）保留旧数据，避免页面闪空态
        if (silent && this.data.bus) return
        this.setData({ loading: false, bus: null, stops: [], loadError: 'notfound' })
        return
      }
      const progress = found.progress || 0
      const linePoints = (points || []).filter((p) => p.longitude != null && p.latitude != null)
      // 真实道路轨迹：按 routeId 缓存只拉一次（之前每 15s 轮询都重拉，弱网下纯属浪费）；
      // 失败/为空 → 回退站点直线
      let roadPoints = null
      const routeId = this._line && this._line.routeId
      if (this._roadCache && routeId && this._roadCache.routeId === routeId) {
        roadPoints = this._roadCache.points
      } else if (routeId) {
        try {
          const road = await api.getBusLinePolyline(routeId, silent ? { silent: true } : undefined)
          if (stale()) return
          if (road && road.length >= 2) {
            roadPoints = road.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))
            this._roadCache = { routeId, points: roadPoints }
          }
        } catch (e) {
          if (stale()) return
          roadPoints = null
        }
      }
      const sim = found.dataSource === 'SIMULATED' || found.locationSource === 'SIMULATED'
      // 头部信息：当前站 → 下一站 → 预计到达（缺位置时如实说明，不留空白）
      const nextName = found.nextStation || ''
      const currentName = found.currentStation || ''
      const etaRaw = found.etaToNextStationMinutes != null
        ? found.etaToNextStationMinutes
        : (typeof found.etaMinutes === 'number' ? found.etaMinutes : null)
      const running = found.status === 1 || found.status === 'RUNNING'
      const etaText = etaRaw != null ? `预计 ${Math.max(1, Math.ceil(etaRaw))} 分钟到达` : ''
      const distText = found.distanceToNextStationKm != null ? `，约 ${found.distanceToNextStationKm} km` : ''
      const hasLocation = found.latitude != null && found.longitude != null
      const stateText = !hasLocation
        ? '暂无该车位置信息'
        : (running
          ? (nextName
            ? `行驶中 · 下一站 ${nextName}${etaText ? '，' + etaText : ''}${distText}`
            : `行驶中 · 预计 ${etaText || '即将'} 到达终点站`)
          : (currentName
            ? `待发车 · 起点站 ${currentName}${etaRaw != null ? `，约 ${Math.max(1, Math.ceil(etaRaw))} 分钟后发车` : ''}`
            : `已到达终点站 ${found.endStation || '—'}，等待下一班`))
      const markers = []
      if (me) {
        markers.push({
          id: 1, longitude: me.longitude, latitude: me.latitude,
          iconPath: '/images/marker-me.png', width: 36, height: 36, zIndex: 9
        })
      }
      if (found.longitude != null && found.latitude != null) {
        markers.push({
          id: 2000 + Number(found.busId),
          longitude: found.longitude, latitude: found.latitude,
          iconPath: sim ? '/images/marker-bus-sim.png' : '/images/marker-bus-real.png',
          width: 34, height: 34, zIndex: 8,
          callout: {
            content: `${found.plateNo || '班车'}${sim ? ' · 位置推算' : ' · 实时'}\n下一站：${found.nextStation || '—'}`,
            color: '#ffffff', bgColor: sim ? '#C75B2A' : '#2E7D32',
            fontSize: 11, borderRadius: 8, padding: 6, display: 'ALWAYS'
          }
        })
      }
      this.setData({
        bus: found,
        stops: this.buildStops(points, progress),
        progress,
        currentStationText: currentName || '—',
        nextStationText: nextName || (hasLocation ? '—（已到终点站）' : '—'),
        etaText: etaText || (hasLocation && nextName ? '' : '—'),
        stateText,
        markers,
        // 优先用真实道路 polyline（后端高德路网，按需查询），回退到站点直线
        polyline: (() => {
          const pts = (roadPoints && roadPoints.length >= 2)
            ? roadPoints
            : (linePoints.length >= 2 ? linePoints.map((p) => ({ latitude: p.latitude, longitude: p.longitude })) : [])
          return pts.length >= 2
            ? [{
                points: pts.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
                color: (appearance.THEMES[this.data.themeColor] || appearance.THEMES.green).primary,
                width: 4,
                arrowLine: true
              }]
            : []
        })(),
        mapCenter: !this._userPanned && found.latitude != null
          ? { latitude: found.latitude, longitude: found.longitude }
          : this.data.mapCenter,
        sourceText: found.locationSource === 'REAL_FRESH' ? '实时（司机上报）'
          : (found.locationSource === 'REAL_STALE' ? '位置可能过期'
            : (sim ? '班次推算位置' : '位置暂不可用')),
        // 是否有可靠车辆位置（无位置不显示假的实时信息）
        locationAvailable: !!(found.latitude != null && found.longitude != null),
        loading: false,
        loadError: ''
      })
    } catch (e) {
      if (stale()) return
      // 静默刷新失败保留旧数据（弱网抖动不该把已展示的车辆信息闪成错误态）
      if (silent && this.data.bus) return
      this.setData({ loading: false, bus: null, loadError: 'network' })
    }
  },

  /** 用户拖动/缩放地图后不再每 15s 抢回中心（与首页/公交地图同一约定） */
  onRegionChange(e) {
    if (e.causedBy === 'drag' || e.causedBy === 'scale') {
      this._userPanned = true
    }
  },

  /** 按进度给站点打状态：passed/current/upcoming */
  buildStops(points, progress) {
    if (!points || !points.length) return []
    const lastMin = points[points.length - 1].plannedMinutes || 0
    const cur = lastMin > 0 ? (progress / 100) * lastMin : 0
    // 当前站 = 第一个计划分钟数 >= 进度对应分钟数的站（进度走完则取终点）
    let curIdx = points.findIndex((p) => (p.plannedMinutes || 0) >= cur)
    if (curIdx < 0) curIdx = points.length - 1
    return points.map((p, i) => ({
      sequenceNo: p.sequenceNo,
      stationId: p.stationId,
      stationName: p.stationName,
      plannedMinutes: p.plannedMinutes || 0,
      state: i < curIdx ? 'passed' : i === curIdx ? 'current' : 'upcoming'
    }))
  },

  /** 分享这辆车：带回班次参数，点开即看到哪儿了 */
  onShareAppMessage() {
    const bus = this.data.bus
    const name = bus && (bus.routeName || bus.plateNo)
    return {
      title: name ? `「${name}」班车到哪儿了？点开看实时位置` : '咱村的班车到哪儿了？点开看实时位置',
      path: `/pages/bus/detail?id=${this.data.busId || ''}`
    }
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh())
  }
})

