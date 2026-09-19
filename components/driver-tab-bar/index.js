/**
 * 司机端自定义底部导航栏（暗色）
 * - hover 按压态 + 轻触感反馈，与用户版 TabBar 体验对齐
 * - 非 tab 页间切换用 redirectTo：保留返回手势且无 reLaunch 的重建闪烁；
 *   仅回用户版时用 switchTab（跳入 tab 页必须用它）
 */
const feedback = require('../../utils/feedback')
const { navThrottled } = require('../../utils/util')

Component({
  properties: {
    current: {
      type: String,
      value: 'workbench'
    },
    /** 老年人模式：字号/图标放大（由页面传入） */
    elderly: {
      type: Boolean,
      value: false
    }
  },

  data: {
    tabs: [
      { key: 'workbench', label: '工作台', icon: 'bus' },
      { key: 'routes', label: '我的路线', icon: 'road' },
      { key: 'earnings', label: '我的收益', icon: 'wallet' },
      { key: 'exit', label: '用户版', icon: 'user' }
    ]
  },

  methods: {
    switchTab(e) {
      const key = e.currentTarget.dataset.key
      if (key === this.data.current) return
      // 防连点：redirectTo 飞行中再触发会叠导航/报 fail（工作台 ↔ 路线 ↔ 收益快速来回点）
      if (navThrottled(this)) return

      feedback.tap()

      if (key === 'exit') {
        wx.switchTab({ url: '/pages/index/index' })
        return
      }

      wx.redirectTo({
        url: `/pages/driver/${key}/${key}`
      })
    }
  }
})
