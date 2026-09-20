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

/**
 * 高德「微信小程序」key（官方 amap-wx.js 路线，见 README.md「现实公交接入」）。
 *
 * 申请：高德控制台 → 应用管理 → 创建应用 → 添加 Key → 服务平台选「微信小程序」，绑定小程序 AppID。
 * 配置：填到下面；同时把 https://restapi.amap.com 加入微信公众平台的 request 合法域名。
 * 留空 = 不启用客户端现实公交层（项目自建线路 + 模拟车辆仍正常，不伪造现实公交）。
 *
 * 注意：小程序 key 与 AppID 绑定、只允许白名单域名调用，可以放在小程序里；
 * 而「Web 服务」key 不能放客户端，那种 key 请配到后端（yudao.transport.amap.key）。
 */
const AMAP_MINI_KEY = 'f35fa96247bd40fa437a485d710d4d02'

/** 定位失败时的地图默认中心，按运营区域调整（实时公交页初始中心，拿到真实坐标前使用） */
const DEFAULT_MAP_CENTER = { latitude: 29.5325, longitude: 106.5765 }

/** 定位失败时的地图默认中心，按运营区域调整（司机工作台路线概览初始中心） */
const DRIVER_DEFAULT_MAP_CENTER = { latitude: 30.32, longitude: 108.21 }

function getBaseUrl() {
  try {
    const info = wx.getAccountInfoSync()
    return BASE_URLS[info.miniProgram.envVersion] || BASE_URLS.develop
  } catch (e) {
    return BASE_URLS.develop
  }
}

/** 高德小程序 key（未配置返回 ''，调用方据此禁用客户端现实公交层） */
function getAmapMiniKey() {
  return AMAP_MINI_KEY || ''
}

module.exports = { getBaseUrl, getAmapMiniKey, DEFAULT_MAP_CENTER, DRIVER_DEFAULT_MAP_CENTER }
