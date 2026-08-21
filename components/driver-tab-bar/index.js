/**
 * 司机端自定义底部导航栏
 */
Component({
  properties: {
    current: {
      type: String,
      value: 'workbench'
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

      if (key === 'exit') {
        wx.switchTab({ url: '/pages/index/index' })
        return
      }

      wx.reLaunch({
        url: `/pages/driver/${key}/${key}`
      })
    }
  }
})
