/**
 * 实时公交页 - 车来了式：线路选择 + 地图车辆位置 + 实时车辆列表
 * 数据源：GET /app-api/transport/bus/lines（线路地图/线路车辆）+ GET /app-api/transport/bus/nearby
 *        （附近公交分层：现实公交 REAL_TRANSIT + 项目线路 PROJECT_TRANSIT + 模拟车辆 SIMULATED）
 * 说明：附近公交与首页共用同一 nearby 接口，避免"首页一套逻辑、公交页另一套逻辑"。
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')
const location = require('../../utils/location')
const transitAmap = require('../../utils/transit-amap')

const REFRESH_MS = 15000

Page({
  data: {
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    lines: [],
    activeLineIndex: 0,
    currentLineName: '',
    mapCenter: { lng: 103.0, lat: 30.0 },
    mapScale: 11,
    markers: [],
    polyline: [],
    buses: [],
    hasError: false,
    loading: true,
    // 附近公交（现实公交 / 项目线路 / 模拟车辆分层，与首页同源）
    nearbyBuses: [],
    nearbyStations: [],
    nearbyLines: [],
    nearbyLineCount: 0,
    nearbyRealTransitAvailable: false,
    nearbyBusStatus: 'loading', // loading | ok | empty | error
    nearbyLocatedText: ''
  },

  onLoad() {
    appearance.apply(this)
    this.loadNearby()
    this.loadLines()
  },

  onShow() {
    appearance.apply(this)
    this.loadNearby()
    this.loadLines()
    this.startTimer()
  },

  onHide() {
    this.stopTimer()
  },

  onUnload() {
    this.stopTimer()
  },

  /** 每 15s 静默刷新，保持车辆位置接近实时 */
  startTimer() {
    this.stopTimer()
    this._timer = setInterval(() => {
      this.loadLines()
      this.loadNearby()
    }, REFRESH_MS)
  },

  stopTimer() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  /** 拉取线路 + 车辆，重建当前线路地图数据 */
  async loadLines() {
    if (this._linesLoading) return
    this._linesLoading = true
    try {
      await this._doLoadLines()
    } finally {
      this._linesLoading = false
    }
  },

  /**
   * 附近公交（与首页同一接口 /bus/nearby）：现实公交站点/线路 + 项目自建线路 + 车辆（REAL/SIMULATED）。
   * 分层展示、各自标注来源；"有线路但暂无实时车辆"不会被误报成"附近没有公交"。
   */
  async loadNearby() {
    try {
      const loc = await location.getCurrentLocation()
      const hasCoords = !!(loc && loc.success
        && typeof loc.latitude === 'number' && typeof loc.longitude === 'number')
      const district = hasCoords ? '' : ((loc && loc.district) || '')
      const raw = await api.getNearbyRealtimeBuses(
        hasCoords ? loc.latitude : null,
        hasCoords ? loc.longitude : null,
        hasCoords ? this._nearbyRadius(loc) : null,
        district || null
      )
      // 与首页同一口径：后端现实层缺失时，用高德小程序 SDK 补客户端现实站点
      const data = await transitAmap.enrichNearby(
        raw,
        hasCoords ? loc.latitude : null,
        hasCoords ? loc.longitude : null
      )
      const buses = (data && data.buses) || []
      const stations = (data && data.nearbyStations) || []
      const lines = (data && data.lines) || []
      this.setData({
        nearbyBuses: buses.map((b) => this._formatNearbyBus(b)),
        nearbyStations: stations,
        nearbyLines: lines,
        nearbyLineCount: (data && data.lineCount) || lines.length,
        nearbyRealTransitAvailable: !!(data && data.realTransitAvailable),
        nearbyBusStatus: buses.length ? 'ok' : 'empty',
        nearbyLocatedText: hasCoords
          ? (loc.source === 'demo' ? `根据${loc.district || '演示地点'}展示` : '根据当前位置展示')
          : (district ? `根据${district}展示` : '定位不可用')
      })
    } catch (e) {
      this.setData({ nearbyBusStatus: 'error' })
    }
  },

  /** 搜索半径按定位精度自适应（与首页口径一致，避免定位偏差导致查不到车） */
  _nearbyRadius(loc) {
    const accuracy = loc && typeof loc.accuracy === 'number' ? loc.accuracy : null
    if (accuracy && accuracy > 500) return 15000
    if (loc && loc.level === 'APPROXIMATE') return 10000
    return 5000
  },

  /** 附近车辆卡片文案：来源（实时/模拟演示/过期）与状态，绝不把模拟位置标成实时 */
  _formatNearbyBus(b) {
    const hasEta = typeof b.etaMinutes === 'number' && b.etaMinutes >= 0
    const simulated = b.locationSource === 'SIMULATED' || b.dataSource === 'SIMULATED'
    return {
      ...b,
      simulated,
      isReal: b.locationSource === 'REAL_FRESH' || b.dataSource === 'REAL',
      statusText: b.status === 'RUNNING' ? '行驶中'
        : (b.status === 'IDLE' ? '待发/停靠' : (b.status === 'ARRIVED' ? '已到站' : '无位置')),
      sourceText: b.locationSource === 'REAL_FRESH' ? '实时'
        : (b.locationSource === 'REAL_STALE' ? '位置可能过期'
          : (simulated ? '模拟演示' : '位置暂不可用')),
      etaText: hasEta ? b.etaMinutes + ' 分钟' : (simulated ? '演示中' : '—')
    }
  },

  async _doLoadLines() {
    if (this._loading) return
    this._loading = true
    try {
      const lines = (await api.getRealtimeBusLines()) || []
      if (!lines.length) {
        this.setData({ lines: [], currentLineName: '', buses: [], markers: [], polyline: [], hasError: false })
        return
      }
      const activeLineIndex = Math.min(this.data.activeLineIndex, lines.length - 1)
      this.setData({ lines, activeLineIndex, hasError: false })
      this.rebuildMap()
    } catch (e) {
      this.setData({ hasError: true })
    } finally {
      this._loading = false
      // 首次加载完成后关闭首帧加载态（后续 15s 静默刷新不再触发）
      if (this.data.loading) this.setData({ loading: false })
    }
  },

  /** 切换线路 */
  selectLine(e) {
    const index = e.currentTarget.dataset.index
    if (index === this.data.activeLineIndex) return
    this.setData({ activeLineIndex: index })
    this.rebuildMap()
  },

  /** 根据当前选中线路重建 中心点 / markers / polyline / 车辆列表 */
  rebuildMap() {
    const { lines, activeLineIndex } = this.data
    const line = lines[activeLineIndex]
    if (!line) return
    const points = line.points || []
    const coords = points.filter((p) => p.longitude != null && p.latitude != null)
    // 中心点 = 途经点几何中心
    let lng = 0
    let lat = 0
    coords.forEach((p) => { lng += p.longitude; lat += p.latitude })
    if (coords.length) {
      lng /= coords.length
      lat /= coords.length
    }
    // 车辆 markers（点击 marker 或卡片都进详情）
    const primary = (appearance.THEMES[this.data.themeColor] || appearance.THEMES.green).primary
    const buses = line.buses || []
    const markers = buses
      .filter((b) => b.longitude != null && b.latitude != null)
      .map((b) => ({
        id: b.busId,
        longitude: b.longitude,
        latitude: b.latitude,
        iconPath: '/images/marker-stop.png',
        width: 30,
        height: 30,
        callout: {
          content: b.plateNo || b.shiftCode || '',
          color: '#ffffff',
          fontSize: 11,
          borderRadius: 6,
          bgColor: primary,
          padding: 4,
          display: 'ALWAYS'
        }
      }))
    // 线路轨迹
    const polyline = [{
      points: coords.map((p) => ({ longitude: p.longitude, latitude: p.latitude })),
      color: primary,
      width: 4,
      arrowLine: true
    }]
    // 轨迹签名：首末点 + 点数 + 线路索引。未变时只刷新车辆位置，
    // 避免 15s 定时刷新全量 setData 导致地图中心跳回/闪烁。
    const first = coords[0]
    const last = coords[coords.length - 1]
    const trackKey = `${activeLineIndex}|${coords.length}|` +
      `${first ? first.longitude + ',' + first.latitude : ''}|` +
      `${last ? last.longitude + ',' + last.latitude : ''}`
    if (trackKey === this._trackKey) {
      this.setData({
        currentLineName: line.routeName || '',
        markers,
        buses
      })
      return
    }
    this._trackKey = trackKey
    this.setData({
      currentLineName: line.routeName || '',
      mapCenter: coords.length ? { lng, lat } : this.data.mapCenter,
      markers,
      polyline,
      buses
    })
  },

  /** 从车辆卡片（dataset.bus）或地图 marker（detail.markerId）跳详情 */
  goToBusDetail(e) {
    const busId =
      e.detail && e.detail.markerId != null
        ? e.detail.markerId
        : e.currentTarget.dataset.bus != null
          ? e.currentTarget.dataset.bus
          : null
    if (busId == null) return
    wx.navigateTo({ url: `/pages/bus/detail?id=${busId}` })
  },

  onPullDownRefresh() {
    Promise.all([this.loadLines(), this.loadNearby()]).finally(() => wx.stopPullDownRefresh())
  }
})
