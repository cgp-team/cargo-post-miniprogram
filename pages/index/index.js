/**
 * 首页逻辑 - 农村客货邮小程序
 */
const api = require('../../utils/api')
const weatherApi = require('../../utils/weather')
const appearance = require('../../utils/appearance')
const productImg = require('../../utils/product-img')

Page({
  data: {
    userInfo: {},
    currentVillage: '云山村',
    weather: {},
    weatherLoading: false,   // 真实天气请求中
    weatherUpdateTime: '',   // 更新时间提示
    weatherExpanded: false,  // 天气详情卡展开态（默认只显示头部胶囊）
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
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
        imageUrl: '/images/product-tea.png'
      },
      {
        id: 2,
        name: '土鸡蛋30枚装',
        fromVillage: '大湾村',
        price: '45.00',
        unit: '箱',
        imageUrl: '/images/product-egg.png'
      },
      {
        id: 3,
        name: '有机红薯粉',
        fromVillage: '竹林乡',
        price: '28.00',
        unit: '袋',
        imageUrl: '/images/product-noodle.png'
      },
      {
        id: 4,
        name: '野生山核桃',
        fromVillage: '青山镇',
        price: '55.00',
        unit: '斤',
        imageUrl: '/images/product-nut.png'
      }
    ]
  },

  onLoad() {
    // 获取状态栏高度，适配刘海屏
    const sys = wx.getWindowInfo()
    this.setData({ statusBarHeight: sys.statusBarHeight || 20 })

    // 同步老年模式 / 主题色
    appearance.apply(this)

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
    this.loadWeather()
    this.loadHomeData()
  },

  onShow() {
    // 每次显示时刷新外观设置（设置页改动后回来立即生效）
    appearance.apply(this)
    // 刷新天气和公交（loadWeather 内部有防重复，不会并发双发）
    this.loadWeather()
    this.loadBusData()
  },

  /**
   * 获取天气 — 缓存/本地兜底秒开，后台刷新真实数据
   */
  loadWeather() {
    // 防重复：onLoad 与 onShow 都会触发，避免同一时刻发两次请求
    if (this._weatherLoading) return
    this._weatherLoading = true

    // 1) 先渲染缓存或本地兜底天气，卡片立刻有内容
    this._renderWeatherFallback()

    // 2) 后台请求真实天气
    this.setData({ weatherLoading: true })
    wx.getSetting({
      success: (setting) => {
        if (setting.authSetting['scope.userLocation'] === false) {
          // 用户拒绝定位：保留缓存/兜底展示即可
          this._weatherLoading = false
          this.setData({ weatherLoading: false })
          return
        }
        wx.getLocation({
          type: 'wgs84',
          isHighAccuracy: true,          // 高精度定位：坐标更准，天气取的网格点更贴近实际位置
          highAccuracyExpireTime: 6000,  // 6 秒内未拿到高精度则自动回退普通定位
          success: (loc) => {
            this._fetchWeather(loc.latitude, loc.longitude)
          },
          fail: (err) => {
            // 定位失败：保留兜底展示
            console.log('定位失败', err)
            this._weatherLoading = false
            this.setData({ weatherLoading: false })
          }
        })
      },
      fail: () => {
        this._weatherLoading = false
        this.setData({ weatherLoading: false })
      }
    })
  },

  /** 先用缓存（有则用缓存，无则本地兜底）渲染天气，保证秒开 */
  _renderWeatherFallback() {
    const cache = wx.getStorageSync('weatherCache')
    if (cache && cache.data) {
      this.setData({
        weather: cache.data,
        weatherUpdateTime: this._fmtTime(cache.ts)
      })
      return
    }
    this.setData({
      weather: weatherApi.localMockWeather(),
      weatherUpdateTime: ''
    })
  },

  /** 请求真实天气 + 逆地理地名 */
  _fetchWeather(lat, lon) {
    // 腾讯LBS逆地理 → 真实地名
    weatherApi.reverseGeocode(lat, lon).then(placeName => {
      if (placeName) {
        this.setData({ currentVillage: placeName })
        getApp().globalData.currentVillage = placeName
      }
    })

    weatherApi.fetchWeather(lat, lon).then(data => {
      this._weatherLoading = false
      if (!data) return

      // 网络失败返回兜底数据：已有缓存则保留缓存，避免真实数据降级成模拟数据
      if (data.mock) {
        const cache = wx.getStorageSync('weatherCache')
        if (cache && cache.data && !this.data.weather.mock) {
          this.setData({ weatherLoading: false })
          return
        }
      }

      this.setData({
        weather: data,
        weatherUpdateTime: this._fmtTime(Date.now()),
        weatherLoading: false
      })
      // 只有真实数据才写缓存，mock 不覆盖缓存
      if (!data.mock) {
        wx.setStorageSync('weatherCache', { data, ts: Date.now() })
      }
    })
  },

  /** 时间格式化 → 中文更新时间提示 */
  _fmtTime(ts) {
    if (!ts) return ''
    const diff = Math.floor((Date.now() - ts) / 1000)
    if (diff < 60) return '刚刚更新'
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前更新'
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前更新'
    const d = new Date(ts)
    return (d.getMonth() + 1) + '月' + d.getDate() + '日更新'
  },

  /**
   * 加载首页数据
   */
  async loadHomeData() {
    // 平台公告：真实接口，失败/为空时保留静态演示公告
    this.loadNotices()
    try {
      // 推荐商品：拉取后端上架商品，取前 4 条
      const list = (await api.listProducts()) || []
      this.setData({
        recommendProducts: list.slice(0, 4).map((p) => ({
          id: p.id,
          name: p.name,
          fromVillage: p.fromVillage,
          price: Number(p.price).toFixed(2),
          unit: p.unit,
          imageUrl: productImg.resolve(p)
        }))
      })
    } catch (err) {
      console.error('加载推荐商品失败', err)
    }
  },

  /** 平台公告（真实接口；失败/为空时保留静态演示数据） */
  async loadNotices() {
    try {
      const notices = (await api.listNotices()) || []
      if (notices.length) this.setData({ notices })
    } catch (err) {
      console.error('加载平台公告失败，使用演示数据', err)
    }
  },

  /** 点击公告查看详情内容 */
  showNotice(e) {
    const item = e.currentTarget.dataset.item
    if (!item) return
    wx.showModal({
      title: item.title,
      content: item.content || '暂无详细内容',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  /**
   * 加载公交数据（真实实时公交；失败/未接入时保留静态演示数据）
   */
  async loadBusData() {
    try {
      const buses = (await api.getRealtimeBuses()) || []
      if (buses.length) {
        this.setData({
          nearbyBuses: buses.map((b) => ({
            id: b.busId,
            routeNumber: b.shiftCode || b.routeName,
            startStation: b.startStation || '—',
            endStation: b.endStation || '—',
            nextStation: b.nextStation || '—',
            status: b.status === 1 ? 'running' : 'arrived',
            arriveTime: b.etaMinutes != null ? b.etaMinutes : 0
          }))
        })
      }
    } catch (err) {
      // 真实数据拉取失败：保留静态演示数据，等接口完善后自动替换
      console.error('加载实时公交失败，使用演示数据', err)
    }
  },

  /** 展开/收起天气详情卡（默认只显示头部胶囊） */
  toggleWeather() {
    this.setData({ weatherExpanded: !this.data.weatherExpanded })
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
   * 跳转实时公交（车来了式地图+列表）
   */
  goToBusTracking() {
    wx.navigateTo({ url: '/pages/bus/index' })
  },

  /**
   * 跳转公交详情
   */
  goToBusDetail(e) {
    const busId = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/bus/detail?id=${busId}` })
  },

  /**
   * 跳转农产品选购
   */
  goToProducts() {
    wx.switchTab({ url: '/pages/goods/goods' })
  },

  /**
   * 跳转产品详情
   */
  goToProductDetail(e) {
    const productId = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/goods/detail/detail?id=${productId}` })
  },

  /**
   * 跳转我的快递
   */
  goToParcel() {
    wx.switchTab({ url: '/pages/parcel/parcel' })
  },

  /**
   * 跳转我要寄货
   */
  goToSend() {
    const token = wx.getStorageSync('token')
    if (!token) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    wx.navigateTo({ url: '/pages/send/send' })
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
