/**
 * 页面公共样板：状态栏高度 + 外观（主题/老年模式）注入
 * 用法：behaviors: [require('../../behaviors/page-base')]（层级按页面深度调整）
 *   onLoad/onShow 中：this._initPageBase() 或 this._applyAppearance()
 */
const appearance = require('../utils/appearance')

module.exports = Behavior({
  data: {
    statusBarHeight: 20
  },
  methods: {
    _initPageBase() {
      const { statusBarHeight } = wx.getWindowInfo()
      this.setData({ statusBarHeight: statusBarHeight || 20 })
      appearance.apply(this)
    },
    _applyAppearance() {
      appearance.apply(this)
    }
  }
})
