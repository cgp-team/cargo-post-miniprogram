/**
 * 商城页 - 买家界面
 * 农产品选购，融合生鲜电商风格
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')

Page({
  data: {
    userInfo: {},
    currentVillage: '云山村',
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    activeCategory: 0,
    categories: [
      { id: 0, name: '全部' },
      { id: 1, name: '水果' },
      { id: 2, name: '蔬菜' },
      { id: 3, name: '禽蛋' },
      { id: 4, name: '茶叶' },
      { id: 5, name: '干货' }
    ],
    products: [],
    loading: true
  },

  onLoad() {
    const sys = wx.getWindowInfo()
    this.setData({ statusBarHeight: sys.statusBarHeight || 20 })
    const userInfo = wx.getStorageSync('userInfo')
    const app = getApp()
    this.setData({
      userInfo: userInfo || {},
      currentVillage: app.globalData.currentVillage || '云山村'
    })
    appearance.apply(this)
    this.loadProducts()
  },

  onShow() {
    const app = getApp()
    this.setData({ currentVillage: app.globalData.currentVillage || '云山村' })
    // 同步老年模式 / 主题色（设置页改动后回来立即生效）
    appearance.apply(this)
  },

  /** 加载上架商品（后端真实数据） */
  async loadProducts() {
    this.setData({ loading: true })
    try {
      const list = (await api.listProducts()) || []
      this.setData({
        products: list.map((p) => ({ ...p, price: Number(p.price).toFixed(2) }))
      })
    } catch (e) {
      // 错误提示已由 api.js 统一处理
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 切换分类 */
  switchCategory(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ activeCategory: id })
  },

  /** 点击商品 → 跳详情页 */
  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/goods/detail/detail?id=${id}` })
  },

  /** 切换村庄 */
  switchVillage() {
    const villages = ['云山村', '大湾村', '青山镇', '竹林乡', '溪口村', '双河镇']
    wx.showActionSheet({
      itemList: villages,
      success: (res) => {
        getApp().globalData.currentVillage = villages[res.tapIndex]
        this.setData({ currentVillage: villages[res.tapIndex] })
      }
    })
  },

  /** 下拉刷新 */
  onPullDownRefresh() {
    this.loadProducts().then(() => {
      wx.stopPullDownRefresh()
      wx.showToast({ title: '已刷新', icon: 'success', duration: 1000 })
    })
  }
})
