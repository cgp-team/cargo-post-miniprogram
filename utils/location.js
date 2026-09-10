/**
 * 统一用户定位服务（LocationService = AmapLocationProvider 适配层）
 *
 * 定位来源优先级（业务层只认这里，页面禁止直接调 wx.getLocation）：
 *   1. 高德链路（AMAP）：wx.getLocation({type:'gcj02'}) 取设备坐标与精度 →
 *      高德小程序 SDK（amap-wx.js）逆地理 → 同时得到 GCJ-02 坐标 + 省/市/区（city/district）；
 *   2. 设备定位 + 免费逆地理兜底（仍是 GCJ-02，source 归入 AMAP）；
 *   3. 缓存（1~5 分钟内可用；60s 内秒出，超过则同步刷新）；
 *   4. DEMO 演示坐标（开发/测试，生产 release 隐藏入口）；
 *   5. UNKNOWN（定位失败/权限拒绝 → 页面显示"定位不可用"，绝不伪造）。
 *
 * 统一输出（业务层唯一坐标来源）：
 *   {
 *     success, latitude, longitude, accuracy,
 *     district, city,
 *     timestamp,
 *     source,   // AMAP | CACHE | DEMO | UNKNOWN
 *     level,    // PRECISE(<=100m) | APPROXIMATE | DISTRICT | UNKNOWN
 *     stale,    // true = 旧缓存兜底（非本次实时坐标）
 *     denied    // true = 用户拒绝定位权限（页面据此引导"去设置"）
 *   }
 *
 * 坐标系：全链路 **GCJ-02**（微信地图组件、高德 POI/公交/路线、项目站点表一致）。
 * 禁止把 WGS-84 坐标直接与 GCJ-02 数据做 Haversine；如需 WGS-84（如车载设备上报）用后端
 * GeoCoordUtil 统一转换。本项目设备来源本身即 gcj02，无需页面自行换算。
 *
 * 关键原则：
 *   - 区域名（district/city）只是展示文本，内部必须保留真实经纬度。
 *   - 定位缓存与天气/公交数据缓存彻底分开。
 *   - 精度阈值、缓存 TTL、搜索半径等常量统一放本文件，页面不得各自写死。
 */
const weatherApi = require('./weather')
const demoLocationUtil = require('./demo-location')

// ==================== 常量（阈值统一在此，不要在页面重复写死） ====================

/** 定位缓存有效期：5 分钟（缓存 1~5 分钟内可用；超出则不再作为兜底） */
const LOCATION_CACHE_TTL = 5 * 60 * 1000
/**
 * "秒出"缓存新鲜阈值：90 秒。
 * 超过该时长不再直接用缓存坐标去查附近公交（否则会拿几分钟前的位置算距离，表现为"定位不准"），
 * 改为同步取一次新定位；定位失败才退回旧缓存（标记 stale）。
 */
const CACHE_FRESH_TTL = 60 * 1000
/** 高精度定位超时（毫秒）：给系统更多时间拿好精度（越大越准，但等待越久） */
const HIGH_ACCURACY_EXPIRE_MS = 10000
/** 可接受精度（米）：优于该值视为"够准"，不再补测 */
const ACCEPTABLE_ACCURACY = 200
/** 逆地理区域缓存有效期：30 分钟（行政区变化慢，可复用） */
const DISTRICT_CACHE_TTL = 30 * 60 * 1000
/** PRECISE 精度阈值（米）：accuracy <= 100m 视为精确 */
const PRECISE_ACCURACY = 100

/** 附近公交搜索半径（米）：按定位精度自适应，避免"定位偏几百米 → 一辆车都查不到" */
const RADIUS_PRECISE_M = 5000
const RADIUS_MEDIUM_M = 8000
const RADIUS_COARSE_M = 15000

/** 数据来源标识（业务层展示用；不再区分"wechat/cache/stale-cache"，统一为四种） */
const SOURCE_AMAP = 'AMAP'
const SOURCE_CACHE = 'CACHE'
const SOURCE_DEMO = 'DEMO'
const SOURCE_UNKNOWN = 'UNKNOWN'

/** 定位精度级别 */
const LEVEL_PRECISE = 'PRECISE'        // 有经纬度，精度 <= 100m
const LEVEL_APPROXIMATE = 'APPROXIMATE' // 有经纬度，但 accuracy 较差
const LEVEL_DISTRICT = 'DISTRICT'      // 只有行政区
const LEVEL_UNKNOWN = 'UNKNOWN'        // 完全没有

