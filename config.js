/**
 * 环境配置 - 按微信小程序运行环境切换后端地址
 *
 * 运行环境（wx.getAccountInfoSync().miniProgram.envVersion）：
 *   develop  开发版（微信开发者工具预览）
 *   trial    体验版
 *   release  正式版（审核发布后）
 *
 * 需要切环境时只改这里，不用动 api.js。
 */
const BASE_URLS = {
  develop: 'http://1.15.29.107/api', // 开发服务器
  trial: 'http://1.15.29.107/api',   // 暂无独立体验环境，先指开发服务器
  release: 'http://1.15.29.107/api'  // 暂无正式服务器，先指开发服务器
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
