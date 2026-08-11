/**
 * 寄货页 - 农户一键寄货
 * 初期简化版：语音示例 → 填写信息 → 拍照 → 智能匹配
 */
const appearance = require('../../utils/appearance')

Page({
  data: {
    step: 1,          // 1=填写信息, 2=拍照确认, 3=匹配成功
    goodsName: '',
    goodsWeight: '',
    goodsNote: '',
    photoPath: '',
    matchedBus: {
      route: 'C302路',
      fromStop: '云山村招呼站',
      waitMinutes: 15
    },
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: ''
  },

  onLoad() {
    appearance.apply(this)
  },

  onNameInput(e) { this.setData({ goodsName: e.detail.value }) },
  onWeightInput(e) { this.setData({ goodsWeight: e.detail.value }) },
  onNoteInput(e) { this.setData({ goodsNote: e.detail.value }) },

  /** 下一步：拍照 */
  goToPhoto() {
    const { goodsName, goodsWeight } = this.data
    if (!goodsName.trim()) {
      wx.showToast({ title: '请输入货物名称', icon: 'none' })
      return
    }
    if (!goodsWeight.trim()) {
      wx.showToast({ title: '请输入货物重量', icon: 'none' })
      return
    }
    this.setData({ step: 2 })
  },

  /** 拍照 */
  takePhoto() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['camera'],
      success: (res) => {
        this.setData({ photoPath: res.tempFilePaths[0] })
      }
    })
  },

  /** 确认发布 → 模拟智能匹配 */
  confirmSend() {
    if (!this.data.photoPath) {
      wx.showToast({ title: '请先拍照确认货物', icon: 'none' })
      return
    }

    wx.showLoading({ title: '智能匹配中…', mask: true })

    setTimeout(() => {
      wx.hideLoading()
      this.setData({ step: 3 })

      // 语音播报（如果支持）
      const { matchedBus } = this.data
      wx.showToast({
        title: `匹配成功！${matchedBus.route}距站点${matchedBus.waitMinutes}分钟`,
        icon: 'none',
        duration: 3000
      })
    }, 2000)
  },

  /** 重新发布 */
  resetSend() {
    this.setData({
      step: 1,
      goodsName: '',
      goodsWeight: '',
      goodsNote: '',
      photoPath: '',
    })
  },

  /** 返回首页 */
  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
