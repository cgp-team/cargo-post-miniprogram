/**
 * 司机收益页 - 查看运输副业收入
 */
Page({
  data: {
    statusBarHeight: 0,

    // 收益总览
    totalEarnings: 12850.50,
    monthEarnings: 3650.00,
    todayEarnings: 180.00,
    totalOrders: 326,

    // 收益明细
    records: [
      {
        id: 1,
        type: '农产品运输',
        route: 'C302路',
        goods: '高山云雾茶 30斤',
        amount: 45.00,
        time: '2026-07-23 10:30',
        status: 'completed'
      },
      {
        id: 2,
        type: '快递代运',
        route: 'C302路',
        goods: '包裹 x3',
        amount: 18.00,
        time: '2026-07-23 09:15',
        status: 'completed'
      },
      {
        id: 3,
        type: '农产品运输',
        route: 'C302路',
        goods: '土鸡蛋 15斤',
        amount: 30.00,
        time: '2026-07-22 16:20',
        status: 'completed'
      },
      {
        id: 4,
        type: '农产品运输',
        route: 'C101路',
        goods: '有机红薯粉 50袋',
        amount: 75.00,
        time: '2026-07-22 11:00',
        status: 'completed'
      },
      {
        id: 5,
        type: '快递代运',
        route: 'C302路',
        goods: '包裹 x5',
        amount: 25.00,
        time: '2026-07-21 14:45',
        status: 'completed'
      }
    ]
  },

  onLoad() {
    const sysInfo = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: sysInfo.statusBarHeight })
  }
})
