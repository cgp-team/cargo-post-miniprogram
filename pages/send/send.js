/**
 * 寄货页 - 农户一键寄货
 * 步骤：填写信息 + 选站点（StationPicker）→ 路线预览 → 拍照 + 收货信息 → 真实提交创建货运订单
 *
 * 路线预览：选好取货/送达站点后不立即请求；点"下一步：拍照确认"时校验并调
 * previewSendRoute（后端校验站点有效 + 高德路网距离/时间），成功才进入 Step 2。
 * 相同站点组合缓存复用；修改任一站点立即清空旧预估。
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')
const auth = require('../../utils/auth')
const feedback = require('../../utils/feedback')
const reviewUtils = require('../../utils/review')
const qrcodeRender = require('../../utils/qrcode-render')
const util = require('../../utils/util')
const location = require('../../utils/location')
const transitAmap = require('../../utils/transit-amap')

/** 货物类型可选值（与后端 cargoCategory 字段一致，缺省农产品） */
const CARGO_CATEGORIES = ['农产品', '生鲜果蔬', '日用品', '文件票据', '其他']

/** 单件限重（kg）：与后端承运审核规则一致，超限前端先提示，避免提交后被拒运 */
const MAX_WEIGHT_KG = 30

/** 草稿存储 key 与字段清单：只存表单本体，照片临时路径/路线预估/费用试算等派生数据不存 */
const DRAFT_KEY = 'sendDraft'
const DRAFT_FIELDS = [
  'goodsName', 'goodsWeight', 'goodsNote',
  'categoryIndex', 'cargoCategory', 'itemCount',
  'sizeLength', 'sizeWidth', 'sizeHeight', 'freshFlag',
  'pickupMode', 'originalAddress', 'originalLatitude', 'originalLongitude', 'pickupServiceMode',
  'pickupStationId', 'pickupStationName', 'deliveryStationId', 'deliveryStationName',
  'pickupAddressText', 'deliveryAddressText',
  'receiverName', 'receiverMobile', 'receiverAddress'
]
/** 判断草稿是否有实际内容（只填了默认值不算，避免空草稿也弹"已恢复"） */
const DRAFT_MEANINGFUL_FIELDS = [
  'goodsName', 'goodsWeight', 'goodsNote', 'sizeLength', 'sizeWidth', 'sizeHeight',
  'pickupStationId', 'deliveryStationId', 'pickupAddressText', 'deliveryAddressText',
  'receiverName', 'receiverMobile', 'receiverAddress'
]

