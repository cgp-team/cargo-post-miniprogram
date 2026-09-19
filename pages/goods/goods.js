/**
 * 商城页 - 买家界面
 * 农产品选购，融合生鲜电商风格
 */
const api = require('../../utils/api')
const productImg = require('../../utils/product-img')
const { VILLAGES } = require('../../utils/util')

/** 分类名 → 商品名关键词（后端暂无分类字段，按名称归类） */
const CATEGORY_KEYWORDS = {
  1: ['果', '柚', '橙', '李', '桃'],        // 水果（'果'兼顾泛水果名）
  2: ['菜', '萝卜', '红薯', '土豆', '菌', '笋'], // 蔬菜（薯类归蔬菜）
  3: ['蛋', '鸡', '鸭'],                   // 禽蛋（鸡蛋也在此类）
  4: ['茶'],                             // 茶叶（油茶/苦丁茶同样命中）
  5: ['粉', '面', '干货', '核桃', '坚果', '花生', '栗', '蜂蜜', '腊'] // 干货/山货（红薯粉/粉丝归干货）
}

/** 商品归属分类 id，无匹配归 0（仅“全部”可见） */
function matchCategory(p) {
  const text = String((p && p.name) || '')
  for (const id in CATEGORY_KEYWORDS) {
    if (CATEGORY_KEYWORDS[id].some((k) => text.indexOf(k) >= 0)) return Number(id)
  }
  return 0
}

Page({
  behaviors: [require('../../behaviors/page-base')],
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
    allProducts: [],
    products: [],
    pageNo: 1,
    pageSize: 10,
    total: 0,
    hasMore: true,
    loading: true
  },

  onLoad() {
    this._initPageBase()
    const userInfo = wx.getStorageSync('userInfo')
    const app = getApp()
    this.setData({
      userInfo: userInfo || {},
      currentVillage: app.globalData.currentVillage || '云山村'
    })
    this.loadProducts()
  },

  onShow() {
    const app = getApp()
    this.setData({ currentVillage: app.globalData.currentVillage || '云山村' })
    // 同步老年模式 / 主题色（设置页改动后回来立即生效）
    this._applyAppearance()
    // 后台改了商品（价格/描述/图片/上下架）后回到商城要看到最新数据，而不是首屏的缓存
    if (this._loaded) this.reloadProducts()
  },

  /** 加载上架商品（分页，追加到 allProducts） */
  async loadProducts() {
    this.setData({ loading: true })
    try {
      const res = await api.listProductsPage({ pageNo: this.data.pageNo, pageSize: this.data.pageSize })
      const list = (res.list || []).map((p) => ({
        ...p,
        categoryId: matchCategory(p),
        price: Number(p.price).toFixed(2),
        imageUrl: productImg.resolve(p)
      }))
      const allProducts = this.data.pageNo === 1 ? list : this.data.allProducts.concat(list)
      const total = res.total || 0
      this._loaded = true
      this.setData({
        allProducts,
        total,
        hasMore: list.length >= this.data.pageSize && allProducts.length < total
      })
      this.applyCategory()
      return true
    } catch (e) {
      // 错误提示已由 api.js 统一处理；返回失败标记，避免下拉刷新误弹"已刷新"
      return false
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 重置分页并重新加载 */
  reloadProducts() {
    this.setData({ pageNo: 1, allProducts: [], total: 0, hasMore: true })
    return this.loadProducts()
  },

  /** 触底加载下一页 */
  onReachBottom() {
    if (this.data.loading || !this.data.hasMore) return
    this.setData({ pageNo: this.data.pageNo + 1 })
    this.loadProducts()
  },

  /** 按当前分类过滤展示列表 */
  applyCategory() {
    const id = this.data.activeCategory
    const products = id === 0
      ? this.data.allProducts
      : this.data.allProducts.filter((p) => p.categoryId === id)
    this.setData({ products })
  },

  /** 切换分类（同步过滤商品列表） */
  switchCategory(e) {
    const id = Number(e.currentTarget.dataset.id)
    if (id === this.data.activeCategory) return
    this.setData({ activeCategory: id })
    this.applyCategory()
  },

  /** 顶部头像 → 个人中心 */
  goToProfile() {
    wx.switchTab({ url: '/pages/mine/mine' })
  },

  /** 点击商品 → 跳详情页 */
  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/goods/detail/detail?id=${id}` })
  },

  /** 切换村庄 */
  switchVillage() {
    wx.showActionSheet({
      itemList: VILLAGES,
      success: (res) => {
        getApp().globalData.currentVillage = VILLAGES[res.tapIndex]
        this.setData({ currentVillage: VILLAGES[res.tapIndex] })
      }
    })
  },

  /** 下拉刷新 */
  onPullDownRefresh() {
    this.reloadProducts().then((ok) => {
      wx.stopPullDownRefresh()
      if (ok !== false) wx.showToast({ title: '已刷新', icon: 'success', duration: 1000 })
    })
  }
})
