/**
 * 工具函数
 */

/**
 * 手机号验证
 */
function validatePhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone)
}

/**
 * 长×宽×高（厘米）→ 体积（立方米），保留 4 位小数（与后端 decimal(12,4) 对齐）。
 * 任一维非正数/非法 → 返回 0（不猜体积）。
 */
function cmSizeToM3(length, width, height) {
  const l = Number(length)
  const w = Number(width)
  const h = Number(height)
  if (!(l > 0 && w > 0 && h > 0)) return 0
  return Math.round((l / 100) * (w / 100) * (h / 100) * 10000) / 10000
}

/**
 * Haversine 大圆距离（公里）：经纬度均为度，坐标系必须一致（项目统一 GCJ-02）。
 * 与后端 GeoDistanceUtil.haversineKm 同口径，保证前后端距离一致。
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180
  const R = 6371.0
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * 格式化时间
 */
function formatTime(date) {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  const second = date.getSeconds()

  return `${[year, month, day].map(formatNumber).join('-')} ${[hour, minute, second].map(formatNumber).join(':')}`
}

function formatNumber(n) {
  n = n.toString()
  return n[1] ? n : `0${n}`
}

/**
 * 页面跳转防连点：gap 毫秒内重复触发视为连点，返回 true 让调用方直接 return。
 * 快速双击 navigateTo 会叠两层相同页面；用时间戳而非 setTimeout，
 * 页面销毁后无残留回调，不需要 onUnload 清理。
 * 用法：if (navThrottled(this)) return
 */
function navThrottled(page, gap) {
  const now = Date.now()
  const g = gap || 400
  if (page._navAt && now - page._navAt < g) return true
  page._navAt = now
  return false
}

// 运营片区村庄清单（暂无后端接口，运营区域确定后更新，后续应后端化）
// 首页/商城/快递页切换村庄入口共用，改动一处全局生效
const VILLAGES = ['云山村', '大湾村', '青山镇', '竹林乡', '溪口村', '双河镇']

/**
 * 后端时间格式化：LocalDateTime 全局序列化为毫秒时间戳，兼容字符串回退。
 * 输出：YYYY-MM-DD HH:mm
 */
function formatBackendTime(t) {
  if (!t) return ''
  if (typeof t === 'number') {
    const d = new Date(t)
    const p = (n) => (n < 10 ? '0' + n : '' + n)
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  return String(t).replace('T', ' ').substring(0, 16)
}

/**
 * 同步自定义 tabBar 选中态（tab 页 onShow 时调用，index 为当前页 tab 序号）。
 * 组件侧 pageLifetimes.show 按路由反查，在切换动画期间可能读到旧路由把选中态打回；
 * 由各页面按自身序号权威上报，彻底避免选中态跳回。
 */
function syncTabBar(page, index) {
  const bar = page.getTabBar && page.getTabBar()
  if (bar && bar.data.selected !== index) bar.setData({ selected: index })
}

module.exports = {
  validatePhone,
  cmSizeToM3,
  haversineKm,
  formatTime,
  formatBackendTime,
  navThrottled,
  syncTabBar,
  VILLAGES
}