Page({
  data: {
    step: 1,          // 1=填写信息, 2=拍照确认, 3=提交成功
    goodsName: '',
    goodsWeight: '',
    goodsNote: '',
    // 物体信息（类型/件数/体积/生鲜）——后端 transport_cargo_order 对应字段
    categoryOptions: CARGO_CATEGORIES,
    categoryIndex: 0,
    cargoCategory: CARGO_CATEGORIES[0],
    itemCount: '1',
    sizeLength: '',
    sizeWidth: '',
    sizeHeight: '',
    volumeM3: 0,          // 长×宽×高(cm) 折算 m³，提交用
    volumeText: '0.0000', // 展示用（保留 4 位小数）
    freshFlag: false,
    // 取货方式：'station' 自选取货站点 / 'location' 使用当前位置（含可达性评估与推荐站点）
    pickupMode: 'station',
    reachLoading: false,
    reachability: null,
    // 用户原始地址与坐标（位置 ≠ 车辆能到的地方：二者都保存，不互相覆盖）
    originalAddress: '',
    originalLatitude: null,
    originalLongitude: null,
    // 取货服务方式（后端 ServiceModeEnum.code）：可达性评估结果，随订单一起落库，
    // 后台订单管理/审核页据此显示"最近站点交接 / 上门交接"
    pickupServiceMode: '',
    // 定位精度提示（粗定位 >500m 时提示手动选点）
    locCoarse: false,
    locAccuracyText: '',
    photoPath: '',
    photoUrl: '', // 拍照后上传到服务器拿到的真实 URL
    // 站点（从后端拉取）
    stations: [],
    stationsLoading: false,
    stationsError: false,
    pickupStationId: null,
    pickupStationName: '',
    deliveryStationId: null,
    deliveryStationName: '',
    // 手填地址 → 推荐站点（取货/送达都支持）：tips = 高德输入提示候选地址
    pickupAddressText: '',
    deliveryAddressText: '',
    pickupTips: [],
    deliveryTips: [],
    tipsLoading: false,
    // 试算金额（件单价×件数 + 里程费）：取货/送达站点一选定就算好，提交前就能看到
    quote: null,
    quoteLoading: false,
    // 路线预估（点击"下一步"时查询；routeStatus: idle|loading|success|error）
    routePreview: null,
    routeStatus: 'idle',
    routePreviewKey: '', // 缓存 key：`${pickupStationId}:${deliveryStationId}`
    // 收货信息
    receiverName: '',
    receiverMobile: '',
    receiverAddress: '',
    // 承运审核"需客户操作"时的就近交接站点（客户送站导航用）
    servicePointStationName: '',
    servicePointDistanceKm: null,
    servicePointLatitude: null,
    servicePointLongitude: null,
    // 所选取货站点车辆不可进入时的就近改站建议（一键更换，见 _checkStationAccess）
    stationSuggestion: null,
    // 提交结果
    orderNo: '',
    orderAmount: null,
    submitting: false, // 确认发布防重入（按钮 disabled/loading 同步绑定）
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: ''
  },

  async onLoad() {
    if (!auth.requireLogin()) return
    appearance.apply(this)
    this.loadStations()
    this._restoreDraft()
  },

  onShow() {
    // 从地址簿选择后回填收货信息
    const selected = getApp().globalData.selectedAddress
    if (selected) {
      getApp().globalData.selectedAddress = null
      this.setData({
        receiverName: selected.name,
        receiverMobile: selected.mobile,
        receiverAddress: selected.address
      })
      this._scheduleSaveDraft()
    }
  },

  /** 页面隐藏（返回/切后台/跳地址簿）时补写草稿，防抖窗口内的最后输入不丢 */
  onHide() {
    this._flushSaveDraft()
  },

  // ==================== 表单草稿（网络差/误退出可恢复，仅 send 使用） ====================

  /** 表单变更后防抖 500ms 落本地 */
  _scheduleSaveDraft() {
    if (this._draftTimer) clearTimeout(this._draftTimer)
    this._draftTimer = setTimeout(() => {
      this._draftTimer = null
      this._saveDraft()
    }, 500)
  },

  _saveDraft() {
    try {
      const draft = {}
      DRAFT_FIELDS.forEach((field) => { draft[field] = this.data[field] })
      wx.setStorageSync(DRAFT_KEY, draft)
    } catch (e) { /* 存储失败不影响填写 */ }
  },

  _flushSaveDraft() {
    if (!this._draftTimer) return
    clearTimeout(this._draftTimer)
    this._draftTimer = null
    this._saveDraft()
  },

  _clearDraft() {
    if (this._draftTimer) {
      clearTimeout(this._draftTimer)
      this._draftTimer = null
    }
    try { wx.removeStorageSync(DRAFT_KEY) } catch (e) { /* 忽略 */ }
  },

  /** 读回上次未提交的草稿（含已选站点；照片临时路径不恢复，恢复到第 1 步重拍重算） */
  _restoreDraft() {
    let draft = null
    try {
      draft = wx.getStorageSync(DRAFT_KEY)
    } catch (e) {
      return
    }
    if (!draft || typeof draft !== 'object') return
    if (!DRAFT_MEANINGFUL_FIELDS.some((field) => !!draft[field])) return
    const patch = {}
    DRAFT_FIELDS.forEach((field) => {
      if (draft[field] !== undefined) patch[field] = draft[field]
    })
    this.setData(patch, () => this.recalcVolume())
    wx.showToast({ title: '已恢复上次填写', icon: 'none' })
  },

  /** 打开地址簿选择收货人 */
  goToAddressBook() {
    wx.navigateTo({ url: '/pages/mine/address/address?from=send' })
  },

  /** 加载寄货站点列表（供 StationPicker） */
  async loadStations() {
    this.setData({ stationsLoading: true, stationsError: false })
    try {
      const stations = await api.listSendStations()
      this.setData({ stations: stations || [], stationsLoading: false })
    } catch (e) {
      // api 已 toast；进入错误态，StationPicker 内可点击重试
      this.setData({ stations: [], stationsLoading: false, stationsError: true })
    }
  },

  onNameInput(e) { this.setData({ goodsName: e.detail.value }); this._scheduleSaveDraft() },
  onWeightInput(e) { this.setData({ goodsWeight: e.detail.value }); this._scheduleSaveDraft() },
  onNoteInput(e) { this.setData({ goodsNote: e.detail.value }); this._scheduleSaveDraft() },
  onReceiverNameInput(e) { this.setData({ receiverName: e.detail.value }); this._scheduleSaveDraft() },
  onReceiverMobileInput(e) { this.setData({ receiverMobile: e.detail.value }); this._scheduleSaveDraft() },
  onReceiverAddressInput(e) { this.setData({ receiverAddress: e.detail.value }); this._scheduleSaveDraft() },

  /** 货物类型选择 */
  onCategoryChange(e) {
    const index = Number(e.detail.value) || 0
    this.setData({ categoryIndex: index, cargoCategory: CARGO_CATEGORIES[index] })
    this._scheduleSaveDraft()
  },

  /** 货物件数：仅保留正整数 */
  onItemCountInput(e) {
    const value = String(e.detail.value || '').replace(/[^\d]/g, '')
    this.setData({ itemCount: value }, () => this.refreshQuote())
    this._scheduleSaveDraft()
  },

  // ==================== 手填地址 → 推荐站点（取货 / 送达） ====================

  onPickupAddressInput(e) { this.setData({ pickupAddressText: e.detail.value, pickupTips: [] }); this._scheduleSaveDraft() },
  onDeliveryAddressInput(e) { this.setData({ deliveryAddressText: e.detail.value, deliveryTips: [] }); this._scheduleSaveDraft() },

  /** 取货地址：高德输入提示拿候选（村民不用自己找站点，写地址即可） */
  async recommendPickupByAddress() {
    const keyword = String(this.data.pickupAddressText || '').trim()
    if (keyword.length < 2) {
      wx.showToast({ title: '请输入更完整的取货地址', icon: 'none' })
      return
    }
    this.setData({ tipsLoading: true })
    const tips = await transitAmap.searchAddressTips(keyword).catch(() => [])
    this.setData({ tipsLoading: false, pickupTips: tips || [] })
    if (!tips || !tips.length) {
      wx.showToast({ title: '没找到该地址，可改用「自选站点」', icon: 'none' })
    }
  },

  /** 送达地址：同上 */
  async recommendDeliveryByAddress() {
    const keyword = String(this.data.deliveryAddressText || '').trim()
    if (keyword.length < 2) {
      wx.showToast({ title: '请输入更完整的送达地址', icon: 'none' })
      return
    }
    this.setData({ tipsLoading: true })
    const tips = await transitAmap.searchAddressTips(keyword).catch(() => [])
    this.setData({ tipsLoading: false, deliveryTips: tips || [] })
    if (!tips || !tips.length) {
      wx.showToast({ title: '没找到该地址，可改用「自选站点」', icon: 'none' })
    }
  },

  /** 选中取货候选地址：坐标 → 可达性评估 → 推荐取货站点 → 重新试算 */
  async onPickupTipTap(e) {
    const tip = this.data.pickupTips[Number(e.currentTarget.dataset.index)]
    if (!tip) return
    const address = [tip.name, tip.address].filter(Boolean).join(' ') || tip.name || ''
    this.setData({
      pickupTips: [],
      pickupAddressText: tip.name || address,
      pickupMode: 'location',
      originalAddress: address,
      originalLatitude: tip.latitude,
      originalLongitude: tip.longitude,
      locCoarse: false,
      locAccuracyText: ''
    })
    await this._evaluateReachability(tip.latitude, tip.longitude)
    this.refreshQuote()
    this._scheduleSaveDraft()
  },

  /** 选中送达候选地址：坐标 → 推荐送达站点 → 重新试算 */
  async onDeliveryTipTap(e) {
    const tip = this.data.deliveryTips[Number(e.currentTarget.dataset.index)]
    if (!tip) return
    const address = [tip.name, tip.address].filter(Boolean).join(' ') || tip.name || ''
    this.setData({
      deliveryTips: [],
      deliveryAddressText: tip.name || address
    })
    if (!String(this.data.receiverAddress || '').trim()) {
      this.setData({ receiverAddress: address })
    }
    try {
      const res = await api.getReachability(tip.latitude, tip.longitude)
      const rec = res && res.recommendedStation
      if (rec && rec.id !== this.data.pickupStationId) {
        this.setData({
          deliveryStationId: rec.id,
          deliveryStationName: rec.name,
          routePreview: null,
          routeStatus: 'idle',
          routePreviewKey: ''
        })
        wx.showToast({ title: `已按地址推荐送达站点「${rec.name}」`, icon: 'none' })
      }
    } catch (err) {
      // 推荐失败不影响手填地址本身，用户仍可自选站点
    }
    this.refreshQuote()
    this._scheduleSaveDraft()
  },

  /** 试算金额（取货 + 送达站点都选定才请求；失败静默，由提交时兜底） */
  async refreshQuote() {
    const { pickupStationId, deliveryStationId, itemCount } = this.data
    if (!pickupStationId || !deliveryStationId || pickupStationId === deliveryStationId) {
      this.setData({ quote: null })
      return
    }
    this.setData({ quoteLoading: true })
    try {
      const quote = await api.quoteSendFee(pickupStationId, deliveryStationId, Number(itemCount) || 1)
      this.setData({ quote: quote || null, quoteLoading: false })
    } catch (e) {
      this.setData({ quote: null, quoteLoading: false })
    }
  },

  /** 长/宽/高（cm）输入：任一变化即重算体积（m³） */
  onSizeInput(e) {
    const field = e.currentTarget.dataset.field
    const value = String(e.detail.value || '').replace(/[^\d.]/g, '')
    this.setData({ [field]: value }, () => this.recalcVolume())
    this._scheduleSaveDraft()
  },

  /** 是否生鲜/需冷链（true → 后端转人工确认承运条件） */
  onFreshChange(e) {
    this.setData({ freshFlag: !!e.detail.value })
    this._scheduleSaveDraft()
  },

  /**
   * 使用当前位置寄货：真实定位（GCJ-02）→ 后端可达性评估 → 不可达则推荐最近可服务站点。
   * 订单会同时保存"用户原始地址/坐标"与"实际服务站"，不把用户地址覆盖成站点名。
   */
  async useCurrentLocation() {
    this.setData({ reachLoading: true, pickupMode: 'location' })
    try {
      const loc = await location.getCurrentLocation()
      if (!loc || !loc.success) {
        this.setData({ reachLoading: false, pickupMode: 'station' })
        wx.showToast({ title: '无法获取当前位置，请改用自选站点', icon: 'none' })
        return
      }
      const address = loc.address
        || [loc.city, loc.district].filter(Boolean).join('')
        || '当前位置'
      this.setData({
        originalAddress: address,
        originalLatitude: loc.latitude,
        originalLongitude: loc.longitude
      })
      // 定位精度提示：粗定位（>500m）时提醒用户手动选点，避免"附近没有站点/距离很远"的错觉
      this.setData({
        locCoarse: location.isCoarseAccuracy(loc),
        locAccuracyText: location.accuracyText(loc)
      })
      // 可达性评估（可达 → 直接就近取货；不可达 → 等用户点「使用推荐站点」确认）
      await this._evaluateReachability(loc.latitude, loc.longitude)
      this._scheduleSaveDraft()
    } catch (e) {
      this.setData({ reachLoading: false, pickupMode: 'station' })
      wx.showToast({ title: '可达性判断失败，请改用自选站点', icon: 'none' })
    }
  },

  /** 用户确认使用推荐站点（不可达场景的"送站交接"确认） */
  useRecommendedStation() {
    const res = this.data.reachability
    if (!res || !res.recommendedStation) return
    this.applyPickupStation(res.recommendedStation)
    wx.showToast({ title: '已使用推荐站点', icon: 'success' })
  },

  /**
   * 手动选择位置（定位不准时的纠正）：微信地图选点 → 用选中坐标重新做可达性评估。
   * 粗定位会让"推荐站点/距离/步行分钟"全部失真，演示前若发现定位偏了，点这里纠正一次即可。
   */
  async manualPickLocation() {
    try {
      const picked = await location.chooseLocation()
      if (!picked || !picked.success) return // 用户取消
      const address = picked.name || picked.address || [picked.city, picked.district].filter(Boolean).join('') || '所选位置'
      this.setData({
        pickupMode: 'location',
        originalAddress: address,
        originalLatitude: picked.latitude,
        originalLongitude: picked.longitude,
        locCoarse: false,
        locAccuracyText: ''
      })
      await this._evaluateReachability(picked.latitude, picked.longitude)
      this._scheduleSaveDraft()
    } catch (e) {
      wx.showToast({ title: '选择位置失败，请重试', icon: 'none' })
    }
  },

  /** 可达性评估（与 useCurrentLocation 共用） */
  async _evaluateReachability(latitude, longitude) {
    this.setData({ reachLoading: true })
    try {
      const res = await api.getReachability(latitude, longitude)
      this.setData({
        reachability: res || null,
        pickupServiceMode: (res && res.serviceMode) || '',
        reachLoading: false
      })
      if (res && res.reachable && res.recommendedStation) {
        this.applyPickupStation(res.recommendedStation)
      }
    } catch (e) {
      this.setData({ reachLoading: false })
      wx.showToast({ title: '可达性判断失败，请改用自选站点', icon: 'none' })
    }
  },

  /** 切回自选取货站点 */
  switchToStationMode() {
    this.setData({ pickupMode: 'station', reachability: null, pickupServiceMode: '' })
    this._scheduleSaveDraft()
  },

  /** 把推荐站点写入取货站点（与手动选择共用同一字段，提交口径一致） */
  applyPickupStation(station) {
    this.setData({
      pickupStationId: station.id,
      pickupStationName: station.name,
      routePreview: null,
      routeStatus: 'idle',
      routePreviewKey: ''
    }, () => this.refreshQuote())
    this._scheduleSaveDraft()
  },

  /** 长×宽×高(cm) → 体积(m³)：0.01m 换算，保留 4 位小数（与 decimal(12,4) 对齐） */
  recalcVolume() {
    const { sizeLength, sizeWidth, sizeHeight } = this.data
    const volumeM3 = util.cmSizeToM3(sizeLength, sizeWidth, sizeHeight)
    this.setData({ volumeM3, volumeText: volumeM3.toFixed(4) })
  },

  /** 取货站点变更：同步 ID/名称；与送达相同则拦截；清空旧路线预估 */
  onPickupStationChange(e) {
    const s = e.detail
    if (s.id === this.data.deliveryStationId) {
      wx.showToast({ title: '取货站点和送达站点不能相同', icon: 'none' })
      return
    }
    this.setData({
      pickupStationId: s.id,
      pickupStationName: s.stationName,
      routePreview: null,
      routeStatus: 'idle',
      routePreviewKey: ''
    }, () => this.refreshQuote())
    // 站点不可直达（车辆进不去）时，后端会给出"就近可服务站点"，前端提示一键更换
    this._checkStationAccess(s)
    this._scheduleSaveDraft()
  },

  /**
   * 校验所选取货站点是否真的能用：以站点坐标做一次可达性评估，
   * 若该站点车辆无法进入（如校园/封闭园区里的自建站），提示改用就近可服务站点，
   * 用户可一键更换 —— 避免"选了站点才发现不能寄"。
   */
  async _checkStationAccess(station) {
    if (!station || station.longitude == null || station.latitude == null) {
      this.setData({ stationSuggestion: null })
      return
    }
    try {
      const res = await api.getReachability(Number(station.longitude), Number(station.latitude))
      const rec = res && res.recommendedStation
      const needSwitch = !!(res && res.reachable === false && rec && rec.id !== station.id)
      this.setData({
        stationSuggestion: needSwitch
          ? {
              id: rec.id,
              name: rec.name,
              distanceKm: rec.distanceKm,
              message: res.message || '当前站点车辆无法进入，建议就近更换交接站点'
            }
          : null
      })
    } catch (e) {
      this.setData({ stationSuggestion: null })
    }
  },

  /** 一键改用推荐的就近站点（不可达场景的首要操作） */
  applyStationSuggestion() {
    const s = this.data.stationSuggestion
    if (!s) return
    this.applyPickupStation({ id: s.id, name: s.name })
    this.setData({ stationSuggestion: null })
    // 站点名长度不定，超 7 字改用 none，避免 success 图标 toast 折行
    wx.showToast({ title: `已改用「${s.name}」`, icon: 'none' })
  },

  /** 送达站点变更：同步 ID/名称；与取货相同则拦截；清空旧路线预估 */
  onDeliveryStationChange(e) {
    const s = e.detail
    if (s.id === this.data.pickupStationId) {
      wx.showToast({ title: '取货站点和送达站点不能相同', icon: 'none' })
      return
    }
    this.setData({
      deliveryStationId: s.id,
      deliveryStationName: s.stationName,
      routePreview: null,
      routeStatus: 'idle',
      routePreviewKey: ''
    }, () => this.refreshQuote())
    this._scheduleSaveDraft()
  },

  /** 下一步：基础校验 → 路线预览（缓存命中直接复用）→ 成功才进入拍照页 */
  async goToPhoto() {
    if (this.data.routeStatus === 'loading') return // 防重复点击（路线计算中）
    const { goodsName, goodsWeight, pickupStationId, deliveryStationId } = this.data
    if (!goodsName.trim()) {
      wx.showToast({ title: '请输入货物名称', icon: 'none' })
      return
    }
    if (!goodsWeight.trim() || Number(goodsWeight) <= 0) {
      wx.showToast({ title: '请输入正确的货物重量', icon: 'none' })
      return
    }
    // 单件限重与后端承运审核规则一致（斤 → kg），超限先提示，避免提交后被拒运
    if (Number(goodsWeight) * 0.5 > MAX_WEIGHT_KG) {
      wx.showToast({ title: `单件限重 ${MAX_WEIGHT_KG} 公斤（${MAX_WEIGHT_KG * 2} 斤）`, icon: 'none' })
      return
    }
    if (!Number(this.data.itemCount) || Number(this.data.itemCount) < 1) {
      wx.showToast({ title: '请输入货物件数', icon: 'none' })
      return
    }
    if (!(this.data.volumeM3 > 0)) {
      wx.showToast({ title: '请填写货物长宽高', icon: 'none' })
      return
    }
    if (!pickupStationId) {
      wx.showToast({ title: '请选择取货站点', icon: 'none' })
      return
    }
    if (!deliveryStationId) {
      wx.showToast({ title: '请选择送达站点', icon: 'none' })
      return
    }
    if (pickupStationId === deliveryStationId) {
      wx.showToast({ title: '取货站点和送达站点不能相同', icon: 'none' })
      return
    }
    // 相同组合已成功查询过 → 直接复用，不再请求（避免重复打高德）
    const key = `${pickupStationId}:${deliveryStationId}`
    if (this.data.routePreviewKey === key && this.data.routePreview) {
      this.setData({ step: 2 })
      return
    }
    this.setData({ routeStatus: 'loading', routePreview: null })
    try {
      const preview = await api.previewSendRoute(pickupStationId, deliveryStationId)
      if (preview && preview.available !== false) {
        this.setData({ routePreview: preview, routeStatus: 'success', routePreviewKey: key, step: 2 })
      } else {
        // 路线不可达
        this.setData({ routePreview: preview || null, routeStatus: 'error' })
        wx.showToast({ title: '暂时无法获取路线', icon: 'none' })
      }
    } catch (e) {
      // api 已 toast；失败不进入下一步
      this.setData({ routePreview: null, routeStatus: 'error' })
    }
  },

  /** 路线失败 → 重新查询 */
  retryRoutePreview() {
    this.goToPhoto()
  },

  /** 拍照（wx.chooseMedia）并上传到服务器拿真实 URL（快递总站核对凭证） */
  takePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['camera'],
      success: async (res) => {
        const temp = res.tempFiles[0].tempFilePath
        this.setData({ photoPath: temp, photoUrl: '' })
        wx.showLoading({ title: '上传照片…', mask: true })
        try {
          const url = await api.uploadFile(temp)
          wx.hideLoading()
          this.setData({ photoUrl: url })
          feedback.tap()
          wx.showToast({ title: '照片已上传', icon: 'success' })
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '照片上传失败，请重拍', icon: 'none' })
        }
      }
    })
  },

  /** 确认发布 → 真实创建货运订单（只提交站点/货物/收货信息，不提交前端距离结果） */
  async confirmSend() {
    const { photoPath, photoUrl, receiverMobile } = this.data
    if (this.data.submitting) return
    if (!photoPath) {
      wx.showToast({ title: '请先拍照确认货物', icon: 'none' })
      return
    }
    if (!receiverMobile.trim()) {
      wx.showToast({ title: '请输入收货电话', icon: 'none' })
      return
    }
    if (!util.validatePhone(receiverMobile.trim())) {
      wx.showToast({ title: '请输入正确的收货电话', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中…', mask: true })
    try {
      // 照片上传失败/超时不再直接卡住发布：先补传一次，仍失败再让用户选择"不带照片提交"
      // （后端 photoUrl 允许为空，不能因为一张照片把订单堵死在页面上）
      let finalPhotoUrl = photoUrl
      if (!finalPhotoUrl) {
        wx.showLoading({ title: '重试上传照片…', mask: true })
        finalPhotoUrl = await this._uploadPhoto(photoPath)
        if (finalPhotoUrl) {
          this.setData({ photoUrl: finalPhotoUrl })
        } else {
          const goOn = await this._confirmWithoutPhoto()
          if (!goOn) {
            this.setData({ submitting: false })
            wx.hideLoading()
            return
          }
        }
        wx.showLoading({ title: '提交中…', mask: true })
      }
      const res = await api.createSendOrder({
        pickupStationId: this.data.pickupStationId,
        deliveryStationId: this.data.deliveryStationId,
        goodsName: this.data.goodsName.trim(),
        goodsWeight: Number(this.data.goodsWeight) * 0.5, // 斤 → kg
        cargoCategory: this.data.cargoCategory,
        itemCount: Number(this.data.itemCount),
        volumeM3: this.data.volumeM3,
        freshFlag: this.data.freshFlag,
        // 用户原始位置（不可达时与推荐站点一起保存，后台可看到"用户在哪、车去哪接"）
        originalAddress: this.data.originalAddress || '',
        originalLatitude: this.data.originalLatitude,
        originalLongitude: this.data.originalLongitude,
        // 取货方式随单落库，后台可核对"用户在校内 → 最近站点交接"
        pickupServiceMode: this.data.pickupServiceMode || '',
        goodsNote: this.data.goodsNote.trim(),
        photoUrl: finalPhotoUrl,
        receiverName: this.data.receiverName.trim(),
        receiverMobile: receiverMobile.trim(),
        receiverAddress: this.data.receiverAddress.trim()
      })
      this.setData({ submitting: false })
      wx.hideLoading()
      // 订单已创建：清掉本地草稿，再切到成功页（保证"已发布"一定可见），再补审核结果文案。
      // 展示层异常绝不能让用户以为"没发布成功"而重复提交。
      this._clearDraft()
      const amount = res.totalAmount != null ? res.totalAmount : (this.data.quote ? this.data.quote.amount : null)
      this.setData({ orderNo: res.orderNo, orderAmount: amount, step: 3 }, () => this.drawQr())
      try {
        feedback.tap()
        this.setData(this.resolveReview(res))
      } catch (e) {
        console.warn('[send] 审核结果展示异常（订单已创建）', e)
      }
    } catch (e) {
      this.setData({ submitting: false })
      wx.hideLoading()
      // 错误提示已由 api.js 统一处理，保留当前页面现场
    }
  },

  /** 上传照片（返回 URL；失败返回空串，绝不抛出） */
  async _uploadPhoto(path) {
    if (!path) return ''
    try {
      return (await api.uploadFile(path)) || ''
    } catch (e) {
      return ''
    }
  },

  /** 照片上传失败时询问是否继续提交（后端允许无照片，避免流程被一张照片堵死） */
  _confirmWithoutPhoto() {
    return new Promise((resolve) => {
      wx.showModal({
        title: '照片未上传成功',
        content: '网络较慢导致照片上传失败，是否不带照片提交？（受理后工作人员仍会现场核实货物）',
        confirmText: '继续提交',
        confirmColor: '#C75B2A',
        cancelText: '重试上传',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      })
    })
  },

  /** 审核结果 → 前端展示态（mode 驱动样式，hint 为操作指引；reasonCode 文案走 utils/review 统一映射） */
  resolveReview(res) {
    const reasonText = reviewUtils.reasonText(res.reviewReasonCodes)
    switch (res.reviewStatus) {
      case 1:
        return { reviewMode: 'passed', reviewTitle: '审核通过', reviewHint: '订单可进入待入池，调度员将尽快为您安排班次', reviewReasonText: '' }
      case 2:
        return {
          reviewMode: 'conditional',
          reviewTitle: '需您操作',
          // 就近交接站点：后端已按"取货站点最近的可用站点"匹配（取货站本身是场站时就用该站）
          reviewHint: this._servicePointHint(res),
          reviewReasonText: reasonText,
          servicePointStationName: res.servicePointStationName || '',
          servicePointDistanceKm: res.servicePointDistanceKm != null ? res.servicePointDistanceKm : null,
          servicePointLatitude: res.servicePointLatitude != null ? res.servicePointLatitude : null,
          servicePointLongitude: res.servicePointLongitude != null ? res.servicePointLongitude : null
        }
      case 3:
        return { reviewMode: 'manual', reviewTitle: '待人工审核', reviewHint: '工作人员将尽快确认承运条件，请留意通知', reviewReasonText: reasonText }
      case 4:
        return { reviewMode: 'rejected', reviewTitle: '审核不通过', reviewHint: '该货物暂不支持承运，无法进入运输流程', reviewReasonText: reasonText }
      default:
        return { reviewMode: 'pending', reviewTitle: '审核中', reviewHint: '正在为您确认承运条件', reviewReasonText: reasonText }
    }
  },

  /** 就近送站提示文案：站点名 + 距取货点公里数（缺数据时给通用文案） */
  _servicePointHint(res) {
    const name = res && res.servicePointStationName
    if (!name) return '请将货物送到指定站点交接后即可入池'
    const km = res.servicePointDistanceKm
    return `请将货物送到就近站点「${name}」${km != null ? `（距取货点约 ${km} km）` : ''}交接后即可入池`
  },

  /** 导航到就近交接站点（wx.openLocation 需要站点坐标） */
  openServicePoint() {
    const { servicePointLatitude: lat, servicePointLongitude: lng, servicePointStationName: name } = this.data
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      wx.showToast({ title: '站点暂无坐标，请在「快递」页查看站点名', icon: 'none' })
      return
    }
    wx.openLocation({ latitude: lat, longitude: lng, name: name || '交接站点', scale: 16 })
  },

  /** 提交成功后绘制订单二维码（取件/司机扫码用） */
  drawQr() {
    wx.nextTick(() => {
      const query = wx.createSelectorQuery().in(this)
      query.select('#qrCanvas').fields({ node: true, size: true }).exec((res) => {
        if (!res[0] || !res[0].node || !this.data.orderNo) return
        qrcodeRender.draw(res[0].node, this.data.orderNo, res[0].width)
      })
    })
  },

  /** 复制订单号 */
  copyOrderNo() {
    wx.setClipboardData({
      data: this.data.orderNo,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  },

  /** 长按预览已拍货物照片（点按仍是重拍，不冲突） */
  previewPhoto() {
    const url = this.data.photoUrl || this.data.photoPath
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  noop() {},

  /** 转发给收货人查件 */
  onShareAppMessage() {
    // step 1/2 未提交时无单号，转发品牌文案 + 本页路径（口径与全站分享一致：咱村的客货邮）
    if (!this.data.orderNo) {
      return { title: '咱村的客货邮——山货填个单，大巴捎进城', path: '/pages/send/send' }
    }
    return {
      title: `寄货单 ${this.data.orderNo} 已提交，点击查看物流进度`,
      path: '/pages/parcel/parcel'
    }
  },

  /** 重新发布 */
  resetSend() {
    this._clearDraft()
    this.setData({
      step: 1,
      goodsName: '',
      goodsWeight: '',
      goodsNote: '',
      categoryIndex: 0,
      cargoCategory: CARGO_CATEGORIES[0],
      itemCount: '1',
      sizeLength: '',
      sizeWidth: '',
      sizeHeight: '',
      volumeM3: 0,
      volumeText: '0.0000',
      freshFlag: false,
      pickupMode: 'station',
      reachLoading: false,
      reachability: null,
      stationSuggestion: null,
      originalAddress: '',
      originalLatitude: null,
      originalLongitude: null,
      pickupServiceMode: '',
      photoPath: '',
      photoUrl: '',
      pickupStationId: null,
      pickupStationName: '',
      deliveryStationId: null,
      deliveryStationName: '',
      pickupAddressText: '',
      deliveryAddressText: '',
      pickupTips: [],
      deliveryTips: [],
      quote: null,
      quoteLoading: false,
      routePreview: null,
      routeStatus: 'idle',
      routePreviewKey: '',
      receiverName: '',
      receiverMobile: '',
      receiverAddress: '',
      servicePointStationName: '',
      servicePointDistanceKm: null,
      servicePointLatitude: null,
      servicePointLongitude: null,
      orderNo: '',
      orderAmount: null,
      submitting: false
    })
  },

  /** 返回首页 */
  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
