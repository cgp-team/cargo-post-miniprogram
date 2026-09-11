/**
 * 实时公交车辆详情：车辆信息 + 进度 + 经停站点状态（已过/当前/待达）
 * 数据源：GET /app-api/transport/bus/lines（按 busId 匹配车辆及其线路站点）
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')
const location = require('../../utils/location')

const REFRESH_MS = 15000

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
    mapCenter: { latitude: 30.5723, longitude: 104.0657 },
    mapScale: 14,
    markers: [],
    polyline: [],
    sourceText: ''
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

  /** 每 15s 静默刷新，保持车辆状态接近实时 */
  startTimer() {
    this.stopTimer()
    this._timer = setInterval(() => this.loadDetail(), REFRESH_MS)
  },

  stopTimer() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  async loadDetail() {
    try {
      const lines = (await api.getRealtimeBusLines()) || []
      const busId = Number(this.data.busId)
      let found = null
      let points = []
      for (const line of lines) {
        const bus = (line.buses || []).find((b) => Number(b.busId) === busId)
        if (bus) {
          found = bus
          points = line.points || []
          break
        }
      }
      if (!found) {
        this.setData({ loading: false, bus: null, stops: [], loadError: 'notfound' })
        return
      }
      const progress = found.progress || 0
      // 我的位置（统一 LocationService，页面不直接调 wx.getLocation）
      let me = null
      try {
        const loc = await location.getCurrentLocation()
        if (loc && loc.success) me = { latitude: loc.latitude, longitude: loc.longitude }
      } catch (e) {
        me = null
      }
      const linePoints = (points || []).filter((p) => p.longitude != null && p.latitude != null)
      const sim = found.dataSource === 'SIMULATED' || found.locationSource === 'SIMULATED'
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
            content: `${found.plateNo || '班车'}${sim ? ' · 模拟演示' : ' · 实时'}\n下一站：${found.nextStation || '—'}`,
            color: '#ffffff', bgColor: sim ? '#C75B2A' : '#2E7D32',
            fontSize: 11, borderRadius: 8, padding: 6, display: 'ALWAYS'
          }
        })
      }
      this.setData({
        bus: found,
        stops: this.buildStops(points, progress),
        progress,
        markers,
        // 优先用真实道路 polyline（后端高德路网），回退到站点直线
        polyline: (() => {
          const roadPts = found.roadPolyline || line.roadPolyline
          const pts = (roadPts && roadPts.length >= 2)
            ? roadPts
            : (linePoints.length >= 2 ? linePoints : [])
          return pts.length >= 2
            ? [{
                points: pts.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
                color: (appearance.THEMES[this.data.themeColor] || appearance.THEMES.green).primary,
                width: 4,
                arrowLine: true
              }]
            : []
        })(),
        mapCenter: found.latitude != null ? { latitude: found.latitude, longitude: found.longitude } : this.data.mapCenter,
        sourceText: found.locationSource === 'REAL_FRESH' ? '实时（司机上报）'
          : (found.locationSource === 'REAL_STALE' ? '位置可能过期'
            : (sim ? '模拟演示' : '位置暂不可用')),
        // 是否有可靠车辆位置（无位置不显示假的实时信息）
        locationAvailable: !!(found.latitude != null && found.longitude != null),
        loading: false,
        loadError: ''
      })
    } catch (e) {
      this.setData({ loading: false, bus: null, loadError: 'network' })
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

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh())
  }
})

