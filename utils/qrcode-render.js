/**
 * 二维码渲染工具 — 在 canvas 2d 上绘制订单二维码
 *
 * 用法：
 *   1. wxml 放 <canvas type="2d" id="qrCanvas" class="qr-canvas"></canvas>
 *   2. js 里：
 *      const qrcodeRender = require('../../utils/qrcode-render')
 *      const query = wx.createSelectorQuery().in(this)
 *      query.select('#qrCanvas').fields({ node: true, size: true }).exec(res => {
 *        if (!res[0] || !res[0].node) return
 *        qrcodeRender.draw(res[0].node, '订单号', res[0].width)
 *      })
 *   3. 颜色可传主题墨色(--color-ink)保持一致观感，默认 #2B2B28
 */
const qrcode = require('./qrcode.js')

/**
 * 绘制二维码
 * @param {Object} canvas canvas 2d 节点
 * @param {string} text 编码内容（订单号等）
 * @param {number} sizePx CSS 尺寸（像素）
 * @param {string} darkColor 深色模块颜色，默认墨字 #2B2B28
 */
function draw(canvas, text, sizePx, darkColor) {
  if (!canvas || !text) return
  const qr = qrcode(0, 'M') // typeNumber 0=自动、纠错 M
  qr.addData(String(text))
  qr.make()

  const dpr = (wx.getWindowInfo().pixelRatio) || 2
  canvas.width = sizePx * dpr
  canvas.height = sizePx * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  // 白底
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sizePx, sizePx)

  // 深色模块（四周各留 4 模块 quiet zone，QR 标准要求）
  const count = qr.getModuleCount()
  const cell = sizePx / (count + 8)
  const offset = 4 * cell
  ctx.fillStyle = darkColor || '#2B2B28'
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell)
      }
    }
  }
}

module.exports = { draw }
