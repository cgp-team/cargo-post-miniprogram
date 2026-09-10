/**
 * 现实公交·客户端数据源（高德微信小程序 SDK，官方路线）。
 *
 * 接入步骤（与 https://lbs.amap.com/api/wx/gettingstarted 一致）：
 *   1) 高德控制台申请 key：服务平台选「微信小程序」，绑定小程序 AppID（本项目 wx687e9bf8544ac559）；
 *   2) amap-wx.js 放到 miniprogram/libs/（仓库已内置一份，可替换为「相关下载」页的最新版）；
 *   3) 微信公众平台 → 开发设置 → request 合法域名加入 https://restapi.amap.com；
 *   4) utils/config.js 的 AMAP_MINI_KEY 填上该 key。
 *
 * 行为约定：
 * - 未配置 key / SDK 缺失 / 请求失败/超时 → available()=false 或返回空数组，**绝不影响**项目自建线路与模拟车辆；
 * - 返回站点统一标注 dataSource=REAL_TRANSIT + transitSource=AMAP_MINI，不伪装成项目线路；
 * - 与后端 AmapTransitProvider（Web 服务 key）二选一即可：后端已提供现实层时不再重复请求，避免双倍配额消耗。
 */
const util = require('./util')
const config = require('./config')

/** 静态 require：libs/amap-wx.js 已随仓库内置，缺失时兜底为 null（不阻断页面） */
let amapSdk = null
try {
  amapSdk = require('../libs/amap-wx.js')
} catch (e) {
  amapSdk = null
}

/** 高德 POI 分类：150700 = 公交车站 */
const POI_TYPE_BUS_STATION = '150700'
/** 请求超时（毫秒）：超时按"无用例"处理，避免拖慢首页 */
const TIMEOUT_MS = 4000

function getKey() {
  try {
    return config.getAmapMiniKey() || ''
  } catch (e) {
    return ''
  }
}

/** 客户端现实公交层是否可用（key + SDK 都在） */
function available() {
  return !!getKey() && !!(amapSdk && amapSdk.AMapWX)
}

/**
 * 高德公交站 POI 的 address 字段实际是"途经线路"（如 "125路" / "(停运)G50路;184路;801路;…"）：
 * 拆成线路名数组供 UI 直接展示（过滤"XX路1号""XX路站"这类地址片段，最多 8 条）。
 */
function parseLines(address) {
  if (!address) return []
  return String(address)
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 24 && /(路|线|快巴|BRT|专线)/.test(s) && !/[号站]$/.test(s))
    .slice(0, 8)
}

/**
 * 站点去重键：规范化名称 + 5 位小数坐标。
 * 现实公交数据里同一站点会有多条 POI 记录（不同线路各一条），必须合并成一张卡片、线路取并集。
 * 名称规范化：去掉「(公交站)」「（XX）」等后缀与空白，使「曾家岩(公交站)」与「曾家岩」归为同一键。
 */
function normalizeStationName(name) {
  return String(name || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/(公交车?站|站点|站)$/g, '')
    .replace(/\s+/g, '')
    .trim()
}

function stationKey(station) {
  const name = normalizeStationName(station && station.name)
  const lat = Number(station && station.latitude).toFixed(5)
  const lng = Number(station && station.longitude).toFixed(5)
  return `${name}|${lat}|${lng}`
}

/**
 * 站点去重（同键合并）：距离取更近、线路取并集、名称取更简洁的那个、来源保留先到的非空值。
 * 纯函数，便于单测；客户端与后端 Provider 使用同一套键规则（名称规范化 + 5 位小数坐标）。
 */
