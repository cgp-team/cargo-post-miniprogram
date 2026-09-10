/**
 * 统一用户定位服务（LocationService）
 *
 * 定位来源优先级：
 *   1. 较新缓存（TTL 5min 内）→ 秒出，后台异步刷新（失败保留旧缓存）
 *   2. 微信原生高精度定位（复用项目现有参数：wgs84 + isHighAccuracy）→ 精确经纬度
 *   3. 逆地理区域 fallback（复用 weather.reverseGeocode）→ 行政区名
 *   4. 旧缓存兜底（标记 stale）
 *   5. 无 → UNKNOWN（"定位不可用"）
 *
 * 统一返回结构 userLocation：
 *   {
 *     success, latitude, longitude, accuracy,
 *     district, village,
 *     timestamp, source,        // source: wechat | cache | stale-cache | reverse-geocode | denied | unknown
 *     stale,                    // true = 旧缓存兜底（非实时坐标）
 *     level                     // PRECISE | APPROXIMATE | DISTRICT | UNKNOWN
 *   }
 *
 * 关键原则：
 *   - 区域名（district/village）只是展示文本，内部必须保留真实经纬度（userLocation.latitude/longitude）。
 *   - 定位坐标缓存是"用户定位"，与天气/公交实时数据缓存无关。
 *   - 精度阈值、缓存 TTL 等常量统一放在本文件，页面/组件不得各自写死。
 *   - 区域/定位失败/权限拒绝均不阻塞调用方，返回明确状态由页面决定 UI。
 */
const weatherApi = require('./weather')
const demoLocationUtil = require('./demo-location')

// ==================== 常量（阈值统一在此，不要在页面重复写死） ====================

/** 定位缓存有效期：5 分钟（用户位置比天气更需要新鲜；方案建议 5~10 分钟取 5） */
const LOCATION_CACHE_TTL = 5 * 60 * 1000
/**
 * "秒出"缓存新鲜阈值：90 秒。
 * 超过该时长不再直接用缓存坐标去查附近公交（否则会拿几分钟前的位置算距离，表现为"定位不准"），
 * 改为同步取一次新定位；定位失败才退回旧缓存（标记 stale）。
 */
const CACHE_FRESH_TTL = 90 * 1000
/** 高精度定位超时（毫秒）：给系统更多时间拿好精度（越大越准，但等待越久） */
const HIGH_ACCURACY_EXPIRE_MS = 10000
/** 可接受精度（米）：优于该值视为"够准"，不再补测 */
const ACCEPTABLE_ACCURACY = 200
/** 逆地理区域缓存有效期：30 分钟（行政区变化慢，可复用） */
const DISTRICT_CACHE_TTL = 30 * 60 * 1000
/** PRECISE 精度阈值（米）：accuracy <= 100m 视为精确 */
const PRECISE_ACCURACY = 100

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
 * 取一次"尽可能准"的定位：
 * 1. 先按高精度取一次；
 * 2. 精度不够（无 accuracy 或 > {@link ACCEPTABLE_ACCURACY}）时再取一次，取两次里更准的那次。
 * 目的：微信首次定位常返回几百米误差（基站/WiFi 定位），补测一次通常能显著收敛。
 */
async function locateOnce() {
  const first = await wechatGetLocation()
  if (!first.success) return first
  if (typeof first.accuracy === 'number' && first.accuracy > 0 && first.accuracy <= ACCEPTABLE_ACCURACY) {
    return first
  }
  const second = await wechatGetLocation()
  if (second.success && typeof second.accuracy === 'number'
      && (typeof first.accuracy !== 'number' || second.accuracy < first.accuracy)) {
    return second
  }
  return first
}

/** 坐标是否发生实质变化（>100m，约 0.001 度），避免 GPS 抖动触发重复请求 */
function movedEnough(prev, next) {
  if (!prev || typeof prev.latitude !== 'number' || typeof prev.longitude !== 'number') return true
  return Math.abs(prev.latitude - next.latitude) > 0.001 || Math.abs(prev.longitude - next.longitude) > 0.001
}

/** 定位日志（排障用；只打坐标/精度/来源/区域，不含用户身份信息） */
function logLocation(loc) {
  if (!loc) return
  console.log(`[Location] latitude=${loc.latitude} longitude=${loc.longitude} accuracy=${loc.accuracy} source=${loc.source} district=${loc.district || ''} level=${loc.level}`)
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
    timestamp: Date.now(),
    source: 'demo',
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
      const region = await reverseToDistrict(forced.latitude, forced.longitude)
      const result = { ...forced, source: 'wechat', ...(region || {}), level: classifyLevel(forced) }
      writeCache(result)
      return result
    }
    // 强制刷新失败：旧缓存兜底
    if (cache) return normalize(cache, { source: 'stale-cache', stale: true })
    return { success: false, level: LEVEL_UNKNOWN, source: 'unknown', timestamp: now }
  }

  // 1) 90 秒内缓存：直接返回（秒出），后台异步刷新（刷新到更准位置时会通知页面重查公交）
  if (cache && cache.timestamp && now - cache.timestamp < CACHE_FRESH_TTL) {
    refreshInBackground()
    return normalize(cache, { source: 'cache' })
  }

  // 2) 缓存过期/不存在：同步取新定位（不再拿几分钟前的坐标查附近公交）
  const loc = await locateOnce()
  if (loc.denied) {
    return withDenied(cache, now)
  }
  if (loc.success) {
    // 逆地理补区域（失败不影响坐标返回）；30min 内已逆地理过则复用旧区域，减少弱网请求
    let region = null
    if (cache && cache.district && cache.timestamp && now - cache.timestamp < DISTRICT_CACHE_TTL) {
      region = { district: cache.district }
    } else {
      region = await reverseToDistrict(loc.latitude, loc.longitude)
    }
    const result = { ...loc, source: 'wechat', ...(region || {}), level: classifyLevel(loc) }
    writeCache(result)
    return result
  }

  // 3) 定位失败：旧缓存兜底（标记 stale）；无缓存 → UNKNOWN
  if (cache) {
    return normalize(cache, { source: 'stale-cache', stale: true })
  }
  return { success: false, level: LEVEL_UNKNOWN, source: 'unknown', timestamp: now }
}

/** 后台异步刷新：命中缓存后补发一次真实定位（择优），成功才覆盖缓存（失败/拒绝保留旧缓存） */
function refreshInBackground() {
  locateOnce().then((loc) => {
    if (!loc.success) return
    return reverseToDistrict(loc.latitude, loc.longitude).then((region) => {
      const fresh = { ...loc, source: 'wechat', ...(region || {}), level: classifyLevel(loc) }
      writeCache(fresh)
      logLocation(fresh)
      notifyListeners(fresh)
    })
  }).catch(() => {})
}

/** 权限拒绝：有旧缓存则兜底返回（stale），否则 UNKNOWN + denied 标记 */
function withDenied(cache, now) {
  if (cache) {
    return normalize(cache, { source: 'stale-cache', stale: true, denied: true })
  }
  return { success: false, denied: true, level: LEVEL_UNKNOWN, source: 'denied', timestamp: now }
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
  LEVEL_PRECISE,
  LEVEL_APPROXIMATE,
  LEVEL_DISTRICT,
  LEVEL_UNKNOWN,
  classifyLevel,
  getCurrentLocation,
  /** 强制重新定位（跳过缓存），供"定位不准·重新定位"/下拉刷新使用 */
  refreshLocation: () => getCurrentLocation({ force: true }),
  setDemoLocation,
  clearDemoLocation,
  onLocationChange,
  openLocationSetting
}
