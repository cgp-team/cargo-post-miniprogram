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
 * 身份证号验证
 */
function validateIdCard(idCard) {
  return /^[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.test(idCard)
}

/**
 * 密码强度验证 (6-20位字母或数字)
 */
function validatePassword(password) {
  return /^[a-zA-Z0-9]{6,20}$/.test(password)
}

/**
 * 车牌号验证
 */
function validatePlateNumber(plate) {
  return /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁][A-HJ-NP-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警]$/.test(plate)
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
 * 对话时间（月/日 时:分，面对面翻译页用）
 */
function recordTime(date) {
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  return `${[month, day].map(formatNumber).join('/')} ${[hour, minute].map(formatNumber).join(':')}`
}

/**
 * 村庄列表（首页/商城/快递页切换村庄入口共用，改动一处全局生效）
 */
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

module.exports = {
  validatePhone,
  validateIdCard,
  validatePassword,
  validatePlateNumber,
  formatTime,
  formatBackendTime,
  recordTime,
  VILLAGES
}
