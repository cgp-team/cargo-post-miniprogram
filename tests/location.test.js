/**
 * LocationService 单元测试（Node 直跑，mock 全局 wx + weather）
 *
 * 运行：node miniprogram/tests/location.test.js
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
    assert.strictEqual(first.source, 'wechat')
    assert.strictEqual(first.district, '大足区')
    const second = await location.getCurrentLocation()
    assert.strictEqual(second.source, 'cache')        // TTL 内命中缓存
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
    storage['userLocation'] = { success: true, latitude: 30.0, longitude: 104.0, accuracy: 30, district: '旧区', timestamp: Date.now() - 6 * 60 * 1000, source: 'wechat' }
    const loc = await location.getCurrentLocation()
    assert.strictEqual(loc.latitude, 30.5723) // 重新定位的新值
    assert.strictEqual(loc.source, 'wechat')
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
    assert.strictEqual(loc.source, 'cache')
    console.log('✓ 12 缓存命中秒出（source=cache）')
  }

  // 13: 定位失败但有旧缓存 → stale-cache 兜底
  {
    reset()
    storage['userLocation'] = { success: true, latitude: 30.0, longitude: 104.0, accuracy: 30, district: '旧区', timestamp: Date.now() - 6 * 60 * 1000, source: 'wechat' }
    getLocationMode = 'fail-other'
    const loc = await location.getCurrentLocation()
    assert.strictEqual(loc.success, true)
    assert.strictEqual(loc.stale, true)
    assert.strictEqual(loc.source, 'stale-cache')
    assert.strictEqual(loc.latitude, 30.0)
    console.log('✓ 13 定位失败旧缓存兜底 → stale-cache')
  }

  // 14: DEMO 青山镇 → source=demo + 坐标正确（用仓库已有站点坐标）
  {
    reset()
    location.setDemoLocation('青山镇')
    const loc = await location.getCurrentLocation()
    assert.strictEqual(loc.source, 'demo')
    assert.strictEqual(loc.latitude, 30.6234)   // ST004 青山镇站
    assert.strictEqual(loc.longitude, 104.2345)
    assert.strictEqual(loc.level, 'PRECISE')
    assert.strictEqual(loc.district, '青山镇')
    location.clearDemoLocation()
    console.log('✓ 14 DEMO 青山镇 → source=demo + 坐标正确')
  }

  // 15: DEMO → 真实（clearDemoLocation 后回到微信 GPS）
  {
    reset()
    location.setDemoLocation('青山镇')
    await location.getCurrentLocation() // demo
    location.clearDemoLocation()
    const loc = await location.getCurrentLocation() // 微信真实
    assert.strictEqual(loc.source, 'wechat')
    assert.strictEqual(loc.latitude, 30.5723) // mock 真实坐标
    assert.strictEqual(loc.longitude, 104.0657)
    console.log('✓ 15 DEMO→真实 → source=wechat')
  }

  // 16: setDemoLocation 不存在 → null；DEMO 并发去重（同一实例）
  {
    reset()
    assert.strictEqual(location.setDemoLocation('不存在的村'), null)
    location.setDemoLocation('县城客运中心')
    const p1 = location.getCurrentLocation()
    const p2 = location.getCurrentLocation()
    const [a, b] = await Promise.all([p1, p2])
    assert.strictEqual(a.source, 'demo')
    assert.strictEqual(a.latitude, 30.5723) // 县城客运中心 ST001
    assert.strictEqual(a, b) // 同一 demo 实例，无并发
    location.clearDemoLocation()
    console.log('✓ 16 演示名不存在返回 null；DEMO 并发去重')
  }

  console.log('\n全部通过 ✅')
}

main().catch((e) => {
  console.error('测试失败:', e)
  process.exit(1)
})
