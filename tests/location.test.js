/**
 * LocationService 单元测试（Node 直跑，mock 全局 wx + weather）
 *
 * 运行：node tests/location.test.js
 * 覆盖：定位成功/失败/权限拒绝/permission deny/高精度/accuracy差/缓存命中/无缓存/缓存过期/
 *       逆地理失败/并发去重/缓存秒出/旧缓存 stale 兜底。
 */
const assert = require('assert')

// ---------- mock 全局 wx ----------
let storage = {}
let getLocationCalls = 0
let authSetting = {}            // getSetting 返回的 authSetting
let getLocationMode = 'success' // success | fail-auth-deny | fail-other

/** 默认 wx.getLocation：读 getLocationMode 返回成功/失败；场景可临时替换后由 reset() 恢复 */
const defaultGetLocation = (o) => {
  getLocationCalls++
  if (getLocationMode === 'fail-auth-deny') { o.fail && o.fail({ errMsg: 'getLocation:fail auth deny' }); return }
  if (getLocationMode === 'fail-other') { o.fail && o.fail({ errMsg: 'getLocation:fail timeout' }); return }
  o.success && o.success({ latitude: 30.5723, longitude: 104.0657, accuracy: 30 })
}

global.wx = {
  getStorageSync: (k) => (k in storage ? storage[k] : ''),
  setStorageSync: (k, v) => { storage[k] = v },
  getSetting: (o) => { o.success && o.success({ authSetting: Object.assign({}, authSetting) }) },
  getLocation: defaultGetLocation,
  openSetting: (o) => { o.success && o.success({ authSetting: { 'scope.userLocation': true } }) }
}

// mock weather 逆地理（location.js require 同一实例，替换导出属性生效）
const weather = require('../utils/weather')
weather.reverseGeocode = () => Promise.resolve('大足区')

const location = require('../utils/location')

function reset() {
  storage = {}
  getLocationCalls = 0
  authSetting = {}
  getLocationMode = 'success'
  global.wx.getLocation = defaultGetLocation // 恢复默认 mock（场景会临时替换 wx.getLocation）
}

