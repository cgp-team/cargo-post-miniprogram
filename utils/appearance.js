/**
 * 外观设置助手 — 老年人模式 + 主题颜色
 *
 * 统一：
 * 1. 从本地存储读取设置（storage 是唯一数据源）
 * 2. 生成主题色 CSS 变量（--color-primary 等），通过页面根节点内联 style 注入
 * 3. 页面 onShow 时调用 apply(page)，同步 elderlyMode / themeColor / themeStyle
 *
 * 用法：
 *   const appearance = require('../../utils/appearance')
 *   Page({
 *     onShow() { appearance.apply(this) }
 *   })
 *   根节点：class="... {{elderlyMode ? 'elderly-mode' : ''}}" style="{{themeStyle}}"
 *   图标：  <icon color="{{iconColor}}" />（见 apply 注释）
 */

/** 默认主题：白色 + 蓝色（答辩/演示要求；绿色/橙色/红色仍可在设置里切换） */
const DEFAULT_THEME = 'blue'

/* 导航栏换色去重：wx.setNavigationBarColor 只作用于当前页面，
 * 主题或页面任一变化时才重新设置，避免同页 onShow 重复调用 */
let _lastNavTheme = null
let _lastNavPage = null

/**
 * 各主题色板（key 与设置页存储保持一致：green/orange/blue）。
 * 设计语言：山乡巴士 · 站牌与车票——
 *   primary 站牌绿（大面积主角，非点缀）、dark 深站牌绿、accent 新芽绿、
 *   clay 陶土橙（司机/行动）、gold 稻谷金（农产品/公告）、paper 米纸底、ink 墨字、
 *   shadow 主色 20% 透明光晕（box-shadow 描边/辉光）。
 */
const THEMES = {
  green: {
    name: '山野绿',
    primary: '#2E7D32',    // 站牌绿（主）
    dark: '#1C4B2E',       // 深站牌绿（头部/标题）
    accent: '#4CAF50',     // 新芽绿（强调）
    light: '#EAF3EA',      // 浅绿（浅色背景）
    shadow: 'rgba(46,125,50,0.2)', // 主色 20% 透明光晕
    clay: '#C75B2A',       // 陶土橙（司机/行动暖色）
    gold: '#D9A441',       // 稻谷金（农产品价格/公告）
    paper: '#F6F2E9',      // 米纸底（页面底色）
    ink: '#2B2B28',        // 墨字（正文）
    // 表面色：卡片/输入框/描边/轨道等（与 app.wxss 默认值一致）
    card: '#FFFDF8', cardWarm: '#FCF8EC', field: '#FBF8F1',
    line: '#E4DECD', lineDeep: '#D8D2C4', track: '#EDE7D9',
    goldLight: '#FBF3DF', goldDeep: '#8A6A1F',
    clayLight: '#F8ECE3', clayDeep: '#A64A1F'
  },
  orange: {
    name: '陶土橙',
    primary: '#C75B2A',
    dark: '#9E4A1F',
    accent: '#E07A3F',
    light: '#F8ECE3',
    shadow: 'rgba(199,91,42,0.2)',
    clay: '#C75B2A',
    gold: '#D9A441',
    paper: '#F6F2E9',
    ink: '#2B2B28',
    card: '#FFFDF8', cardWarm: '#FCF8EC', field: '#FBF8F1',
    line: '#E4DECD', lineDeep: '#D8D2C4', track: '#EDE7D9',
    goldLight: '#FBF3DF', goldDeep: '#8A6A1F',
    clayLight: '#F8ECE3', clayDeep: '#A64A1F'
  },
  blue: {
    name: '山泉蓝',
    primary: '#1F5E9E',
    dark: '#123F6E',
    accent: '#2E7BBF',
    light: '#E6EFF5',
    shadow: 'rgba(31,94,158,0.2)',
    clay: '#C75B2A',
    gold: '#D9A441',
    paper: '#F5F8FC',
    ink: '#2B2B28',
    // 蓝主题表面色偏冷白，与纸底同族
    card: '#FFFFFF', cardWarm: '#F0F5FA', field: '#F7FAFD',
    line: '#DCE6EE', lineDeep: '#C7D5E0', track: '#E4EBF2',
    goldLight: '#FBF3DF', goldDeep: '#8A6A1F',
    clayLight: '#F8ECE3', clayDeep: '#A64A1F'
  },
  red: {
    name: '中国红',
    primary: '#A6242F',    // 中国红（主）
    dark: '#7A1821',       // 深红（头部/标题）
    accent: '#C24A3D',     // 亮红（强调）
    light: '#F7E6E4',      // 浅红（浅色背景）
    shadow: 'rgba(166,36,47,0.2)', // 主色 20% 透明光晕
    clay: '#C75B2A',       // 陶土橙（司机/行动暖色）
    gold: '#D9A441',       // 稻谷金（农产品价格/公告）
    paper: '#F6F2E9',      // 米纸底（页面底色）
    ink: '#2B2B28',        // 墨字（正文）
    card: '#FFFDF8', cardWarm: '#FCF8EC', field: '#FBF8F1',
    line: '#E4DECD', lineDeep: '#D8D2C4', track: '#EDE7D9',
    goldLight: '#FBF3DF', goldDeep: '#8A6A1F',
    clayLight: '#F8ECE3', clayDeep: '#A64A1F'
  }
}

