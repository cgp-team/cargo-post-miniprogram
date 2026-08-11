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

/** 各主题色板（与设置页色点保持一致） */
const THEMES = {
  green: {
    name: '翠绿',
    primary: '#2E7D32',    // 主色
    dark: '#1B5E20',       // 深色（渐变深端/标题）
    accent: '#4CAF50',     // 辅助强调色
    light: '#E8F5E9'       // 浅色背景
  },
  orange: {
    name: '暖橙',
    primary: '#FF9800',
    dark: '#E65100',
    accent: '#FFB74D',
    light: '#FFF3E0'
  },
  blue: {
    name: '天蓝',
    primary: '#1565C0',
    dark: '#0D47A1',
    accent: '#1E88E5',
    light: '#E3F2FD'
  }
}

/** 读取当前设置 */
function getSettings() {
  const elderlyMode = !!wx.getStorageSync('elderlyMode')
  const saved = wx.getStorageSync('themeColor')
  const themeColor = THEMES[saved] ? saved : DEFAULT_THEME
  return { elderlyMode, themeColor }
}

/** 生成主题 CSS 变量内联样式字符串 */
function themeStyle(color) {
  const t = THEMES[color] || THEMES[DEFAULT_THEME]
  return [
    `--color-primary:${t.primary};`,
    `--color-primary-dark:${t.dark};`,
    `--color-accent:${t.accent};`,
    `--color-primary-light:${t.light};`,
    `--color-on-primary:#ffffff;`
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
