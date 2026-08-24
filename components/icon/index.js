/**
 * SVG 线性图标组件 —— 替代 emoji 图标
 *
 * 用法：<icon name="home" size="44" color="#2E7D32" />
 *
 * 原理：图标以 SVG data-URI 形式喂给 image 组件（基础库 2.x 起支持）。
 * 注意：data-URI 里的颜色无法继承 CSS，必须传具体色值；
 * 主题场景请用 appearance.getSettings() 取当前主题色后传入。
 *
 * 新增图标：在 ICONS 里加一条，body 中用 %C% 作为颜色占位（仅限 ASCII 字符）。
 */

/* ASCII base64 编码（小程序环境无 btoa） */
const _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64Encode(str) {
  let out = ''
  let i = 0
  const len = str.length
  while (i < len) {
    const c1 = str.charCodeAt(i++)
    const c2 = i < len ? str.charCodeAt(i++) : NaN
    const c3 = i < len ? str.charCodeAt(i++) : NaN
    out += _B64[c1 >> 2]
    out += _B64[((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4)]
    out += isNaN(c2) ? '=' : _B64[((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6)]
    out += isNaN(c3) ? '=' : _B64[c3 & 63]
  }
  return out
}

const ICONS = {
  home: '<path fill="%C%" d="M12 3.2 3.5 10.4c-.4.35-.1 1 .45 1H5v8.1c0 .55.45 1 1 1h4.2v-5.6h3.6v5.6H18c.55 0 1-.45 1-1v-8.1h1.05c.55 0 .85-.65.45-1L12 3.2z"/>',
  shop: '<g fill="none" stroke="%C%" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h2.2l1.3 11.2c.1.9.85 1.55 1.75 1.55h8.9c.8 0 1.5-.55 1.7-1.35L21.5 9H7.1"/><circle cx="9.5" cy="19.7" r="1.3"/><circle cx="17.5" cy="19.7" r="1.3"/></g>',
  box: '<g fill="none" stroke="%C%" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2.6 3.4 7v10L12 21.4 20.6 17V7L12 2.6z"/><path d="M3.4 7 12 11.4 20.6 7M12 11.4v10"/></g>',
  user: '<g fill="none" stroke="%C%" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="7.5" r="4"/><path d="M4 20c.6-3.9 4-6 8-6s7.4 2.1 8 6"/></g>',
  bus: '<path fill="%C%" d="M4 5c0-1.1 3.6-2 8-2s8 .9 8 2v10.5c0 .8-.7 1.5-1.5 1.5h-13C4.7 17 4 16.3 4 15.5V5zm2 2v4h12V7H6zm1 8.2a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6zm10 0a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6zM7.5 17l-1 3h2l.8-3H7.5zm9 0h-1.8l.8 3h2l-1-3z"/>',
  leaf: '<path fill="%C%" d="M19.5 4.5C10 4.5 4.5 9 4.5 15.5c0 1.6.4 3 1 4 .6-4.5 3-9.5 8.5-11-4.5 2.5-7 7-7.5 11.5.9.4 2 .5 3 .5 7 0 10-8 10-16z"/>',
  send: '<path d="M21 3.5 10 13.5M21 3.5l-6.8 17-3.7-7.5L3 9.3 21 3.5z" fill="none" stroke="%C%" stroke-width="1.8" stroke-linejoin="round"/>',
  search: '<g fill="none" stroke="%C%" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></g>',
  notice: '<g fill="none" stroke="%C%" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4c0 .6.4 1 1 1h2l4.5 3.5c.6.4 1.5 0 1.5-.8V6.3c0-.8-.9-1.2-1.5-.8L7 9H5c-.6 0-1 .4-1 1z"/><path d="M17.5 9c.8 1 .8 5 0 6M18 7c1.7 2 1.7 8 0 10"/></g>',
  sun: '<g fill="none" stroke="%C%" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7"/></g>',
  pin: '<path d="M12 21.5s-7-6.3-7-11.3a7 7 0 0 1 14 0c0 5-7 11.3-7 11.3zm0-9a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z" fill="none" stroke="%C%" stroke-width="1.8"/>',
  clock: '<g fill="none" stroke="%C%" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/></g>',
  qr: '<g fill="none" stroke="%C%" stroke-width="1.6"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.8v2.8H14zM17.5 17.5H20V20h-2.5zM14 20h2M20 14v2"/></g>',
  arrow: '<path d="M9 5.5 15.5 12 9 18.5" fill="none" stroke="%C%" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  gear: '<path fill="%C%" d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6a.5.5 0 0 0 .1-.6l-2-3.4a.5.5 0 0 0-.6-.2l-2.4 1a7.6 7.6 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.4-1a.5.5 0 0 0-.6.2l-2 3.4a.5.5 0 0 0 .1.6l2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l2 3.4c.1.2.4.3.6.2l2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.6c0 .2.2.4.5.4h4c.3 0 .5-.2.5-.4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.4 1c.2.1.5 0 .6-.2l2-3.4a.5.5 0 0 0-.1-.6l-2-1.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>',
  edit: '<g fill="none" stroke="%C%" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5 19 9.5M5.5 18.5l.8-3.6L16 5.2a1.7 1.7 0 0 1 2.4 0l.4.4a1.7 1.7 0 0 1 0 2.4L9.1 17.7l-3.6.8z"/></g>',
  info: '<g fill="none" stroke="%C%" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11.2v5"/><circle cx="12" cy="7.8" r="1.1" fill="%C%" stroke="none"/></g>',
  logout: '<g fill="none" stroke="%C%" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14M10 12h10M17 8.5 20.5 12 17 15.5"/></g>',
  wallet: '<g fill="none" stroke="%C%" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="6" width="17" height="13" rx="2"/><path d="M15.5 12.2h5v3.6h-5a1.8 1.8 0 0 1 0-3.6z" stroke-linecap="round"/></g>',
  phone: '<path fill="%C%" d="M7 3h3l1.5 4L9.5 8.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 5 5a2 2 0 0 1 2-2z"/>',
  list: '<g fill="none" stroke="%C%" stroke-width="1.8" stroke-linecap="round"><path d="M8.5 6h12M8.5 12h12M8.5 18h12"/><circle cx="4" cy="6" r="1.1" fill="%C%" stroke="none"/><circle cx="4" cy="12" r="1.1" fill="%C%" stroke="none"/><circle cx="4" cy="18" r="1.1" fill="%C%" stroke="none"/></g>',
  camera: '<g fill="none" stroke="%C%" stroke-width="1.8" stroke-linejoin="round"><path d="M4 8a1.5 1.5 0 0 1 1.5-1.5h2L9 4h6l1.5 2.5h2A1.5 1.5 0 0 1 20 8v10a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V8z"/><circle cx="12" cy="13" r="3.5"/></g>',
  check: '<path d="M4.5 12.5 10 18 19.5 6.5" fill="none" stroke="%C%" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  road: '<g fill="none" stroke="%C%" stroke-width="1.8" stroke-linecap="round"><path d="M5.5 20 9.5 4h5l4 16"/><path d="M12 7v2.5M12 12v2.5M12 17v1.8"/></g>',
  font: '<g fill="none" stroke="%C%" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 19 8.5 5h1L14.5 19M5.4 14h7.2"/><path d="M15.8 19l2.4-6.8h.6L21.2 19M16.8 16.5h3.4"/></g>'
}

function buildSrc(name, color) {
  const body = ICONS[name]
  if (!body) return ''
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    + body.split('%C%').join(color) + '</svg>'
  return 'data:image/svg+xml;base64,' + base64Encode(svg)
}

Component({
  properties: {
    name: { type: String, value: '' },
    size: { type: Number, value: 44 },   // rpx
    color: { type: String, value: '#2B2B28' }
  },

  data: { src: '' },

  observers: {
    // size 只影响 wxml 里 image 的宽高，不参与 src 计算，无需监听
    'name, color': function (name, color) {
      this._refresh()
    }
  },

  lifetimes: {
    attached() { this._refresh() }
  },

  methods: {
    _refresh() {
      const src = buildSrc(this.data.name, this.data.color)
      if (src !== this.data.src) this.setData({ src })
    }
  }
})
