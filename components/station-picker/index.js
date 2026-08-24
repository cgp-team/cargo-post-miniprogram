/**
 * 站点选择器 —— Bottom Sheet 半屏弹窗（取货/送达站点共用，不写两套选择逻辑）
 *
 * 用法：
 *   <station-picker
 *     title="选择取货站点"
 *     stations="{{stations}}"
 *     value="{{pickupStationId}}"
 *     placeholder="请选择取货站点"
 *     loading="{{stationsLoading}}"
 *     error="{{stationsError}}"
 *     bindchange="onPickupStationChange"
 *     bindretry="loadStations"
 *   />
 *
 * 说明：
 * - 点击整行打开半屏弹窗；搜索 stationName / address；当前选中项显示勾选；
 * - 选中后 triggerEvent('change', station)，station 为 stations 中该条原样对象（含 id/stationName/address）；
 * - loading / error 由父页面传入：error 时显示"点击重试"，点击触发 retry 事件（父页面重新 loadStations）；
 * - 空态/加载态/错误态/搜索无结果 内置；
 * - styleIsolation: apply-shared 使组件内 .elderly-mode 选择器命中页面根节点老年模式类；
 *   颜色全部走 CSS 变量（--color-*），跟随页面主题。
 */
const appearance = require('../../utils/appearance')

Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    title: { type: String, value: '选择站点' },
    placeholder: { type: String, value: '请选择站点' },
    stations: { type: Array, value: [] },
    value: { type: null, value: null }, // 当前选中站 id（数字）
    loading: { type: Boolean, value: false },
    error: { type: Boolean, value: false }
  },

  data: {
    sheetVisible: false,
    keyword: '',
    filteredStations: [],
    selectedName: '',
    iconColor: '#2E7D32'
  },

  observers: {
    'stations, keyword': function () {
      this._syncFiltered()
    },
    'stations, value': function () {
      this._syncSelectedName()
    }
  },

  lifetimes: {
    attached() {
      const s = appearance.getSettings()
      const t = appearance.THEMES[s.themeColor] || appearance.THEMES[appearance.DEFAULT_THEME]
      this.setData({ iconColor: t.primary })
    }
  },

  methods: {
    /** 点击整行 → 打开弹窗 */
    onRowTap() {
      this.setData({ sheetVisible: true, keyword: '' })
    },

    close() {
      this.setData({ sheetVisible: false })
    },

    onSearchInput(e) {
      this.setData({ keyword: e.detail.value })
    },

    onSelectStation(e) {
      const idx = e.currentTarget.dataset.index
      const station = this.data.filteredStations[idx]
      if (!station) return
      this.triggerEvent('change', station)
      this.setData({ sheetVisible: false, keyword: '' })
    },

    onRetry() {
      this.triggerEvent('retry')
    },

    _syncFiltered() {
      const kw = (this.data.keyword || '').trim()
      const list = (this.data.stations || []).filter((s) => {
        if (!kw) return true
        return (s.stationName || '').indexOf(kw) !== -1 || (s.address || '').indexOf(kw) !== -1
      })
      this.setData({ filteredStations: list })
    },

    _syncSelectedName() {
      const st = (this.data.stations || []).find((s) => s.id === this.data.value)
      const name = st ? st.stationName : ''
      if (name !== this.data.selectedName) this.setData({ selectedName: name })
    }
  }
})
