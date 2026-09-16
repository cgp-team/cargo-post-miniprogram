/**
 * 车辆移动动画层单测（Node 直跑）
 *
 * 运行：node tests/bus-motion.test.js
 * 覆盖：插值（不跳跃、端点精确）、朝向（左/右）、统一动画循环（单定时器、结束自停、destroy 清理）。
 */
const assert = require('assert')
const motion = require('../utils/bus-motion')

// 1. 线性插值：端点精确、中点居中
assert.strictEqual(motion.lerp(0, 10, 0), 0)
assert.strictEqual(motion.lerp(0, 10, 1), 10)
assert.strictEqual(motion.lerp(0, 10, 0.5), 5)

// 2. 位置插值：t=0/1 精确落在起终点，中间点单调（不跳跃）
const from = { latitude: 30.0, longitude: 104.0 }
const to = { latitude: 30.1, longitude: 104.2 }
assert.deepStrictEqual(motion.interpolatePosition(from, to, 0), { latitude: 30.0, longitude: 104.0 })
assert.deepStrictEqual(motion.interpolatePosition(from, to, 1), { latitude: 30.1, longitude: 104.2 })
const mid = motion.interpolatePosition(from, to, 0.5)
assert.ok(mid.latitude > from.latitude && mid.latitude < to.latitude)
assert.ok(mid.longitude > from.longitude && mid.longitude < to.longitude)
// 超出 [0,1] 自动截断（防刷新间隔抖动导致越界）
assert.deepStrictEqual(motion.interpolatePosition(from, to, 1.7), { latitude: 30.1, longitude: 104.2 })

// 3. 朝向：向东 → 右侧图标；向北 → 不判为右
assert.strictEqual(motion.headingRight({ latitude: 30.0, longitude: 104.0 }, { latitude: 30.0, longitude: 104.1 }), true)
assert.strictEqual(motion.headingRight({ latitude: 30.0, longitude: 104.0 }, { latitude: 30.1, longitude: 104.0 }), false)
assert.ok(Math.abs(motion.bearing({ latitude: 30.0, longitude: 104.0 }, { latitude: 30.1, longitude: 104.0 })) < 1)

// 4/5. 统一动画循环与定时器治理（异步，需 IIFE 包裹，避免 ESM 歧义）
;(async () => {
  {
    let frames = 0
    const animator = motion.createAnimator((progressed, ctx) => {
      frames += 1
      void ctx
    }, () => [{ id: 1 }], { durationMs: 60, tickMs: 20 })

    animator.setTargets([
      { id: 1, current: { latitude: 30.0, longitude: 104.0 }, to: { latitude: 30.01, longitude: 104.01 }, meta: { plate: '川A·B5201' } }
    ])
    assert.strictEqual(animator.isRunning(), true, '有移动目标时应运行')
    assert.ok(frames >= 1, 'setTargets 后应立即出一帧')

    await new Promise((r) => setTimeout(r, 200))
    assert.strictEqual(animator.isRunning(), false, '动画结束后必须自停（无定时器泄漏）')
    assert.ok(frames > 1, '应产生多帧平滑过渡')

    // 重新设定目标后再 destroy：定时器必须被清理
    animator.setTargets([{ id: 1, current: { latitude: 30.01, longitude: 104.01 }, to: { latitude: 30.02, longitude: 104.02 } }])
    assert.strictEqual(animator.isRunning(), true)
    animator.destroy()
    assert.strictEqual(animator.isRunning(), false, 'destroy 后不得残留定时器')
  }

  // 5. 无目标：不启动定时器
  {
    const animator = motion.createAnimator(() => {}, () => [])
    animator.setTargets([])
    assert.strictEqual(animator.isRunning(), false)
    animator.destroy()
  }

  console.log('bus-motion.test.js 全部通过')
})()
