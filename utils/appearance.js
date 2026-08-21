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
 */

const DEFAULT_THEME = 'green'

/**
 * 各主题色板（key 与设置页存储保持一致：green/orange/blue）。
 * 设计语言：山乡巴士 · 站牌与车票——
 *   primary 站牌绿（大面积主角，非点缀）、dark 深站牌绿、accent 新芽绿、
 *   clay 陶土橙（司机/行动）、gold 稻谷金（农产品/公告）、paper 米纸底、ink 墨字。
 */
const THEMES = {
  green: {
    name: '山野绿',
    primary: '#2E7D32',    // 站牌绿（主）
    dark: '#1C4B2E',       // 深站牌绿（头部/标题）
    accent: '#4CAF50',     // 新芽绿（强调）
    light: '#EAF3EA',      // 浅绿（浅色背景）
    clay: '#C75B2A',       // 陶土橙（司机/行动暖色）
    gold: '#D9A441',       // 稻谷金（农产品价格/公告）
    paper: '#F6F2E9',      // 米纸底（页面底色）
    ink: '#2B2B28'         // 墨字（正文）
  },
  orange: {
    name: '陶土橙',
    primary: '#C75B2A',
    dark: '#9E4A1F',
    accent: '#E07A3F',
    light: '#F8ECE3',
    clay: '#C75B2A',
    gold: '#D9A441',
    paper: '#F6F2E9',
    ink: '#2B2B28'
  },
  blue: {
    name: '山泉蓝',
    primary: '#1F5E9E',
    dark: '#123F6E',
    accent: '#2E7BBF',
    light: '#E6EFF5',
    clay: '#C75B2A',
    gold: '#D9A441',
    paper: '#F6F2E9',
    ink: '#2B2B28'
  },
  red: {
    name: '中国红',
    primary: '#A6242F',    // 中国红（主）
    dark: '#7A1821',       // 深红（头部/标题）
    accent: '#C24A3D',     // 亮红（强调）
    light: '#F7E6E4',      // 浅红（浅色背景）
    clay: '#C75B2A',       // 陶土橙（司机/行动暖色）
    gold: '#D9A441',       // 稻谷金（农产品价格/公告）
    paper: '#F6F2E9',      // 米纸底（页面底色）
    ink: '#2B2B28'         // 墨字（正文）
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
    `--color-status-warn:${s.statusWarn};`
  ].join('')
}

/**
 * 将外观设置同步进页面 data，返回设置对象
 * 需在页面 onShow / onLoad 中调用
 */
function apply(page) {
  const s = getSettings()
  page.setData({
    elderlyMode: s.elderlyMode,
    themeColor: s.themeColor,
    themeStyle: themeStyle(s.themeColor)
  })
  return s
}

module.exports = { THEMES, DEFAULT_THEME, getSettings, themeStyle, apply }
