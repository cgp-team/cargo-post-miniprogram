/**
 * 寄货页 - 农户一键寄货
 * 步骤：填写信息 + 选站点 → 拍照 + 收货信息 → 真实提交创建货运订单
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')
const feedback = require('../../utils/feedback')
const qrcodeRender = require('../../utils/qrcode-render')

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
    pickupStationId: null,
    pickupStationName: '',
    deliveryStationId: null,
    deliveryStationName: '',
    // 收货信息
    receiverName: '',
    receiverMobile: '',
    receiverAddress: '',
    // 提交结果
    orderNo: '',
    // 语音输入
    voiceListening: false,
    voiceResult: '',
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: ''
  },

  async onLoad() {
    appearance.apply(this)
    this.loadStations()
  },

  /** 页面卸载时停止录音，避免后台占用麦克风 */
  onUnload() {
    this.stopVoiceInput()
  },

  /** 加载寄货站点列表 */
  async loadStations() {
    try {
      const stations = await api.listSendStations()
      this.setData({ stations: stations || [] })
    } catch (e) { /* api 已 toast */ }
  },

  onNameInput(e) { this.setData({ goodsName: e.detail.value }) },
  onWeightInput(e) { this.setData({ goodsWeight: e.detail.value }) },
  onNoteInput(e) { this.setData({ goodsNote: e.detail.value }) },
  onReceiverNameInput(e) { this.setData({ receiverName: e.detail.value }) },
  onReceiverMobileInput(e) { this.setData({ receiverMobile: e.detail.value }) },
  onReceiverAddressInput(e) { this.setData({ receiverAddress: e.detail.value }) },

  /** 选择取货站点 */
  choosePickupStation() {
    this.chooseStation((s) => {
      this.setData({ pickupStationId: s.id, pickupStationName: s.stationName })
    })
  },

  /** 选择送达站点 */
  chooseDeliveryStation() {
    this.chooseStation((s) => {
      this.setData({ deliveryStationId: s.id, deliveryStationName: s.stationName })
    })
  },

  chooseStation(cb) {
    const names = this.data.stations.map((s) => s.stationName)
    if (!names.length) {
      wx.showToast({ title: '站点加载中，请稍后', icon: 'none' })
      this.loadStations()
      return
    }
    wx.showActionSheet({
      itemList: names,
      success: (res) => cb(this.data.stations[res.tapIndex])
    })
  },

  /** 下一步：拍照 */
  goToPhoto() {
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
    this.setData({ step: 2 })
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

  /** 确认发布 → 真实创建货运订单 */
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
      this.setData({ orderNo: res.orderNo, step: 3 }, () => this.drawQr())
    } catch (e) {
      this.submitting = false
      wx.hideLoading()
      // 错误提示已由 api.js 统一处理，保留当前页面现场
    }
  },

  /**
   * 点击语音按钮：开始/停止录音识别（微信同声传译插件 WechatSI）
   * 说明：该插件仅企业/组织主体可用，当前个人主体无法声明（编译报 89260），
   * 代码按插件方案就位，换组织主体 + 后台添加插件后即启用；未就绪时 try-catch 降级提示。
   */
  startVoiceInput() {
    if (this.data.voiceListening) {
      this.stopVoiceInput()
      return
    }
    let plugin
    try {
      plugin = requirePlugin('WechatSI')
    } catch (e) {
      wx.showToast({ title: '语音需企业主体小程序', icon: 'none', duration: 2500 })
      return
    }
    if (!this.voiceManager) {
      this.voiceManager = plugin.getRecordRecognitionManager()
      this.voiceManager.onStart = () => this.setData({ voiceListening: true, voiceResult: '' })
      this.voiceManager.onStop = (res) => {
        this.setData({ voiceListening: false })
        this.handleVoiceResult((res && res.result) || '')
      }
      this.voiceManager.onError = () => {
        this.setData({ voiceListening: false })
        wx.showToast({ title: '语音识别失败，请重试', icon: 'none' })
      }
    }
    this.voiceManager.start({ duration: 30000, lang: 'zh_CN' })
  },

  /** 停止录音 */
  stopVoiceInput() {
    if (this.voiceManager) {
      try { this.voiceManager.stop() } catch (e) { /* 已停止 */ }
    }
  },

  /** 解析识别文本：提取重量、货物名称，原文存备注 */
  handleVoiceResult(text) {
    const cleaned = (text || '').trim()
    if (!cleaned) {
      wx.showToast({ title: '未听清，请再试一次', icon: 'none' })
      return
    }
    let goodsName = this.data.goodsName
    let goodsWeight = this.data.goodsWeight
    // 重量：数字 + 斤/公斤
    const wm = cleaned.match(/(\d+(?:\.\d+)?)\s*(斤|公斤|千克)/)
    if (wm) {
      goodsWeight = wm[1] + wm[2]
    }
    // 货物名称：在"寄/要寄/发"与重量(或"到")之间
    const nm = cleaned.match(/(?:寄|寄送|要寄|发)(.+?)(?:\d+(?:\.\d+)?\s*(?:斤|公斤|千克)|\s*到|$)/)
    if (nm && nm[1]) {
      const name = nm[1].replace(/我|要|把|这个|那个|的东西|东西|货物/g, '').trim()
      if (name && !/\d/.test(name) && name.length <= 20) {
        goodsName = name
      }
    }
    this.setData({ voiceResult: cleaned, goodsName, goodsWeight, goodsNote: cleaned })
    wx.showToast({ title: '已识别，可修改', icon: 'none' })
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
    wx.setClipboardData({ data: this.data.orderNo })
  },

  noop() {},

  /** 转发给收货人查件 */
  onShareAppMessage() {
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
