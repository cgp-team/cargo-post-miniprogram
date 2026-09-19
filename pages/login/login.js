/**
 * 登录页面 - 对接 Java 后端 member 模块
 * 支持：短信验证码登录 / 微信一键登录 / 密码登录
 */
const api = require('../../utils/api')
const util = require('../../utils/util')
const feedback = require('../../utils/feedback')
const appearance = require('../../utils/appearance')

/** 测试验证码提示仅非正式版可见；读取环境信息失败按正式版处理（宁可不提示，不可让 Page 注册失败） */
function isNotRelease() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion !== 'release'
  } catch (e) {
    return false
  }
}

Page({
  data: {
    phone: '',
    password: '',
    smsCode: '',
    smsCodeSending: false,
    smsCountdown: 0,
    loginMode: 'sms', // 'sms' | 'password'
    loading: false,
    // 测试验证码提示仅非正式版可见
    showSmsTip: isNotRelease(),
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: ''
  },

  onLoad() {
    appearance.apply(this)
  },

  onShow() {
    // 小程序后台 setInterval 会被节流：回前台按截止时间戳立即校准一次倒计时
    if (this._smsTimer) this._tickSmsCountdown()
  },

  onUnload() {
    this._clearSmsTimer()
    // 登录成功后的延迟跳转：页面已销毁就不再抢跳（用户已主动离开）
    if (this._redirectTimer) {
      clearTimeout(this._redirectTimer)
      this._redirectTimer = null
    }
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
      this._startSmsCountdown()
    } catch (err) {
      // 错误提示已由 api.js 处理
    } finally {
      this.setData({ smsCodeSending: false })
    }
  },

  /**
   * 60s 倒计时：按截止时间戳算剩余，而非"每秒 -1"。
   * 小程序退后台后 setInterval 被节流，按次递减会让倒计时比真实时间慢，
   * 用户看到还在倒数、服务端却已放行/过期；时间戳口径回前台即校准。
   */
  _startSmsCountdown() {
    this._clearSmsTimer()
    this._smsEndAt = Date.now() + 60 * 1000
    this.setData({ smsCountdown: 60 })
    this._smsTimer = setInterval(() => this._tickSmsCountdown(), 1000)
  },

  _tickSmsCountdown() {
    const left = Math.max(0, Math.ceil((this._smsEndAt - Date.now()) / 1000))
    if (left <= 0) this._clearSmsTimer()
    if (left !== this.data.smsCountdown) this.setData({ smsCountdown: left })
  },

  _clearSmsTimer() {
    if (this._smsTimer) {
      clearInterval(this._smsTimer)
      this._smsTimer = null
    }
  },

  /** 登录按钮统一入口：按当前登录模式分发 */
  handleLogin() {
    if (this.data.loading) return // 防重复点击（请求中）
    if (this.data.loginMode === 'sms') this.handleSmsLogin()
    else this.handlePasswordLogin()
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
    if (this.data.loading || this._wechatStarting) return // 防重复点击（wx.login 返回前 loading 尚未置位，需单独把守）
    // e.detail.code 为动态令牌（需小程序已开通"手机号快捷验证"能力）；未开通或用户拒绝时无 code
    const phoneCode = e.detail.code
    if (!phoneCode) {
      wx.showToast({ title: '手机号授权失败，请使用验证码登录', icon: 'none', duration: 2500 })
      return
    }
    // 1. wx.login() 获取 loginCode
    this._wechatStarting = true
    wx.login({
      success: (res) => {
        this._wechatStarting = false
        if (!res.code) {
          wx.showToast({ title: '微信登录失败，请重试', icon: 'none' })
          return
        }
        this._wechatLogin(phoneCode, res.code)
      },
      fail: () => {
        this._wechatStarting = false
        wx.showToast({ title: '微信登录失败，请重试', icon: 'none' })
      }
    })
  },

  /** 2. 调用后端微信一键登录（phoneCode + loginCode） */
  async _wechatLogin(phoneCode, loginCode) {
    this.setData({ loading: true })
    try {
      // state：随机字符串（后端校验非空，用于防 CSRF）
      const state = 'wx' + Date.now() + Math.random().toString(36).slice(2, 10)
      const res = await api.wechatMiniAppLogin(phoneCode, loginCode, state)
      this._onLoginSuccess(res)
    } catch (err) {
      // 错误提示已由 api.js 统一处理
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 登录成功处理 */
  async _onLoginSuccess(res) {
    feedback.tap()
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
    // 记录句柄：onUnload 时清掉，避免页面销毁后回调里再抢跳（会把用户从新页面拽走）
    this._redirectTimer = setTimeout(() => {
      this._redirectTimer = null
      this._redirectAfterLogin()
    }, 1500)
  },

  /** 登录成功后跳回来源页（requireLogin 记录的 loginRedirect）；无来源则回首页 */
  _redirectAfterLogin() {
    const redirect = wx.getStorageSync('loginRedirect')
    if (redirect && redirect.url) {
      wx.removeStorageSync('loginRedirect')
      if (redirect.isTab) {
        wx.switchTab({ url: redirect.url })
      } else {
        wx.redirectTo({ url: redirect.url })
      }
      return
    }
    wx.reLaunch({ url: '/pages/index/index' })
  },

  /** 大字模式（老年模式）开关 */
  toggleElderly() {
    const next = !this.data.elderlyMode
    feedback.tap()
    wx.setStorageSync('elderlyMode', next)
    getApp().globalData.elderlyMode = next
    appearance.apply(this)
  }
})
