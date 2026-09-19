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
  // 记录来源页并在重新登录后跳回：401 会强制 reLaunch 登录页，
  // 不记录的话「商城下单/寄货提交」这类写到一半的操作现场会丢失（用户只能从头再来）。
  try {
    const pages = getCurrentPages()
    const current = pages[pages.length - 1]
    if (current && current.route && current.route !== 'pages/login/login') {
      const isTab = ['pages/index/index', 'pages/goods/goods', 'pages/parcel/parcel', 'pages/mine/mine'].indexOf(current.route) >= 0
      wx.setStorageSync('loginRedirect', { url: '/' + current.route, isTab })
    }
  } catch (e) {
    // 记录失败不影响登录跳转
  }
  wx.removeStorageSync('token')
  wx.removeStorageSync('userInfo')
  wx.removeStorageSync('refreshToken')
  wx.removeStorageSync('userId')
  const now = Date.now()
  if (now - last401At < 2000) return
  last401At = now
  wx.showToast({ title: '登录已失效，请重新登录', icon: 'none', duration: 2500 })
  wx.reLaunch({ url: '/pages/login/login' })
}

/**
 * 请求参数清理：过滤 undefined / null / 空字符串。
 *
 * 背景：微信 wx.request 会把 undefined 序列化成字符串 "undefined"（GET 拼进 query、POST 拼进 body），
 * 后端 Integer/Long/Double 等类型绑定会直接失败，例如订单页
 * `status: undefined` → `For input string: "undefined"` 的线上报错。
 *
 * 约定：
 * - 只清理对象自身的键（浅层），嵌套对象/数组原样保留（避免误删结构）；
 * - 保留 0 / false / 非空字符串（0 是合法业务值，如「待发货」status=0、页码等）。
 */
function cleanParams(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const cleaned = {}
  Object.keys(data).forEach((key) => {
    const value = data[key]
    if (value === undefined || value === null || value === '') return
    cleaned[key] = value
  })
  return cleaned
}

/**
 * 通用请求
 * @param {Object} [options] options.silent：静默请求（轮询类后台刷新用），
 *   失败不弹 toast——15s 轮询在弱网下行车会每 15s 弹一次"网络连接失败"，老人用户无所适从；
 *   页面自身有空态/错误态兜底。接口参数与返回结构不变。
 */
