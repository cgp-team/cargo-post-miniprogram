/**
 * 寄货页 - 农户一键寄货
 * 步骤：填写信息 + 选站点 → 拍照 + 收货信息 → 真实提交创建货运订单
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')
const auth = require('../../utils/auth')
const feedback = require('../../utils/feedback')
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
      this.setData({ orderNo: res.orderNo, step: 3 }, () => this.drawQr())
    } catch (e) {
      this.submitting = false
      wx.hideLoading()
      // 错误提示已由 api.js 统一处理，保留当前页面现场
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