function dedupeStations(stations) {
  const map = {}
  const order = []
  ;(stations || []).forEach((s) => {
    if (!s || typeof s.latitude !== 'number' || typeof s.longitude !== 'number') return
    const key = stationKey(s)
    const exist = map[key]
    if (!exist) {
      const copy = Object.assign({}, s, { lines: (s.lines || []).slice() })
      map[key] = copy
      order.push(key)
      return
    }
    if (exist.distanceKm == null || (s.distanceKm != null && s.distanceKm < exist.distanceKm)) {
      exist.distanceKm = s.distanceKm
    }
    const lines = {}
    ;(exist.lines || []).concat(s.lines || []).forEach((l) => { if (l) lines[l] = true })
    exist.lines = Object.keys(lines)
    // 更简洁的名称优先（「曾家岩」优于「曾家岩(公交站)」）
    if (s.name && (!exist.name || s.name.length < exist.name.length)) exist.name = s.name
    if (!exist.dataSource && s.dataSource) exist.dataSource = s.dataSource
    if (!exist.address && s.address) exist.address = s.address
  })
  return order.map((k) => map[k])
}

/**
 * 高德 POI 数组 → 站点列表（纯函数，便于单测）。
 * 坐标 GCJ-02（与站点表/后端一致）；距离用 Haversine 本地算，避免依赖 SDK 返回的 distance 字段。
 */
function parsePois(pois, latitude, longitude) {
  if (!pois || !pois.length) return []
  const result = []
  pois.forEach((poi) => {
    if (!poi || !poi.location) return
    const parts = String(poi.location).split(',')
    const lng = Number(parts[0])
    const lat = Number(parts[1])
    if (!isFinite(lng) || !isFinite(lat)) return
    result.push({
      name: poi.name || '公交站',
      longitude: lng,
      latitude: lat,
      distanceKm: Math.round(util.haversineKm(latitude, longitude, lat, lng) * 100) / 100,
      dataSource: 'REAL_TRANSIT',
      transitSource: 'AMAP_MINI',
      address: poi.address || '',
      lines: parseLines(poi.address)
    })
  })
  // 先按距离排序，再去重（同名同坐标合并；保留线路并集）
  return dedupeStations(result.sort((a, b) => a.distanceKm - b.distanceKm))
}

/** 查询附近公交站点（Promise：失败/超时/未配置 key 均 resolve([])，不 reject） */
function searchNearbyStations(latitude, longitude) {
  return new Promise((resolve) => {
    if (!available() || typeof latitude !== 'number' || typeof longitude !== 'number') {
      resolve([])
      return
    }
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = setTimeout(() => finish([]), TIMEOUT_MS)
    try {
      const client = new amapSdk.AMapWX({ key: getKey() })
      client.getPoiAround({
        // location 传参可跳过 SDK 内部再定位一次（我们已用统一 LocationService 拿到 GCJ-02 坐标）
        location: `${longitude},${latitude}`,
        querytypes: POI_TYPE_BUS_STATION,
        success: (data) => {
          clearTimeout(timer)
          finish(parsePois((data && data.poisData) || [], latitude, longitude))
        },
        fail: () => {
          clearTimeout(timer)
          finish([])
        }
      })
    } catch (e) {
      clearTimeout(timer)
      finish([])
    }
  })
}

/**
 * 把客户端现实公交站点并入后端 nearby 结果。
 * - 后端已有现实层（realTransitAvailable=true）→ 原样返回，不重复请求（省配额）；
 * - 无坐标 → 原样返回；
 * - 合并后重排距离、更新最近站与分层计数，并标注 transitProvider=AMAP_MINI。
 */
async function enrichNearby(data, latitude, longitude) {
  const result = data || {}
  if (result.realTransitAvailable || !available()) return result
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return result
  const stations = await searchNearbyStations(latitude, longitude)
  if (!stations.length) return result
  const merged = (result.nearbyStations || []).concat(stations)
    .sort((a, b) => (a.distanceKm == null ? Number.MAX_VALUE : a.distanceKm)
      - (b.distanceKm == null ? Number.MAX_VALUE : b.distanceKm))
  return Object.assign({}, result, {
    nearbyStations: merged,
    nearestStation: merged[0],
    realStationCount: stations.length,
    realTransitAvailable: true,
    transitProvider: 'AMAP_MINI'
  })
}

module.exports = {
  POI_TYPE_BUS_STATION,
  available,
  parseLines,
  normalizeStationName,
  dedupeStations,
  parsePois,
  searchNearbyStations,
  enrichNearby
}
