/**
 * 触感反馈工具：主操作成功时给轻微震动，提升"点下去有响应"的感知。
 * 不支持震动的低版本/环境静默降级，不影响功能。
 */
function tap() {
  try {
    wx.vibrateShort({ type: 'light' })
  } catch (e) {
    // 静默降级
  }
}

module.exports = { tap }
