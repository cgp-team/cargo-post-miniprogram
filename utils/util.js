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
 * 密码强度验证 (6-20位字母数字)
 */
function validatePassword(password) {
  return password.length >= 6 && password.length <= 20
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

module.exports = {
  validatePhone,
  validateIdCard,
  validatePassword,
  validatePlateNumber,
  formatTime
}
