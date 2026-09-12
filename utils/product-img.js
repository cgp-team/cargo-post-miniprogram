/**
 * 商品图片助手
 *
 * 后端/演示数据里的 image 字段历史上是 emoji 字符。
 * 这里统一把商品映射到本地实拍图：
 *   - 重庆特产：miniprogram/images/products/*.jpg（高清实拍，随包发布，不依赖外网）
 *   - 农产品：miniprogram/images/product-*.png
 * 已经是图片路径/URL 的原样返回；都不匹配返回 ''（调用方显示占位图）。
 *
 * 用法：const productImg = require('../../utils/product-img')
 *       imageUrl: productImg.resolve(p)
 */

const LOCAL_MAP = [
  // ===== 重庆特产（真实照片，随小程序包发布）=====
  [/火锅|底料|牛油/, '/images/products/hotpot-base.jpg'],
  [/小面|麻辣面|豌杂/, '/images/products/xiaomian.jpg'],
  [/榨菜/, '/images/products/zhacai.jpg'],
  [/桃片/, '/images/products/taopian.jpg'],
  [/米花糖/, '/images/products/mihuatang.jpg'],
  [/腊肉|香肠|烟熏肉/, '/images/products/larou.jpg'],
  // ===== 农产品 =====
  [/茶/, '/images/product-tea.png'],
  [/蛋/, '/images/product-egg.png'],
  [/面|粉|粉丝/, '/images/product-noodle.png'],
  [/核桃|坚果|花生|栗/, '/images/product-nut.png']
]

/** 返回可直接用于 <image src> 的路径或 URL，无匹配返回 '' */
function resolve(product) {
  if (!product) return ''
  // 后台上传的图片优先（商品图以后台配置为准，不再靠商品名猜）
  const url = product.imageUrl
  // 注意：后台上传返回的地址可能是绝对地址（http(s)://域名/admin-api/infra/file/...），
  // 也可能是相对地址（/admin-api/infra/file/...）——两种都要认，否则会被下面的"按名字猜本地图"覆盖，
  // 表现就是"后台换了商品图片，小程序里还是旧图/占位图"。
  if (typeof url === 'string'
    && /^(https?:\/\/|\/\/|\/images\/|\/uploads\/|\/app-api\/|\/admin-api\/|\/infra\/)/.test(url.trim())) {
    return url.trim()
  }
  const img = product.image
  if (typeof img === 'string'
    && (/^https?:\/\//.test(img) || /^\/\//.test(img) || /^\/images\//.test(img) || /^\/admin-api\//.test(img))) {
    return img
  }
  const text = String(product.name || '') + String(img || '')
  for (const [re, path] of LOCAL_MAP) {
    if (re.test(text)) return path
  }
  return ''
}

module.exports = { resolve }
