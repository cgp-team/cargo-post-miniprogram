/**
 * buildNavPoints 单元测试（Node 直跑）
 *
 * 运行：node miniprogram/tests/nav.test.js
 * 覆盖：去重/数量聚合/计单数退化/顺序/纯经停/planId 过滤/route 为空。
 */
const assert = require('assert')
const { buildNavPoints } = require('../utils/nav')

// 同站多动作 + 重复 stop 的 route
const route = {
  planId: 100,
  stops: [
    { stationId: 1, stationName: '场站', longitude: 104.0, latitude: 30.0, visitSequence: 1, actionName: '出发', status: 7, statusName: '已完成' },
    { stationId: 2, stationName: '红花村', longitude: 104.1, latitude: 30.1, visitSequence: 2, actionName: '揽收', status: 0, statusName: '待执行' },
    { stationId: 3, stationName: '绿水村', longitude: 104.2, latitude: 30.2, visitSequence: 3, actionName: '派送', status: 0, statusName: '待执行' }
  ]
}

const tasks = [
  { planId: 100, visitSequence: 2, stationId: 2, stationName: '红花村', actionType: 4, actionName: '揽收', orderId: 10, orderNo: 'C001', quantity: 2, status: 0, statusName: '待执行' },
  { planId: 100, visitSequence: 2, stationId: 2, stationName: '红花村', actionType: 4, actionName: '揽收', orderId: 11, orderNo: 'C002', quantity: null, status: 0, statusName: '待执行' },
  { planId: 100, visitSequence: 3, stationId: 3, stationName: '绿水村', actionType: 3, actionName: '派送', orderId: 12, orderNo: 'C003', quantity: 1, status: 0, statusName: '待执行' },
  // 其它方案的明细应被 planId 过滤掉
  { planId: 200, visitSequence: 1, stationId: 99, stationName: '别方案', actionType: 4, actionName: '揽收', orderId: 13, orderNo: 'X', quantity: 5, status: 0 }
]

function test_dedupe_and_order() {
  const pts = buildNavPoints(route, tasks)
  assert.strictEqual(pts.length, 3, '应 3 个站点（去重后）')
  assert.deepStrictEqual(pts.map((p) => p.stationId), [1, 2, 3], '应按 visitSequence 升序')
  assert.strictEqual(pts[0].index, 0)
  assert.strictEqual(pts[2].index, 2)
}

function test_quantity_aggregation_and_fallback() {
  const pts = buildNavPoints(route, tasks)
  const red = pts[1] // 红花村
  // 明细：quantity=2 + quantity=null（退化计 1）= 3 件取货
  assert.strictEqual(red.pickupCount, 3, '红花村取货 2+1(计单数)=3')
  assert.strictEqual(red.deliverCount, 0)
  assert.strictEqual(red.actionTotal, 3)
  assert.strictEqual(red.orders.length, 2)

  const green = pts[2] // 绿水村
  assert.strictEqual(green.deliverCount, 1, '绿水村派货 1')
  assert.strictEqual(green.pickupCount, 0)
}

function test_pure_pass_station() {
  const pts = buildNavPoints(route, [])
  // 无 tasks 明细时，所有站 actionTotal=0（纯经停）
  assert.strictEqual(pts[1].actionTotal, 0)
  assert.strictEqual(pts[1].orders.length, 0)
}

function test_route_empty() {
  assert.deepStrictEqual(buildNavPoints(null, tasks), [])
  assert.deepStrictEqual(buildNavPoints({ stops: [] }, tasks), [])
}

function test_mixed_actions_same_station() {
  const mixedTasks = [
    { planId: 100, stationId: 2, actionType: 4, quantity: 2, orderId: 1 }, // 取货2
    { planId: 100, stationId: 2, actionType: 3, quantity: 1, orderId: 2 }, // 派货1
    { planId: 100, stationId: 2, actionType: 1, quantity: 1, orderId: 3 } // 接客1
  ]
  const pts = buildNavPoints(route, mixedTasks)
  const red = pts[1]
  assert.strictEqual(red.pickupCount, 2)
  assert.strictEqual(red.deliverCount, 1)
  assert.strictEqual(red.boardCount, 1)
  assert.deepStrictEqual(red.actionTypes.sort(), [1, 3, 4])
}

// 返场经停：计划首尾同站（出发/返回）去重后必须把"返场"补回队尾，
// 否则司机端没有返场确认入口，班次执行不结束、用户端"司机已到达交付点"不触发
function test_return_stop_appended() {
  const depotRoute = {
    planId: 100,
    stops: [
      { stationId: 1, stationName: '黄桷垭站', longitude: 106.57, latitude: 29.53, visitSequence: 1, actionName: '出发', status: 0, statusName: '待执行' },
      { stationId: 2, stationName: '重邮站', longitude: 106.58, latitude: 29.53, visitSequence: 2, actionName: '揽收', status: 0, statusName: '待执行' },
      { stationId: 1, stationName: '黄桷垭站', longitude: 106.57, latitude: 29.53, visitSequence: 3, actionName: '返回', status: 0, statusName: '待执行' }
    ]
  }
  const pts = buildNavPoints(depotRoute, [])
  assert.strictEqual(pts.length, 3, '出发场站去重后应把返场站补回队尾')
  assert.deepStrictEqual(pts.map((p) => p.stationId), [1, 2, 1])
  assert.strictEqual(pts[0].isReturn, undefined)
  assert.strictEqual(pts[2].isReturn, true)
  assert.strictEqual(pts[2].actionTotal, 0)
}

test_dedupe_and_order()
test_quantity_aggregation_and_fallback()
test_pure_pass_station()
test_route_empty()
test_mixed_actions_same_station()
test_return_stop_appended()

console.log('nav.test.js 全部通过')
