/**
 * 商品溯源页 - 商城订单的大巴承运轨迹
 * 数据源：GET /app-api/transport/product-order/trace?id=<订单ID>
 * 展示：轨迹地图（已行驶路线 + 线路站点 + 当前位置）+ 站点时间轴
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')
const qrcodeRender = require('../../../utils/qrcode-render')

Page({
  data: {
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    loading: true,
    loadError: false, // 网络请求失败（区别于"未发货无轨迹"空态）
    trace: null, // 接口原始数据
    // 地图
    mapCenter: { lng: 116.4, lat: 39.9 },
    mapScale: 12,
    markers: [],
    polyline: [],
    trackPoints: [], // 站点 + 轨迹 + 当前位置，用于地图 include-points 自适应视口
    // 站点时间轴
    stops: [],
    lastReportText: '',
    // 司机到站/交付（商城订单同样走"司机装车 → 到站 → 妥投"闭环）
    arrivedText: '',
    loadTimeText: '',
    deliverTimeText: '',
    statusText: ''
  },

  onLoad(options) {
    appearance.apply(this)
    if (!options.id) {
      wx.showToast({ title: '缺少订单编号', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }
    this.setData({ orderId: options.id })
    this.loadTrace()
  },

  async loadTrace() {
    this.setData({ loading: true, loadError: false })
    try {
      const trace = await api.getProductOrderTrace(this.data.orderId)
      this.renderTrace(trace || {})
    } catch (e) {
      // 网络失败（errMsg）给"重新加载"入口；业务错误（未发货/无轨迹，body 只有 code/msg）仍走空态
      const isNetwork = !!(e && typeof e.errMsg === 'string')
      this.setData({ trace: null, loading: false, loadError: isNetwork })
    }
  },

  /** 分享溯源/物流进度：path 带订单号（路由参数名为 id） */
  onShareAppMessage() {
    return {
      title: '你的包裹到哪儿了？点这里看',
      path: `/pages/goods/trace/trace?id=${this.data.orderId || ''}`
    }
  },

  renderTrace(trace) {
    const primary = (appearance.THEMES[this.data.themeColor] || appearance.THEMES.green).primary
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
        label: { content: String(p.sequenceNo || i + 1), color: '#fff', bgColor: primary, borderRadius: 12, padding: 2, fontSize: 11 },
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
        color: primary,
        width: 5,
        arrowLine: true
      })
    }
    // 地图中心：优先当前位置，其次轨迹末点，其次首站
    const center = (trace.currentLongitude && { lng: trace.currentLongitude, lat: trace.currentLatitude })
      || (track.length && { lng: track[track.length - 1].longitude, lat: track[track.length - 1].latitude })
      || (points.length && { lng: points[0].longitude, lat: points[0].latitude })
      || this.data.mapCenter
    // include-points：站点 + 轨迹 + 当前位置，让视口自适应包含全部点
    const trackPoints = points.map((p) => ({ longitude: p.longitude, latitude: p.latitude }))
      .concat(track.map((t) => ({ longitude: t.longitude, latitude: t.latitude })))
    if (trace.currentLongitude && trace.currentLatitude) {
      trackPoints.push({ longitude: trace.currentLongitude, latitude: trace.currentLatitude })
    }
    this.setData({
      trace,
      markers,
      polyline,
      mapCenter: center,
      trackPoints,
      stops: this.markStops(points, trace),
      lastReportText: this.formatTime(trace.lastReportTime),
      statusText: trace.statusName || '',
      arrivedText: this.buildArrivedText(trace),
      loadTimeText: this.formatTime(trace.loadTime),
      deliverTimeText: this.formatTime(trace.deliverTime),
      loading: false
    }, () => this.drawOrderQr())
  },

  /**
   * 站点进度：为时间线标记 已途经/当前所在站（纯展示派生，不改接口数据）。
   * 已妥投 → 全部已途经；司机已到达交付点 → 最后一站为当前站；
   * 否则取离最近上报位置最近的站点为当前站（已装车未上报时不高亮）。
   */
  markStops(points, trace) {
    const total = points.length
    let current = -1
    if (trace.deliverTime) {
      current = total
    } else if (trace.driverArrived) {
      current = total - 1
    } else if (trace.currentLongitude && trace.currentLatitude) {
      let best = Infinity
      points.forEach((p, i) => {
        const dLng = p.longitude - trace.currentLongitude
        const dLat = p.latitude - trace.currentLatitude
        const dist = dLng * dLng + dLat * dLat
        if (dist < best) {
          best = dist
          current = i
        }
      })
    }
    return points.map((p, i) => ({
      sequenceNo: p.sequenceNo,
      stationName: p.stationName,
      plannedMinutes: p.plannedMinutes || 0,
      isPassed: current >= total || i < current,
      isCurrent: i === current
    }))
  },

  /** 司机已到达/已交付文案：用户端"司机已到达交付点"提醒（后端 shift_execution 为源） */
  buildArrivedText(trace) {
    if (!trace) return ''
    const driver = trace.driverName ? `${trace.driverName}${trace.driverMobile ? ' ' + trace.driverMobile : ''} ` : ''
    if (trace.deliverTime) return `${driver}已送达（${this.formatTime(trace.deliverTime)}）`
    if (trace.driverArrived) {
      const station = trace.deliverStationName || trace.endStation || '交付站点'
      return `${driver}已到达${station}，请前往领取`
    }
    if (trace.loadTime) return `${driver}已装车，正在配送（${this.formatTime(trace.loadTime)}）`
    return ''
  },

  /** 订单二维码：司机扫码装车/妥投（内容=业务订单号，与司机端扫码匹配口径一致） */
  drawOrderQr() {
    const trace = this.data.trace || {}
    if (!trace.orderNo) return
    wx.nextTick(() => {
      const query = wx.createSelectorQuery().in(this)
      query
        .select('#mallOrderQr')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) return
          try {
            qrcodeRender.draw(res[0].node, trace.orderNo, res[0].width)
          } catch (e) {
            // 二维码绘制失败不影响溯源主流程
          }
        })
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

  /** 预览司机核验凭证照片（装车/妥投，两张一起可左右翻） */
  previewProof(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const trace = this.data.trace || {}
    const urls = [trace.loadPhotoUrl, trace.deliverPhotoUrl].filter(Boolean)
    wx.previewImage({ urls: urls.length ? urls : [url], current: url })
  },

  /** 长按复制订单号（客服核对/手工录单要用） */
  copyOrderNo() {
    const no = this.data.trace && this.data.trace.orderNo
    if (!no) return
    wx.setClipboardData({
      data: no,
      success: () => wx.showToast({ title: '订单号已复制', icon: 'success' })
    })
  }
})
