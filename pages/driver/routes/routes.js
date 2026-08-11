/**
 * 司机路线页 - 查看今日排班和途经站点
 */
Page({
  data: {
    statusBarHeight: 0,
    todayRoutes: [
      {
        id: 1,
        routeNumber: 'C302路',
        direction: '县城 → 云山村',
        time: '08:00 - 14:30',
        status: 'running',
        stops: ['县城客运站', '双河桥头', '青山镇路口', '竹林乡', '溪口村', '桃花源', '云山村'],
        currentStop: 2
      },
      {
        id: 2,
        routeNumber: 'C302路',
        direction: '云山村 → 县城',
        time: '15:00 - 20:30',
        status: 'pending',
        stops: ['云山村', '桃花源', '溪口村', '竹林乡', '青山镇路口', '双河桥头', '县城客运站'],
        currentStop: 0
      }
    ]
  },

  onLoad() {
    // 获取状态栏高度
    const sysInfo = wx.getWindowInfo()
    this.setData({ statusBarHeight: sysInfo.statusBarHeight })
  }
})
