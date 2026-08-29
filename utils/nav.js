/**
 * 司机端「连续任务导航」数据构造（纯函数，可 Node 单测）。
 *
 * 把后端两份接口合并成导航途经点序列：
 *   - /driver/route 的 stops：每站坐标 + 算法顺序（visitSequence）+ 真实道路 polyline
 *   - /driver/tasks 的明细：每站动作类型（取货/派货/上下客）+ 数量 + 订单
 *
 * 动作类型语义（与后端 PlanItemActionEnum 一致）：
 *   0 出发 DEPART / 1 接客 BOARD / 2 送客 ALIGHT / 3 派送 DELIVER / 4 揽收 PICKUP / 5 返回 RETURN / 6 经停 PASS
 */

const ACTION = {
  DEPART: 0,
  BOARD: 1,
  ALIGHT: 2,
  DELIVER: 3,
  PICKUP: 4,
  RETURN: 5,
  PASS: 6
}

/**
 * 合并 route + tasks 得到导航途经点序列。
 *
 * @param {object|null} route  GET /driver/route 返回（{ planId, stops:[{stationId,stationName,longitude,latitude,visitSequence,actionName,status,statusName}], polyline, ... }）
 * @param {Array}        tasks GET /driver/tasks 返回（[{ planId, visitSequence, stationId, stationName, actionType, actionName, orderId, orderNo, quantity, status, statusName }]）
 * @returns {Array} navPoints：每站一个（同站多动作已聚合），按 visitSequence 升序
 */
function buildNavPoints(route, tasks) {
  if (!route || !route.stops || !route.stops.length) return []
  const planId = route.planId

  // ① route.stops → 每站首个坐标 + 顺序（同站相邻出现多次，取 visitSequence 最小的一次）
  const coordMap = {}
  ;(route.stops || []).forEach((s) => {
    if (s.stationId == null) return
    const k = String(s.stationId)
    if (!coordMap[k]) {
      coordMap[k] = { stationId: s.stationId, stationName: s.stationName, longitude: s.longitude, latitude: s.latitude, visitSequence: s.visitSequence, status: s.status, statusName: s.statusName }
    } else if (s.visitSequence != null && (coordMap[k].visitSequence == null || s.visitSequence < coordMap[k].visitSequence)) {
      coordMap[k].visitSequence = s.visitSequence
    }
  })

  // ② tasks → 按 stationId 聚合动作数量/订单明细（只取当前方案）
  const detailMap = {}
  ;(tasks || []).forEach((t) => {
    if (t.stationId == null) return
    if (planId != null && t.planId != null && String(t.planId) !== String(planId)) return
    const k = String(t.stationId)
    const d = detailMap[k] || (detailMap[k] = { pickupCount: 0, deliverCount: 0, boardCount: 0, alightCount: 0, orders: [] })
    // quantity>0 用件数/人数；为空退化计单数（每明细算 1）
    const qty = (t.quantity && t.quantity > 0) ? t.quantity : 1
    if (t.actionType === ACTION.PICKUP) d.pickupCount += qty
    else if (t.actionType === ACTION.DELIVER) d.deliverCount += qty
    else if (t.actionType === ACTION.BOARD) d.boardCount += qty
    else if (t.actionType === ACTION.ALIGHT) d.alightCount += qty
    d.orders.push({
      orderId: t.orderId, orderNo: t.orderNo, actionType: t.actionType,
      actionName: t.actionName, quantity: t.quantity, statusName: t.statusName
    })
  })

  // ③ 合并 + 排序 + 赋 index
  const navPoints = Object.keys(coordMap).map((stationId) => {
    const c = coordMap[stationId]
    const d = detailMap[stationId] || {}
    const pickupCount = d.pickupCount || 0
    const deliverCount = d.deliverCount || 0
    const boardCount = d.boardCount || 0
    const alightCount = d.alightCount || 0
    return {
      stationId: c.stationId,
      stationName: c.stationName,
      longitude: c.longitude,
      latitude: c.latitude,
      visitSequence: c.visitSequence,
      pickupCount,
      deliverCount,
      boardCount,
      alightCount,
      actionTotal: pickupCount + deliverCount + boardCount + alightCount,
      orders: d.orders || [],
      actionTypes: [...new Set((d.orders || []).map((o) => o.actionType))],
      status: c.status,
      statusName: c.statusName,
      reached: false
    }
  }).sort((a, b) => (a.visitSequence || 0) - (b.visitSequence || 0))

  navPoints.forEach((p, i) => { p.index = i })
  return navPoints
}

module.exports = { buildNavPoints, ACTION }