/** 读取当前设置 */
function getSettings() {
  const elderlyMode = !!wx.getStorageSync('elderlyMode')
  const saved = wx.getStorageSync('themeColor')
  const themeColor = THEMES[saved] ? saved : DEFAULT_THEME
  return { elderlyMode, themeColor }
}

/**
 * 语义变量（随主题派生；价格/危险色/中性文字色各主题一致）
 * shipping 跟随主题主色，warn 用深金，保证状态色也参与换肤。
 */
function semanticVars(t) {
  return {
    price: t.clay,
    danger: '#C0392B',
    textSecondary: '#6B675C',
    textTertiary: '#8A8778',
    statusPending: t.clay,
    statusShipping: t.primary,
    statusDone: '#8A8778',
    statusWarn: '#B27A12'
  }
}

/** 生成主题 CSS 变量内联样式字符串 */
function themeStyle(color) {
  const t = THEMES[color] || THEMES[DEFAULT_THEME]
  const s = semanticVars(t)
  return [
    `--color-primary:${t.primary};`,
    `--color-primary-dark:${t.dark};`,
    `--color-accent:${t.accent};`,
    `--color-primary-light:${t.light};`,
    `--color-primary-shadow:${t.shadow};`,
    `--color-on-primary:#ffffff;`,
    `--color-clay:${t.clay};`,
    `--color-gold:${t.gold};`,
    `--color-paper:${t.paper};`,
    `--color-ink:${t.ink};`,
    `--color-price:${s.price};`,
    `--color-danger:${s.danger};`,
    `--color-text-secondary:${s.textSecondary};`,
    `--color-text-tertiary:${s.textTertiary};`,
    `--color-status-pending:${s.statusPending};`,
    `--color-status-shipping:${s.statusShipping};`,
    `--color-status-done:${s.statusDone};`,
    `--color-status-warn:${s.statusWarn};`,
    `--color-card:${t.card};`,
    `--color-card-warm:${t.cardWarm};`,
    `--color-field:${t.field};`,
    `--color-line:${t.line};`,
    `--color-line-deep:${t.lineDeep};`,
    `--color-track:${t.track};`,
    `--color-gold-light:${t.goldLight};`,
    `--color-gold-deep:${t.goldDeep};`,
    `--color-clay-light:${t.clayLight};`,
    `--color-clay-deep:${t.clayDeep};`
  ].join('')
}

/**
 * 将外观设置同步进页面 data，返回设置对象（含图标色）
 * 需在页面 onShow / onLoad 中调用；值未变化时跳过 setData，避免多余渲染。
 * WXML 中的 <icon> 无法继承 CSS 变量，图标请绑定：
 *   color="{{iconColor}}" 主色 / {{iconDeep}} 深色 / {{iconAccent}} 强调色 / {{iconClay}} 陶土橙（各主题固定）
 */
function apply(page) {
  const s = getSettings()
  const t = THEMES[s.themeColor] || THEMES[DEFAULT_THEME]
  const patch = {
    elderlyMode: s.elderlyMode,
    themeColor: s.themeColor,
    themeStyle: themeStyle(s.themeColor),
    iconColor: t.primary,
    iconDeep: t.dark,
    iconAccent: t.accent,
    iconClay: t.clay
  }
  const changed = Object.keys(patch).some((k) => page.data[k] !== patch[k])
  if (changed) page.setData(patch)
  // 导航栏跟随主题深色（login 页已删除 json 覆盖，同样走这里）
  if (_lastNavTheme !== s.themeColor || _lastNavPage !== page) {
    _lastNavTheme = s.themeColor
    _lastNavPage = page
    wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: t.dark })
  }
  return s
}

module.exports = { THEMES, DEFAULT_THEME, getSettings, themeStyle, apply }
