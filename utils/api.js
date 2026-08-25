/**
 * API请求工具 - 农村客货邮小程序
 * 对接 Java 后端（芋道框架 member 模块）
 *
 * 本地调试：
 *   在微信开发者工具中 "详情 → 本地设置 → 不校验合法域名" 勾选
 */
const { getBaseUrl } = require('./config')
const BASE_URL = getBaseUrl()

/** 401 防抖：并发请求同时失效时，只提示/跳转一次 */
let last401At = 0

function handle401() {
  wx.removeStorageSync('token')
  wx.removeStorageSync('userInfo')
  wx.removeStorageSync('refreshToken')
  wx.removeStorageSync('userId')
  const now = Date.now()
  if (now - last401At < 2000) return
  last401At = now
  wx.showToast({ title: '登录已失效，请重新登录', icon: 'none' })
  wx.reLaunch({ url: '/pages/login/login' })
}

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
        if (!body || typeof body !== 'object') {
          wx.showToast({ title: '请求失败', icon: 'none', duration: 2500 })
          reject(new Error('empty response'))
          return
        }
        if (res.statusCode === 200 && body.code === 0) {
          resolve(body.data)
        } else if (res.statusCode === 401 || body.code === 401) {
          handle401()
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

// ==================== 收货地址 ====================

/** 地址列表 */
function listAddresses() {
  return request('/app-api/member/address/list', 'GET')
}

/** 新增地址 { name, mobile, areaId, detailAddress, defaultStatus } */
function createAddress(data) {
  return request('/app-api/member/address/create', 'POST', data)
}

/** 更新地址（含 id） */
function updateAddress(data) {
  return request('/app-api/member/address/update', 'PUT', data)
}

/** 删除地址 */
function deleteAddress(id) {
  return request(`/app-api/member/address/delete?id=${id}`, 'DELETE')
}

/** 获取默认地址 */
function getDefaultAddress() {
  return request('/app-api/member/address/get-default', 'GET')
}

/** 地区树（省市区三级，免登录） */
function getAreaTree() {
  return request('/app-api/system/area/tree', 'GET')
}

// ==================== 平台公告 ====================

/** 上架公告列表（免登录），[{id,title,content}] */
function listNotices() {
  return request('/app-api/transport/notice/list', 'GET')
}

// ==================== 意见反馈 ====================

/** 提交意见反馈 { content, name?, mobile? } */
function createFeedback(data) {
  return request('/app-api/transport/feedback/create', 'POST', data)
}

/** 我的反馈分页 { pageNo, pageSize } */
function pageMyFeedback(params) {
  return request('/app-api/transport/feedback/page', 'GET', params)
}

/** 商城订单溯源（承运车辆 + 大巴轨迹 + 线路站点） */
function getProductOrderTrace(id) {
  return request(`/app-api/transport/product-order/trace?id=${id}`, 'GET')
}

// ==================== 商品 ====================

/** 获取上架商品列表 */
function listProducts() {
  return request('/app-api/transport/product/list')
}

/** 上架商品分页 { pageNo, pageSize } */
function listProductsPage(params) {
  return request('/app-api/transport/product/page', 'GET', params)
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

/** 路线预览：取货/送达站点路网距离 + 预计时间（POST，后端校验站点有效性） */
function previewSendRoute(pickupStationId, deliveryStationId) {
  return request('/app-api/transport/send/route-preview', 'POST', { pickupStationId, deliveryStationId })
}

/** 我的乘车安排（客运订单已分配/在途/完成，含承运车辆，供村民到站通知） */
function getMyArrangements() {
  return request('/app-api/transport/send/arrangements')
}

/** 客户确认已按替代交接送到指定站点（待客户操作 → 待入池） */
function confirmStationAction(orderId) {
  return request(`/app-api/transport/send/confirm-station-action?orderId=${orderId}`, 'POST')
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

/** 司机路线（完整任务段有序经停 + 真实道路 polyline + 偏航判定，Phase 9 地图数据） */
function getDriverRoute(driverId) {
  return request('/app-api/transport/driver/route', 'GET', { driverId })
}

/** 发车：创建当天班次执行记录，订单推进已发车 */
function driverDepart(driverId, shiftId) {
  return request('/app-api/transport/driver/depart', 'POST', { driverId, shiftId })
}

/** 到站：更新当前站点；到达终点站时完成班次 */
function driverArrive(driverId, shiftId, stationId) {
  return request('/app-api/transport/driver/arrive', 'POST', { driverId, shiftId, stationId })
}

/** 装车确认：货运订单推进运输中（货运强制带司机收件照片） */
function driverPickupConfirm(driverId, orderId, driverPhotoUrl) {
  return request('/app-api/transport/driver/pickup-confirm', 'POST', { driverId, orderId, driverPhotoUrl })
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

/** 实时公交列表（复用监控车辆位置，含线路起终点/下一站/ETA/位置，免登录） */
function getRealtimeBuses() {
  return request('/app-api/transport/bus/realtime')
}

/** 实时公交线路（含经停点与该线在线车辆，车来了式地图+列表，免登录） */
function getRealtimeBusLines() {
  return request('/app-api/transport/bus/lines')
}

/** 附近实时公交（按用户坐标 Haversine 过滤 radius 内站点/车辆；无坐标时传 district 区域 fallback）。
 *  过滤 undefined 参数：微信 wx.request 会把 undefined 序列化成字符串 "undefined"，导致后端 Double 转换 400。 */
function getNearbyRealtimeBuses(latitude, longitude, radius, district) {
  const params = {}
  if (latitude != null) params.latitude = latitude
  if (longitude != null) params.longitude = longitude
  if (radius != null) params.radius = radius
  if (district) params.district = district
  return request('/app-api/transport/bus/nearby', 'GET', params)
}

// ==================== 取件核销 + 文件上传 ====================

/** 取件核销：邮快件收件人取件，司机确认（校验取件码） */
function driverPickupVerify(driverId, orderId, pickupCode) {
  return request('/app-api/transport/driver/pickup-verify', 'POST', { driverId, orderId, pickupCode })
}

/** 上传文件（照片），返回文件 URL（infra app 文件上传，免登录） */
function uploadFile(filePath) {
  const token = wx.getStorageSync('token')
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${BASE_URL}/app-api/infra/file/upload`,
      filePath,
      name: 'file',
      // 与 request() 鉴权方式一致，无 token 时不带该头
      header: token ? { 'Authorization': `Bearer ${token}` } : {},
      success(res) {
        let body
        try { body = JSON.parse(res.data) } catch (e) { body = null }
        // 与 request() 行为对齐：401 统一清理登录态并跳转登录页
        if (res.statusCode === 401 || (body && body.code === 401)) {
          handle401()
          reject(body || { msg: '登录已失效，请重新登录' })
          return
        }
        if (!body) { reject({ msg: '上传响应异常' }); return }
        if (body.code === 0) resolve(body.data)
        else reject(body)
      },
      fail(err) {
        // 用户取消不提示，其余失败统一 toast（与 request() 一致）
        if (!err || !err.errMsg || err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '上传失败，请重试', icon: 'none' })
        }
        reject(err)
      }
    })
  })
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
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  getDefaultAddress,
  getAreaTree,
  listNotices,
  createFeedback,
  pageMyFeedback,
  getProductOrderTrace,
  listProducts,
  listProductsPage,
  getProduct,
  createProductOrder,
  pageMyProductOrders,
  cancelProductOrder,
  createSendOrder,
  pageMySendOrders,
  trackParcel,
  listSendStations,
  previewSendRoute,
  getMyArrangements,
  confirmStationAction,
  getDriverProfile,
  getDriverShifts,
  getDriverPickups,
  getDriverEarnings,
  getDriverTasks,
  getDriverRoute,
  driverDepart,
  driverArrive,
  driverPickupConfirm,
  driverDeliver,
  reportDriverLocation,
  getRealtimeBuses,
  getRealtimeBusLines,
  getNearbyRealtimeBuses,
  driverPickupVerify,
  uploadFile
}
