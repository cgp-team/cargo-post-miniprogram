/**
 * 登录态统一工具
 *
 * 背景：此前各页面登录拦截方式不一（index 直接 reLaunch、mine 逐个入口判断、
 * detail 弹窗确认），现统一为 requireLogin()：
 *
 *   if (!auth.requireLogin()) return
 *
 * 401 被动失效的跳转防抖由 utils/api.js 负责，本文件只管主动拦截。
 */

/** 是否已登录（存在有效 token） */
function isLogin() {
  return !!wx.getStorageSync('token')
}

/**
 * 登录拦截：已登录返回 true；未登录弹确认框引导去登录，返回 false
 * @param {Object} [options]
 * @param {string} [options.content] 弹窗说明文案
 */
function requireLogin(options = {}) {
  if (isLogin()) return true
  wx.showModal({
    title: '请先登录',
    content: options.content || '登录后可使用该功能',
    confirmText: '去登录',
    success: (res) => {
      if (res.confirm) {
        // 记录来源页，登录成功后跳回（tab 页需用 switchTab，故记下 isTab）
        const pages = getCurrentPages()
        const current = pages[pages.length - 1]
        if (current && current.route && current.route !== 'pages/login/login') {
          const isTab = ['pages/index/index', 'pages/goods/goods', 'pages/parcel/parcel', 'pages/mine/mine'].indexOf(current.route) >= 0
          wx.setStorageSync('loginRedirect', { url: '/' + current.route, isTab })
        }
        wx.reLaunch({ url: '/pages/login/login' })
      }
    }
  })
  return false
}

module.exports = { isLogin, requireLogin }
