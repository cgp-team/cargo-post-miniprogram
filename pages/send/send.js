/**
 * 寄货页 - 农户一键寄货
 * 步骤：填写信息 + 选站点（StationPicker）→ 路线预览 → 拍照 + 收货信息 → 真实提交创建货运订单
 *
 * 路线预览：选好取货/送达站点后不立即请求；点"下一步：拍照确认"时校验并调
 * previewSendRoute（后端校验站点有效 + 高德路网距离/时间），成功才进入 Step 2。
 * 相同站点组合缓存复用；修改任一站点立即清空旧预估。
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')
const auth = require('../../utils/auth')
const feedback = require('../../utils/feedback')
const reviewUtils = require('../../utils/review')
const qrcodeRender = require('../../utils/qrcode-render')
const util = require('../../utils/util')

Page({
  data: {
    step: 1,          // 1=填写信息, 2=拍照确认, 3=提交成功
    goodsName: '',
    goodsWeight: '',
    goodsNote: '',
    photoPath: '',
    photoUrl: '', // 拍照后上传到服务器拿到的真实 URL
    // 站点（从后端拉取）
    stations: [],
    stationsLoading: false,
    stationsError: false,
    pickupStationId: null,
    pickupStationName: '',
    deliveryStationId: null,
    deliveryStationName: '',
    // 路线预估（点击"下一步"时查询；routeStatus: idle|loading|success|error）
    routePreview: null,
    routeStatus: 'idle',
    routePreviewKey: '', // 缓存 key：`${pickupStationId}:${deliveryStationId}`
    // 收货信息
    receiverName: '',
    receiverMobile: '',
    receiverAddress: '',
    // 提交结果
    orderNo: '',
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: ''
  },

  async onLoad() {
    if (!auth.requireLogin()) return
    appearance.apply(this)
    this.loadStations()
  },

  onShow() {
    // 从地址簿选择后回填收货信息
    const selected = getApp().globalData.selectedAddress
    if (selected) {
      getApp().globalData.selectedAddress = null
      this.setData({
        receiverName: selected.name,
        receiverMobile: selected.mobile,
        receiverAddress: selected.address
      })
    }
  },

  /** 打开地址簿选择收货人 */
  goToAddressBook() {
    wx.navigateTo({ url: '/pages/mine/address/address?from=send' })
  },

  /** 加载寄货站点列表（供 StationPicker） */
  async loadStations() {
    this.setData({ stationsLoading: true, stationsError: false })
    try {
      const stations = await api.listSendStations()
      this.setData({ stations: stations || [], stationsLoading: false })
    } catch (e) {
      // api 已 toast；进入错误态，StationPicker 内可点击重试
      this.setData({ stations: [], stationsLoading: false, stationsError: true })
    }
  },

  onNameInput(e) { this.setData({ goodsName: e.detail.value }) },
  onWeightInput(e) { this.setData({ goodsWeight: e.detail.value }) },
  onNoteInput(e) { this.setData({ goodsNote: e.detail.value }) },
  onReceiverNameInput(e) { this.setData({ receiverName: e.detail.value }) },
  onReceiverMobileInput(e) { this.setData({ receiverMobile: e.detail.value }) },
  onReceiverAddressInput(e) { this.setData({ receiverAddress: e.detail.value }) },

  /** 取货站点变更：同步 ID/名称；与送达相同则拦截；清空旧路线预估 */
  onPickupStationChange(e) {
    const s = e.detail
    if (s.id === this.data.deliveryStationId) {
      wx.showToast({ title: '取货站点和送达站点不能相同', icon: 'none' })
      return
    }
    this.setData({
      pickupStationId: s.id,
      pickupStationName: s.stationName,
      routePreview: null,
      routeStatus: 'idle',
      routePreviewKey: ''
    })
  },

  /** 送达站点变更：同步 ID/名称；与取货相同则拦截；清空旧路线预估 */
  onDeliveryStationChange(e) {
    const s = e.detail
    if (s.id === this.data.pickupStationId) {
      wx.showToast({ title: '取货站点和送达站点不能相同', icon: 'none' })
      return
    }
    this.setData({
      deliveryStationId: s.id,
      deliveryStationName: s.stationName,
      routePreview: null,
      routeStatus: 'idle',
      routePreviewKey: ''
    })
  },

  /** 下一步：基础校验 → 路线预览（缓存命中直接复用）→ 成功才进入拍照页 */
  async goToPhoto() {
    if (this.data.routeStatus === 'loading') return // 防重复点击（路线计算中）
    const { goodsName, goodsWeight, pickupStationId, deliveryStationId } = this.data
    if (!goodsName.trim()) {
      wx.showToast({ title: '请输入货物名称', icon: 'none' })
      return
    }
    if (!goodsWeight.trim() || Number(goodsWeight) <= 0) {
      wx.showToast({ title: '请输入正确的货物重量', icon: 'none' })
      return
    }
    if (!pickupStationId) {
      wx.showToast({ title: '请选择取货站点', icon: 'none' })
      return
    }
    if (!deliveryStationId) {
      wx.showToast({ title: '请选择送达站点', icon: 'none' })
      return
    }
    if (pickupStationId === deliveryStationId) {
      wx.showToast({ title: '取货站点和送达站点不能相同', icon: 'none' })
      return
    }
    // 相同组合已成功查询过 → 直接复用，不再请求（避免重复打高德）
    const key = `${pickupStationId}:${deliveryStationId}`
    if (this.data.routePreviewKey === key && this.data.routePreview) {
      this.setData({ step: 2 })
      return
    }
    this.setData({ routeStatus: 'loading', routePreview: null })
    try {
      const preview = await api.previewSendRoute(pickupStationId, deliveryStationId)
      if (preview && preview.available !== false) {
        this.setData({ routePreview: preview, routeStatus: 'success', routePreviewKey: key, step: 2 })
      } else {
        // 路线不可达
        this.setData({ routePreview: preview || null, routeStatus: 'error' })
        wx.showToast({ title: '暂时无法获取路线', icon: 'none' })
      }
    } catch (e) {
      // api 已 toast；失败不进入下一步
      this.setData({ routePreview: null, routeStatus: 'error' })
    }
  },

  /** 路线失败 → 重新查询 */
  retryRoutePreview() {
    this.goToPhoto()
  },

  /** 拍照（wx.chooseMedia）并上传到服务器拿真实 URL（快递总站核对凭证） */
  takePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['camera'],
      success: async (res) => {
        const temp = res.tempFiles[0].tempFilePath
        this.setData({ photoPath: temp, photoUrl: '' })
        wx.showLoading({ title: '上传照片…', mask: true })
        try {
          const url = await api.uploadFile(temp)
          wx.hideLoading()
          this.setData({ photoUrl: url })
          wx.showToast({ title: '照片已上传', icon: 'success' })
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '照片上传失败，请重拍', icon: 'none' })
        }
      }
    })
  },

  /** 确认发布 → 真实创建货运订单（只提交站点/货物/收货信息，不提交前端距离结果） */
  async confirmSend() {
    const { photoPath, photoUrl, receiverMobile } = this.data
    if (this.submitting) return
    if (!photoPath) {
      wx.showToast({ title: '请先拍照确认货物', icon: 'none' })
      return
    }
    if (!photoUrl) {
      wx.showToast({ title: '照片上传中或失败，请稍后重试', icon: 'none' })
      return
    }
    if (!receiverMobile.trim()) {
      wx.showToast({ title: '请输入收货电话', icon: 'none' })
      return
    }
    if (!util.validatePhone(receiverMobile.trim())) {
      wx.showToast({ title: '请输入正确的收货电话', icon: 'none' })
      return
    }
    this.submitting = true
    wx.showLoading({ title: '提交中…', mask: true })
    try {
      const res = await api.createSendOrder({
        pickupStationId: this.data.pickupStationId,
        deliveryStationId: this.data.deliveryStationId,
        goodsName: this.data.goodsName.trim(),
        goodsWeight: Number(this.data.goodsWeight) * 0.5, // 斤 → kg
        goodsNote: this.data.goodsNote.trim(),
        photoUrl,
        receiverName: this.data.receiverName.trim(),
        receiverMobile: receiverMobile.trim(),
        receiverAddress: this.data.receiverAddress.trim()
      })
      this.submitting = false
      wx.hideLoading()
      feedback.tap()
      // 承运审核结果：客户实时知道可运/不可运/为什么/需什么操作（reasonCode 前端统一映射文案）
      const review = this.resolveReview(res)
      this.setData({ orderNo: res.orderNo, step: 3, ...review }, () => this.drawQr())
    } catch (e) {
      this.submitting = false
      wx.hideLoading()
      // 错误提示已由 api.js 统一处理，保留当前页面现场
    }
  },

  /** 审核结果 → 前端展示态（mode 驱动样式，hint 为操作指引；reasonCode 文案走 utils/review 统一映射） */
  resolveReview(res) {
    const reasonText = reviewUtils.reasonText(res.reviewReasonCodes)
    switch (res.reviewStatus) {
      case 1:
        return { reviewMode: 'passed', reviewTitle: '审核通过', reviewHint: '订单可进入待入池，调度员将尽快为您安排班次', reviewReasonText: '' }
      case 2:
        return { reviewMode: 'conditional', reviewTitle: '需您操作', reviewHint: '请将货物送到指定站点交接后即可入池', reviewReasonText: reasonText }
      case 3:
        return { reviewMode: 'manual', reviewTitle: '待人工审核', reviewHint: '工作人员将尽快确认承运条件，请留意通知', reviewReasonText: reasonText }
      case 4:
        return { reviewMode: 'rejected', reviewTitle: '审核不通过', reviewHint: '该货物暂不支持承运，无法进入运输流程', reviewReasonText: reasonText }
      default:
        return { reviewMode: 'pending', reviewTitle: '审核中', reviewHint: '正在为您确认承运条件', reviewReasonText: reasonText }
    }
  },

  /** 提交成功后绘制订单二维码（取件/司机扫码用） */
  drawQr() {
    wx.nextTick(() => {
      const query = wx.createSelectorQuery().in(this)
      query.select('#qrCanvas').fields({ node: true, size: true }).exec((res) => {
        if (!res[0] || !res[0].node || !this.data.orderNo) return
        qrcodeRender.draw(res[0].node, this.data.orderNo, res[0].width)
      })
    })
  },

  /** 复制订单号 */
  copyOrderNo() {
    wx.setClipboardData({
      data: this.data.orderNo,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  },

  noop() {},

  /** 转发给收货人查件 */
  onShareAppMessage() {
    // step 1/2 未提交时无单号，转发通用文案
    if (!this.data.orderNo) {
      return { title: '客货邮便民服务平台', path: '/pages/parcel/parcel' }
    }
    return {
      title: `寄货单 ${this.data.orderNo} 已提交，点击查看物流进度`,
      path: '/pages/parcel/parcel'
    }
  },

  /** 重新发布 */
  resetSend() {
    this.setData({
      step: 1,
      goodsName: '',
      goodsWeight: '',
      goodsNote: '',
      photoPath: '',
      photoUrl: '',
      pickupStationId: null,
      pickupStationName: '',
      deliveryStationId: null,
      deliveryStationName: '',
      routePreview: null,
      routeStatus: 'idle',
      routePreviewKey: '',
      receiverName: '',
      receiverMobile: '',
      receiverAddress: '',
      orderNo: ''
    })
  },

  /** 返回首页 */
  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
