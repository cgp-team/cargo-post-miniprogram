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
    products: [
      {
        id: 1,
        name: '高山脆李',
        fromVillage: '云山村',
        price: '68.00',
        unit: '斤',
        image: '🍑',
        badge: '大巴直通车'
      },
      {
        id: 2,
        name: '土鸡蛋30枚装',
        fromVillage: '大湾村',
        price: '45.00',
        unit: '箱',
        image: '🥚',
        badge: '大巴直通车'
      },
      {
        id: 3,
        name: '有机红薯粉',
        fromVillage: '竹林乡',
        price: '28.00',
        unit: '袋',
        image: '🍜',
        badge: ''
      },
      {
        id: 4,
        name: '野生山核桃',
        fromVillage: '青山镇',
        price: '55.00',
        unit: '斤',
        image: '🥜',
        badge: '大巴直通车'
      },
      {
        id: 5,
        name: '明前龙井茶',
        fromVillage: '云山村',
        price: '128.00',
        unit: '盒',
        image: '🍵',
        badge: ''
      },
      {
        id: 6,
        name: '农家腊肉',
        fromVillage: '溪口村',
        price: '88.00',
        unit: '斤',
        image: '🥩',
        badge: '大巴直通车'
      }
    ]
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
  },

  onShow() {
    const app = getApp()
    this.setData({ currentVillage: app.globalData.currentVillage || '云山村' })
    // 同步老年模式 / 主题色（设置页改动后回来立即生效）
    appearance.apply(this)
  },

  /** 切换分类 */
  switchCategory(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ activeCategory: id })
  },

  /** 点击商品 */
  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.showToast({ title: '商品详情开发中', icon: 'none' })
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
    wx.stopPullDownRefresh()
    wx.showToast({ title: '已刷新', icon: 'success', duration: 1000 })
  }
})
