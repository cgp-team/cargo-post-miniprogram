/**
 * 司机收益页 - 运营统计（真实后端数据：班次/货运订单）
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')

Page({
  data: {
    statusBarHeight: 0,

    // 运营统计
    totalEarnings: '0.00',   // 累计货运订单总额
    todayEarnings: '0.00',   // 今日货运订单总额
    totalOrders: 0,          // 累计货运订单数
    todayOrders: 0,          // 今日货运订单数
    shiftCount: 0,           // 今日计划班次
    pendingCount: 0,         // 待装车任务数

    // 最近订单明细
    records: [],

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
    this.loadEarnings()
  },

  onShow() {
    appearance.apply(this)
  },

  async loadEarnings() {
    this.setData({ loading: true })
    try {
      const e = await api.getDriverEarnings()
      const records = (e.records || []).map((r) => ({
        id: r.orderNo,
        type: '货运订单',
        goods: r.goodsName || '寄货',
        weight: r.weightKg ? r.weightKg + 'kg' : '',
        amount: r.totalAmount || '0',
        time: this.formatTime(r.createTime),
        status: r.statusName || ''
      }))
      this.setData({
        totalEarnings: e.totalAmount || '0.00',
        todayEarnings: e.todayAmount || '0.00',
        totalOrders: e.totalOrders || 0,
        todayOrders: e.todayOrders || 0,
        shiftCount: e.shiftCount || 0,
        pendingCount: e.pendingCount || 0,
        records,
        loaded: true
      })
    } catch (e) {
      this.setData({ loaded: true })
    } finally {
      this.setData({ loading: false })
    }
  },

  formatTime(t) {
    if (!t) return ''
    // 后端 LocalDateTime 全局序列化为毫秒时间戳，兼容字符串格式
    if (typeof t === 'number') {
      const d = new Date(t)
      const p = (n) => (n < 10 ? '0' + n : '' + n)
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    }
    return String(t).replace('T', ' ').substring(0, 16)
  }
})
