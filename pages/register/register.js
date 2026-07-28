/**
 * 注册页面 - 对接 Java 后端 member 模块
 * 新用户通过短信验证码登录即自动注册（createUserIfAbsent）
 * 此页面仅做引导，实际注册在短信登录时完成
 */
const api = require('../../utils/api')
const util = require('../../utils/util')

Page({
  data: {
    phone: '',
    smsCode: '',
    smsCountdown: 0,
    smsCodeSending: false,
    loading: false
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value })
  },
  onSmsCodeInput(e) {
    this.setData({ smsCode: e.detail.value })
  },

  /** 发送验证码 */
  async handleSendSms() {
    const { phone, smsCodeSending, smsCountdown } = this.data
    if (smsCodeSending || smsCountdown > 0) return
    if (!util.validatePhone(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    this.setData({ smsCodeSending: true })
    try {
      await api.sendSmsCode(phone, 1)
      wx.showToast({ title: '验证码已发送', icon: 'success' })
      this.setData({ smsCountdown: 60 })
      const timer = setInterval(() => {
        const count = this.data.smsCountdown - 1
        if (count <= 0) clearInterval(timer)
        this.setData({ smsCountdown: count > 0 ? count : 0 })
      }, 1000)
    } finally {
      this.setData({ smsCodeSending: false })
    }
  },

  /** 注册（短信验证码登录，新用户自动创建） */
  async handleRegister() {
    const { phone, smsCode } = this.data
    if (!util.validatePhone(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    if (!smsCode || smsCode.length < 4) {
      wx.showToast({ title: '请输入验证码', icon: 'none' })
      return
    }

    this.setData({ loading: true })
    try {
      const res = await api.smsLogin(phone, smsCode)
      // 保存登录状态
      wx.setStorageSync('token', res.accessToken || res.token)
      if (res.refreshToken) wx.setStorageSync('refreshToken', res.refreshToken)
      if (res.userId) wx.setStorageSync('userId', res.userId)

      wx.showToast({ title: '注册成功', icon: 'success', duration: 1500 })
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/index/index' })
      }, 1500)
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 返回登录页 */
  goToLogin() {
    wx.navigateBack()
  }
})
