/**
 * 天气服务
 *
 * 优先级：Open-Meteo（免费无Key） → 本地动态模拟
 *
 * Open-Meteo 完全免费、无需注册、无需 API Key、开源气象数据
 * 国内访问偶尔较慢，设置了 5 秒超时自动降级
 */

/** emoji 图标映射 */
const ICONS = {
  0: '☀️', 1: '☀️', 2: '⛅', 3: '☁️',         // 晴/少云/多云/阴
  45: '🌫️', 48: '🌫️',                            // 雾
  51: '🌧️', 53: '🌧️', 55: '🌧️', 61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '🌨️',
  80: '🌦️', 81: '🌦️', 82: '🌦️',
  95: '⛈️', 96: '⛈️', 99: '⛈️'
}

/** 农业提示 */
function farmTips(code, temp) {
  if (code >= 95) return '雷雨天气，减少户外农事活动'
  if (code >= 51 && code <= 65) return '雨天路滑，出行注意安全'
  if (code >= 71 && code <= 75) return '降雪天气，注意大棚防冻'
  if (code <= 2 && temp > 33) return '高温天气，注意防暑，避免正午劳作'
  if (code <= 2) return '天气晴好，适宜出行和农事活动'
  if (code === 3) return '阴天，注意晾晒物品及时收回'
  if (code === 45 || code === 48) return '雾天能见度低，出行注意安全'
  return '天气尚可，注意关注变化'
}

/**
 * 本地兜底天气 — 按月份/时段粗略模拟
 * 保证任何情况下天气卡片都能秒出内容（不会一直空白）
 */
function localMockWeather() {
  const now = new Date()
  const month = now.getMonth() + 1
  const hour = now.getHours()
  const isDay = hour >= 6 && hour <= 18

  // 按月近似基准气温（江浙山区估算值）
  let base
  if (month === 12 || month === 1 || month === 2) base = 6
  else if (month === 3 || month === 4) base = 15
  else if (month === 5 || month === 9) base = 23
  else if (month === 6 || month === 10) base = 26
  else base = 30 // 7、8月

  const temp = base + (isDay ? 3 : -3)
  const code = temp > 28 ? 0 : temp > 20 ? 2 : 3

  return {
    temp,
    condition: codeText(code),
    icon: ICONS[code] || '⛅',
    humidity: 55 + (temp > 25 ? 10 : 0),
    wind: windStr(0, 12), // 12 km/h ≈ 3级风
    tips: farmTips(code, temp),
    mock: true,
    // 兜底预报沿用当前天气状态，避免出现"当前阴天、预报却全是晴"的明显错误
    forecast: [0, 1, 2].map((i) => {
      const t = temp + (i === 1 ? 1 : 0)
      return {
        day: i === 0 ? '今天' : i === 1 ? '明天' : '后天',
        icon: ICONS[code] || '⛅',
        tempHi: Math.round(t + 4),
        tempLo: Math.round(t - 6),
        condition: codeText(code)
      }
    })
  }
}

/**
 * 获取天气（Open-Meteo 免费 API）
 * 精度优先级：ECMWF IFS 0.25°（全球最准之一）→ 默认 best_match → 本地兜底
 * 每次 8 秒超时，网络稍慢会自动切换下一个来源，尽量避免用模拟数据
 */
function fetchWeather(lat, lon) {
  return new Promise((resolve) => {
    requestOpenMeteo(lat, lon, 0, resolve)
  })
}

/** 组装 Open-Meteo URL；model 为 null 时用默认 best_match */
function weatherUrl(lat, lon, model) {
  let url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min'
    + '&timezone=Asia/Shanghai&forecast_days=4'
    + '&wind_speed_unit=kmh&temperature_unit=celsius'
  if (model) url += `&models=${model}`
  return url
}

/** 逐级请求：0=ECMWF IFS，1=默认 best_match，全失败才兜底 */
function requestOpenMeteo(lat, lon, attempt, resolve) {
  const models = ['ecmwf_ifs025', null]
  const model = models[attempt]
  const timeout = 8000

  // settle 守卫：超时已降级到下一档后，本档迟到的回包必须丢弃——
  // 否则会再发一次重复请求（弱网双倍流量），甚至用旧档数据覆盖新档结果
  let settled = false
  const next = () => {
    if (attempt < models.length - 1) requestOpenMeteo(lat, lon, attempt + 1, resolve)
    else resolve(localMockWeather())
  }
  const finish = (fn) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    fn()
  }

  const timer = setTimeout(() => finish(next), timeout)

  wx.request({
    url: weatherUrl(lat, lon, model),
    success: (res) => finish(() => {
      const data = parseOpenMeteo(res)
      if (data) { resolve(data); return }
      next()
    }),
    fail: () => finish(next)
  })
}

