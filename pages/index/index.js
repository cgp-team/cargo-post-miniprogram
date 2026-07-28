/**
 * 首页逻辑 - 农村客货邮小程序
 */
const api = require('../../utils/api')

Page({
  data: {
    userInfo: {},
    currentVillage: '云山村',
    notices: [
      { id: 1, title: 'C302路公交今日新增云山村农产品临时停靠点' },
      { id: 2, title: '好消息！周末助农专线免费承运农户农产品' },
      { id: 3, title: '系统升级通知：物流轨迹查询功能已全面优化' }
    ],
    nearbyBuses: [
      {
        id: 1,
        routeNumber: 'C302路',
        startStation: '县城客运站',
        endStation: '云山村',
        nextStation: '青山镇路口',
        status: 'running',
        arriveTime: 8
      },
      {
        id: 2,
        routeNumber: 'C101路',
        startStation: '县城客运站',
        endStation: '大湾村',
        nextStation: '双河桥头',
        status: 'running',
        arriveTime: 15
      },
      {
        id: 3,
        routeNumber: 'C202路',
        startStation: '县城客运站',
        endStation: '溪口村',
        nextStation: '县城客运站',
        status: 'arrived',
        arriveTime: 0
      }
    ],
    recommendProducts: [
      {
        id: 1,
        name: '高山云雾茶',
        fromVillage: '云山村',
        price: '68.00',
        unit: '斤',
        image: '/images/product-tea.png'
      },
      {
        id: 2,
        name: '土鸡蛋30枚装',
        fromVillage: '大湾村',
        price: '45.00',
        unit: '箱',
        image: '/images/product-egg.png'
      },
      {
        id: 3,
        name: '有机红薯粉',
        fromVillage: '竹林乡',
        price: '28.00',
        unit: '袋',
        image: '/images/product-noodle.png'
      },
      {
        id: 4,
        name: '野生山核桃',
        fromVillage: '青山镇',
        price: '55.00',
        unit: '斤',
        image: '/images/product-nut.png'
      }
    ]
  },

  onLoad() {
    // 获取用户信息
    const userInfo = wx.getStorageSync('userInfo')
    if (userInfo) {
      this.setData({ userInfo })
    } else {
      // 未登录，跳转登录页
      wx.reLaunch({
        url: '/pages/login/login'
      })
    }

    // 加载数据
    this.loadHomeData()
  },

  onShow() {
    // 每次显示时刷新
    this.loadBusData()
  },

  /**
   * 加载首页数据
   */
  async loadHomeData() {
    try {
      // 这里后续接入后端API获取公告、推荐商品等数据
      // const res = await api.request('/home/data')
      // this.setData({ ... })
    } catch (err) {
      console.error('加载首页数据失败', err)
    }
  },

  /**
   * 加载公交数据
   */
  async loadBusData() {
    try {
      // 后续接入后端API
      // const res = await api.request('/bus/nearby')
      // this.setData({ nearbyBuses: res.data })
    } catch (err) {
      console.error('加载公交数据失败', err)
    }
  },

  /**
   * 切换村庄
   */
  switchVillage() {
    wx.showActionSheet({
      itemList: ['云山村', '大湾村', '青山镇', '竹林乡', '溪口村', '双河镇'],
      success: (res) => {
        const villages = ['云山村', '大湾村', '青山镇', '竹林乡', '溪口村', '双河镇']
        this.setData({ currentVillage: villages[res.tapIndex] })
        this.loadHomeData()
      }
    })
  },

  /**
   * 跳转搜索
   */
  goToSearch() {
    wx.showToast({ title: '搜索功能开发中', icon: 'none' })
  },

  /**
   * 跳转实时公交
   */
  goToBusTracking() {
    wx.showToast({ title: '实时公交页面开发中', icon: 'none' })
  },

  /**
   * 跳转公交详情
   */
  goToBusDetail(e) {
    const busId = e.currentTarget.dataset.id
    wx.showToast({ title: `公交${busId}详情页面开发中`, icon: 'none' })
  },

  /**
   * 跳转农产品选购
   */
  goToProducts() {
    wx.showToast({ title: '农产品选购页面开发中', icon: 'none' })
  },

  /**
   * 跳转产品详情
   */
  goToProductDetail(e) {
    const productId = e.currentTarget.dataset.id
    wx.showToast({ title: `产品${productId}详情开发中`, icon: 'none' })
  },

  /**
   * 跳转我的快递
   */
  goToParcel() {
    wx.showToast({ title: '我的快递页面开发中', icon: 'none' })
  },

  /**
   * 跳转我要寄货
   */
  goToSend() {
    wx.showToast({ title: '寄货页面开发中', icon: 'none' })
  },

  /**
   * 跳转个人中心
   */
  goToProfile() {
    wx.showToast({ title: '个人中心开发中', icon: 'none' })
  },

  /**
   * 下拉刷新
   */
  onPullDownRefresh() {
    this.loadHomeData()
    this.loadBusData()
    wx.stopPullDownRefresh()
  }
})
