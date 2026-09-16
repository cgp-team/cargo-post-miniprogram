/**
 * 请求参数清理单元测试（Node 直跑）
 *
 * 运行：node tests/api-params.test.js
 * 覆盖：cleanParams 过滤规则（undefined/null/'' 过滤，0/false 保留）；request() 实际发出的 data 已清理。
 *
 * 背景：wx.request 会把 undefined 序列化成字符串 "undefined"（GET 拼 query、POST 拼 body），
 * 后端 Integer/Long/Double 绑定失败 —— 线上订单页 `status=undefined` 就是这样炸的。
 */
const assert = require('assert')

// api.js 顶层会读 wx（config.getBaseUrl 内部 try/catch 兜底）；这里给最小桩并记录请求
global.wx = {
  getStorageSync: () => '',
  request: (opts) => {
    global.__lastRequest = opts
    opts.success({ statusCode: 200, data: { code: 0, msg: '', data: { ok: true } } })
  }
}

const api = require('../utils/api')

// 1. 过滤 undefined / null / ''，保留 0 / false / 非空字符串（0 是合法业务值，如待发货 status=0）
assert.deepStrictEqual(
  api.cleanParams({ pageNo: 1, pageSize: 10, status: undefined, empty: '', nil: null, zero: 0, flag: false, text: 'x' }),
  { pageNo: 1, pageSize: 10, zero: 0, flag: false, text: 'x' }
)

// 2. 非对象入参原样返回（不抛错）
assert.strictEqual(api.cleanParams(undefined), undefined)
assert.strictEqual(api.cleanParams(null), null)
assert.deepStrictEqual(api.cleanParams([1, 2]), [1, 2])

;(async () => {
  // 3. GET 全部订单：data 里不得出现 status（更不得出现字符串 "undefined"）
  await api.request('/app-api/transport/product-order/page', 'GET', { pageNo: 1, pageSize: 10, status: undefined })
  assert.deepStrictEqual(global.__lastRequest.data, { pageNo: 1, pageSize: 10 })
  assert.ok(!Object.prototype.hasOwnProperty.call(global.__lastRequest.data, 'status'), 'status 不应出现在参数里')

  // 4. status=0（待发货）必须保留
  await api.request('/app-api/transport/product-order/page', 'GET', { pageNo: 1, pageSize: 10, status: 0 })
  assert.strictEqual(global.__lastRequest.data.status, 0)

  // 5. POST body 同样清理：空字符串/undefined 不进 body
  await api.request('/app-api/transport/product-order/create', 'POST', { productId: 1, remark: '', note: undefined })
  assert.deepStrictEqual(global.__lastRequest.data, { productId: 1 })

  // 6. 附近公交：无定位/无区域时不得带 undefined（历史 400：Method parameter 'latitude' ... "undefined"）
  await api.getNearbyRealtimeBuses(undefined, undefined, undefined, '青山镇')
  assert.deepStrictEqual(global.__lastRequest.data, { district: '青山镇' })
  assert.strictEqual(global.__lastRequest.url.indexOf('undefined'), -1, 'URL 不应出现 undefined')

  // 7. 附近公交：有坐标时只带坐标（radius 未指定则交给后端默认 5000）
  await api.getNearbyRealtimeBuses(30.5723, 104.0657)
  assert.deepStrictEqual(global.__lastRequest.data, { latitude: 30.5723, longitude: 104.0657 })

  console.log('api-params.test.js 全部通过')
})()
