/**
 * 现实公交客户端数据源单测（高德微信小程序 SDK 路线）
 *
 * 运行：node tests/transit-amap.test.js
 * 覆盖：未配 key 不启用（不影响项目线路/模拟车辆）；POI 解析（缺坐标/非法坐标跳过、按距离排序）；
 *       配置 key 后经 amap-wx 的 getPoiAround 拿到真实站点并标注 REAL_TRANSIT；
 *       后端已有现实层时不再重复请求（省配额）；enrichNearby 合并后更新分层计数。
 */
const assert = require('assert')

let requestCalls = 0
let pois = []
global.wx = {
  request: (opts) => {
    requestCalls++
    opts.success && opts.success({ data: { status: '1', info: 'OK', pois: pois } })
  },
  getLocation: (o) => o.success && o.success({ latitude: 30.6, longitude: 104.1 }),
  getStorage: (o) => o.success && o.success({ data: '' }),
  setStorage: () => {}
}

const config = require('../utils/config')
const transit = require('../utils/transit-amap')

const oriGetKey = config.getAmapMiniKey

;(async () => {
  // 1. 未配置 key：不可用，enrichNearby 原样返回（不伪造现实公交）
  config.getAmapMiniKey = () => ''
  assert.strictEqual(transit.available(), false)
  const passthrough = await transit.enrichNearby(
    { nearbyStations: [{ name: '项目站', distanceKm: 1 }], realTransitAvailable: false },
    30.6, 104.1
  )
  assert.deepStrictEqual(passthrough.nearbyStations, [{ name: '项目站', distanceKm: 1 }])
  assert.strictEqual(passthrough.realTransitAvailable, false)
  assert.strictEqual(requestCalls, 0)

  // 2. parsePois：缺坐标/非法坐标跳过，合法按距离升序
  const parsed = transit.parsePois([
    { name: '远站', location: '104.3000,30.7000' },
    { name: '缺坐标' },
    { name: '非法坐标', location: 'abc,def' },
    { name: '近站', location: '104.1100,30.6100' }
  ], 30.6000, 104.1000)
  assert.deepStrictEqual(parsed.map((s) => s.name), ['近站', '远站'])
  assert.strictEqual(parsed[0].dataSource, 'REAL_TRANSIT')
  assert.strictEqual(parsed[0].transitSource, 'AMAP_MINI')
  assert.ok(parsed[0].distanceKm < parsed[1].distanceKm)

  // 2b. 途经线路解析：address 是线路清单（真实高德返回形态），地址片段要过滤掉
  assert.deepStrictEqual(transit.parseLines('125路'), ['125路'])
  assert.deepStrictEqual(
    transit.parseLines('(停运)G50路;184路;801路;G25路;夜间8路;K13线'),
    ['(停运)G50路', '184路', '801路', 'G25路', '夜间8路', 'K13线']
  )
  assert.deepStrictEqual(transit.parseLines('人民路1号'), []) // 地址不是线路
  assert.deepStrictEqual(transit.parseLines('锦悦西路站'), [])
  assert.deepStrictEqual(transit.parseLines(''), [])
  const withLines = transit.parsePois([{ name: '环球东路北(公交站)', location: '104.0658,30.5709', address: '125路' }], 30.57, 104.06)
  assert.deepStrictEqual(withLines[0].lines, ['125路'])

  // 3. 配置 key：走 amap-wx getPoiAround 拉真实站点
  config.getAmapMiniKey = () => 'test-key'
  pois = [
    { name: '人民公园站', location: '104.1050,30.6050', address: '人民路1号' },
    { name: '火车北站', location: '104.1500,30.6500', address: '北站路2号' }
  ]
  assert.strictEqual(transit.available(), true)
  const stations = await transit.searchNearbyStations(30.6000, 104.1000)
  assert.strictEqual(requestCalls, 1, '应调用一次高德 REST（经 amap-wx SDK）')
  assert.strictEqual(stations.length, 2)
  assert.strictEqual(stations[0].name, '人民公园站')
  assert.strictEqual(stations[0].latitude, 30.605)

  // 3b. 同名同坐标站点去重：线路取并集、只保留一张卡片（线上曾出现「曾家岩(公交站)」重复两条）
  const deduped = transit.dedupeStations([
    { name: '曾家岩(公交站)', latitude: 30.605, longitude: 104.105, distanceKm: 0.08, dataSource: 'REAL_TRANSIT', lines: ['125路'] },
    { name: '曾家岩', latitude: 30.605, longitude: 104.105, distanceKm: 0.08, dataSource: 'REAL_TRANSIT', lines: ['184路'] },
    { name: '人民支路(公交站)', latitude: 30.61, longitude: 104.11, distanceKm: 0.24, dataSource: 'REAL_TRANSIT', lines: ['125路'] }
  ])
  assert.strictEqual(deduped.length, 2, '同名同坐标必须合并为一条')
  const zeng = deduped.find((s) => s.name.indexOf('曾家岩') >= 0)
  assert.strictEqual(zeng.name, '曾家岩', '名称取更简洁的（去掉 (公交站)）')
  assert.deepStrictEqual(zeng.lines.sort(), ['125路', '184路'], '线路必须并集，不能丢')
  assert.strictEqual(transit.normalizeStationName('曾家岩(公交站)'), '曾家岩')
  assert.strictEqual(transit.normalizeStationName('人民支路站'), '人民支路')
  // 坐标相差较大（>1e-5 度）的不合并
  const far = transit.dedupeStations([
    { name: '同名站', latitude: 30.6, longitude: 104.1, lines: [] },
    { name: '同名站', latitude: 30.62, longitude: 104.12, lines: [] }
  ])
  assert.strictEqual(far.length, 2)

  // 4. enrichNearby：与后端结果合并，标注来源并更新分层计数
  const merged = await transit.enrichNearby(
    { nearbyStations: [{ name: '项目站', distanceKm: 0.5, dataSource: 'PROJECT_TRANSIT' }], realTransitAvailable: false },
    30.6000, 104.1000
  )
  assert.strictEqual(merged.realTransitAvailable, true)
  assert.strictEqual(merged.transitProvider, 'AMAP_MINI')
  assert.strictEqual(merged.realStationCount, 2)
  assert.strictEqual(merged.nearbyStations.length, 3)
  assert.strictEqual(merged.nearestStation.name, '项目站') // 0.5km 仍最近

  // 5. 后端已提供现实层 → 不再重复请求（省配额、避免双份数据）
  const callsBefore = requestCalls
  const skipped = await transit.enrichNearby(
    { nearbyStations: [{ name: '后端现实站', dataSource: 'REAL_TRANSIT' }], realTransitAvailable: true },
    30.6000, 104.1000
  )
  assert.strictEqual(requestCalls, callsBefore, '后端已有现实层时不应再请求高德')
  assert.strictEqual(skipped.nearbyStations[0].name, '后端现实站')

  // 6. 高德失败/超时：返回空数组且不影响主流程
  global.wx.request = (opts) => opts.fail && opts.fail({ errMsg: 'request:fail' })
  const failed = await transit.searchNearbyStations(30.6, 104.1)
  assert.deepStrictEqual(failed, [])

  config.getAmapMiniKey = oriGetKey
  console.log('transit-amap.test.js 全部通过')
})()