async function main() {
  // 1/5/7/8: 定位成功 → PRECISE + district；第二次命中缓存 source=cache
  {
    reset()
    const first = await location.getCurrentLocation()
    assert.strictEqual(first.success, true)
    assert.strictEqual(first.latitude, 30.5723)
    assert.strictEqual(first.longitude, 104.0657)
    assert.strictEqual(first.level, 'PRECISE')       // accuracy 30 <= 100
    assert.strictEqual(first.source, 'AMAP')
    assert.strictEqual(first.district, '大足区')
    const second = await location.getCurrentLocation()
    assert.strictEqual(second.source, 'CACHE')        // TTL 内命中缓存
    console.log('✓ 1/5/7/8 定位成功+PRECISE+逆地理区域+缓存命中')
  }

  // 6: accuracy 较差 → APPROXIMATE
  {
    reset()
    global.wx.getLocation = (o) => { o.success && o.success({ latitude: 30.5, longitude: 104.1, accuracy: 300 }) }
    const loc = await location.getCurrentLocation()
    assert.strictEqual(loc.level, 'APPROXIMATE')
    global.wx.getLocation = global.wx.getLocation // keep mock call counter intact
    console.log('✓ 6 accuracy较差 → APPROXIMATE')
  }

  // 2: 定位失败（无缓存）→ success:false UNKNOWN
  {
    reset()
    getLocationMode = 'fail-other'
    const loc = await location.getCurrentLocation()
    assert.strictEqual(loc.success, false)
    assert.strictEqual(loc.level, 'UNKNOWN')
    console.log('✓ 2 定位失败无缓存 → UNKNOWN')
  }

  // 3: 用户拒绝（getSetting 返回 false）→ denied
  {
    reset()
    authSetting = { 'scope.userLocation': false }
    const loc = await location.getCurrentLocation()
    assert.strictEqual(loc.denied, true)
    assert.strictEqual(loc.success, false)
    console.log('✓ 3 用户拒绝权限 → denied')
  }

  // 4: getLocation fail auth deny → denied（未请求过时走此路径）
  {
    reset()
    getLocationMode = 'fail-auth-deny'
    const loc = await location.getCurrentLocation()
    assert.strictEqual(loc.denied, true)
    console.log('✓ 4 getLocation fail auth deny → denied')
  }

  // 9: 缓存过期（> 5min）→ 重新定位
  {
    reset()
    storage['userLocation'] = { success: true, latitude: 30.0, longitude: 104.0, accuracy: 30, district: '旧区', timestamp: Date.now() - 6 * 60 * 1000, source: 'AMAP' }
    const loc = await location.getCurrentLocation()
    assert.strictEqual(loc.latitude, 30.5723) // 重新定位的新值
    assert.strictEqual(loc.source, 'AMAP')
    console.log('✓ 9 缓存过期 → 重新定位')
  }

  // 10: 逆地理失败 → 仍保留坐标
  {
    reset()
    weather.reverseGeocode = () => Promise.resolve(null)
    const loc = await location.getCurrentLocation()
    assert.strictEqual(loc.success, true)
    assert.strictEqual(loc.latitude, 30.5723)
    assert.strictEqual(loc.district, undefined)
    assert.strictEqual(loc.level, 'PRECISE')
    weather.reverseGeocode = () => Promise.resolve('大足区')
    console.log('✓ 10 逆地理失败 → 仍保留坐标')
  }

  // 11: 并发去重（无缓存，同步两次调用）→ getLocation 只调 1 次
  {
    reset()
    const p1 = location.getCurrentLocation()
    const p2 = location.getCurrentLocation()
    await Promise.all([p1, p2])
    assert.strictEqual(getLocationCalls, 1)
    console.log('✓ 11 并发去重 → getLocation 只调 1 次')
  }

  // 12: 缓存命中秒出（第二次不等待定位，后台异步刷新）
  {
    reset()
    await location.getCurrentLocation()            // 首次定位写缓存
    const loc = await location.getCurrentLocation() // 命中缓存立即返回
    assert.strictEqual(loc.source, 'CACHE')
    console.log('✓ 12 缓存命中秒出（source=cache）')
  }

  // 13: 定位失败但有"仍在 5 分钟有效期内"的缓存 → CACHE + stale 兜底（超过 5 分钟的缓存不再使用，见 13b）
  {
    reset()
    storage['userLocation'] = { success: true, latitude: 30.0, longitude: 104.0, accuracy: 30, district: '旧区', timestamp: Date.now() - 3 * 60 * 1000, source: 'AMAP' }
    getLocationMode = 'fail-other'
    const loc = await location.getCurrentLocation()
    assert.strictEqual(loc.success, true)
    assert.strictEqual(loc.stale, true)
    assert.strictEqual(loc.source, 'CACHE')
    assert.strictEqual(loc.latitude, 30.0)
    console.log('✓ 13 定位失败（5 分钟内缓存）→ CACHE + stale 兜底')
  }

  // 13b: 缓存已超过 5 分钟有效期且定位失败 → 不伪造位置，返回 UNKNOWN
  {
    reset()
    storage['userLocation'] = { success: true, latitude: 30.0, longitude: 104.0, accuracy: 30, district: '旧区', timestamp: Date.now() - 6 * 60 * 1000, source: 'AMAP' }
    getLocationMode = 'fail-other'
    const loc = await location.getCurrentLocation()
    assert.strictEqual(loc.success, false)
    assert.strictEqual(loc.source, 'UNKNOWN')
    assert.strictEqual(loc.level, 'UNKNOWN')
    console.log('✓ 13b 超过 5 分钟的缓存不再兜底 → UNKNOWN（不伪造位置）')
  }

  // 17: 精度不足（800m）→ 自动补测一次并取更准的结果（定位不准的核心修复）
  {
    reset()
    let call = 0
    global.wx.getLocation = (o) => {
      call++
      o.success && o.success(call === 1
        ? { latitude: 30.5723, longitude: 104.0657, accuracy: 800 } // 首次：基站粗定位
        : { latitude: 30.5999, longitude: 104.1001, accuracy: 35 }) // 补测：高精度
    }
    const loc = await location.getCurrentLocation()
    assert.strictEqual(call, 2, '精度不足应补测一次')
    assert.strictEqual(loc.accuracy, 35, '应取更准的那次定位')
    assert.strictEqual(loc.latitude, 30.5999)
    assert.strictEqual(loc.level, 'PRECISE')
    console.log('✓ 17 精度不足 → 补测一次并取更准结果')
  }

  // 18: 缓存超过"秒出"阈值（90s）→ 同步重新定位，不用旧坐标查公交
  {
    reset()
    storage.userLocation = {
      latitude: 1, longitude: 2, accuracy: 30, district: '旧区域',
      timestamp: Date.now() - 200 * 1000, level: 'PRECISE', source: 'AMAP'
    }
    const loc = await location.getCurrentLocation()
    assert.strictEqual(getLocationCalls, 1, '缓存超过 90s 应重新定位')
    assert.strictEqual(loc.source, 'AMAP')
    assert.strictEqual(loc.latitude, 30.5723)
    console.log('✓ 18 缓存超过 90s → 同步重新定位（不再用旧坐标）')
  }

  // 19: refreshLocation（force）跳过缓存，即使缓存很新
  {
    reset()
    await location.getCurrentLocation() // 先写入新缓存
    assert.strictEqual(getLocationCalls, 1)
    const loc = await location.refreshLocation()
    assert.strictEqual(getLocationCalls, 2, '强制刷新应跳过缓存再定位一次')
    assert.strictEqual(loc.source, 'AMAP')
    console.log('✓ 19 refreshLocation 强制跳过缓存')
  }

  // 20: 附近公交半径按精度自适应（5000 / 8000 / 15000）+ 来源/城市字段
  {
    reset()
    assert.strictEqual(location.nearbyRadius(35), 5000)   // <=100m
    assert.strictEqual(location.nearbyRadius(100), 5000)
    assert.strictEqual(location.nearbyRadius(300), 8000)  // 100~500m
    assert.strictEqual(location.nearbyRadius(500), 8000)
    assert.strictEqual(location.nearbyRadius(900), 15000) // >500m
    assert.strictEqual(location.nearbyRadius(null, 'PRECISE'), 5000)
    assert.strictEqual(location.nearbyRadius(null, 'APPROXIMATE'), 15000)
    const loc = await location.getCurrentLocation()
    // 统一输出契约：source ∈ AMAP|CACHE|MANUAL|UNKNOWN，并带 city/district/accuracy/timestamp/level
    assert.deepStrictEqual(
      ['success', 'latitude', 'longitude', 'accuracy', 'timestamp', 'source', 'level', 'district'].filter((k) => !(k in loc)),
      []
    )
    assert.ok(['AMAP', 'CACHE', 'MANUAL', 'UNKNOWN'].includes(loc.source))
  console.log('✓ 20 半径自适应 + 统一输出字段（source/level/accuracy/timestamp/district）')
  }

  // 21: 精度分级/文案（粗定位 >500m、极差 >1000m）
  {
    reset()
    assert.strictEqual(location.isCoarseAccuracy({ accuracy: 300 }), false)
    assert.strictEqual(location.isCoarseAccuracy({ accuracy: 800 }), true)
    assert.strictEqual(location.isVeryCoarseAccuracy({ accuracy: 800 }), false)
    assert.strictEqual(location.isVeryCoarseAccuracy({ accuracy: 3200 }), true)
    assert.strictEqual(location.accuracyText({ accuracy: 35 }), '35m')
    assert.strictEqual(location.accuracyText({ accuracy: 3200 }), '3.2km')
    assert.strictEqual(location.accuracyText({}), '')
    console.log('✓ 21 粗定位阈值/精度文案')
  }

  // 22: 粗定位（公里级误差）时沿用最近一次高精度结果，避免"人在南岸区显示渝中区"
  {
    reset()
    global.wx.getLocation = (o) => { o.success && o.success({ latitude: 29.5325, longitude: 106.5765, accuracy: 30 }) }
    const precise = await location.getCurrentLocation({ force: true })
    assert.strictEqual(precise.level, 'PRECISE')
    // 紧接着系统只给出公里级粗定位（未开精确位置/室内/WiFi 定位，坐标偏到渝中区）
    global.wx.getLocation = (o) => { o.success && o.success({ latitude: 29.5555, longitude: 106.5500, accuracy: 3200 }) }
    const reused = await location.getCurrentLocation({ force: true })
    assert.strictEqual(reused.latitude, 29.5325, '应沿用上一次高精度纬度')
    assert.strictEqual(reused.longitude, 106.5765, '应沿用上一次高精度经度')
    assert.strictEqual(reused.stale, true)
    assert.ok(/耐用上一次高精度|沿用上一次高精度/.test(reused.note || ''), '应标注沿用说明')
    console.log('✓ 22 极差精度沿用上一次高精度定位')
  }

  // 23: 手动选点（wx.chooseLocation）优先于自动定位，且在有效期内不被覆盖
  {
    reset()
    global.wx.chooseLocation = (o) => {
      o.success && o.success({ latitude: 29.5325, longitude: 106.5765, name: '重庆邮电大学', address: '南岸区崇文路' })
    }
    const picked = await location.chooseLocation()
    assert.strictEqual(picked.success, true)
    assert.strictEqual(picked.source, 'MANUAL')
    assert.strictEqual(picked.manual, true)
    assert.strictEqual(picked.name, '重庆邮电大学')
    assert.strictEqual(picked.accuracy, 20)
    assert.strictEqual(picked.level, 'PRECISE')
    // 自动定位此时不应覆盖手动结果（也不再调 wx.getLocation）
    getLocationCalls = 0
    const auto = await location.getCurrentLocation()
    assert.strictEqual(auto.source, 'MANUAL')
    assert.strictEqual(auto.latitude, 29.5325)
    assert.strictEqual(getLocationCalls, 0, '手动选点有效期内不应再自动定位')
    // 用户主动"重新定位" → 放弃手动选点，回到真实定位
    const refreshed = await location.refreshLocation()
    assert.strictEqual(refreshed.source, 'AMAP')
    assert.strictEqual(getLocationCalls > 0, true)
    console.log('✓ 23 手动选点优先 + 强制刷新回到真实定位')
  }

  // 24: 高德 addressComponent 空数组字段归一（[] 是 truthy，直接 || 会得到空数组）
  {
    reset()
    assert.strictEqual(location.pickText([]), '')
    assert.strictEqual(location.pickText(['南岸区']), '南岸区')
    assert.strictEqual(location.pickText('南岸区'), '南岸区')
    assert.strictEqual(location.pickText(undefined), '')
    console.log('✓ 24 高德空数组字段归一为字符串')
  }

  console.log('\n全部通过 ✅')
}

main().catch((e) => {
  console.error('测试失败:', e)
  process.exit(1)
})
