/**
 * 收货地址管理页 - member/address 接口（list/create/update/delete）
 * 支持从寄件页进入选择地址（?from=send 时点击条目回填并返回）
 */
const api = require('../../../utils/api')
const appearance = require('../../../utils/appearance')
const feedback = require('../../../utils/feedback')

Page({
  data: {
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: '',
    from: '', // from=send 时为选择模式
    list: [],
    loading: false,
    loadError: false, // 列表加载失败（错误态带"重新加载"入口）
    saving: false, // 保存地址防重入（按钮 disabled 同步绑定）
    // 编辑弹层
    showForm: false,
    formId: null, // null=新增
    formName: '',
    formMobile: '',
    formDetail: '',
    formDefault: false,
    // 地区三级选择
    areaReady: false,
    areaColumns: [[], [], []], // 省/市/区 名称列
    areaIndex: [0, 0, 0],
    regionText: ''
  },

  onLoad(options) {
    appearance.apply(this)
    this.setData({ from: (options && options.from) || '' })
    this._provincial = [] // 省节点
    this._areaMap = {} // areaId -> { id, name, parentId }
    this.loadAreaTree()
    this.loadList()
  },

  onShow() {
    appearance.apply(this)
  },

  /** 地区树：缓存到 storage（7 天有效），避免每次拉全量 */
  async loadAreaTree() {
    try {
      const cache = wx.getStorageSync('areaTree')
      let tree
      if (cache && cache.list && cache.list.length && cache.ts && Date.now() - cache.ts < 7 * 24 * 3600 * 1000) {
        tree = cache.list
      } else {
        tree = await api.getAreaTree()
        wx.setStorageSync('areaTree', { list: tree, ts: Date.now() })
      }
      this._provincial = tree
      const map = {}
      const walk = (nodes, parentId) => {
        ;(nodes || []).forEach((n) => {
          map[n.id] = { id: n.id, name: n.name, parentId }
          if (n.children) walk(n.children, n.id)
        })
      }
      walk(tree, 0)
      this._areaMap = map
      this.rebuildColumns([0, 0, 0])
      this.setData({ areaReady: true })
      // 列表可能先于地区树返回，补算区域文本
      if (this.data.list.length) this.decorateList(this.data.list)
    } catch (e) { /* api 已 toast */ }
  },

  /** 按索引重建省市区三列（picker multiSelector） */
  rebuildColumns(index) {
    const provinces = this._provincial
    const p = Math.min(index[0], Math.max(provinces.length - 1, 0))
    const cities = (provinces[p] && provinces[p].children) || []
    const c = Math.min(index[1], Math.max(cities.length - 1, 0))
    const districts = (cities[c] && cities[c].children) || []
    this.setData({
      areaColumns: [provinces.map((i) => i.name), cities.map((i) => i.name), districts.map((i) => i.name)],
      areaIndex: [p, c, Math.min(index[2], Math.max(districts.length - 1, 0))]
    })
    this._cities = cities
    this._districts = districts
  },

  onAreaColumnChange(e) {
    const idx = this.data.areaIndex.slice()
    idx[e.detail.column] = e.detail.value
    // 级联重置后续列
    for (let i = e.detail.column + 1; i < 3; i++) idx[i] = 0
    this.rebuildColumns(idx)
  },

  onAreaChange(e) {
    const idx = e.detail.value
    const d = this._districts[idx[2]]
    const names = this.data.areaColumns
    this.setData({
      areaIndex: idx,
      regionText: names[0][idx[0]] + ' ' + (names[1][idx[1]] || '') + ' ' + (names[2][idx[2]] || '')
    })
    this._selectedAreaId = d ? d.id : null
  },

  /** 由 areaId 反推「省 市 区」文本与 picker 索引 */
  resolveRegion(areaId) {
    const node = this._areaMap[areaId]
    if (!node) return { text: '', index: [0, 0, 0] }
    const city = this._areaMap[node.parentId]
    const prov = city ? this._areaMap[city.parentId] : null
    const text = [prov && prov.name, city && city.name, node.name].filter(Boolean).join(' ')
    // 定位索引（编辑预填用）
    const pIdx = this._provincial.findIndex((p) => prov && p.id === prov.id)
    const cities = pIdx >= 0 ? this._provincial[pIdx].children || [] : []
    const cIdx = cities.findIndex((c) => city && c.id === city.id)
    const districts = cIdx >= 0 ? cities[cIdx].children || [] : []
    const dIdx = districts.findIndex((d) => d.id === areaId)
    return { text, index: [Math.max(pIdx, 0), Math.max(cIdx, 0), Math.max(dIdx, 0)] }
  },

  /** 列表条目补充区域文本 */
  decorateList(list) {
    const decorated = list.map((a) => ({ ...a, regionText: this.resolveRegion(a.areaId).text }))
    this.setData({ list: decorated })
  },

  async loadList() {
    // 竞态守卫：新增/删除/设默认后各自触发刷新，旧响应不得覆盖新列表
    const seq = (this._listSeq = (this._listSeq || 0) + 1)
    this.setData({ loading: true, loadError: false })
    try {
      const list = (await api.listAddresses()) || []
      if (seq !== this._listSeq) return
      if (this._areaMap && Object.keys(this._areaMap).length) this.decorateList(list)
      else this.setData({ list })
    } catch (e) {
      if (seq !== this._listSeq) return
      // api 已 toast；首屏无数据时进入错误态，可点"重新加载"
      if (!this.data.list.length) this.setData({ loadError: true })
    } finally {
      if (seq === this._listSeq) this.setData({ loading: false })
    }
  },

  /** 打开新增/编辑弹层 */
  openForm(e) {
    const item = e.currentTarget.dataset.item
    if (item) {
      const region = this.data.areaReady ? this.resolveRegion(item.areaId) : { text: '', index: [0, 0, 0] }
      if (this.data.areaReady) this.rebuildColumns(region.index)
      this._selectedAreaId = item.areaId
      this.setData({
        showForm: true,
        formId: item.id,
        formName: item.name,
        formMobile: item.mobile,
        formDetail: item.detailAddress,
        formDefault: !!item.defaultStatus,
        regionText: region.text,
        areaIndex: region.index
      })
    } else {
      if (this.data.areaReady) this.rebuildColumns([0, 0, 0])
      this._selectedAreaId = null
      this.setData({
        showForm: true,
        formId: null,
        formName: '',
        formMobile: '',
        formDetail: '',
        formDefault: this.data.list.length === 0, // 首个地址默认设为默认
        regionText: '',
        areaIndex: [0, 0, 0]
      })
    }
  },

  closeForm() {
    this.setData({ showForm: false })
  },

  /** 阻止弹层点击穿透关闭 */
  noop() {},

  onFormNameInput(e) { this.setData({ formName: e.detail.value }) },
  onFormMobileInput(e) { this.setData({ formMobile: e.detail.value }) },
  onFormDetailInput(e) { this.setData({ formDetail: e.detail.value }) },
  onFormDefaultChange(e) { this.setData({ formDefault: e.detail.value }) },

  /** 保存地址 */
  async saveAddress() {
    if (this.data.saving) return // 防重复点击（连点不重复提交）
    const { formId, formName, formMobile, formDetail, formDefault } = this.data
    if (!formName.trim()) return wx.showToast({ title: '请输入收件人姓名', icon: 'none' })
    if (!/^1\d{10}$/.test(formMobile.trim())) return wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
    if (!this._selectedAreaId) return wx.showToast({ title: '请选择所在地区', icon: 'none' })
    if (!formDetail.trim()) return wx.showToast({ title: '请输入详细地址', icon: 'none' })
    const payload = {
      name: formName.trim(),
      mobile: formMobile.trim(),
      areaId: this._selectedAreaId,
      detailAddress: formDetail.trim(),
      defaultStatus: formDefault
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '保存中…', mask: true })
    try {
      if (formId) await api.updateAddress({ id: formId, ...payload })
      else await api.createAddress(payload)
      wx.hideLoading()
      feedback.tap()
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ showForm: false })
      this.loadList()
    } catch (e) {
      wx.hideLoading()
    } finally {
      this.setData({ saving: false })
    }
  },

  /** 删除地址 */
  removeAddress(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除地址',
      content: '确定删除该收货地址吗？',
      confirmText: '确认删除',
      confirmColor: '#C75B2A',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.deleteAddress(id)
          feedback.tap()
          wx.showToast({ title: '已删除', icon: 'success' })
          this.loadList()
        } catch (err) { /* api 已 toast */ }
      }
    })
  },

  /** 设为默认 */
  async setDefault(e) {
    const item = e.currentTarget.dataset.item
    if (item.defaultStatus || this._settingDefault) return // 防连点：连发两次 updateAddress
    this._settingDefault = true
    try {
      await api.updateAddress({
        id: item.id,
        name: item.name,
        mobile: item.mobile,
        areaId: item.areaId,
        detailAddress: item.detailAddress,
        defaultStatus: true
      })
      this.loadList()
    } catch (err) { /* api 已 toast */ } finally {
      this._settingDefault = false
    }
  },

  /** 选择模式：点击条目回填寄件页 */
  selectAddress(e) {
    if (this.data.from !== 'send') return
    // 防连点：navigateBack 连发会一次弹两层（直接跳过寄件页）
    if (this._selecting) return
    this._selecting = true
    const item = e.currentTarget.dataset.item
    getApp().globalData.selectedAddress = {
      name: item.name,
      mobile: item.mobile,
      address: (item.regionText ? item.regionText + ' ' : '') + item.detailAddress
    }
    wx.navigateBack()
  }
})
