/**
 * 实时公交页 - 车来了式：线路选择 + 地图车辆位置 + 实时车辆列表
 * 数据源：GET /app-api/transport/bus/lines（免登录，复用监控车辆位置）
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')

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
    hasError: false
  },

  onLoad() {
    appearance.apply(this)
    this.loadLines()
  },

  onShow() {
    appearance.apply(this)
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
    this._timer = setInterval(() => this.loadLines(true), REFRESH_MS)
  },

  stopTimer() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  /** 拉取线路 + 车辆，重建当前线路地图数据 */
  async loadLines(silent) {
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
    this.loadLines(true).finally(() => wx.stopPullDownRefresh())
  }
})
