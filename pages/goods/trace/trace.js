/**
 * 商品溯源页 - 商城订单的大巴承运轨迹
 * 数据源：GET /app-api/transport/product-order/trace?id=<订单ID>
 * 展示：轨迹地图（已行驶路线 + 线路站点 + 当前位置）+ 站点时间轴
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')

Page({
  data: {
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    loading: true,
    trace: null, // 接口原始数据
    // 地图
    mapCenter: { lng: 116.4, lat: 39.9 },
    mapScale: 12,
    markers: [],
    polyline: [],
    // 站点时间轴
    stops: [],
    lastReportText: ''
  },

  onLoad(options) {
    appearance.apply(this)
    this.setData({ orderId: options.id })
    this.loadTrace()
  },

  async loadTrace() {
    this.setData({ loading: true })
    try {
      const trace = await api.getProductOrderTrace(this.data.orderId)
      this.renderTrace(trace || {})
    } catch (e) {
      // 未发货/无轨迹等：展示空态
      this.setData({ trace: null, loading: false })
    }
  },

  renderTrace(trace) {
    const points = trace.points || []
    const track = trace.track || []
    const markers = []
    // 线路站点 marker
    points.forEach((p, i) => {
      markers.push({
        id: i + 1,
        longitude: p.longitude,
        latitude: p.latitude,
        width: 24,
        height: 24,
        label: { content: String(p.sequenceNo || i + 1), color: '#fff', bgColor: '#2E7D32', borderRadius: 12, padding: 2, fontSize: 11 },
        callout: { content: p.stationName, display: 'ALWAYS', borderRadius: 6, padding: 4, fontSize: 11 }
      })
    })
    // 当前车辆位置 marker
    if (trace.currentLongitude && trace.currentLatitude) {
      markers.push({
        id: 9999,
        longitude: trace.currentLongitude,
        latitude: trace.currentLatitude,
        width: 32,
        height: 32,
        callout: { content: '🚌 ' + (trace.vehiclePlate || '承运车辆'), display: 'ALWAYS', borderRadius: 6, padding: 6, fontSize: 12, bgColor: '#ffffff' }
      })
    }
    // 已行驶轨迹线 + 计划线路（虚线）
    const polyline = []
    if (points.length >= 2) {
      polyline.push({
        points: points.map((p) => ({ longitude: p.longitude, latitude: p.latitude })),
        color: '#9E9E9E',
        width: 3,
        dottedLine: true
      })
    }
    if (track.length >= 2) {
      polyline.push({
        points: track.map((t) => ({ longitude: t.longitude, latitude: t.latitude })),
        color: '#2E7D32',
        width: 5,
        arrowLine: true
      })
    }
    // 地图中心：优先当前位置，其次轨迹末点，其次首站
    const center = (trace.currentLongitude && { lng: trace.currentLongitude, lat: trace.currentLatitude })
      || (track.length && { lng: track[track.length - 1].longitude, lat: track[track.length - 1].latitude })
      || (points.length && { lng: points[0].longitude, lat: points[0].latitude })
      || this.data.mapCenter
    this.setData({
      trace,
      markers,
      polyline,
      mapCenter: center,
      stops: points.map((p) => ({ sequenceNo: p.sequenceNo, stationName: p.stationName, plannedMinutes: p.plannedMinutes || 0 })),
      lastReportText: this.formatTime(trace.lastReportTime),
      loading: false
    })
  },

  formatTime(t) {
    if (!t) return ''
    if (typeof t === 'number') {
      const d = new Date(t)
      const p = (n) => (n < 10 ? '0' + n : '' + n)
      return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    }
    return String(t).replace('T', ' ').substring(5, 16)
  },

  onPullDownRefresh() {
    this.loadTrace().finally(() => wx.stopPullDownRefresh())
  }
})