/** 缓存 key：只存用户定位，与 weatherCache / 公交数据缓存区分 */
const CACHE_KEY = 'userLocation'

// ==================== 精度分级 ====================

/** 精度分级：阈值统一在此，页面/组件不要各自写死 */
function classifyLevel(loc) {
  if (!loc || loc.success === false) return LEVEL_UNKNOWN
  if (typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
    if (typeof loc.accuracy === 'number' && loc.accuracy > 0 && loc.accuracy <= PRECISE_ACCURACY) {
      return LEVEL_PRECISE
    }
    return LEVEL_APPROXIMATE
  }
  if (loc.district) return LEVEL_DISTRICT
  return LEVEL_UNKNOWN
}

// ==================== 缓存读写 ====================

function readCache() {
  try {
    const cache = wx.getStorageSync(CACHE_KEY)
    return cache && typeof cache === 'object' ? cache : null
  } catch (e) {
    return null
  }
}

function writeCache(loc) {
  try {
    wx.setStorageSync(CACHE_KEY, loc)
  } catch (e) {
    // storage 满等异常不影响主流程
  }
}

// ==================== 微信原生定位 ====================

/**
 * 微信原生高精度定位（复用项目现有参数：wgs84 + 高精度 + 6s 回退）。
 * 返回 { success:true, latitude, longitude, accuracy, timestamp } 或
 *     { denied:true }（用户拒绝权限）或 { success:false }（定位失败）。
 */
function wechatGetLocation() {
  return new Promise((resolve) => {
    wx.getSetting({
      success: (setting) => {
        if (setting.authSetting['scope.userLocation'] === false) {
          // 用户明确拒绝过定位权限
          resolve({ denied: true })
          return
        }
        wx.getLocation({
          // GCJ-02：与项目站点表（transport_station）、高德、司机端上报同一坐标系，
          // 用 wgs84 会让"附近距离"整体偏移百米级（见 docs/optimization/realtime-bus.md）
          type: 'gcj02',
          isHighAccuracy: true,          // 高精度定位
          highAccuracyExpireTime: HIGH_ACCURACY_EXPIRE_MS, // 10 秒内尽量拿高精度，超时自动回退
          success: (loc) => {
            resolve({
              success: true,
              latitude: loc.latitude,
              longitude: loc.longitude,
              accuracy: typeof loc.accuracy === 'number' ? loc.accuracy : null,
              coordType: 'GCJ02',
              timestamp: Date.now()
            })
          },
          fail: (err) => {
            // 区分"用户拒绝/系统权限关闭"与其他失败：拒绝时标记 denied，页面才能准确引导"去设置"
            const msg = (err && err.errMsg) || ''
            const denied = msg.indexOf('auth deny') !== -1 || msg.indexOf('auth denied') !== -1
              || msg.indexOf('permission') !== -1
            resolve({ success: false, denied })
          }
        })
      },
      fail: () => resolve({ success: false })
    })
  })
}

// ==================== 逆地理（区域 fallback） ====================

/** 坐标 → 区域名（复用 weather.reverseGeocode 的免费逆地理：腾讯LBS→BigDataCloud） */
function reverseToDistrict(lat, lon) {
  return weatherApi.reverseGeocode(lat, lon)
    .then((name) => (name ? { district: name } : null))
    .catch(() => null)
}

// ==================== 统一入口 ====================

let pending = null // 并发去重：同一时刻只发一次定位（onLoad + onShow 不会双发）
let demoLocation = null // DEMO 演示定位（设置了则覆盖真实定位，source=demo）
/** 定位变化订阅者（首页用它触发"位置变了→重新查附近公交"） */
const listeners = []