function request(url, method = 'GET', data = {}, options = {}) {
  const silent = !!(options && options.silent)
  const token = wx.getStorageSync('token')
  // GET/POST 统一清理参数：空值不进 query/body，避免 "undefined" 字符串打到后端
  const payload = cleanParams(data)

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${url}`,
      method,
      data: payload,
      timeout: 10000,
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      success(res) {
        // yudao 统一格式 {code: 0, msg: "", data: ...}
        const body = res.data
        if (!body || typeof body !== 'object') {
          if (!silent) wx.showToast({ title: '请求失败', icon: 'none', duration: 2500 })
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
          if (!silent) wx.showToast({ title: errMsg, icon: 'none', duration: 2500 })
          reject(body)
        }
      },
      fail(err) {
        console.error('网络请求失败:', err)
        if (!silent) wx.showToast({ title: '网络连接失败，请检查网络', icon: 'none', duration: 2500 })
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

/**
 * 当前位置可达性评估：车辆能否直接到达用户位置；
 * 不可达时返回最近可服务站点 + 距离 + 步行时间（服务端按道路距离优先、直线兜底）。
 */
function getReachability(latitude, longitude) {
  return request('/app-api/transport/send/reachability', 'POST', { latitude, longitude })
}

/** 路线预览：取货/送达站点路网距离 + 预计时间（POST，后端校验站点有效性） */
function previewSendRoute(pickupStationId, deliveryStationId) {
  return request('/app-api/transport/send/route-preview', 'POST', { pickupStationId, deliveryStationId })
}

/**
 * 寄货试算：件单价×件数 + 里程费（与后台方案预计收入同源）。
 * 村民在寄货页填完取货/送达地址即显示金额，不必等提交后才看得到。
 */
function quoteSendFee(pickupStationId, deliveryStationId, itemCount) {
  return request('/app-api/transport/send/quote', 'POST', { pickupStationId, deliveryStationId, itemCount })
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
// driver 系包装函数末位均可选传 options（透传 request 第 4 参，如 { silent: true } 静默轮询不弹 toast）

/** 司机档案（登录会员识别身份） */
function getDriverProfile(options) {
  return request('/app-api/transport/driver/profile', 'GET', {}, options)
}

/** 今日班次与经停站点 */
function getDriverShifts(options) {
  return request('/app-api/transport/driver/shifts', 'GET', {}, options)
}

/** 待装车任务 */
function getDriverPickups(options) {
  return request('/app-api/transport/driver/pickups', 'GET', {}, options)
}

/** 运营统计 */
function getDriverEarnings(options) {
  return request('/app-api/transport/driver/earnings', 'GET', {}, options)
}

/** 调度任务（算法派单结果，预留） */
function getDriverTasks(driverId, options) {
  return request('/app-api/transport/driver/tasks', 'GET', { driverId }, options)
}

/** 司机路线（完整任务段有序经停 + 真实道路 polyline + 偏航判定，Phase 9 地图数据） */
function getDriverRoute(driverId, options) {
  return request('/app-api/transport/driver/route', 'GET', { driverId }, options)
}

/** 发车：创建当天班次执行记录，订单推进已发车 */
function driverDepart(driverId, shiftId, options) {
  return request('/app-api/transport/driver/depart', 'POST', { driverId, shiftId }, options)
}

/** 到站：更新当前站点；到达终点站时完成班次 */
function driverArrive(driverId, shiftId, stationId, options) {
  return request('/app-api/transport/driver/arrive', 'POST', { driverId, shiftId, stationId }, options)
}

/** 装车确认：货运订单推进运输中（货运强制带司机收件照片） */
function driverPickupConfirm(driverId, orderId, driverPhotoUrl, options) {
  return request('/app-api/transport/driver/pickup-confirm', 'POST', { driverId, orderId, driverPhotoUrl }, options)
}

/** 妥投确认：货运订单推进已完成 */
function driverDeliver(driverId, orderId, options) {
  return request('/app-api/transport/driver/deliver', 'POST', { driverId, orderId }, options)
}

/** 商城订单装车确认（司机拍照核验凭证，订单保持已发货/配送中） */
function driverProductLoad(driverId, orderId, driverPhotoUrl, options) {
  return request('/app-api/transport/driver/product-load', 'POST', { driverId, orderId, driverPhotoUrl }, options)
}

/** 商城订单妥投完成（司机交付凭证，订单转已完成，用户端可见） */
function driverProductDeliver(driverId, orderId, driverPhotoUrl, options) {
  return request('/app-api/transport/driver/product-deliver', 'POST', { driverId, orderId, driverPhotoUrl }, options)
}

/** 上报车辆位置（行驶中定时调用） */
function reportDriverLocation(data, options) {
  return request('/app-api/transport/driver/location', 'POST', data, options)
}

/** 司机车辆当前位置（真实上报 REAL + 模拟引擎 SIMULATED） */
function getDriverPosition(driverId, options) {
  return request('/app-api/transport/driver/position', 'GET', { driverId }, options)
}

/** 微信订阅消息模板列表（@PermitAll，返回含 id=模板ID/title/type） */
function getSubscribeTemplateList() {
  return request('/app-api/member/social-user/get-subscribe-template-list')
}

// ==================== 实时公交 ====================

/** 实时公交列表（复用监控车辆位置，含线路起终点/下一站/ETA/位置，免登录） */
function getRealtimeBuses() {
  return request('/app-api/transport/bus/realtime')
}

/** 实时公交线路（含经停点与该线在线车辆，车来了式地图+列表，免登录） */
/** 实时公交线路（传坐标时只取附近线路：主城全量线网几百条，全量下发会超时） */
function getRealtimeBusLines(latitude, longitude, radius, options) {
  return request('/app-api/transport/bus/lines', 'GET', { latitude, longitude, radius }, options)
}

/** 单条线路的真实道路轨迹（点开线路时按需查询，带缓存；失败由前端回退站点直线） */
function getBusLinePolyline(routeId, options) {
  return request(`/app-api/transport/bus/line-polyline?routeId=${routeId}`, 'GET', {}, options)
}

/** 附近实时公交（按用户坐标 Haversine 过滤 radius 内站点/车辆；无坐标时传 district 区域 fallback）。
 *  空值参数（无定位/无区域/未指定 radius）统一由 request() 的 cleanParams 过滤，
 *  避免 wx.request 把 undefined 序列化成字符串 "undefined" 导致后端 Double 转换 400。 */
function getNearbyRealtimeBuses(latitude, longitude, radius, district, options) {
  return request('/app-api/transport/bus/nearby', 'GET', { latitude, longitude, radius, district }, options)
}

// ==================== 取件核销 + 文件上传 ====================

/** 取件核销：邮快件收件人取件，司机确认（校验取件码） */
function driverPickupVerify(driverId, orderId, pickupCode, options) {
  return request('/app-api/transport/driver/pickup-verify', 'POST', { driverId, orderId, pickupCode }, options)
}

// ==================== 消息通知中心 ====================

/** 我的消息分页（readStatus 可选：0未读 1已读） */
function pageMyNotifications(params) {
  return request('/app-api/transport/notification/page', 'GET', params)
}

/** 我的未读消息数（红点） */
function getNotificationUnreadCount() {
  return request('/app-api/transport/notification/unread-count', 'GET')
}

/** 标记单条消息已读 */
function readNotification(id) {
  return request(`/app-api/transport/notification/read?id=${id}`, 'PUT')
}

/** 全部标记已读（orderId 可选） */
function readAllNotifications(orderId) {
  return request('/app-api/transport/notification/read-all', 'PUT', { orderId })
}

// ==================== 多段联运（司机交接 / 运输段进度） ====================

/** 待确认的货物交接任务 */
function getDriverHandovers(driverId, options) {
  return request('/app-api/transport/driver/handovers', 'GET', { driverId }, options)
}

/** 确认货物交接（拍照核验） */
function confirmDriverHandover(data, options) {
  return request('/app-api/transport/driver/handover/confirm', 'POST', data, options)
}

/** 我的运输段进度 */
function getDriverLegs(driverId, options) {
  return request('/app-api/transport/driver/legs', 'GET', { driverId }, options)
}

/** 用户端：按订单号查多段运输进度 */
function getParcelLegs(no) {
  return request('/app-api/transport/send/legs', 'GET', { no })
}

/** 用户端：按订单号查运输拓扑（订单+分段+换乘交接+候选方案解释+时间线，一次返回） */
function getParcelTopology(no) {
  return request('/app-api/transport/send/topology', 'GET', { no })
}

// ==================== 司机运输段任务（接受/导航/到达/装货/发车/交接/完成） ====================

/** 当前运输段（司机任务详情） */
function getDriverCurrentLeg(driverId, options) {
  return request('/app-api/transport/driver/current-leg', 'GET', { driverId }, options)
}

/** 运输段操作：action ∈ accept/navigate/arrive-origin/load/start/arrive-dest/handover-start/handover-confirm/complete */
function driverLegAction(action, data, options) {
  return request(`/app-api/transport/driver/leg/${action}`, 'POST', data, options)
}

/** 司机消息中心分页 */
function pageDriverMessages(params, options) {
  return request('/app-api/transport/driver/messages', 'GET', params, options)
}

/** 司机未读消息数 */
function getDriverUnreadCount(driverId, options) {
  return request('/app-api/transport/driver/messages/unread-count', 'GET', { driverId }, options)
}

/** 标记司机消息已读 */
function readDriverMessage(id, driverId, options) {
  return request(`/app-api/transport/driver/messages/read?id=${id}&driverId=${driverId}`, 'PUT', {}, options)
}

/** 上传文件（照片），返回文件 URL（infra app 文件上传，免登录） */
function uploadFile(filePath) {
  const token = wx.getStorageSync('token')
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${BASE_URL}/app-api/infra/file/upload`,
      filePath,
      name: 'file',
      // 显式超时：默认不超时会让"上传中…"遮罩一直挂着，用户以为卡死在发布界面
      timeout: 30000,
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
  cleanParams,
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
  quoteSendFee,
  getReachability,
  getMyArrangements,
  confirmStationAction,
  getDriverProfile,
  getDriverShifts,
  getDriverPickups,
  getDriverEarnings,
  getDriverTasks,
  getDriverRoute,
  getDriverPosition,
  getSubscribeTemplateList,
  driverDepart,
  driverArrive,
  driverPickupConfirm,
  driverDeliver,
  driverProductLoad,
  driverProductDeliver,
  reportDriverLocation,
  getRealtimeBuses,
  getRealtimeBusLines,
  getBusLinePolyline,
  getNearbyRealtimeBuses,
  driverPickupVerify,
  pageMyNotifications,
  getNotificationUnreadCount,
  readNotification,
  readAllNotifications,
  getDriverHandovers,
  confirmDriverHandover,
  getDriverLegs,
  getParcelLegs,
  getParcelTopology,
  getDriverCurrentLeg,
  driverLegAction,
  pageDriverMessages,
  getDriverUnreadCount,
  readDriverMessage,
  uploadFile
}
