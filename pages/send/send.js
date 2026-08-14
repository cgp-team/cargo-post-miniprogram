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

  /** 拍照（wx.chooseMedia 替代已废弃的 wx.chooseImage） */
  takePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['camera'],
      success: (res) => {
        this.setData({ photoPath: res.tempFiles[0].tempFilePath })
      }
    })
  },

  /** 确认发布 → 真实创建货运订单 */
  async confirmSend() {
    const { photoPath, receiverMobile } = this.data
    if (this.submitting) return
    if (!photoPath) {
      wx.showToast({ title: '请先拍照确认货物', icon: 'none' })
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
        photoUrl: this.data.photoPath,
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
   * 点击语音按钮：录音 → 上传后端识别（百度智能云 ASR）
   * 个人主体无法用微信同声传译插件，录音走原生 wx.getRecorderManager，识别走后端 /voice/recognize
   */
  startVoiceInput() {
    if (this.data.voiceListening) {
      this.stopVoiceInput()
      return
    }
    const recorder = this.voiceRecorder || (this.voiceRecorder = wx.getRecorderManager())
    recorder.onStart(() => this.setData({ voiceListening: true, voiceResult: '' }))
    recorder.onStop((res) => {
      this.setData({ voiceListening: false })
      if (res.tempFilePath) {
        this.uploadAndRecognize(res.tempFilePath)
      }
    })
    recorder.onError((err) => {
      this.setData({ voiceListening: false })
      wx.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none', duration: 2000 })
    })
    // wav 16k 单声道（百度短语音识别支持格式）
    recorder.start({ duration: 30000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'wav' })
  },

  /** 停止录音（松开/再次点击） */
  stopVoiceInput() {
    if (this.voiceRecorder) {
      try { this.voiceRecorder.stop() } catch (e) { /* 已停止 */ }
    }
  },

  /** 录音完成：上传后端识别 */
  async uploadAndRecognize(filePath) {
    wx.showLoading({ title: '识别中…', mask: true })
    try {
      const text = await api.recognizeVoice(filePath, 'zh')
      wx.hideLoading()
      this.handleVoiceResult(text)
    } catch (e) {
      wx.hideLoading()
      // 错误提示已由 api 统一处理；若语音服务未配置会有对应提示
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
