/**
 * 面对面翻译页
 * 两个人面对面，一方按住「说中文」、另一方按住「说英文」，各自说完自动翻译成对方语言并显示。
 * 录音走原生 wx.getRecorderManager，识别+翻译走后端百度智能云（个人主体无法用微信同声传译插件）。
 */
const api = require('../../utils/api')
const appearance = require('../../utils/appearance')

Page({
  data: {
    dialogList: [],        // { role:'zh'|'en', src, dst, time }
    recording: false,      // 正在录音
    voiceLang: '',         // 当前录音语言 zh/en
    elderlyMode: false,
    themeColor: 'green',
    themeStyle: ''
  },

  onLoad() {
    appearance.apply(this)
  },
  onShow() {
    appearance.apply(this)
  },
  onUnload() {
    this.stopRecord()
  },

  /** 长按开始录音：lang 来自按钮 data-lang（zh=说中文 / en=说英文） */
  startRecord(e) {
    const lang = e.currentTarget.dataset.lang || 'zh'
    if (this.data.recording) {
      this.stopRecord()
      return
    }
    const recorder = this.recorder || (this.recorder = wx.getRecorderManager())
    recorder.onStart(() => this.setData({ recording: true, voiceLang: lang }))
    recorder.onStop((res) => {
      this.setData({ recording: false })
      if (res.tempFilePath) {
        this.recognizeAndTranslate(res.tempFilePath, lang)
      }
    })
    recorder.onError(() => {
      this.setData({ recording: false })
      wx.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none', duration: 2000 })
    })
    recorder.start({ duration: 30000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'wav' })
  },

  /** 松开结束录音 */
  stopRecord() {
    if (this.recorder) {
      try { this.recorder.stop() } catch (e) { /* 已停止 */ }
    }
  },

  /** 识别 + 翻译 + 加入对话 */
  async recognizeAndTranslate(filePath, lang) {
    wx.showLoading({ title: '识别翻译中…', mask: true })
    try {
      const text = await api.recognizeVoice(filePath, lang)
      const to = lang === 'zh' ? 'en' : 'zh'
      const translated = await api.translateText(text, lang, to)
      wx.hideLoading()
      this.addDialog(lang, text, translated)
    } catch (e) {
      wx.hideLoading()
    }
  },

  addDialog(role, src, dst) {
    const item = { role, src, dst, time: this.nowTime() }
    this.setData({ dialogList: [...this.data.dialogList, item] })
    // 滚动到底部
    wx.nextTick(() => {
      const query = wx.createSelectorQuery().in(this)
      query.select('.translate-list').boundingClientRect()
      query.select('.translate-bottom').boundingClientRect()
      query.exec((res) => { /* 保持简单，不强制滚动 */ })
    })
  },

  /** 清空对话 */
  clearDialog() {
    this.setData({ dialogList: [] })
  },

  nowTime() {
    const d = new Date()
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  }
})