/** 解析 Open-Meteo 响应，结构不完整返回 null 以便降级 */
function parseOpenMeteo(res) {
  if (res.statusCode !== 200 || !res.data || !res.data.current) return null
  const c = res.data.current
  const d = res.data.daily
  if (typeof c.weather_code !== 'number' || typeof c.temperature_2m !== 'number') return null

  const code = c.weather_code
  const temp = Math.round(c.temperature_2m)

  return {
    temp,
    condition: codeText(code),
    icon: ICONS[code] || '🌤️',
    humidity: c.relative_humidity_2m,
    wind: windStr(c.wind_direction_10m, Math.round(c.wind_speed_10m)),
    tips: farmTips(code, temp),
    mock: false,
    forecast: (d && d.time ? d.time.slice(0, 3) : []).map((date, i) => ({
      day: i === 0 ? '今天' : i === 1 ? '明天' : i === 2 ? '后天' : date.slice(5),
      icon: ICONS[d.weather_code[i]] || '🌤️',
      tempHi: Math.round(d.temperature_2m_max[i]),
      tempLo: Math.round(d.temperature_2m_min[i]),
      condition: codeText(d.weather_code[i])
    }))
  }
}

function codeText(code) {
  const map = { 0:'晴', 1:'晴', 2:'多云', 3:'阴', 45:'雾', 48:'雾',
    51:'小雨', 53:'小雨', 55:'中雨', 61:'中雨', 63:'中雨', 65:'大雨',
    71:'小雪', 73:'中雪', 75:'大雪', 80:'阵雨', 81:'阵雨', 82:'暴雨',
    95:'雷阵雨', 96:'雷暴', 99:'雷暴' }
  return map[code] || '未知'
}

/**
 * km/h → 蒲福风级换算
 * Open-Meteo 的 wind_speed_10m 单位是 km/h，直接当级数显示会闹出"10级"笑话
 */
function beaufort(kmh) {
  if (kmh <= 1) return 0
  if (kmh <= 5) return 1
  if (kmh <= 11) return 2
  if (kmh <= 19) return 3
  if (kmh <= 28) return 4
  if (kmh <= 38) return 5
  if (kmh <= 49) return 6
  if (kmh <= 61) return 7
  if (kmh <= 74) return 8
  if (kmh <= 88) return 9
  if (kmh <= 102) return 10
  if (kmh <= 117) return 11
  return 12
}

/** 风力显示：只显示风级，不显示风向（风向对单点不靠谱） */
function windStr(deg, speedKmh) {
  const level = beaufort(speedKmh)
  return `${level}级风`
}

/**
 * 逆地理编码（坐标 → 地名）
 * 优先级：腾讯位置服务（配了 Key 更准）→ BigDataCloud（免费免 Key 兜底）
 *
 * 腾讯位置服务：免费额度 10,000 次/天，注册 https://lbs.qq.com → 创建应用 → 获取 Key
 * BigDataCloud：免费免 Key，限额较低，作为未配置 Key 时的兜底
 */
const TENCENT_KEY = '' // ← 填入腾讯位置服务 Key

/** 腾讯位置服务逆地理 */
function tencentReverseGeocode(lat, lon) {
  return new Promise((resolve) => {
    wx.request({
      url: `https://apis.map.qq.com/ws/geocoder/v1/?location=${lat},${lon}&key=${TENCENT_KEY}&get_poi=0`,
      timeout: 5000,
      success: (res) => {
        if (res.statusCode === 200 && res.data.status === 0) {
          const addr = res.data.result.address_component
          const name = addr.street_number || addr.street || addr.district || addr.city || addr.province || ''
          resolve(name)
        } else {
          resolve(null)
        }
      },
      fail: () => resolve(null)
    })
  })
}

/** BigDataCloud 免 Key 逆地理（返回最近乡镇/城市名） */
function bigDataCloudReverseGeocode(lat, lon) {
  return new Promise((resolve) => {
    wx.request({
      url: `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`,
      timeout: 5000,
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          const d = res.data
          const name = d.locality || d.city || d.principalSubdivision || ''
          resolve(name || null)
        } else {
          resolve(null)
        }
      },
      fail: () => resolve(null)
    })
  })
}

function reverseGeocode(lat, lon) {
  if (TENCENT_KEY) return tencentReverseGeocode(lat, lon)
  return bigDataCloudReverseGeocode(lat, lon)
}

module.exports = { fetchWeather, localMockWeather, reverseGeocode }
