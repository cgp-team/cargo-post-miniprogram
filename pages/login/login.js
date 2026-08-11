/**
 * 登录页面 - 对接 Java 后端 member 模块
 * 支持：短信验证码登录 / 微信一键登录 / 密码登录
 */
const api = require('../../utils/api')
const util = require('../../utils/util')
const appearance = require('../../utils/appearance')

Page({
  data: {
    phone: '',
    password: '',
    smsCode: '',
    smsCodeSending: false,
    smsCountdown: 0,
    loginMode: 'sms', // 'sms' | 'password'
    loading: false,
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: ''
  },

  onLoad() {
    appearance.apply(this)
  },

  /** 切换登录方式 */
  switchMode() {
    const next = this.data.loginMode === 'sms' ? 'password' : 'sms'
    this.setData({ loginMode: next })
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value })
  },
  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },
  onSmsCodeInput(e) {
    this.setData({ smsCode: e.detail.value })
  },

  /** 发送短信验证码 */
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
      // 60秒倒计时
      this.setData({ smsCountdown: 60 })
      const timer = setInterval(() => {
        const count = this.data.smsCountdown - 1
        if (count <= 0) clearInterval(timer)
        this.setData({ smsCountdown: count })
      }, 1000)
    } catch (err) {
      // 错误提示已由 api.js 处理
    } finally {
      this.setData({ smsCodeSending: false })
    }
  },

  /** 短信验证码登录 */
  async handleSmsLogin() {
    const { phone, smsCode } = this.data
    if (!util.validatePhone(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    if (!smsCode || smsCode.length < 4) {
      wx.showToast({ title: '请输入验证码', icon: 'none' })
      return
    }
    // 测试环境固定验证码 9999
    this.setData({ loading: true })
    try {
      const res = await api.smsLogin(phone, smsCode)
      this._onLoginSuccess(res)
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 密码登录 */
  async handlePasswordLogin() {
    const { phone, password } = this.data
    if (!util.validatePhone(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    if (!password || password.length < 4) {
      wx.showToast({ title: '请输入密码', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const res = await api.login(phone, password)
      this._onLoginSuccess(res)
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 微信小程序一键登录：手机号快捷验证回调 */
  onWechatPhoneNumber(e) {
    // e.detail.code 为动态令牌（需小程序已开通"手机号快捷验证"能力）；未开通或用户拒绝时无 code
    const phoneCode = e.detail.code
    if (!phoneCode) {
      wx.showToast({ title: '手机号授权失败，请使用验证码登录', icon: 'none', duration: 2500 })
      return
    }
    // 1. wx.login() 获取 loginCode
    wx.login({
      success: (res) => {
        if (!res.code) {
          wx.showToast({ title: '微信登录失败，请重试', icon: 'none' })
          return
        }
        this._wechatLogin(phoneCode, res.code)
      },
      fail: () => {
        wx.showToast({ title: '微信登录失败，请重试', icon: 'none' })
      }
    })
  },

  /** 2. 调用后端微信一键登录（phoneCode + loginCode） */
  async _wechatLogin(phoneCode, loginCode) {
    this.setData({ loading: true })
    try {
      const res = await api.wechatMiniAppLogin(phoneCode, loginCode, '')
      this._onLoginSuccess(res)
    } catch (err) {
      // 错误提示已由 api.js 统一处理
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 登录成功处理 */
  async _onLoginSuccess(res) {
    const token = res.accessToken || res.token
    wx.setStorageSync('token', token)
    if (res.refreshToken) wx.setStorageSync('refreshToken', res.refreshToken)
    if (res.userId) wx.setStorageSync('userId', res.userId)

    // 芋道标准流程：调用 /member/user/get 获取用户信息
    try {
      await api.getUserInfo().then(info => wx.setStorageSync('userInfo', info))
    } catch (e) {
      wx.setStorageSync('userInfo', { id: res.userId })
    }

    wx.showToast({ title: '登录成功', icon: 'success', duration: 1500 })
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/index/index' })
    }, 1500)
  },

  /** 跳转注册（引导到登录页短信注册） */
  goToRegister() {
    wx.showToast({ title: '新用户首次短信登录即自动注册', icon: 'none', duration: 2000 })
  }
})
