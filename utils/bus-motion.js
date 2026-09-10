/**
 * 车辆移动动画层（统一循环，避免每辆车各起定时器）
 *
 * 背景：15 秒一次 API 刷新时，车辆坐标是"跳变"的；直接 setData 会瞬移，没有"在跑"的感觉。
 * 做法：刷新只更新目标坐标；动画层在 1.2 秒内把 marker 从旧坐标插值到新坐标（约 12 帧）。
 *
 * 设计要点：
 * - **单一定时器**：所有车辆共用一次 tick，避免几十个 timer 与 setData 风暴（需求 23）；
 * - **纯函数可测**：lerp / bearing / 插值帧，便于单测；
 * - **朝向**：按 bearing 选左/右朝向图标（微信 marker 旋转不稳定时的兜底），也可用于 callout 文案；
 * - 动画只改 markers，不动机 map 中心、polyline、列表结构（需求 16）。
 */

/** 单次动画时长（毫秒） */
const MOVE_DURATION_MS = 1200
/** tick 间隔（毫秒）：100ms ≈ 12 帧，兼顾平滑与性能 */
const TICK_MS = 100

/** 线性插值 */
function lerp(from, to, t) {
  return from + (to - from) * t
}

/** 两点朝向角（度，0=正北，顺时针）：用于选左/右朝向图标 */
function bearing(from, to) {
  if (!from || !to) return 0
  const toRad = (d) => (d * Math.PI) / 180
  const toDeg = (r) => (r * 180) / Math.PI
  const y = Math.sin(toRad(to.longitude - from.longitude)) * Math.cos(toRad(to.latitude))
  const x = Math.cos(toRad(from.latitude)) * Math.sin(toRad(to.latitude))
    - Math.sin(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.cos(toRad(to.longitude - from.longitude))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** 是否向东行驶（bearing 45~135 度）：决定用 marker-bus-right 还是 -left */
function headingRight(from, to) {
  const b = bearing(from, to)
  return b > 45 && b < 135
}

/** 单点插值：t∈[0,1] */
function interpolatePosition(from, to, t) {
  const k = Math.max(0, Math.min(1, t))
  return {
    latitude: lerp(from.latitude, to.latitude, k),
    longitude: lerp(from.longitude, to.longitude, k)
  }
}

/**
 * 创建动画管理器。
 * @param {(markers: Array) => void} onFrame 每帧回调（只传 markers，避免整页 setData）
 * @param {() => Array} collectMarkers 由调用方提供"当前应显示的 markers"（含 id/位置/图标）
 * @param {{durationMs?: number, tickMs?: number}} [options]
 */
function createAnimator(onFrame, collectMarkers, options) {
  const duration = (options && options.durationMs) || MOVE_DURATION_MS
  const tick = (options && options.tickMs) || TICK_MS
  let timer = null
  let items = [] // [{ id, from:{lat,lng}, to:{lat,lng}, startedAt }]
  let running = false

  function stopTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  /** 设定新的目标位置：仅对"位置发生变化"的车辆启动动画 */
  function setTargets(targets) {
    const now = Date.now()
    items = (targets || []).map((t) => {
      const from = t.from && t.from.latitude != null ? t.from : t.current
      return {
        id: t.id,
        from: from || { latitude: t.to.latitude, longitude: t.to.longitude },
        to: { latitude: t.to.latitude, longitude: t.to.longitude },
        startedAt: now,
        meta: t.meta || {}
      }
    })
    if (!items.length) {
      stopTimer()
      return
    }
    if (!timer && !running) {
      running = true
      timer = setInterval(tickOnce, tick)
    }
    tickOnce() // 立即出一帧，避免首帧等待
  }

  /** 计算当前帧（纯计算，便于单测/调试） */
  function frameAt(now) {
    const progressed = items.map((item) => {
      const ratio = duration > 0 ? Math.min(1, (now - item.startedAt) / duration) : 1
      const pos = interpolatePosition(item.from, item.to, ratio)
      return {
        id: item.id,
        latitude: pos.latitude,
        longitude: pos.longitude,
        done: ratio >= 1,
        headingRight: headingRight(item.from, item.to),
        meta: item.meta
      }
    })
    return progressed
  }

  function tickOnce() {
    const now = Date.now()
    const progressed = frameAt(now)
    const allDone = progressed.every((p) => p.done)
    if (allDone) {
      stopTimer()
      running = false
    }
    if (typeof onFrame === 'function') {
      onFrame(progressed, { done: allDone, markers: typeof collectMarkers === 'function' ? collectMarkers() : [] })
    }
  }

  /** 停止动画并清理定时器（页面 onHide/onUnload 必须调用，防定时器泄漏） */
  function destroy() {
    stopTimer()
    running = false
    items = []
  }

  return { setTargets, destroy, frameAt, isRunning: () => !!timer }
}

module.exports = {
  MOVE_DURATION_MS,
  TICK_MS,
  lerp,
  bearing,
  headingRight,
  interpolatePosition,
  createAnimator
}
