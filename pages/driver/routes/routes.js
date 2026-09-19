/**
 * 司机路线页 - 查看今日排班和途经站点（真实班次数据）
 * 支持路线地图展示和导航
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')

Page({
  data: {
    statusBarHeight: 0,
    todayRoutes: [],
    loading: false,
    loaded: false,
    hasError: false,
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: ''
  },

  onLoad() {
    const sysInfo = wx.getWindowInfo()
    this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 })
    appearance.apply(this)
    this.loadRoutes()
  },

  onShow() {
    appearance.apply(this)
  },

  async loadRoutes() {
    this.setData({ loading: true, hasError: false })
    try {
      const shifts = await api.getDriverShifts()
      const todayRoutes = (shifts || []).map((s) => {
        const stops = s.stops || []
        const stopNames = stops.map((st) => st.stationName)
        const start = stopNames[0] || ''
        const end = stopNames[stopNames.length - 1] || ''
        const statusKey = s.status === 1 ? 'running' : (s.status === 2 ? 'done' : 'pending')
        const currentStop = statusKey === 'running' ? this.currentStopIndex(s, stopNames.length, stops) : -1

        // 构建地图数据
        const hasMap = stops.length >= 2 && stops.some((st) => st.latitude && st.longitude)
        const mapData = hasMap ? this.buildRouteMapData(stops, currentStop) : null

        return {
          id: s.shiftId,
          routeNumber: s.routeName || s.shiftCode,
          direction: start + (end ? ' → ' + end : ''),
          time: this.formatTime(s.plannedDepartureTime) + (s.plannedDurationMinutes ? ' · 约' + s.plannedDurationMinutes + '分钟' : ''),
          status: statusKey,
          statusText: s.statusName || (s.status === 1 ? '进行中' : s.status === 2 ? '已完成' : '待发车'),
          stopNames: stopNames,
          stops: stops,
          currentStop: currentStop,
          showMap: statusKey === 'running', // 在途班次默认展开地图
          hasMap: hasMap,
          mapCenter: mapData ? mapData.center : null,
          mapMarkers: mapData ? mapData.markers : [],
          mapPolyline: mapData ? mapData.polyline : []
        }
      })
      this.setData({ todayRoutes, loaded: true })
    } catch (e) {
      // 网络失败不能冒充"今日暂无班次"，亮错误态给重新加载入口
      this.setData({ loaded: true, hasError: true })
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 构建路线地图数据 */
  buildRouteMapData(stops, currentStop) {
    const validStops = stops.filter((s) => s.latitude && s.longitude)
    if (validStops.length < 2) return null

    // 计算地图中心点
    const latSum = validStops.reduce((sum, s) => sum + s.latitude, 0)
    const lngSum = validStops.reduce((sum, s) => sum + s.longitude, 0)
    const center = {
      latitude: latSum / validStops.length,
      longitude: lngSum / validStops.length
    }

    // 构建站点markers
    const markers = validStops.map((s, i) => {
      const isPassed = currentStop >= 0 && i < currentStop
      const isCurrent = currentStop >= 0 && i === currentStop
      const isNext = currentStop >= 0 && i === currentStop + 1
      let bgColor = '#42A5F5' // 未到站
      if (isPassed) bgColor = '#9E9E9E'
      else if (isCurrent) bgColor = '#FF9800'
      else if (isNext) bgColor = '#1976D2'

      return {
        id: 3000 + i,
        latitude: s.latitude,
        longitude: s.longitude,
        width: (isCurrent || isNext) ? 34 : 26,
        height: (isCurrent || isNext) ? 34 : 26,
        iconPath: '/images/marker-stop.png',
        callout: {
          content: (i + 1) + '. ' + (s.stationName || ''),
          color: '#ffffff',
          bgColor: bgColor,
          padding: 8,
          borderRadius: 10,
          display: 'ALWAYS',
          fontSize: 13
        }
      }
    })

    // 构建路线polyline（站点连线）
    const polyline = [{
      points: validStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
      color: '#2E7D32',
      width: 5,
      arrowLine: true
    }]

    return { center, markers, polyline }
  },

  /** 切换路线地图显示 */
  toggleRouteMap(e) {
    const routeId = e.currentTarget.dataset.id
    const todayRoutes = this.data.todayRoutes.map((r) => {
      if (r.id === routeId) {
        return { ...r, showMap: !r.showMap }
      }
      return r
    })
    this.setData({ todayRoutes })
  },

  /** 导航到下一站 */
  navigateRoute(e) {
    const routeId = e.currentTarget.dataset.id
    const route = this.data.todayRoutes.find((r) => r.id === routeId)
    if (!route) return

    const stops = route.stops || []
    const nextIdx = Math.min((route.currentStop || 0) + 1, stops.length - 1)
    const nextStop = stops[nextIdx]

    if (!nextStop || !nextStop.latitude || !nextStop.longitude) {
      wx.showToast({ title: '暂无导航目标', icon: 'none' })
      return
    }

    wx.openLocation({
      latitude: nextStop.latitude,
      longitude: nextStop.longitude,
      name: nextStop.stationName || '下一站',
      scale: 16
    })
  },

  formatTime(t) {
    if (!t) return ''
    return String(t).substring(0, 5)
  },

  /** 在途班次当前站点：优先后端真实 currentStationId，回退按已行驶时长占比估算 */
  currentStopIndex(shift, stopCount, stops) {
    if (!shift || stopCount <= 1) return 0
    if (shift.currentStationId != null && stops && stops.length) {
      const idx = stops.findIndex((st) => st.stationId === shift.currentStationId)
      if (idx >= 0) return idx
    }
    const timeStr = String(shift.plannedDepartureTime || '')
    const parts = timeStr.split(':').map(Number)
    const duration = shift.plannedDurationMinutes || 60
    const now = new Date()
    const departure = new Date()
    departure.setHours(parts[0] || 0, parts[1] || 0, 0, 0)
    const elapsed = (now - departure) / 60000
    const pct = Math.max(0, Math.min(1, elapsed / duration))
    return Math.round(pct * (stopCount - 1))
  }
})
