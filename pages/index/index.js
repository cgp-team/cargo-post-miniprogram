/**
 * 首页逻辑 - 农村客货邮小程序
 */
const api = require('../../utils/api')
const weatherApi = require('../../utils/weather')
const productImg = require('../../utils/product-img')
const auth = require('../../utils/auth')
const location = require('../../utils/location')
const { VILLAGES } = require('../../utils/util')

/** 天气缓存有效期：10 分钟内直接复用缓存渲染，跳过定位与网络请求 */
const WEATHER_CACHE_TTL = 10 * 60 * 1000

Page({
  behaviors: [require('../../behaviors/page-base')],
  data: {
    userInfo: {},
    currentVillage: '云山村',
    villageManual: false, // 用户是否手动切换过村庄（手动选择优先作为区域 fallback）
    // 用户定位（统一 LocationService 结果；内部保留真实经纬度，currentVillage 只是展示文本）
    userLocation: null,
    locationDenied: false,      // 权限被拒绝（引导"去设置"）
    locationUnavailable: false, // 定位不可用（无坐标）
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
    nearbyBuses: [],            // 附近实时公交（真实接口数据，不再硬编码 Demo）
    nearbyStations: [],         // 附近站点（用于空态区分：有站点但无车 = 非运营时间）
    nearbyLines: [],            // 附近站点关联线路（无运营车辆也展示：该区域有哪些线路/不在运营）
    nearbyBusStatus: 'loading', // loading | ok | empty | error
    nearbyBusUpdatedAt: 0,      // 最近成功更新时间戳（相对文案用）
    nearbyBusUpdatedText: '',   // "已更新：刚刚" / "更新于 12 秒前"
    nearbyBusLocatedText: '',   // "根据当前位置展示" / "根据青山镇展示"
    recommendProducts: [
      {
        id: 1,
        name: '高山云雾茶',
        fromVillage: '云山村',
        price: '68.00',
        unit: '斤',
        imageUrl: '/images/product-tea.png',
        isDemo: true
      },
      {
        id: 2,
        name: '土鸡蛋30枚装',
        fromVillage: '大湾村',
        price: '45.00',
        unit: '箱',
        imageUrl: '/images/product-egg.png',
        isDemo: true
      },
      {
        id: 3,
        name: '有机红薯粉',
        fromVillage: '竹林乡',
        price: '28.00',
        unit: '袋',
        imageUrl: '/images/product-noodle.png',
        isDemo: true
      },
      {
        id: 4,
        name: '野生山核桃',
        fromVillage: '青山镇',
        price: '55.00',
        unit: '斤',
        imageUrl: '/images/product-nut.png',
        isDemo: true
      }
    ]
  },

  onLoad() {
    // 状态栏高度（适配刘海屏）+ 同步老年模式 / 主题色
    this._initPageBase()

    // 登录统一拦截：未登录弹窗引导跳登录页（token 判据）
    if (!auth.requireLogin()) return

    // 获取用户信息
    const userInfo = wx.getStorageSync('userInfo')
    if (userInfo) {
      this.setData({ userInfo })
    }

    // 加载数据（定位异步执行，不阻塞天气/商品加载）
    this.loadUserLocation()
    this.loadNearbyBusData()
    this.loadWeather()
    this.loadHomeData()
  },

  onHide() {
    // 页面隐藏停止自动刷新（公交位置不动车）
    this.stopNearbyTimer()
  },

  onUnload() {
    this.stopNearbyTimer()
  },

  onShow() {
    // 每次显示时刷新外观设置（设置页改动后回来立即生效）
    this._applyAppearance()
    // 刷新定位/公交/天气（各自有缓存与并发去重，不会双发；定位刷新失败保留旧缓存）
    this.loadUserLocation()
    this.loadNearbyBusData()
    this.loadWeather()
    // 恢复 15s 自动刷新（onHide 已停止）
    this.startNearbyTimer()
  },

  /**
   * 获取天气 — 缓存/本地兜底秒开，后台刷新真实数据
   */
  loadWeather(options) {
    // 缓存 TTL：10 分钟内直接复用缓存渲染，跳过定位与网络请求（下拉刷新传 force 绕过）
    if (!(options && options.force)) {
      const cache = wx.getStorageSync('weatherCache')
      if (cache && cache.data && cache.ts && Date.now() - cache.ts < WEATHER_CACHE_TTL) {
        this._renderWeatherFallback()
        return
      }
    }

    // 防重复：onLoad 与 onShow 都会触发，避免同一时刻发两次请求
    if (this._weatherLoading) return
    this._weatherLoading = true

    // 1) 先渲染缓存或本地兜底天气，卡片立刻有内容
    this._renderWeatherFallback()

    // 2) 后台请求真实天气：优先复用已定位坐标，无则现取（LocationService 并发去重，不会双发）
    this.setData({ weatherLoading: true })
    const fallback = () => {
      this._weatherLoading = false
      this.setData({ weatherLoading: false })
    }
    const loc = this.data.userLocation
    if (loc && typeof loc.latitude === 'number') {
      this._fetchWeather(loc.latitude, loc.longitude)
      return
    }
    location.getCurrentLocation().then((fresh) => {
      if (fresh && fresh.success && typeof fresh.latitude === 'number') {
        // 定位成功：同步保存坐标（后续"附近公交"用），再请求天气
        this._applyUserLocation(fresh)
        this._fetchWeather(fresh.latitude, fresh.longitude)
      } else {
        // 定位失败/拒绝：保留兜底天气展示
        fallback()
      }
    })
  },

  /**
   * 统一用户定位：由 LocationService 返回，页面只负责保存 userLocation + 更新展示村庄名 + 权限引导。
   * 定位失败/拒绝不阻塞首页其他功能。
   */
  async loadUserLocation() {
    const loc = await location.getCurrentLocation()
    if (!loc || !loc.success) {
      this.setData({
        userLocation: null,
        locationDenied: !!(loc && loc.denied),
        locationUnavailable: true
      })
      return
    }
    this._applyUserLocation(loc)
  },

  /** 保存定位结果（内部保留真实经纬度；currentVillage 只是展示文本），并同步全局 */
  _applyUserLocation(loc) {
    this.setData({
      userLocation: loc,
      locationDenied: false,
      locationUnavailable: false,
      currentVillage: loc.district || this.data.currentVillage
    })
    const app = getApp()
    if (loc.district) app.globalData.currentVillage = loc.district
    app.globalData.userLocation = loc
  },

  /** 权限被拒绝 → 引导去设置开启定位 */
  goToLocationSetting() {
    location.openLocationSetting().then((granted) => {
      if (granted) this.loadUserLocation()
      else wx.showToast({ title: '未开启定位权限', icon: 'none' })
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

  /** 请求真实天气（当前村庄/区域名由 loadUserLocation 统一更新，这里不再重复逆地理） */
  _fetchWeather(lat, lon) {
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
   * 加载附近实时公交：真实 nearby API + 定位（精确坐标或区域 fallback）。
   * 原则：不再显示硬编码 Demo；空数据/失败有明确状态提示。
   */
  async loadNearbyBusData() {
    if (this._nearbyLoading) return // 请求去重：上一请求未返回不发送下一次
    const loc = this.data.userLocation
    const hasCoords = loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number'
    // 区域 fallback：无精确坐标时，手动选择的村庄优先；否则用定位逆地理区域
    const district = !hasCoords
      ? (this.data.villageManual ? this.data.currentVillage : ((loc && loc.district) || ''))
      : ''
    this._nearbyLoading = true
    if (!this.data.nearbyBuses.length) {
      this.setData({ nearbyBusStatus: 'loading' })
    }
    try {
      const data = await api.getNearbyRealtimeBuses(
        hasCoords ? loc.latitude : undefined,
        hasCoords ? loc.longitude : undefined,
        undefined, // radius 默认后端 5000
        district || undefined
      )
      const buses = this._formatBuses((data && data.buses) || [])
      const stations = (data && data.nearbyStations) || []
      const lines = (data && data.lines) || []
      this.setData({
        nearbyBuses: buses,
        nearbyStations: stations,
        nearbyLines: lines,
        nearbyBusStatus: buses.length ? 'ok' : 'empty',
        nearbyBusUpdatedAt: Date.now(),
        nearbyBusUpdatedText: '已更新：刚刚',
        nearbyBusLocatedText: hasCoords
          ? '根据当前位置展示'
          : (this.data.villageManual ? `根据${this.data.currentVillage}展示`
              : (data && data.locationLevel === 'DISTRICT' ? '根据当前区域展示' : ''))
      })
    } catch (err) {
      console.error('加载附近公交失败', err)
      this.setData({ nearbyBusStatus: 'error' })
    } finally {
      this._nearbyLoading = false
    }
  },

  /** 公交卡片字段预处理（状态/来源/下一站/真实 ETA；无可靠位置不显示虚假数字） */
  _formatBuses(buses) {
    const statusText = { RUNNING: '行驶中', IDLE: '待发/停靠', ARRIVED: '已到站', NO_LOCATION: '无位置' }
    return (buses || []).map((b) => {
      const hasEta = typeof b.etaMinutes === 'number' && b.etaMinutes >= 0
      return {
        busId: b.busId,
        routeName: b.routeName || '—',
        shiftCode: b.shiftCode || '',
        startStation: b.startStation || '—',
        endStation: b.endStation || '—',
        status: b.status,
        statusText: statusText[b.status] || b.status || '—',
        statusClass: b.status === 'RUNNING' ? 'running' : '',
        currentStation: b.currentStation || '',
        nextStation: b.nextStation,
        nextStationText: b.nextStation || '—',
        sourceText: b.locationSource === 'REAL_FRESH' ? '实时'
          : (b.locationSource === 'SIMULATED' ? '模拟位置' : '位置暂不可用'),
        sourceDot: b.locationSource === 'REAL_FRESH', // 🟢 实时
        etaText: hasEta ? b.etaMinutes + ' 分钟到站' : '等待实时位置',
        etaMinutes: hasEta ? b.etaMinutes : null,
        distanceKm: typeof b.distanceToNextStationKm === 'number' ? b.distanceToNextStationKm : null,
        routeProvider: b.routeProvider || '',
        lastLocationText: b.lastLocationTime ? this._fmtTimeShort(b.lastLocationTime) : '',
        locationUnavailable: !hasEta && b.locationSource !== 'REAL_FRESH'
      }
    })
  },

  /** 时间戳 → HH:mm（最后位置时间展示用） */
  _fmtTimeShort(t) {
    if (!t) return ''
    const d = typeof t === 'number' ? new Date(t) : new Date(String(t).replace('T', ' '))
    if (isNaN(d.getTime())) return ''
    const p = (n) => (n < 10 ? '0' + n : '' + n)
    return p(d.getHours()) + ':' + p(d.getMinutes())
  },

  /** 15s 自动刷新附近公交（页面隐藏停止，显示恢复；防重复定时器） */
  startNearbyTimer() {
    this.stopNearbyTimer()
    this._nearbyTimer = setInterval(() => {
      this._updateBusUpdatedText()
      this.loadNearbyBusData()
    }, 15000)
  },

  stopNearbyTimer() {
    if (this._nearbyTimer) {
      clearInterval(this._nearbyTimer)
      this._nearbyTimer = null
    }
  },

  /** 两次刷新间更新时间文案（"更新于 12 秒前"） */
  _updateBusUpdatedText() {
    const ts = this.data.nearbyBusUpdatedAt
    if (!ts) return
    const diff = Math.floor((Date.now() - ts) / 1000)
    const text = diff < 60 ? diff + '秒前' : Math.floor(diff / 60) + '分钟前'
    this.setData({ nearbyBusUpdatedText: '更新于 ' + text })
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
      itemList: VILLAGES,
      success: (res) => {
        const name = VILLAGES[res.tapIndex]
        this.setData({ currentVillage: name, villageManual: true })
        getApp().globalData.currentVillage = name
        this.loadHomeData()
        // 手动切换村庄后按新村庄重新查询附近公交（无精确定位时用村庄名做区域 fallback）
        this.loadNearbyBusData()
      }
    })
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
    if (busId == null) return
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
    if (e.currentTarget.dataset.demo) {
      wx.showToast({ title: '示例数据，暂未开通', icon: 'none' })
      return
    }
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
    if (!auth.requireLogin({ content: '登录后可发起寄货' })) return
    wx.navigateTo({ url: '/pages/send/send' })
  },

  /**
   * 跳转个人中心
   */
  goToProfile() {
    wx.switchTab({ url: '/pages/mine/mine' })
  },

  /**
   * 下拉刷新：等数据回来后再收起动画，与 goods/orders 行为一致
   */
  onPullDownRefresh() {
    // 下拉刷新：强制更新天气 + 立即刷新附近公交（有请求去重，不会重复并发）
    this.loadWeather({ force: true })
    Promise.all([this.loadHomeData(), this.loadNearbyBusData()])
      .finally(() => wx.stopPullDownRefresh())
  }
})
