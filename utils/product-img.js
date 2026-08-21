/**
 * 商品图片助手
 *
 * 后端/演示数据里的 image 字段历史上是 emoji 字符。
 * 这里统一把商品映射到本地实拍图（miniprogram/images/product-*.png），
 * 已经是图片路径/URL 的原样返回；都不匹配返回 ''（调用方显示占位图）。
 *
 * 用法：const productImg = require('../../utils/product-img')
 *       imageUrl: productImg.resolve(p)
 */

const LOCAL_MAP = [
  [/茶/, '/images/product-tea.png'],
  [/蛋/, '/images/product-egg.png'],
  [/面|粉|粉丝/, '/images/product-noodle.png'],
  [/核桃|坚果|花生|栗/, '/images/product-nut.png']
]

/** 返回可直接用于 <image src> 的路径或 URL，无匹配返回 '' */
function resolve(product) {
  if (!product) return ''
  const img = product.image
  if (typeof img === 'string' && (/^https?:\/\//.test(img) || /^\/images\//.test(img))) {
    return img
  }
  const text = String(product.name || '') + String(img || '')
  for (const [re, path] of LOCAL_MAP) {
    if (re.test(text)) return path
  }
  return ''
}

module.exports = { resolve }
