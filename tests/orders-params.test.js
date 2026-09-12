/**
 * 商城订单页参数测试（Node 直跑）
 *
 * 运行：node miniprogram/tests/orders-params.test.js
 * 覆盖（对应线上报错回归）：
 *   - 首次打开「全部」不带 status 参数（原 bug：status=undefined → 后端 Integer 绑定失败）
 *   - 待发货 status=0 / 已发货 1 / 已完成 2 / 已取消 3（数字，且 0 不被当空值过滤）
 *   - dataset 回传字符串（'1'）时归一为数字
 *   - 切回「全部」再次不带 status
 */
const assert = require('assert')

const calls = []

global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  setNavigationBarColor: () => {},
  showToast: () => {},
  stopPullDownRefresh: () => {}
}
global.getApp = () => ({ globalData: {} })

// 同一个 api 模块实例：页面内部 require 的也是它
const api = require('../utils/api')
api.pageMyProductOrders = async (params) => {
  calls.push(params)
  return { list: [], total: 0 }
}

let pageConfig = null
global.Page = (config) => { pageConfig = config }
require('../pages/orders/orders.js')

const page = Object.assign({}, pageConfig)
page.data = JSON.parse(JSON.stringify(pageConfig.data))
page.setData = function (patch, cb) {
  Object.assign(this.data, patch)
  if (typeof cb === 'function') cb()
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const last = () => calls[calls.length - 1]

;(async () => {
  // 1. 首次进入（onShow → reload → loadOrders）：不带 status
  page.onShow()
  await tick()
  assert.strictEqual(calls.length, 1)
  assert.deepStrictEqual(calls[0], { pageNo: 1, pageSize: 10 })
  assert.ok(!Object.prototype.hasOwnProperty.call(calls[0], 'status'), '首次打开不应带 status')

  // 2. 各状态 tab：status 必须是数字 0/1/2/3（dataset 数字）
  for (const key of [0, 1, 2, 3]) {
    page.switchTab({ currentTarget: { dataset: { key } } })
    await tick()
    assert.strictEqual(last().status, key, `status 应为数字 ${key}`)
    assert.strictEqual(typeof last().status, 'number')
  }

  // 3. dataset 回传字符串时归一为数字（微信部分基础库行为）
  page.switchTab({ currentTarget: { dataset: { key: '2' } } })
  await tick()
  assert.strictEqual(last().status, 2)
  assert.strictEqual(typeof last().status, 'number')

  // 4. 切回「全部」：再次不带 status
  page.switchTab({ currentTarget: { dataset: { key: '' } } })
  await tick()
  assert.ok(!Object.prototype.hasOwnProperty.call(last(), 'status'), '切回全部不应带 status')

  // 5. 分页追加：仍不夹带 status
  page.switchTab({ currentTarget: { dataset: { key: 0 } } })
  await tick()
  page.data.hasMore = true
  page.setData({ pageNo: 2 })
  await page.loadOrders()
  assert.deepStrictEqual(last(), { pageNo: 2, pageSize: 10, status: 0 })

  console.log('orders-params.test.js 全部通过')
})()
