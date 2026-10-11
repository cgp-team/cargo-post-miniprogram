/**
 * 意见反馈页 - 提交反馈 + 我的反馈列表（含平台回复）
 * 接口：transport/feedback/create、transport/feedback/page
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')
const feedback = require('../../../utils/feedback')
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
    // 附图（最多 3 张）：临时路径用于预览，photoUrls 为上传后的真实 URL
    photos: [],
    photoUrls: [],
    uploading: false,
    submitting: false,
    // 我的反馈
    list: [],
    pageNo: 1,
    pageSize: 10,
    total: 0,
    hasMore: true,
    loading: false,
    loadError: false // 首屏加载失败（错误态带"重新加载"入口）
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

  /** 选附图（最多 3 张）并逐张上传拿真实 URL（管理端按链接看图） */
  choosePhoto() {
    const left = 3 - this.data.photos.length
    if (left <= 0 || this.data.uploading) return
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      success: async (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath)
        if (!paths.length) return
        this.setData({
          photos: this.data.photos.concat(paths),
          uploading: true
        })
        // 逐张上传：失败的剔除并提示，其余保留（上传中断不至于整批丢）
        for (const p of paths) {
          try {
            const url = await api.uploadFile(p)
            this.setData({ photoUrls: this.data.photoUrls.concat([url]) })
          } catch (e) {
            this.setData({ photos: this.data.photos.filter((x) => x !== p) })
            wx.showToast({ title: '有图片上传失败，可重选', icon: 'none' })
          }
        }
        this.setData({ uploading: false })
      }
    })
  },

  /** 删除附图（按临时路径同步撤掉已上传 URL） */
  removePhoto(e) {
    const index = Number(e.currentTarget.dataset.index)
    const photos = this.data.photos.slice()
    const photoUrls = this.data.photoUrls.slice()
    photos.splice(index, 1)
    photoUrls.splice(index, 1)
    this.setData({ photos, photoUrls })
  },

  /** 预览附图 */
  previewPhoto(e) {
    const index = Number(e.currentTarget.dataset.index)
    wx.previewImage({ urls: this.data.photos, current: this.data.photos[index] })
  },

  /** 提交反馈 */
  async submit() {
    if (this.data.submitting) return // 防重复点击（按钮已 disabled，双保险）
    if (this.data.uploading) {
      wx.showToast({ title: '图片上传中，请稍候', icon: 'none' })
      return
    }
    const { content, name, mobile, photoUrls } = this.data
    if (!content.trim()) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    // 后端尚无图片字段（DTO 仅 content/name/mobile），附图以链接形式附在正文末尾；
    // 后端 content 限 500 字，先校验总长避免提交被拒
    const suffix = photoUrls.length ? `\n附图：${photoUrls.join(' ')}` : ''
    const finalContent = content.trim() + suffix
    if (finalContent.length > 500) {
      wx.showToast({ title: '文字+附图超出 500 字，请精简', icon: 'none', duration: 2500 })
      return
    }
    this.setData({ submitting: true })
    try {
      await api.createFeedback({
        content: finalContent,
        name: name.trim(),
        mobile: mobile.trim()
      })
      feedback.tap()
      wx.showToast({ title: '感谢反馈', icon: 'success' })
      this.setData({ content: '', photos: [], photoUrls: [] })
      this.reloadList()
    } catch (e) { /* api 已 toast */ } finally {
      this.setData({ submitting: false })
    }
  },

  reloadList() {
    this.setData({ pageNo: 1, list: [], total: 0, hasMore: true, loadError: false })
    return this.loadList()
  },

  async loadList() {
    // 竞态守卫：提交成功触发的 reload 与在途的"加载更多"并发时，旧响应不得覆盖新列表；
    // pageNo 在请求发起时定格，避免刷新重置 pageNo=1 后旧的分页响应误按第 1 页整表替换
    const seq = (this._listSeq = (this._listSeq || 0) + 1)
    const pageNo = this.data.pageNo
    this.setData({ loading: true, loadError: false })
    try {
      const res = await api.pageMyFeedback({ pageNo, pageSize: this.data.pageSize })
      if (seq !== this._listSeq) return
      const list = (res.list || []).map((f) => ({ ...f, createTimeText: formatBackendTime(f.createTime) }))
      const merged = pageNo === 1 ? list : this.data.list.concat(list)
      this.setData({ list: merged, total: res.total || 0, hasMore: merged.length < (res.total || 0) })
    } catch (e) {
      if (seq !== this._listSeq) return
      // api 已 toast；首屏无数据时进入错误态，可点"重新加载"
      if (!this.data.list.length) this.setData({ loadError: true })
    } finally {
      if (seq === this._listSeq) this.setData({ loading: false })
    }
  },

  onReachBottom() {
    if (this.data.loading || !this.data.hasMore) return
    this.setData({ pageNo: this.data.pageNo + 1 })
    this.loadList()
  }
})
