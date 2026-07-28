/**
 * 司机工作台 - 核心页面
 * 三种状态：待发车(idle) / 行驶中(driving) / 到站停靠(stopped)
 */
Page({
  data: {
    // 状态栏高度（自定义导航栏用）
    statusBarHeight: 20,

    // 当前状态: 'idle' | 'driving' | 'stopped'
    status: 'idle',

    // 班次信息
    routeName: 'C302路',
    startStation: '县城客运站',
    endStation: '云山村',
    currentStation: '县城客运站',
    nextStation: '青山镇路口',
    nextStationDistance: 2300,

    // 进度条
    totalStops: 7,
    currentStopIndex: 0,
    progressPercent: 0,
    progressFillStyle: 'width: 0%;',
    progressDotStyle: 'left: 0%;',

    // 行李舱运力
    cargoCapacity: 50,        // 百分比，滑块当前值
    cargoUsed: 30,            // 已被预定的仓位
    cargoFillStyle: 'height: 50%;',
    cargoUsedStyle: 'bottom: 30%;',
    headerSafeStyle: 'height: 20px;',

    // 语音播报
    voiceText: '',

    // 到站任务
    pendingPickups: [
      { id: 1, name: '高山云雾茶', weight: '30斤', farmer: '张大爷', stop: '青山镇路口' },
      { id: 2, name: '土鸡蛋', weight: '15斤', farmer: '李婶', stop: '青山镇路口' }
    ],

    // 行驶数据
    speed: 0,
    eta: '14:30',

    // 地图标记点
    markers: [],
    polyline: []
  },

  onLoad() {
    const sysInfo = wx.getSystemInfoSync()
    const sbh = sysInfo.statusBarHeight
    this.setData({ headerSafeStyle: 'height: ' + sbh + 'px;' })
    this.initMockData()
  },

  onShow() {
    // 每次显示时刷新
  },

  /**
   * 初始化模拟数据
   */
  initMockData() {
    const stops = ['县城客运站', '双河桥头', '青山镇路口', '竹林乡', '溪口村', '桃花源', '云山村']

    // 路线标记
    const markers = stops.map((name, i) => ({
      id: i,
      latitude: 30.25 + i * 0.02,
      longitude: 108.15 + i * 0.03,
      title: name,
      iconPath: '',
      width: 20,
      height: 20,
      callout: { content: name, fontSize: 12, padding: 4, display: 'ALWAYS' }
    }))

    // 路线连线
    const polyline = [{
      points: stops.map((_, i) => ({
        latitude: 30.25 + i * 0.02,
        longitude: 108.15 + i * 0.03
      })),
      color: '#4CAF50',
      width: 6,
      arrowLine: true
    }]

    this.setData({
      totalStops: stops.length,
      markers,
      polyline
    })
  },

  /**
   * 发车 - 从idle切换到driving
   */
  startDrive() {
    this.setData({
      status: 'driving',
      currentStopIndex: 0,
      progressPercent: 0
    })

    wx.showToast({
      title: '车辆已出发',
      icon: 'success',
      duration: 1500
    })

    // 模拟行驶动画（实际接入GPS）
    this.simulateDriving()
  },

  /**
   * 模拟行驶过程 (开发演示用)
   */
  simulateDriving() {
    const totalStops = this.data.totalStops
    let currentIdx = 0
    // 清除旧定时器
    if (this.driveTimer) clearInterval(this.driveTimer)

    const timer = setInterval(() => {
      // 到站停靠时暂停推进
      if (this.data.status === 'stopped') return

      currentIdx++
      if (currentIdx >= totalStops) {
        clearInterval(timer)
        this.driveTimer = null
        return
      }

      const stops = ['县城客运站', '双河桥头', '青山镇路口', '竹林乡', '溪口村', '桃花源', '云山村']
      const percent = Math.round((currentIdx / (totalStops - 1)) * 100)

      this.setData({
        currentStopIndex: currentIdx,
        currentStation: stops[currentIdx - 1] || stops[0],
        nextStation: stops[currentIdx],
        nextStationDistance: Math.round(Math.random() * 3000 + 500),
        progressPercent: percent,
        speed: Math.round(Math.random() * 30 + 30)
      })
      this.updateComputedStyles()

      // 到站自动切换
      if (currentIdx > 0 && currentIdx < totalStops - 1) {
        setTimeout(() => {
          if (this.data.pendingPickups.length > 0) {
            this.setData({ status: 'stopped' })
          }
        }, 2000)
      }
    }, 5000)

    this.driveTimer = timer
  },

  /**
   * 更新所有计算样式
   */
  updateComputedStyles() {
    this.setData({
      progressFillStyle: 'width: ' + this.data.progressPercent + '%;',
      progressDotStyle: 'left: ' + this.data.progressPercent + '%;',
      cargoFillStyle: 'height: ' + this.data.cargoCapacity + '%;',
      cargoUsedStyle: 'bottom: ' + this.data.cargoUsed + '%;'
    })
  },

  /**
   * 运力滑块变化（slider组件）
   */
  onCapacityChange(e) {
    const value = e.detail.value || e.currentTarget.dataset.value
    if (value !== undefined) {
      this.setData({ cargoCapacity: value })
      this.updateComputedStyles()
    }
  },

  /**
   * 确认发布运力
   */
  publishCapacity() {
    const cap = this.data.cargoCapacity
    wx.showToast({
      title: `已发布 ${cap}% 仓位`,
      icon: 'success'
    })
  },

  /**
   * 扫码装车
   */
  scanToLoad() {
    wx.scanCode({
      scanType: ['qrCode', 'barCode'],
      success: (res) => {
        console.log('扫码结果:', res.result)
        wx.showToast({
          title: '装车确认成功',
          icon: 'success'
        })

        // 返回行驶状态
        setTimeout(() => {
          this.setData({ status: 'driving' })
        }, 1500)
      },
      fail: () => {
        wx.showToast({
          title: '已取消扫码',
          icon: 'none'
        })
      }
    })
  },

  /**
   * 跳过装车，继续行驶
   */
  skipLoading() {
    this.setData({ status: 'driving' })
    wx.showToast({
      title: '继续行驶',
      icon: 'none'
    })
  },

  /**
   * 语音播报开关
   */
  toggleVoice() {
    wx.showToast({
      title: '语音播报已开启',
      icon: 'none'
    })
  },

  onUnload() {
    if (this.driveTimer) {
      clearInterval(this.driveTimer)
    }
  }
})
