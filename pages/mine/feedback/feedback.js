/**
 * 意见反馈页 - 提交反馈 + 我的反馈列表（含平台回复）
 * 接口：transport/feedback/create、transport/feedback/page
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')
const { formatBackendTime } = require('../../../utils/util')

Page({
  data: {
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    // 提交表单
    content: '',
    name: '',
    mobile: '',
    submitting: false,
    // 我的反馈
    list: [],
    pageNo: 1,
    pageSize: 10,
    total: 0,
    hasMore: true,
    loading: false
  },

  onLoad() {
    appearance.apply(this)
    const userInfo = wx.getStorageSync('userInfo') || {}
    this.setData({ name: userInfo.nickname || '', mobile: userInfo.mobile || '' })
    this.reloadList()
  },

  onShow() {
    appearance.apply(this)
  },

  onContentInput(e) { this.setData({ content: e.detail.value }) },
  onNameInput(e) { this.setData({ name: e.detail.value }) },
  onMobileInput(e) { this.setData({ mobile: e.detail.value }) },

  /** 提交反馈 */
  async submit() {
    const { content, name, mobile } = this.data
    if (!content.trim()) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      await api.createFeedback({
        content: content.trim(),
        name: name.trim(),
        mobile: mobile.trim()
      })
      wx.showToast({ title: '已提交，感谢反馈', icon: 'success' })
      this.setData({ content: '' })
      this.reloadList()
    } catch (e) { /* api 已 toast */ } finally {
      this.setData({ submitting: false })
    }
  },

  reloadList() {
    this.setData({ pageNo: 1, list: [], total: 0, hasMore: true })
    return this.loadList()
  },

  async loadList() {
    this.setData({ loading: true })
    try {
      const res = await api.pageMyFeedback({ pageNo: this.data.pageNo, pageSize: this.data.pageSize })
      const list = (res.list || []).map((f) => ({ ...f, createTimeText: formatBackendTime(f.createTime) }))
      const merged = this.data.pageNo === 1 ? list : this.data.list.concat(list)
      this.setData({ list: merged, total: res.total || 0, hasMore: merged.length < (res.total || 0) })
    } catch (e) { /* api 已 toast */ } finally {
      this.setData({ loading: false })
    }
  },

  onReachBottom() {
    if (this.data.loading || !this.data.hasMore) return
    this.setData({ pageNo: this.data.pageNo + 1 })
    this.loadList()
  }
})