/** 订阅定位变化，返回取消订阅函数 */
function onLocationChange(handler) {
  if (typeof handler !== 'function') return () => {}
  listeners.push(handler)
  return () => {
    const idx = listeners.indexOf(handler)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

/**
 * 高德定位适配层（AmapLocationProvider）
 *
 * 说明：微信小程序的"高德定位"能力由 `amap-wx.js`（微信小程序 SDK）提供：其 getRegeo 未传 location 时
 * 会先调用 wx.getLocation({type:'gcj02'}) 取设备坐标，再走高德逆地理接口返回结构化地址。
 * 我们的做法：**自己先取一次设备定位拿到 accuracy（SDK 不返回精度）**，再把坐标交给 SDK 逆地理，
 * 这样既保留精度分级能力，又能拿到高德的 city/district，全程 GCJ-02，不做任何页面级坐标换算。
 *
 * 返回：{ district, city }（拿不到时字段缺失，不抛错）
 */
function amapReverse(latitude, longitude) {
  return new Promise((resolve) => {
    let sdk = null
    try {
      sdk = require('../libs/amap-wx.js')
    } catch (e) {
      sdk = null
    }
    const key = (() => {
      try {
        return require('./config').getAmapMiniKey() || ''
      } catch (e) {
        return ''
      }
    })()
    if (!sdk || !sdk.AMapWX || !key) {
      resolve(null)
      return
    }
    let settled = false
    const finish = (v) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    // 逆地理是"锦上添花"：3 秒拿不到就交给免费逆地理兜底，不拖慢首页
    const timer = setTimeout(() => finish(null), 3000)
    try {
      const client = new sdk.AMapWX({ key })
      client.getRegeo({
        location: `${longitude},${latitude}`, // 已定位，禁止 SDK 再取一次设备位置
        success: (data) => {
          clearTimeout(timer)
          const first = Array.isArray(data) ? data[0] : null
          const comp = first && first.regeocodeData && first.regeocodeData.addressComponent
          if (!comp) {
            finish(null)
            return
          }
          finish({
            district: comp.district || comp.township || '',
            city: comp.city || comp.province || '',
            // 高德逆地理返回的完整地址（如「重庆邮电大学」）→ 作为用户原始寄货地址留痕
            address: first.name || ''
          })
        },
        fail: () => {
          clearTimeout(timer)
          finish(null)
        }
      })
    } catch (e) {
      clearTimeout(timer)
      finish(null)
    }
  })
}

/**
 * 取一次"尽可能准"的定位（设备定位 → 精度择优 → 高德逆地理补 city/district）。
 * 1. 先按高精度取一次；
 * 2. 精度不够（无 accuracy 或 > {@link ACCEPTABLE_ACCURACY}）时再取一次，取两次里更准的那次；
 * 3. 高德逆地理补 city/district（失败则退回免费逆地理，由调用方处理）。
 */
async function locateOnce() {
  let loc = await wechatGetLocation()
  if (!loc.success) return loc
  if (!(typeof loc.accuracy === 'number' && loc.accuracy > 0 && loc.accuracy <= ACCEPTABLE_ACCURACY)) {
    const second = await wechatGetLocation()
    if (second.success && typeof second.accuracy === 'number'
        && (typeof loc.accuracy !== 'number' || second.accuracy < loc.accuracy)) {
      loc = second
    }
  }
  const amap = await amapReverse(loc.latitude, loc.longitude)
  if (amap) {
    return { ...loc, district: amap.district || loc.district, city: amap.city, address: amap.address || '' }
  }
  // 高德不可用时退回免费逆地理（只补 district）
  const region = await reverseToDistrict(loc.latitude, loc.longitude)
  return { ...loc, ...(region || {}) }
}

/**
 * 设备定位（GCJ-02）——给"设备级"用途的页面（如司机端 GPS 上报）使用。
 * 与 getCurrentLocation 的区别：不走缓存、不做逆地理、不写 userLocation 缓存，
 * 只做一次设备定位 + 精度择优，保证全项目只有本文件调用 wx.getLocation。
 */
async function getDeviceLocationGcj02() {
  const loc = await locateOnce()
  return loc
}

/**
 * 附近公交搜索半径（米）：按精度自适应，硬上限 15000（后端另有安全上限）。
 * accuracy <= 100m → 5000；100~500m → 8000；> 500m 或无法判断 → 15000。
 */
function nearbyRadius(accuracy, level) {
  if (typeof accuracy === 'number' && accuracy > 0) {
    if (accuracy <= PRECISE_ACCURACY) return RADIUS_PRECISE_M
    if (accuracy <= 500) return RADIUS_MEDIUM_M
    return RADIUS_COARSE_M
  }
  return level === LEVEL_PRECISE ? RADIUS_PRECISE_M : RADIUS_COARSE_M
}

/** 坐标是否发生实质变化（>100m，约 0.001 度），避免 GPS 抖动触发重复请求 */
function movedEnough(prev, next) {
  if (!prev || typeof prev.latitude !== 'number' || typeof prev.longitude !== 'number') return true
  return Math.abs(prev.latitude - next.latitude) > 0.001 || Math.abs(prev.longitude - next.longitude) > 0.001
}

/** 定位日志（排障用；只打坐标/精度/来源/区域，不含用户身份信息） */
function logLocation(loc) {
  if (!loc) return
  console.log(`[AMAP_LOCATION] source=${loc.source} latitude=${loc.latitude} longitude=${loc.longitude} accuracy=${loc.accuracy} district=${loc.district || ''} city=${loc.city || ''} level=${loc.level}`)
}

/** 通知订阅者：定位发生（实质性）变化 → 页面据此重新查询附近公交 */
function notifyListeners(loc) {
  if (!movedEnough(notified, loc)) return
  notified = loc
  listeners.forEach((handler) => {
    try {
      handler(loc)
    } catch (e) {
      console.warn('[Location] 定位变化回调失败', e)
    }
  })
}

/** 最近一次已通知的定位（防抖） */
let notified = null

/**
 * 设置演示定位（DEMO 模式）：用预设站点坐标替代真实 GPS，供开发/测试验证"附近公交"。
 * @param {string} name 演示名（青山镇/县城客运中心/龙泉镇）
 * @returns {object|null} demo userLocation（含 source=demo），名称不存在返回 null
 */
function setDemoLocation(name) {
  const demo = demoLocationUtil.findDemo(name)
  if (!demo) return null
  demoLocation = {
    success: true,
    latitude: demo.latitude,
    longitude: demo.longitude,
    accuracy: 50, // 演示位置视为精确（<=100 → PRECISE）
    district: demo.district,
    city: '演示城市',
    timestamp: Date.now(),
    source: SOURCE_DEMO,
    coordType: 'GCJ02',
    level: LEVEL_PRECISE
  }
  notified = demoLocation
  return demoLocation
}

/** 清除演示定位：回到真实定位（微信 GPS） */
function clearDemoLocation() {
  demoLocation = null
}

/**
 * 获取当前用户定位（统一入口）。
 *
 * 策略：
 *   0. DEMO 演示定位已设置 → 直接返回（source=demo），不调微信/缓存；
 *   1. 较新缓存（TTL 内）→ 直接返回（source=cache），并后台异步刷新；
 *   2. 否则微信高精度定位 → 成功则逆地理补区域、写缓存返回（source=wechat）；
 *   3. 定位失败 → 旧缓存兜底（source=stale-cache, stale=true）；无缓存 → UNKNOWN；
 *   4. 用户拒绝权限 → 返回 denied，由页面展示"去设置"引导。
 *
 * @returns {Promise<object>} userLocation（含 level）
 */
function getCurrentLocation(options) {
  const force = !!(options && options.force)
  if (demoLocation) return Promise.resolve(demoLocation)
  if (pending) return pending // 并发去重
  pending = doGetLocation(force).then((loc) => {
    logLocation(loc)
    notifyListeners(loc)
    return loc
  }).finally(() => {
    pending = null
  })
  return pending
}

async function doGetLocation(force) {
  const now = Date.now()
  const cache = readCache()

  // 0) 强制刷新：跳过缓存（用户手动"重新定位"/下拉刷新）
  if (force) {
    const forced = await locateOnce()
    if (forced.denied) return withDenied(cache, now)
    if (forced.success) {
      const result = { ...forced, source: SOURCE_AMAP, level: classifyLevel(forced) }
      writeCache(result)
      return result
    }
    // 强制刷新失败：旧缓存兜底
    if (cache && cache.timestamp && now - cache.timestamp < LOCATION_CACHE_TTL) {
      return normalize(cache, { source: SOURCE_CACHE, stale: true })
    }
    return { success: false, level: LEVEL_UNKNOWN, source: SOURCE_UNKNOWN, timestamp: now }
  }

  // 1) 60 秒内缓存：直接返回（秒出），后台异步刷新（刷新到更准位置时会通知页面重查公交）
  if (cache && cache.timestamp && now - cache.timestamp < CACHE_FRESH_TTL) {
    refreshInBackground()
    return normalize(cache, { source: SOURCE_CACHE })
  }

  // 2) 缓存过期/不存在：同步取新定位（公交页/首页进入时都能拿到真实 GPS）
  const loc = await locateOnce()
  if (loc.denied) {
    return withDenied(cache, now)
  }
  if (loc.success) {
    // city/district 由 locateOnce（高德逆地理 → 免费逆地理兜底）补齐；30min 内可复用旧区域名
    if (!loc.district && cache && cache.district && cache.timestamp
        && now - cache.timestamp < DISTRICT_CACHE_TTL) {
      loc.district = cache.district
    }
    if (!loc.city && cache && cache.city && cache.timestamp
        && now - cache.timestamp < DISTRICT_CACHE_TTL) {
      loc.city = cache.city
    }
    const result = { ...loc, source: SOURCE_AMAP, level: classifyLevel(loc) }
    writeCache(result)
    return result
  }

  // 3) 定位失败：旧缓存兜底（标记 stale）；无缓存 → UNKNOWN
  if (cache && cache.timestamp && now - cache.timestamp < LOCATION_CACHE_TTL) {
    return normalize(cache, { source: SOURCE_CACHE, stale: true })
  }
  return { success: false, level: LEVEL_UNKNOWN, source: SOURCE_UNKNOWN, timestamp: now }
}

/** 后台异步刷新：命中缓存后补发一次真实定位（择优），成功才覆盖缓存（失败/拒绝保留旧缓存） */
function refreshInBackground() {
  locateOnce().then((loc) => {
    if (!loc.success) return
    const fresh = { ...loc, source: SOURCE_AMAP, level: classifyLevel(loc) }
    writeCache(fresh)
    logLocation(fresh)
    notifyListeners(fresh)
  }).catch(() => {})
}

/** 权限拒绝：有旧缓存则兜底返回（stale），否则 UNKNOWN + denied 标记 */
function withDenied(cache, now) {
  if (cache && cache.timestamp && now - cache.timestamp < LOCATION_CACHE_TTL) {
    return normalize(cache, { source: SOURCE_CACHE, stale: true, denied: true })
  }
  return { success: false, denied: true, level: LEVEL_UNKNOWN, source: SOURCE_UNKNOWN, timestamp: now }
}

/** 统一补全字段：合并 level / stale / denied，保证结构一致 */
function normalize(loc, extra) {
  return {
    ...loc,
    ...extra,
    level: loc.level || classifyLevel(loc),
    stale: extra.stale || loc.stale || false
  }
}

/**
 * 打开定位权限设置（用户拒绝后引导"去设置"）。
 * 返回 Promise<boolean>：是否拿到授权（openSetting 结果里 scope.userLocation === true）
 */
function openLocationSetting() {
  return new Promise((resolve) => {
    wx.openSetting({
      success: (res) => {
        resolve(!!(res.authSetting && res.authSetting['scope.userLocation']))
      },
      fail: () => resolve(false)
    })
  })
}

module.exports = {
  LOCATION_CACHE_TTL,
  CACHE_FRESH_TTL,
  HIGH_ACCURACY_EXPIRE_MS,
  ACCEPTABLE_ACCURACY,
  DISTRICT_CACHE_TTL,
  PRECISE_ACCURACY,
  // 搜索半径（按精度自适应，页面统一用它，不要各自写死）
  RADIUS_PRECISE_M,
  RADIUS_MEDIUM_M,
  RADIUS_COARSE_M,
  // 数据来源标识：AMAP / CACHE / DEMO / UNKNOWN
  SOURCE_AMAP,
  SOURCE_CACHE,
  SOURCE_DEMO,
  SOURCE_UNKNOWN,
  LEVEL_PRECISE,
  LEVEL_APPROXIMATE,
  LEVEL_DISTRICT,
  LEVEL_UNKNOWN,
  classifyLevel,
  nearbyRadius,
  getDeviceLocationGcj02,
  getCurrentLocation,
  /** 强制重新定位（跳过缓存），供"定位不准·重新定位"/下拉刷新使用 */
  refreshLocation: () => getCurrentLocation({ force: true }),
  setDemoLocation,
  clearDemoLocation,
  onLocationChange,
  openLocationSetting
}
