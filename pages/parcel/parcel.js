/**
 * 快递页 - 物流追踪
 * 快递单号查询 + 物流状态可视化
 */
const appearance = require('../../utils/appearance')

Page({
  data: {
    userInfo: {},
    currentVillage: '云山村',
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    activeTab: 0, // 0=进行中, 1=已签收
    trackingNo: '',
    parcels: [
      {
        id: 1,
        name: '高山云雾茶',
        trackingNo: 'CT302202601001',
        route: 'C302路',
        fromVillage: '云山村',
        status: 'in_transit',
        statusLabel: '运输中',
        progress: 70,
        eta: '预计明日 14:30 到达',
        timeline: [
          { time: '08:30', desc: '农户已交付村口招呼站', done: true },
          { time: '09:15', desc: 'C302路大巴承运，驶往县城', done: true },
          { time: '11:00', desc: '途经青山镇路口', done: false },
          { time: '14:30', desc: '预计到达县城客运总站', done: false }
        ]
      },
      {
        id: 2,
        name: '土鸡蛋30枚装',
        trackingNo: 'CT101202601005',
        route: 'C101路',
        fromVillage: '大湾村',
        status: 'delivered',
        statusLabel: '已签收',
        progress: 100,
        eta: '1月15日 16:20 已签收',
        timeline: [
          { time: '09:00', desc: '农户已交付村口招呼站', done: true },
          { time: '10:30', desc: 'C101路大巴承运，驶往县城', done: true },
          { time: '15:00', desc: '到达县城客运总站', done: true },
          { time: '16:20', desc: '快递员已配送签收', done: true }
        ]
      }
    ]
  },

  onLoad() {
    const sys = wx.getWindowInfo()
    this.setData({ statusBarHeight: sys.statusBarHeight || 20 })
    const userInfo = wx.getStorageSync('userInfo')
    const app = getApp()
    this.setData({
      userInfo: userInfo || {},
      currentVillage: app.globalData.currentVillage || '云山村'
    })
    appearance.apply(this)
  },

  onShow() {
    const app = getApp()
    this.setData({ currentVillage: app.globalData.currentVillage || '云山村' })
    // 同步老年模式 / 主题色（设置页改动后回来立即生效）
    appearance.apply(this)
  },

  /** 切换 tab */
  switchTab(e) {
    const idx = e.currentTarget.dataset.index
    this.setData({ activeTab: idx })
  },

  /** 查询快递 */
  searchParcel() {
    const no = this.data.trackingNo.trim()
    if (!no) {
      wx.showToast({ title: '请输入快递单号', icon: 'none' })
      return
    }
    wx.showToast({ title: '查询功能开发中', icon: 'none' })
  },

  onTrackingInput(e) {
    this.setData({ trackingNo: e.detail.value })
  },

  /** 切换村庄 */
  switchVillage() {
    const villages = ['云山村', '大湾村', '青山镇', '竹林乡', '溪口村', '双河镇']
    wx.showActionSheet({
      itemList: villages,
      success: (res) => {
        getApp().globalData.currentVillage = villages[res.tapIndex]
        this.setData({ currentVillage: villages[res.tapIndex] })
      }
    })
  },

  /** 下拉刷新 */
  onPullDownRefresh() {
    wx.stopPullDownRefresh()
    wx.showToast({ title: '已刷新', icon: 'success', duration: 1000 })
  }
})
