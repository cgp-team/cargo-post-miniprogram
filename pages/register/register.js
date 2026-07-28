/**
 * 注册页面逻辑 - 支持用户/司机双角色
 */
const api = require('../../utils/api')
const util = require('../../utils/util')

Page({
  data: {
    role: 'user', // 'user' | 'driver'
    form: {
      phone: '',
      password: '',
      confirmPassword: '',
      realName: '',
      idCard: '',
      // 司机专用字段
      plateNumber: '',
      driverLicense: '',
      busRoute: '',
      company: ''
    },
    agreed: false,
    loading: false,
    busRoutes: [
      'C101路 - 县城至大湾村',
      'C102路 - 县城至青山镇',
      'C201路 - 县城至竹林乡',
      'C202路 - 县城至溪口村',
      'C301路 - 县城至双河镇',
      'C302路 - 县城至云山村',
      'C303路 - 县城至桃花源'
    ]
  },

  onLoad(options) {
    if (options.role) {
      this.setData({ role: options.role })
    }
  },

  /**
   * 表单字段更新
   */
  onFieldChange(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    this.setData({
      [`form.${field}`]: value
    })
  },

  /**
   * 线路选择
   */
  onRouteChange(e) {
    const index = e.detail.value
    this.setData({
      'form.busRoute': this.data.busRoutes[index]
    })
  },

  /**
   * 协议勾选
   */
  onAgreeChange(e) {
    this.setData({
      agreed: e.detail.value.length > 0
    })
  },

  /**
   * 表单验证
   */
  validateForm() {
    const { form, role } = this.data

    if (!util.validatePhone(form.phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return false
    }
    if (!util.validatePassword(form.password)) {
      wx.showToast({ title: '密码为6-20位字母或数字', icon: 'none' })
      return false
    }
    if (form.password !== form.confirmPassword) {
      wx.showToast({ title: '两次密码输入不一致', icon: 'none' })
      return false
    }
    if (!form.realName.trim()) {
      wx.showToast({ title: '请输入真实姓名', icon: 'none' })
      return false
    }
    if (!util.validateIdCard(form.idCard)) {
      wx.showToast({ title: '请输入正确的身份证号', icon: 'none' })
      return false
    }

    // 司机额外验证
    if (role === 'driver') {
      if (!form.plateNumber.trim()) {
        wx.showToast({ title: '请输入车牌号码', icon: 'none' })
        return false
      }
      if (!form.driverLicense.trim()) {
        wx.showToast({ title: '请输入驾驶证号', icon: 'none' })
        return false
      }
    }

    if (!this.data.agreed) {
      wx.showToast({ title: '请阅读并同意服务协议', icon: 'none' })
      return false
    }

    return true
  },

  /**
   * 提交注册
   */
  async handleRegister() {
    if (!this.validateForm()) return

    this.setData({ loading: true })

    try {
      const { role, form } = this.data

      // 根据角色调用不同的注册接口
      const registerApi = role === 'driver' ? api.registerDriver : api.registerUser
      const res = await registerApi(form)

      wx.showToast({
        title: '注册成功',
        icon: 'success',
        duration: 2000
      })

      // 注册成功，回到登录页
      setTimeout(() => {
        wx.navigateBack()
      }, 2000)

    } catch (err) {
      wx.showToast({
        title: err.message || '注册失败，请重试',
        icon: 'none'
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 返回登录页
   */
  goToLogin() {
    wx.navigateBack()
  }
})
