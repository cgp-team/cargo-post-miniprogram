/**
 * API请求工具 - 农村客货邮小程序
 * 封装所有的后端API请求
 *
 * ⚠️ 真机调试必读：
 *   - localhost 在真机上指向手机自己，无法连接电脑后端
 *   - 真机调试时，请将下方 BASE_URL 改为电脑的局域网IP
 *   - 例如: http://192.168.1.100:3000/api
 *   - 手机和电脑必须连接同一个WiFi
 *   - 同时后端需监听 0.0.0.0 而非 127.0.0.1
 *   - 在微信开发者工具中 "详情 → 本地设置 → 不校验合法域名" 必须勾选
 */

// ========== 真机调试时修改这里 ==========
// const BASE_URL = 'http://localhost:3000/api'           // 本地 Node.js 模拟器用
// const BASE_URL = 'http://10.89.175.217:3000/api'       // 手机热点模式
// const BASE_URL = 'http://192.168.137.1:3000/api'        // 电脑热点模式
const BASE_URL = 'http://1.15.29.107/api'                  // 团队开发服务器（Nginx → Java 后端）
// =====================================

/**
 * 通用请求方法
 */
function request(url, method = 'GET', data = {}) {
  const token = wx.getStorageSync('token')

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${url}`,
      method,
      data,
      timeout: 10000, // 10秒超时
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.data)
        } else if (res.statusCode === 401) {
          // token过期,清除登录状态
          wx.removeStorageSync('token')
          wx.removeStorageSync('userInfo')
          wx.reLaunch({
            url: '/pages/login/login'
          })
          reject(res.data)
        } else {
          // 打印详细错误信息，方便调试
          console.error('API请求失败:', {
            url: `${BASE_URL}${url}`,
            statusCode: res.statusCode,
            data: res.data
          })
          reject(res.data)
        }
      },
      fail(err) {
        // 打印详细错误信息
        console.error('网络请求失败:', {
          url: `${BASE_URL}${url}`,
          error: err.errMsg || err.message || JSON.stringify(err)
        })

        // 根据错误类型给出中文提示
        let errorMsg = '网络请求失败'
        if (err.errMsg) {
          if (err.errMsg.includes('timeout')) {
            errorMsg = '请求超时，请检查网络'
          } else if (err.errMsg.includes('fail')) {
            errorMsg = '无法连接服务器\n请确认：\n1. 手机和电脑在同一WiFi\n2. API地址配置正确\n3. 后端服务已启动'
          }
        }

        wx.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 3000
        })
        reject(err)
      }
    })
  })
}

/**
 * 登录
 */
function login(data) {
  return request('/auth/login', 'POST', data)
}

/**
 * 注册 - 用户
 */
function registerUser(data) {
  return request('/auth/register/user', 'POST', data)
}

/**
 * 注册 - 司机
 */
function registerDriver(data) {
  return request('/auth/register/driver', 'POST', data)
}

/**
 * 获取用户信息
 */
function getUserInfo() {
  return request('/auth/userinfo')
}

/**
 * 微信一键登录
 */
function wechatLogin(code) {
  return request('/auth/wechat-login', 'POST', { code })
}

module.exports = {
  request,
  login,
  registerUser,
  registerDriver,
  getUserInfo,
  wechatLogin
}
