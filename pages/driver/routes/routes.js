/**
 * 司机路线页 - 查看今日排班和途经站点（真实班次数据）
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')

Page({
  data: {
    statusBarHeight: 0,
    todayRoutes: [],
    loading: false,
    loaded: false,
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
    this.setData({ loading: true })
    try {
      const shifts = await api.getDriverShifts()
      const todayRoutes = (shifts || []).map((s) => {
        const names = (s.stops || []).map((st) => st.stationName)
        const start = names[0] || ''
        const end = names[names.length - 1] || ''
        const statusKey = s.status === 1 ? 'running' : (s.status === 2 ? 'done' : 'pending')
        return {
          id: s.shiftId,
          routeNumber: s.routeName || s.shiftCode,
          direction: start + (end ? ' → ' + end : ''),
          time: this.formatTime(s.plannedDepartureTime) + (s.plannedDurationMinutes ? ' · 约' + s.plannedDurationMinutes + '分钟' : ''),
          status: statusKey,
          statusText: s.statusName || (s.status === 1 ? '进行中' : s.status === 2 ? '已完成' : '待发车'),
          stops: names,
          currentStop: statusKey === 'running' ? this.currentStopIndex(s, names.length, s.stops || []) : -1
        }
      })
      this.setData({ todayRoutes, loaded: true })
    } catch (e) {
      this.setData({ loaded: true })
    } finally {
      this.setData({ loading: false })
    }
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
