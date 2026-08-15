/**
 * 实时公交车辆详情：车辆信息 + 进度 + 经停站点状态（已过/当前/待达）
 * 数据源：GET /app-api/transport/bus/lines（按 busId 匹配车辆及其线路站点）
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')

Page({
  data: {
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    bus: null,
    stops: [],
    progress: 0,
    loading: true
  },

  async onLoad(options) {
    appearance.apply(this)
    this.setData({ busId: options.id })
    await this.loadDetail()
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
        this.setData({ loading: false, bus: null, stops: [] })
        return
      }
      const progress = found.progress || 0
      this.setData({
        bus: found,
        stops: this.buildStops(points, progress),
        progress,
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false, bus: null })
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
