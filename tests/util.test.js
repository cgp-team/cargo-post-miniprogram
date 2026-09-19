/**
 * util 单元测试（Node 直跑）
 *
 * 运行：node tests/util.test.js
 * 覆盖：寄货「长×宽×高(cm) → 体积(m³)」换算（正数/零/负数/非法/精度）。
 */
const assert = require('assert')
const { cmSizeToM3, validatePhone, haversineKm, navThrottled } = require('../utils/util')

// 50cm × 40cm × 30cm = 0.06 m³
assert.strictEqual(cmSizeToM3(50, 40, 30), 0.06)
// 100cm 立方 = 1 m³
assert.strictEqual(cmSizeToM3(100, 100, 100), 1)
// 小数厘米：33.5 × 20 × 15 = 0.01005 → 保留 4 位小数
assert.strictEqual(cmSizeToM3(33.5, 20, 15), 0.0101)
// 任一维缺失/为零/负数/非法 → 0（不猜体积）
assert.strictEqual(cmSizeToM3('', 40, 30), 0)
assert.strictEqual(cmSizeToM3(50, 0, 30), 0)
assert.strictEqual(cmSizeToM3(-50, 40, 30), 0)
assert.strictEqual(cmSizeToM3('abc', 40, 30), 0)
// 手机号校验（寄货/下单共用）
assert.strictEqual(validatePhone('13800138000'), true)
assert.strictEqual(validatePhone('12800138000'), false)
// Haversine：同点为 0；1 度纬度约 111.19km；与后端 GeoDistanceUtil 同口径
assert.strictEqual(haversineKm(30.6, 104.1, 30.6, 104.1), 0)
assert.ok(Math.abs(haversineKm(30.0, 104.0, 31.0, 104.0) - 111.19) < 0.5)
assert.strictEqual(haversineKm(30.6, 104.1, 30.7, 104.2), haversineKm(30.7, 104.2, 30.6, 104.1))

// 跳转防连点：首次放行，gap 内连点拦截，超过 gap 再次放行；不同页面实例互不干扰
const pageA = {}
assert.strictEqual(navThrottled(pageA), false)
assert.strictEqual(navThrottled(pageA), true)
const pageB = {}
assert.strictEqual(navThrottled(pageB), false)

console.log('util.test.js 全部通过')
