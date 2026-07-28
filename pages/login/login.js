/**
 * 登录页面逻辑 - 支持用户/司机双角色
 */
const api = require('../../utils/api')
const util = require('../../utils/util')

Page({
  data: {
    currentRole: 'user', // 'user' | 'driver'
    phone: '',
    password: '',
    loading: false,
    canWechatLogin: false
  },

  onLoad() {
    // 检查是否支持微信登录
    if (wx.getUserProfile) {
      this.setData({ canWechatLogin: true })
    }
  },

  /**
   * 切换角色
   */
  switchRole(e) {
    const role = e.currentTarget.dataset.role
    this.setData({ currentRole: role })
  },

  /**
   * 手机号输入
   */
  onPhoneInput(e) {
    this.setData({ phone: e.detail.value })
  },

  /**
   * 密码输入
   */
  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  /**
   * 表单验证
   */
  validateForm() {
    const { phone, password } = this.data

    if (!phone) {
      wx.showToast({ title: '请输入手机号', icon: 'none' })
      return false
    }
    if (!util.validatePhone(phone)) {
      wx.showToast({ title: '手机号格式不正确', icon: 'none' })
      return false
    }
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' })
      return false
    }
    if (!util.validatePassword(password)) {
      wx.showToast({ title: '密码为6-20位字母或数字', icon: 'none' })
      return false
    }
    return true
  },

  /**
   * 登录处理
   */
  async handleLogin() {
    if (!this.validateForm()) return

    this.setData({ loading: true })

    try {
      const res = await api.login({
        phone: this.data.phone,
        password: this.data.password,
        role: this.data.currentRole
      })

      // 保存登录信息
      wx.setStorageSync('token', res.data.token)
      wx.setStorageSync('userInfo', res.data.userInfo)

      wx.showToast({
        title: '登录成功',
        icon: 'success',
        duration: 1500
      })

      // 根据角色跳转不同首页
      const role = this.data.currentRole
      setTimeout(() => {
        if (role === 'driver') {
          wx.reLaunch({
            url: '/pages/driver/workbench/workbench'
          })
        } else {
          wx.reLaunch({
            url: '/pages/index/index'
          })
        }
      }, 1500)

    } catch (err) {
      wx.showToast({
        title: err.message || '登录失败，请重试',
        icon: 'none'
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 微信一键登录
   */
  handleWechatLogin() {
    const that = this

    wx.getUserProfile({
      desc: '用于完善用户信息',
      success: (profileRes) => {
        // 获取微信用户信息后,调用wx.login获取code
        wx.login({
          success: async (loginRes) => {
            try {
              const res = await api.wechatLogin(loginRes.code)

              // 合并微信用户信息
              const userInfo = {
                ...res.data.userInfo,
                nickName: profileRes.userInfo.nickName,
                avatarUrl: profileRes.userInfo.avatarUrl
              }

              wx.setStorageSync('token', res.data.token)
              wx.setStorageSync('userInfo', userInfo)

              wx.showToast({
                title: '登录成功',
                icon: 'success'
              })

              setTimeout(() => {
                const role = that.data.currentRole
                if (role === 'driver') {
                  wx.reLaunch({
                    url: '/pages/driver/workbench/workbench'
                  })
                } else {
                  wx.reLaunch({
                    url: '/pages/index/index'
                  })
                }
              }, 1500)

            } catch (err) {
              wx.showToast({
                title: '微信登录失败，请使用手机号登录',
                icon: 'none'
              })
            }
          }
        })
      },
      fail: () => {
        wx.showToast({
          title: '已取消授权',
          icon: 'none'
        })
      }
    })
  },

  /**
   * 跳转到注册页面
   */
  goToRegister() {
    wx.navigateTo({
      url: '/pages/register/register?role=' + this.data.currentRole
    })
  }
})
