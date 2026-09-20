/**
 * 司机收益页 - 运营统计（真实后端数据：班次/货运订单）
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')
const { formatBackendTime } = require('../../../utils/util')

/** 金额统一两位小数（与订单详情/快递页 toFixed(2) 口径一致；非数字兜底 0.00） */
function toMoney(v) {
  const n = Number(v)
  return isFinite(n) ? n.toFixed(2) : '0.00'
}

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
    hasError: false,
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
    // 加载中重复触发（错误态"重新加载"连点）直接忽略，避免并发请求交错写 data
    if (this.data.loading) return
    this.setData({ loading: true, hasError: false })
    try {
      const e = await api.getDriverEarnings()
      const records = (e.records || []).map((r) => ({
        id: r.orderNo,
        type: '货运订单',
        goods: r.goodsName || '寄货',
        weight: r.weightKg ? r.weightKg + 'kg' : '',
        amount: toMoney(r.totalAmount),
        time: formatBackendTime(r.createTime),
        status: r.statusName || ''
      }))
      this.setData({
        totalEarnings: toMoney(e.totalAmount),
        todayEarnings: toMoney(e.todayAmount),
        totalOrders: e.totalOrders || 0,
        todayOrders: e.todayOrders || 0,
        shiftCount: e.shiftCount || 0,
        pendingCount: e.pendingCount || 0,
        records,
        loaded: true
      })
    } catch (e) {
      // 网络失败不能冒充"暂无收益记录"，亮错误态给重新加载入口
      this.setData({ loaded: true, hasError: true })
    } finally {
      this.setData({ loading: false })
    }
  }
})
