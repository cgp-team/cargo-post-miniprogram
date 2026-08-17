/**
 * 个人资料页 - 编辑昵称/头像/性别 + 修改密码
 * 接口：member/user/get、member/user/update、member/user/update-password（验证码 scene=3）
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')

Page({
  data: {
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    // 资料表单
    nickname: '',
    avatar: '',
    sex: 0, // 0未知 1男 2女
    mobile: '',
    saving: false,
    // 修改密码表单
    password: '',
    passwordConfirm: '',
    smsCode: '',
    codeCountdown: 0,
    changingPwd: false
  },

  onLoad() {
    appearance.apply(this)
    this.loadProfile()
  },

  onShow() {
    appearance.apply(this)
  },

  /** 拉取最新用户信息预填表单 */
  async loadProfile() {
    try {
      const user = await api.getUserInfo()
      this.setData({
        nickname: user.nickname || '',
        avatar: user.avatar || '',
        sex: user.sex == null ? 0 : user.sex,
        mobile: user.mobile || ''
      })
      // 同步本地缓存，保证我的页展示最新
      wx.setStorageSync('userInfo', Object.assign(wx.getStorageSync('userInfo') || {}, user))
    } catch (e) { /* api 已 toast */ }
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  /** 选择性别 */
  selectSex(e) {
    this.setData({ sex: Number(e.currentTarget.dataset.value) })
  },

  /** 选择并上传头像 */
  chooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: async (res) => {
        const file = res.tempFiles[0]
        if (!file) return
        wx.showLoading({ title: '上传中…', mask: true })
        try {
          const url = await api.uploadFile(file.tempFilePath)
          this.setData({ avatar: url })
        } catch (e) { /* api 已 toast */ } finally {
          wx.hideLoading()
        }
      }
    })
  },

  /** 保存资料（后端 nickname/avatar/sex 均按必填校验，回传当前表单值即可） */
  async saveProfile() {
    const nickname = this.data.nickname.trim()
    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const payload = { nickname, sex: this.data.sex }
      // avatar 带 @URL 校验，未设置时省略该字段（后端 updateById 只更新非空字段）
      if (this.data.avatar) payload.avatar = this.data.avatar
      await api.updateUser(payload)
      const cached = wx.getStorageSync('userInfo') || {}
      wx.setStorageSync('userInfo', Object.assign(cached, { nickname, avatar: this.data.avatar, sex: this.data.sex }))
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 800)
    } catch (e) { /* api 已 toast */ } finally {
      this.setData({ saving: false })
    }
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  onPasswordConfirmInput(e) {
    this.setData({ passwordConfirm: e.detail.value })
  },

  onSmsCodeInput(e) {
    this.setData({ smsCode: e.detail.value })
  },

  /** 发送改密验证码（scene=3 MEMBER_UPDATE_PASSWORD） */
  async sendPwdCode() {
    if (this.data.codeCountdown > 0) return
    if (!this.data.mobile) {
      wx.showToast({ title: '未获取到手机号', icon: 'none' })
      return
    }
    try {
      await api.sendSmsCode(this.data.mobile, 3)
      wx.showToast({ title: '验证码已发送', icon: 'none' })
      this.setData({ codeCountdown: 60 })
      this._timer = setInterval(() => {
        const left = this.data.codeCountdown - 1
        if (left <= 0) {
          clearInterval(this._timer)
          this.setData({ codeCountdown: 0 })
        } else {
          this.setData({ codeCountdown: left })
        }
      }, 1000)
    } catch (e) { /* api 已 toast */ }
  },

  /** 提交修改密码 */
  async changePassword() {
    const { password, passwordConfirm, smsCode } = this.data
    if (!smsCode.trim()) {
      wx.showToast({ title: '请输入短信验证码', icon: 'none' })
      return
    }
    if (password.length < 4 || password.length > 16) {
      wx.showToast({ title: '密码长度需为 4-16 位', icon: 'none' })
      return
    }
    if (password !== passwordConfirm) {
      wx.showToast({ title: '两次密码不一致', icon: 'none' })
      return
    }
    this.setData({ changingPwd: true })
    try {
      await api.updatePassword({ password, code: smsCode.trim() })
      wx.showToast({ title: '密码已修改', icon: 'success' })
      this.setData({ password: '', passwordConfirm: '', smsCode: '' })
    } catch (e) { /* api 已 toast */ } finally {
      this.setData({ changingPwd: false })
    }
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer)
  }
})
