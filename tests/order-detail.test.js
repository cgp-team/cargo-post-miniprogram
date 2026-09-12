/**
 * 商城订单详情页测试（Node 直跑）
 *
 * 回归背景：用户反馈"点订单看详情没实现"——本页负责把订单（商品清单/金额/收货信息/承运司机/配送进度）
 * 渲染出来。这里用桩数据钉住渲染口径，避免后续改动把详情页改空。
 */
const assert = require('assert')

let pageConfig = null
global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  setNavigationBarColor: () => {},
  showToast: () => {},
  navigateBack: () => {},
  navigateTo: () => {},
  previewImage: () => {},
  setClipboardData: () => {}
}
global.getApp = () => ({ globalData: {} })
global.Page = (config) => { pageConfig = config }

const api = require('../utils/api')
let tracedId = null
let traceResult = {
  orderId: 88,
  orderNo: 'TP20260913001',
  status: 1,
  statusName: '配送中',
  receiverName: '袁同学',
  receiverMobile: '13800000000',
  receiverAddress: '重庆邮电大学明志苑2舍',
  remark: '轻拿轻放',
  totalAmount: 52.0,
  createTime: '2026-09-13T09:10:00',
  vehiclePlate: '渝A·B5204',
  driverName: '346路司机A',
  driverMobile: '13800138006',
  deliverStationName: '小什字小商品',
  loadTime: '2026-09-13T09:40:00',
  routeName: '346路(悠山路--较场口)',
  shiftCode: 'SH-L346-01',
  items: [
    { productId: 8, productName: '重庆小面麻辣调料包', productImage: '', productPrice: 32.8, quantity: 1, amount: 32.8 },
    { productId: 10, productName: '合川桃片（核桃味）', productImage: '', productPrice: 19.2, quantity: 1, amount: 19.2 }
  ]
}
api.getProductOrderTrace = async (id) => { tracedId = id; return traceResult }

require('../pages/orders/detail/detail.js')
const page = Object.assign({}, pageConfig)
page.data = JSON.parse(JSON.stringify(pageConfig.data))
page.setData = function (patch, cb) {
  Object.assign(this.data, patch)
  if (typeof cb === 'function') cb()
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

;(async () => {
  // 1) 进入详情页（onLoad 记订单号，onShow 拉数据）→ 按订单号请求并渲染
  page.onLoad({ id: '88' })
  page.onShow()
  await tick()
  await tick()
  assert.strictEqual(tracedId, '88', '应按订单ID请求详情')
  assert.strictEqual(page.data.order.orderNo, 'TP20260913001')
  assert.strictEqual(page.data.statusText, '配送中')
  assert.strictEqual(page.data.totalText, '52.00')
  assert.strictEqual(page.data.items.length, 2, '应渲染商品清单')
  assert.strictEqual(page.data.items[0].amountText, '32.80')
  assert.ok(page.data.items[0].imageUrl, '商品图应有回落（本地图/上传图）')
  assert.strictEqual(page.data.steps.length, 5, '配送进度应有 5 步')
  assert.strictEqual(page.data.steps[0].done, true, '已下单应为完成态')
  assert.strictEqual(page.data.steps[2].done, true, '已装车应为完成态')
  assert.ok(page.data.arrivedText.indexOf('已装车') >= 0, '应显示"司机已装车"进度')

  // 2) 未发货订单：进度头要说明"商家还未发货"，而不是空白
  traceResult = {
    orderId: 99, orderNo: 'TP99', status: 0, statusName: '待发货',
    totalAmount: 9.9, items: []
  }
  await page.loadDetail()
  assert.ok(page.data.arrivedText.indexOf('还未发货') >= 0)
  assert.strictEqual(page.data.steps[1].done, false)

  console.log('order-detail.test.js 全部通过')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
