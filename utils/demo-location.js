/**
 * 演示定位（DEMO 模式）：开发/测试环境用预设站点坐标替代真实 GPS，便于验证"附近公交"。
 *
 * 坐标**必须来自仓库已有站点数据**（sql/mysql/transport-demo-data.sql 的 transport_station），
 * 禁止编造。当前取演示线路覆盖的场站/乡镇：
 *   - ST001 县城客运中心  (104.0657, 30.5723)
 *   - ST004 青山镇站      (104.2345, 30.6234)
 *   - ST007 龙泉镇站      (104.3123, 30.6890)
 *
 * 生产安全：仅开发/测试环境展示演示入口（index.js 按 envVersion 判断）；生产不暴露，
 * 普通用户不能随意改变真实位置。
 */

const DEMO_LOCATIONS = [
  { name: '县城客运中心', latitude: 30.5723, longitude: 104.0657, district: '县城客运中心' },
  { name: '青山镇', latitude: 30.6234, longitude: 104.2345, district: '青山镇' },
  { name: '龙泉镇', latitude: 30.6890, longitude: 104.3123, district: '龙泉镇' }
]

/** 按演示名查找；不存在返回 null */
function findDemo(name) {
  return DEMO_LOCATIONS.find((d) => d.name === name) || null
}

/** 当前环境是否允许演示定位（release 正式版隐藏） */
function isDemoAllowed() {
  try {
    const info = wx.getAccountInfoSync()
    return info.miniProgram.envVersion !== 'release'
  } catch (e) {
    return true // 无法获取环境时按开发处理
  }
}

module.exports = { DEMO_LOCATIONS, findDemo, isDemoAllowed }
