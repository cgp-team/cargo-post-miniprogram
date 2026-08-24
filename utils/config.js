/**
 * 环境配置 - 按微信小程序运行环境切换后端地址
 *
 * 运行环境（wx.getAccountInfoSync().miniProgram.envVersion）：
 *   develop  开发版（微信开发者工具预览）
 *   trial    体验版
 *   release  正式版（审核发布后）
 *
 * 需要切环境时只改这里，不用动 api.js。
 *
 * 注意：微信开发者工具对"根目录文件 + 跨目录 require('../config')"解析有坑，
 * 所以放在 utils/ 下、与 api.js 同目录用 require('./config') 引用。
 */
const BASE_URLS = {
  develop: 'http://1.15.29.107/api', // 开发服务器（仅开发版可用 HTTP，需在工具中关闭域名校验）
  // TODO(发布前必改)：体验版/正式版必须使用已备案的 HTTPS 域名，
  // 并在小程序后台「开发管理-服务器域名」中配置 request 合法域名。
  // 未替换占位符前，体验版/正式版无法发起任何请求。
  trial: 'https://YOUR_DOMAIN/api',
  release: 'https://YOUR_DOMAIN/api'
}

function getBaseUrl() {
  try {
    const info = wx.getAccountInfoSync()
    return BASE_URLS[info.miniProgram.envVersion] || BASE_URLS.develop
  } catch (e) {
    return BASE_URLS.develop
  }
}

module.exports = { getBaseUrl }
