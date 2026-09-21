/**
 * 自定义底部 TabBar — 客货邮小程序
 *
 * P0 fix: pageLifetimes.show() 替代 lifetimes.attached()
 *         确保每次页面显示时正确同步选中状态
 * 主题：每次显示时同步主题色变量（选中态颜色跟随主题）
 */
const appearance = require('../utils/appearance')

Component({
  data: {
    selected: 0,
    elderlyMode: false,
    themeStyle: '',
    list: [
      { pagePath: '/pages/index/index',  text: '首页', icon: 'home' },
      { pagePath: '/pages/goods/goods',  text: '商城', icon: 'shop' },
      { pagePath: '/pages/parcel/parcel', text: '快递', icon: 'box' },
      { pagePath: '/pages/mine/mine',   text: '我的', icon: 'user' }
    ]
  },

  lifetimes: {
    attached() {
      this._syncSelected()
    }
  },

  pageLifetimes: {
    show() {
      this._syncSelected()
    }
  },

  methods: {
    /** 根据当前页面路由同步选中 tab */
    _syncSelected() {
      // 同步主题色与老年人模式（含切主题后回首页的情况）
      const s = appearance.getSettings()
      this.setData({
        themeStyle: appearance.themeStyle(s.themeColor),
        elderlyMode: s.elderlyMode
      })

      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      if (!page) return
      const route = '/' + page.route
      const idx = this.data.list.findIndex(t => t.pagePath === route)
      if (idx >= 0 && idx !== this.data.selected) {
        this.setData({ selected: idx })
      }
    },

    /** 切换 tab — 立即反馈，不阻塞 */
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index)
      const path = e.currentTarget.dataset.path
      // 按真实路由判重：选中态在切换动画期间可能与当前页不一致，只看 data.selected 会误拦截
      const pages = getCurrentPages()
      const cur = pages[pages.length - 1]
      if (cur && '/' + cur.route === path) return

      // 立即更新本地状态，消除点击延迟感
      this.setData({ selected: index })
      wx.switchTab({ url: path })
    }
  }
})
