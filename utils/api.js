/**
 * API请求工具 - 农村客货邮小程序
 * 对接 Java 后端（芋道框架 member 模块）
 *
 * 本地调试：
 *   在微信开发者工具中 "详情 → 本地设置 → 不校验合法域名" 勾选
 */
const BASE_URL = 'http://1.15.29.107/api'

/**
 * 通用请求
 */
function request(url, method = 'GET', data = {}) {
  const token = wx.getStorageSync('token')

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${url}`,
      method,
      data,
      timeout: 10000,
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      success(res) {
        // yudao 统一格式 {code: 0, msg: "", data: ...}
        const body = res.data
        if (res.statusCode === 200 && body.code === 0) {
          resolve(body.data)
        } else if (res.statusCode === 401 || body.code === 401) {
          wx.removeStorageSync('token')
          wx.removeStorageSync('userInfo')
          wx.reLaunch({ url: '/pages/login/login' })
          reject(body)
        } else {
          const errMsg = body.msg || '请求失败'
          wx.showToast({ title: errMsg, icon: 'none', duration: 2500 })
          reject(body)
        }
      },
      fail(err) {
        console.error('网络请求失败:', err)
        wx.showToast({ title: '网络连接失败，请检查网络', icon: 'none', duration: 2500 })
        reject(err)
      }
    })
  })
}

// ==================== 认证 ====================

/** 短信验证码登录（新用户自动注册） */
function smsLogin(mobile, code) {
  return request('/app-api/member/auth/sms-login', 'POST', { mobile, code })
}

/** 发送短信验证码 */
function sendSmsCode(mobile, scene) {
  return request('/app-api/member/auth/send-sms-code', 'POST', { mobile, scene: scene || 1 })
}

/** 微信小程序一键登录 */
function wechatMiniAppLogin(phoneCode, loginCode, state) {
  return request('/app-api/member/auth/weixin-mini-app-login', 'POST', { phoneCode, loginCode, state })
}

/** 手机号 + 密码登录 */
function login(mobile, password) {
  return request('/app-api/member/auth/login', 'POST', { mobile, password })
}

/** 登出 */
function logout() {
  return request('/app-api/member/auth/logout', 'POST')
}

// ==================== 用户信息 ====================

/** 获取用户基本信息 */
function getUserInfo() {
  return request('/app-api/member/user/get')
}

/** 更新用户基本信息 */
function updateUser(data) {
  return request('/app-api/member/user/update', 'PUT', data)
}

/** 修改密码 */
function updatePassword(data) {
  return request('/app-api/member/user/update-password', 'PUT', data)
}

module.exports = {
  request,
  smsLogin,
  sendSmsCode,
  wechatMiniAppLogin,
  login,
  logout,
  getUserInfo,
  updateUser,
  updatePassword
}
