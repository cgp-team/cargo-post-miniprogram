/**
 * 商品图片解析测试（Node 直跑）
 *
 * 回归背景：后台换了商品图片（上传后 image_url 是 /admin-api/infra/file/... 这类相对地址）时，
 * 小程序里还显示旧图/占位图 —— 因为解析器只认 http(s)/images，认不出后台上传的相对地址，
 * 于是退化成"按商品名猜本地图"。这里把两种地址都钉住。
 */
const assert = require('assert')
const productImg = require('../utils/product-img')

// 1) 后台上传的绝对地址：原样使用
assert.strictEqual(
  productImg.resolve({ name: '高山脆李', image: '🍑', imageUrl: 'http://1.15.29.107/admin-api/infra/file/4/get/a.jpg' }),
  'http://1.15.29.107/admin-api/infra/file/4/get/a.jpg'
)

// 2) 后台上传的相对地址（文件配置未填域名时）：也要原样使用，不能退化成"按名字猜图"
assert.strictEqual(
  productImg.resolve({ name: '重庆老火锅底料（牛油）', image: '', imageUrl: '/admin-api/infra/file/4/get/hotpot.jpg' }),
  '/admin-api/infra/file/4/get/hotpot.jpg'
)

// 3) 协议相对地址
assert.strictEqual(
  productImg.resolve({ name: '任意', image: '', imageUrl: '//cdn.example.com/a.jpg' }),
  '//cdn.example.com/a.jpg'
)

// 4) image 字段是图片地址（历史数据把 URL 存在 emoji 列）
assert.strictEqual(
  productImg.resolve({ name: '任意', image: '/images/products/xiaomian.jpg' }),
  '/images/products/xiaomian.jpg'
)

// 5) 都没配 → 按商品名回落本地图（演示数据）
assert.strictEqual(productImg.resolve({ name: '重庆老火锅底料（牛油）', image: '' }), '/images/products/hotpot-base.jpg')
assert.strictEqual(productImg.resolve({ name: '合川桃片（核桃味）', image: '' }), '/images/products/taopian.jpg')

// 6) 完全匹配不上 → 空串（调用方显示占位图）
assert.strictEqual(productImg.resolve({ name: '不可识别商品', image: '' }), '')
assert.strictEqual(productImg.resolve(null), '')

console.log('product-img.test.js 全部通过')
