/**
 * API请求工具 - 农村客货邮小程序
 * 对接 Java 后端（芋道框架 member 模块）
 *
 * 本地调试：
 *   在微信开发者工具中 "详情 → 本地设置 → 不校验合法域名" 勾选
 */
const { getBaseUrl } = require('./config')
const BASE_URL = getBaseUrl()

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

// ==================== 商品 ====================

/** 获取上架商品列表 */
function listProducts() {
  return request('/app-api/transport/product/list')
}

/** 获取商品详情 */
function getProduct(id) {
  return request('/app-api/transport/product/get', 'GET', { id })
}

// ==================== 商城订单 ====================

/** 创建商城订单（货到付款） */
function createProductOrder(data) {
  return request('/app-api/transport/product-order/create', 'POST', data)
}

/** 我的订单分页（status 可选：0待发货/1已发货/2已完成/3已取消） */
function pageMyProductOrders(params) {
  return request('/app-api/transport/product-order/page', 'GET', params)
}

/** 取消订单（仅待发货） */
function cancelProductOrder(id) {
  return request(`/app-api/transport/product-order/cancel?id=${id}`, 'PUT')
}

// ==================== 寄货 / 包裹 ====================

/** 寄货创建货运订单 */
function createSendOrder(data) {
  return request('/app-api/transport/send/create', 'POST', data)
}

/** 我的寄货记录分页 */
function pageMySendOrders(params) {
  return request('/app-api/transport/send/page', 'GET', params)
}

/** 按业务订单号追踪包裹 */
function trackParcel(no) {
  return request('/app-api/transport/send/track', 'GET', { no })
}

/** 寄货站点列表 */
function listSendStations() {
  return request('/app-api/transport/send/stations')
}

// ==================== 司机端 ====================

/** 司机档案（登录会员识别身份） */
function getDriverProfile() {
  return request('/app-api/transport/driver/profile')
}

/** 今日班次与经停站点 */
function getDriverShifts() {
  return request('/app-api/transport/driver/shifts')
}

/** 待装车任务 */
function getDriverPickups() {
  return request('/app-api/transport/driver/pickups')
}

/** 运营统计 */
function getDriverEarnings() {
  return request('/app-api/transport/driver/earnings')
}

/** 调度任务（算法派单结果，预留） */
function getDriverTasks(driverId) {
  return request('/app-api/transport/driver/tasks', 'GET', { driverId })
}

/** 发车：创建当天班次执行记录，订单推进已发车 */
function driverDepart(driverId, shiftId) {
  return request('/app-api/transport/driver/depart', 'POST', { driverId, shiftId })
}

/** 到站：更新当前站点；到达终点站时完成班次 */
function driverArrive(driverId, shiftId, stationId) {
  return request('/app-api/transport/driver/arrive', 'POST', { driverId, shiftId, stationId })
}

/** 装车确认：货运订单推进运输中 */
function driverPickupConfirm(driverId, orderId) {
  return request('/app-api/transport/driver/pickup-confirm', 'POST', { driverId, orderId })
}

/** 妥投确认：货运订单推进已完成 */
function driverDeliver(driverId, orderId) {
  return request('/app-api/transport/driver/deliver', 'POST', { driverId, orderId })
}

/** 上报车辆位置（行驶中定时调用） */
function reportDriverLocation(data) {
  return request('/app-api/transport/driver/location', 'POST', data)
}

// ==================== 实时公交 ====================

/** 实时公交列表（复用监控车辆位置，含线路起终点/下一站/ETA，免登录） */
function getRealtimeBuses() {
  return request('/app-api/transport/bus/realtime')
}

// ==================== 语音服务（寄货语音输入 + 面对面翻译） ====================

/** 语音识别：上传录音文件 → 文本（免登录） */
function recognizeVoice(filePath, lang) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${BASE_URL}/app-api/transport/voice/recognize`,
      filePath,
      name: 'file',
      formData: { lang: lang || 'zh' },
      success(res) {
        let body
        try { body = JSON.parse(res.data) } catch (e) { reject({ msg: '识别服务响应异常' }); return }
        if (body.code === 0) resolve(body.data.text)
        else reject(body)
      },
      fail: reject
    })
  })
}

/** 文本翻译：中英文互译（免登录） */
function translateText(text, from, to) {
  return request('/app-api/transport/voice/translate', 'POST', { text, from, to })
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
  updatePassword,
  listProducts,
  getProduct,
  createProductOrder,
  pageMyProductOrders,
  cancelProductOrder,
  createSendOrder,
  pageMySendOrders,
  trackParcel,
  listSendStations,
  getDriverProfile,
  getDriverShifts,
  getDriverPickups,
  getDriverEarnings,
  getDriverTasks,
  driverDepart,
  driverArrive,
  driverPickupConfirm,
  driverDeliver,
  reportDriverLocation,
  getRealtimeBuses,
  recognizeVoice,
  translateText
}
