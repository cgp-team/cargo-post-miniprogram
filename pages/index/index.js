/**
 * 首页逻辑 - 农村客货邮小程序
 */
const api = require('../../utils/api')
const weatherApi = require('../../utils/weather')
const productImg = require('../../utils/product-img')
const auth = require('../../utils/auth')
const location = require('../../utils/location')
const transitAmap = require('../../utils/transit-amap')
const { navThrottled } = require('../../utils/util')

/** 天气缓存有效期：10 分钟内直接复用缓存渲染，跳过定位与网络请求 */
const WEATHER_CACHE_TTL = 10 * 60 * 1000

Page({
  behaviors: [require('../../behaviors/page-base')],
  data: {
    userInfo: {},
    currentVillage: '',
    // 用户定位（统一 LocationService 结果；内部保留真实经纬度，currentVillage 只是展示文本）
    userLocation: null,
    locationDenied: false,      // 权限被拒绝（引导"去设置"）
    locationUnavailable: false, // 定位不可用（无坐标）
    locationPoorAccuracy: false, // 定位精度较低（accuracy > 100m）：提示用户"重新定位"
    locationAccuracyText: null,  // 精度米数（展示用）
    weather: {},
    weatherLoading: false,   // 真实天气请求中
    weatherUpdateTime: '',   // 更新时间提示
    weatherExpanded: false,  // 天气详情卡展开态（默认只显示头部胶囊）
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    notices: [],                // 平台公告（真实接口，失败/为空时展示空态，不再硬编码演示公告）
    nearbyBuses: [],            // 附近实时公交（真实接口数据，不再硬编码 Demo）
    nearbyStations: [],         // 附近站点（用于空态区分：有站点但无车 = 非运营时间）
    nearbyLines: [],            // 附近站点关联线路（无运营车辆也展示：该区域有哪些线路/不在运营）
    nearbyLineCount: 0,         // 附近线路条数（现实公交 + 项目线路，空态文案用）
    nearbyRealTransitAvailable: false, // 现实公交数据源（高德）是否可用
    nearbyBusStatus: 'loading', // loading | ok | empty | error
    nearbyBusUpdatedAt: 0,      // 最近成功更新时间戳（相对文案用）
    nearbyBusUpdatedText: '',   // "已更新：刚刚" / "更新于 12 秒前"
    nearbyBusLocatedText: '',   // "根据当前位置展示" / "根据当前区域展示"
    recommendProducts: []       // 推荐农产品（真实接口，失败/为空时展示空态，不再硬编码演示商品）
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
    // 定位变化（缓存秒出后后台刷到新位置）→ 主动刷新附近公交，避免一直用旧位置查询
    this._offLocationChange = location.onLocationChange((loc) => {
      // 页面在后台时不查公交（省电省流量）；onShow 会补一次刷新
      if (this._pageHidden) return
      this._applyUserLocation(loc)
      this.loadNearbyBusData()
    })
  },

  onHide() {
    // 页面隐藏停止自动刷新（公交位置不动车）
    this._pageHidden = true
    this.stopNearbyTimer()
  },

  onUnload() {
    this.stopNearbyTimer()
    if (this._offLocationChange) {
      this._offLocationChange()
      this._offLocationChange = null
    }
  },

  onShow() {
    this._pageHidden = false
    // 每次显示时刷新外观设置（设置页改动后回来立即生效）
    this._applyAppearance()
    // 首次 onShow 紧接 onLoad（onLoad 已触发加载），跳过避免双发；从其他页返回时才补刷新
    if (this._entered) {
      this.loadUserLocation()
      this.loadNearbyBusData()
      this.loadWeather()
    }
    this._entered = true
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
  async loadUserLocation(options) {
    const loc = await location.getCurrentLocation(options)
    if (!loc || !loc.success) {
      this.setData({
        userLocation: null,
        locationDenied: !!(loc && loc.denied),
        locationUnavailable: true,
        // 定位不可用时不再假装身在某个村庄
        currentVillage: ''
      })
      return
    }
    this._applyUserLocation(loc)
  },

  /** 保存定位结果（内部保留真实经纬度；currentVillage 只是展示文本），并同步全局 */
  _applyUserLocation(loc) {
    const coarse = location.isCoarseAccuracy(loc)
    this.setData({
      userLocation: loc,
      locationDenied: false,
      locationUnavailable: false,
      // 精度差（>500m）时明确提示"可能不准"，并给"手动选择位置"入口（粗定位区域名可能落到隔壁区）
      locationPoorAccuracy: !!loc && (loc.level === 'APPROXIMATE' || coarse),
      locationVeryPoorAccuracy: location.isVeryCoarseAccuracy(loc),
      locationAccuracyText: location.accuracyText(loc),
      locationManual: !!(loc && loc.manual),
      // 区域名只是展示文本：手动选点优先显示用户点选的地点名
      currentVillage: (loc && (loc.manual && loc.name ? loc.name : loc.district)) || ''
    })
    const app = getApp()
    if (loc.district || (loc.manual && loc.name)) {
      app.globalData.currentVillage = loc.manual && loc.name ? loc.name : loc.district
    }
    app.globalData.userLocation = loc
  },

  /**
   * 手动选择位置（定位不准时的纠正手段）：微信地图选点 → 用选中的 GCJ-02 坐标重查附近公交与天气。
   * 手机未开"精确位置"/室内/WiFi 定位时误差可达公里级（人在南岸区显示渝中区），点一次即可纠正。
   */
  async manualPickLocation() {
    try {
      const loc = await location.chooseLocation()
      if (!loc || !loc.success) return // 用户取消
      this._applyUserLocation(loc)
      this._fetchWeather(loc.latitude, loc.longitude)
      this.loadNearbyBusData()
      wx.showToast({ title: `已使用：${loc.name || loc.address || '所选位置'}`.slice(0, 30), icon: 'none' })
    } catch (e) {
      wx.showToast({ title: '选择位置失败，请重试', icon: 'none' })
    }
  },

  /**
   * 附近搜索半径：按定位精度自适应，避免"定位不准（几百米误差）→ 附近公交查不到"。
   * 无坐标时返回 null，交给后端按 district 区域 fallback。
   */
  _nearbyRadius(loc, hasCoords) {
    if (!hasCoords) return null
    // 半径口径统一在 LocationService（5000 / 8000 / 15000），页面不再各自写死
    return location.nearbyRadius(loc && loc.accuracy, loc && loc.level)
  },

  /** 定位不准 → 强制重新定位（跳过缓存）并重查附近公交 */
  async relocate() {
    wx.showLoading({ title: '重新定位…', mask: true })
    try {
      const loc = await location.refreshLocation()
      wx.hideLoading()
      if (loc && loc.success) {
        this._applyUserLocation(loc)
        this.loadNearbyBusData()
        // 精确定位给成功图标（短文案）；精度一般文案较长用 none 避免折行
        if (loc.level === 'PRECISE') {
          wx.showToast({ title: '定位已更新', icon: 'success' })
        } else {
          wx.showToast({ title: '已更新（精度一般）', icon: 'none' })
        }
      } else {
        wx.showToast({ title: '定位失败，请检查定位权限', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '定位失败，请稍后重试', icon: 'none' })
    }
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
    // 平台公告：真实接口，失败/为空时首页展示空态
    this.loadNotices()
    try {
      // 推荐商品：拉取后端上架商品，取前 4 条；失败/为空时展示空态
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

  /** 平台公告（真实接口；失败/为空时首页展示空态，不再回退静态演示公告） */
  async loadNotices() {
    try {
      const notices = (await api.listNotices()) || []
      this.setData({ notices })
    } catch (err) {
      console.error('加载平台公告失败', err)
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
      confirmText: '知道了',
      confirmColor: '#C75B2A'
    })
  },

  /**
   * 加载附近实时公交：真实 nearby API + 定位（精确坐标或区域 fallback）。
   * 原则：不再显示硬编码 Demo；空数据/失败有明确状态提示。
   * 并发合流：请求在飞时再触发（15s 轮询/定位变化/手动切位置/下拉刷新）不丢也不叠加——
   * 挂一个接续任务，在飞请求结束后用最新定位重查（旧写法直接丢弃，旧位置数据会残留到下轮 15s）。
   * 返回 Promise 供下拉刷新等待。
   */
  loadNearbyBusData(options) {
    if (this._nearbyLoading) {
      if (!this._nearbyQueued) {
        // 接续任务用最新一次触发的 options（如定时器 silent）：后触发的意图优先
        this._nearbyQueued = this._nearbyLoading.then(() => {
          this._nearbyLoading = this._runNearbyQuery(options)
          return this._nearbyLoading
        })
        this._nearbyQueued.finally(() => {
          this._nearbyQueued = null
          this._nearbyLoading = null
        })
      }
      return this._nearbyQueued
    }
    this._nearbyLoading = this._runNearbyQuery(options)
    this._nearbyLoading.finally(() => {
      if (!this._nearbyQueued) this._nearbyLoading = null
    })
    return this._nearbyLoading
  },

  /** 实际查询（内部已兜错误态，promise 不 reject；并发合流由 loadNearbyBusData 负责） */
  async _runNearbyQuery(options) {
    const silent = !!(options && options.silent)
    const loc = this.data.userLocation
    const hasCoords = loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number'
    // 区域 fallback：无精确坐标时按定位逆地理区域查询
    const district = !hasCoords ? ((loc && loc.district) || '') : ''
    // 静默轮询不闪 loading（空态/非运营时段是正常内容，不该每 15s 闪成"加载中"）
    if (!silent && !this.data.nearbyBuses.length) {
      this.setData({ nearbyBusStatus: 'loading' })
    }
    try {
      const raw = await api.getNearbyRealtimeBuses(
        // 无定位/无区域时传 null（api.js cleanParams 统一过滤），不要传 undefined：
        // wx.request 会把 undefined 序列化成字符串 "undefined"，后端 Double 绑定直接 400
        hasCoords ? loc.latitude : null,
        hasCoords ? loc.longitude : null,
        this._nearbyRadius(loc, hasCoords), // 精度差时放宽半径（定位不准也能找到车）
        district || null,
        silent ? { silent: true } : undefined // 静默轮询失败不弹 toast（弱网每 15s 弹窗不可接受）
      )
      // 现实公交客户端层（高德小程序 SDK）：后端未配 Web 服务 key 时用小程序 key 补齐真实站点
      const data = await transitAmap.enrichNearby(
        raw,
        hasCoords ? loc.latitude : null,
        hasCoords ? loc.longitude : null
      )
      // 不在运营时间：不铺车辆卡片（避免首页出现一堆"待发"卡片被误读为正在运行）
      const rawBuses = (data && data.buses) || []
      const inService = data && data.inService != null ? data.inService : null
      const buses = this._formatBuses(inService === false ? [] : rawBuses)
      const stations = (data && data.nearbyStations) || []
      const lines = (data && data.lines) || []
      this.setData({
        nearbyBuses: buses,
        nearbyStations: stations,
        nearbyLines: lines,
        // 首页只展示前 6 条线路（主城线网 200+ 条，全列出来会把首页刷屏）
        nearbyLinePreview: (lines || []).slice(0, 6),
        nearbyLineCount: (data && data.lineCount) || lines.length,
        nearbyBusInService: inService,
        nearbyBusWindow: (data && data.serviceWindowText) || '',
        nearbyBusNextDeparture: (data && data.nextDepartureTime) || '',
        nearbyRealTransitAvailable: !!(data && data.realTransitAvailable),
        nearbyBusStatus: buses.length ? 'ok' : (inService === false ? 'off' : 'empty'),
        nearbyBusUpdatedAt: Date.now(),
        nearbyBusUpdatedText: '已更新：刚刚',
        nearbyBusLocatedText: hasCoords
          ? '根据当前位置展示'
          : (data && data.locationLevel === 'DISTRICT' ? '根据当前区域展示' : '')
      })
    } catch (err) {
      console.error('加载附近公交失败', err)
      // 静默轮询失败保留旧内容（不闪错误态）；还在首次 loading（没有任何内容）才亮错误态给重试入口
      if (silent && this.data.nearbyBusStatus !== 'loading') return
      this.setData({ nearbyBusStatus: 'error' })
    }
  },

  /** 公交卡片字段预处理（状态/来源/下一站/真实 ETA；无可靠位置不显示虚假数字） */
  _formatBuses(buses) {
    const statusText = { RUNNING: '行驶中', IDLE: '待发/停靠', ARRIVED: '已到站', NO_LOCATION: '无位置' }
    return (buses || []).map((b) => {
      const hasEta = typeof b.etaMinutes === 'number' && b.etaMinutes >= 0
      const running = b.status === 'RUNNING'
      const waitMinutes = typeof b.waitDepartureMinutes === 'number' ? b.waitDepartureMinutes : null
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
          : (b.locationSource === 'REAL_STALE' ? '位置可能过期'
              : (b.locationSource === 'SIMULATED' ? '位置推算' : '位置暂不可用')),
        sourceDot: b.locationSource === 'REAL_FRESH', // 🟢 实时
        sourceStale: b.locationSource === 'REAL_STALE', // 🟠 位置可能过期（司机中断上报）
        // 无 ETA 时按数据来源区分文案：班次推算车辆说明是"按班次计划推算"，真实车辆才提示"等待实时位置"
        // 在途=到站分钟；待发=距发车分钟；其余不编造数字
        etaText: running && hasEta ? b.etaMinutes + ' 分钟到站'
          : (!running && waitMinutes != null ? waitMinutes + ' 分钟后发车'
            : (b.status === 'ARRIVED' ? '已到终点站' : '待发车')),
        etaLabel: running && hasEta ? '到站' : (!running && waitMinutes != null ? '发车' : '状态'),
        etaMinutes: hasEta ? b.etaMinutes : null,
        waitMinutes,
        running,
        distanceKm: typeof b.distanceToNextStationKm === 'number' ? b.distanceToNextStationKm : null,
        routeProvider: b.routeProvider || '',
        lastLocationText: b.lastLocationTime ? this._fmtTimeShort(b.lastLocationTime) : '',
        locationUnavailable: !hasEta && !running && waitMinutes == null && b.locationSource !== 'REAL_FRESH'
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

  /** 15s 自动刷新附近公交（页面隐藏停止，显示恢复；防重复定时器；轮询静默：弱网失败不弹 toast 不闪错误态） */
  startNearbyTimer() {
    this.stopNearbyTimer()
    this._nearbyTimer = setInterval(() => {
      this._updateBusUpdatedText()
      this.loadNearbyBusData({ silent: true })
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
   * 跳转实时公交（车来了式地图+列表）
   */
  goToBusTracking() {
    if (navThrottled(this)) return // 防连点叠两层页面
    wx.navigateTo({ url: '/pages/bus/index' })
  },

  /**
   * 跳转公交详情
   */
  goToBusDetail(e) {
    if (navThrottled(this)) return
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
    if (navThrottled(this)) return
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
    if (navThrottled(this)) return
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
    // 下拉刷新：强制重新定位（跳过缓存）+ 强制更新天气 + 立即刷新附近公交
    this.loadWeather({ force: true })
    Promise.all([this.loadHomeData(), this.loadUserLocation({ force: true }).then(() => this.loadNearbyBusData())])
      .finally(() => wx.stopPullDownRefresh())
  },

  /** 分享小程序本身（tab 页，path 不带参数） */
  onShareAppMessage() {
    return {
      title: '咱村的客货邮——公交带货、快递进村、农产品出山',
      path: '/pages/index/index'
    }
  }
})
