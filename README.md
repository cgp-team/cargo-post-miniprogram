# 山乡巴士 · 客货邮微信小程序（cargo-post-miniprogram）

![微信小程序](https://img.shields.io/badge/微信小程序-原生-07C160?logo=wechat)
![基础库](https://img.shields.io/badge/基础库-3.17.0-blue)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

县域**客运、货运、生鲜与邮快件协同运营**平台的微信小程序端（项目名 rural-logistics；开发期使用小程序测试号 `wx5ac650e90ef92bb0`，正式号 `wx687e9bf8544ac559` 的 secret 配好后切回），「山乡巴士 · 站牌与车票」设计体系，同时服务两类角色：村民/用户（商城、寄件、包裹查询、实时公交）与司机（工作台）。

本仓库从 [cargo-post-platform](https://github.com/cgp-team/cargo-post-platform) 拆分为独立仓库（提交历史已完整迁移）。小程序与管理端共用同一个 Spring Boot 后端（由 platform 仓库提供），只调用 `/app-api`，不直连算法服务。

<img src="docs/images/miniprogram.png" width="86%" alt="小程序：首页 / 客户功能 / 司机界面">

## 快速开始

环境要求：微信开发者工具（稳定版即可）、本机或可访问的后端服务（见 platform 仓库）。

```bash
# 1. 微信开发者工具「导入项目」选择本仓库根目录，使用仓库内 project.config.json
# 2. 详情 → 本地设置：勾选「不校验合法域名」（开发版走 HTTP 时必须）
# 3. 编译后用短信验证码或账号密码登录，验证 /app-api 连通性
```

单元测试（纯 Node assert 直跑，10 个文件，含一个静态扫描 WXML 误用 Vue 指令的 lint 式测试）：

```bash
for f in tests/*.test.js; do node "$f" || exit 1; done
```

## 配置说明（`utils/config.js`）

- **后端地址**：`getBaseUrl()` 按 `envVersion`（develop/trial/release）返回 BASE_URL。本地调试勾选「不校验合法域名」；体验版/正式版必须替换为已备案 HTTPS 域名并在微信公众平台登记。
- **高德 key**：`AMAP_MINI_KEY` 为「微信小程序」类型 key（客户端现实公交站点层用，绑定 AppID，放小程序里是安全的）。「Web 服务」类型 key 不能放客户端，配在后端（见下文「现实公交接入」）。
- **后端微信登录**：platform 仓库服务器外部化配置 `/opt/cargo-post/config/application-dev.yaml` 的 `wx.miniapp.appid/secret` 必须与本小程序当前使用的 appid 一致（code 与 appid 绑定），否则微信一键登录失败。当前后端已配测试号；切换正式号时两边要同步改。

## 页面结构

底部自定义 tab-bar（`custom-tab-bar/`）：首页、商城、包裹、我的。

- `pages/login/login`：登录（短信验证码登录新用户自动注册、微信小程序一键登录、手机号 + 密码）。
- `pages/index/index`：首页，含天气展示与平台公告轮播（点击看详情）。
- `pages/goods/goods`、`pages/goods/detail/detail`：农产品商城列表与详情。
- `pages/goods/trace/trace`：商品溯源，商城订单的大巴承运轨迹（地图轨迹线 + 途经站点），从「我的订单」已发货/已完成订单进入。
- `pages/send/send`：寄件下单（货物名称/重量/类型/件数/长宽高体积/是否生鲜/备注），支持从地址簿回填收货信息。物体信息随订单落 `transport_cargo_order`（`cargo_category`/`item_count`/`volume_m3`/`fresh_flag`），「我的寄货」按标签回显；前端限重与后端承运审核规则一致（单件 30kg），超限在提交前提示。表单草稿自动保存（输入防抖 + 页面隐藏补写），误退出/断网后重进提示恢复；只存表单本体，照片临时路径与费用试算等派生数据不存，提交成功后清除。
- `pages/parcel/parcel`：快递页，三个 tab：**我的寄货**（邮快件列表直显取件码，点击卡片直接看这单的完整物流详情）/
  **我的购物**（商城买到的商品订单：商品图、金额、承运司机与送货进度，点卡片进订单详情）/
  **单号查询**（取件码二维码、承运班次与到达预估、分段联运与时间轴）。「我的」页的「我的寄货 / 我的购物」入口
  通过 `globalData.parcelIntent` 直达对应 tab。
- **车来取货/送货提醒**：`page` 列表与单号查询会显示「班车 距<目标站>约 N 分钟」，距目标站点 **≤10 分钟**时升级为高亮「车快到了」提醒条并弹一次提示（同一订单不重复打扰）。位置来自**统一位置模型**：司机真实上报优先（5 分钟内标"实时"、过期标"位置可能过期"），无上报时用**确定性班次模拟**位置并标注"模拟演示"——因此即使司机未开 GPS 也能看到倒计时；车辆位置与目标站点的距离/分钟按 Haversine + 均速 25km/h 估算，随时间刷新（15s）。
- `pages/bus/index`、`pages/bus/detail`：实时公交独立页（车来了式：线路地图 + 车辆列表 + 车辆详情），从首页「附近公交」或快递页进入。
- `pages/orders/orders`：农产品商城订单列表（状态筛选、取消订单、溯源入口），从"我的"页进入，不在 tab-bar；
  **点订单卡片进订单详情**。
- `pages/orders/detail/detail`：商城订单详情（商品清单与金额、收货信息、承运车辆/司机/交付站点、
  配送进度时间线、司机装车与妥投核验凭证、跳车辆轨迹）。数据源 `GET /app-api/transport/product-order/trace`。
- `pages/mine/mine`、`pages/settings/settings`：我的与设置（老年人模式、深色模式、主题颜色，由 `utils/appearance.js` 统一处理）。
- `pages/notification/notification`：消息通知中心（订单事件驱动：审核/入池/调度/发车/交接/妥投等），全部/未读筛选、标记已读与全部已读，点带订单的消息跳包裹轨迹；从「我的」页进入，司机端工作台以 `?driverMode=1` 复用本页。
- `pages/mine/profile/profile`：个人资料编辑（昵称/头像/性别）与修改密码（短信验证码 scene=3）。
- `pages/mine/address/address`：收货地址管理（member/address 接口，省市区三级选择）；寄件页「地址簿」选择模式回填。
- `pages/mine/feedback/feedback`：意见反馈提交与我的反馈列表（含平台回复）。
- `pages/driver/workbench/workbench`：司机工作台，含待发车 / 行驶中 / 到站停靠三态、班次进度、行李舱运力、到站任务。发车、到站、扫码装车、扫码妥投均为真实写操作；行驶中通过 `wx.getLocation` 每 10 秒上报车辆位置。
- `pages/driver/routes/routes`：今日排班与途经站点。
- `pages/driver/earnings/earnings`：运输收益总览与明细。
- `pages/driver/handover/handover`：多段联运货物交接（A 车送到换乘站 → B 车到场接货），按当前运输段状态给出操作（接受任务/装货/运输/到达/交接确认等），交接确认拍照留证；从司机工作台进入。

## 设计与体验（山乡巴士 · 站牌与车票）

- **设计原语**（`app.wxss` 全局签名样式）：`.signpost` 站牌头（深绿渐变实板 + 顶部落款横档 + 角落光晕）、`.ticket-card` 车票卡（主券 + 泛黄副券，虚线撕票口两端打孔）、`.road-line` 山路线（虚线道路分隔，时间线/进度用）；配色语义固定——陶土橙 = 司机/行动，稻谷金 = 农产品/公告，米纸底页面，墨字正文。
- **主题变量**：全部颜色走 CSS 变量——主色板（`--color-primary/-dark/-accent`）+ 语义色（`--color-price`/`--color-status-*`，价格统一陶土橙、危险操作独立 `--color-danger`）+ 表面色（`--color-card`/`--color-card-warm`/`--color-field`/`--color-line`/`--color-track` 等），由 `utils/appearance.js` 经页面根节点内联 style 注入。四套主题（山野绿/陶土橙/山泉蓝/中国红，默认山泉蓝）× 深色模式正交共八套皮肤：深色换暖黑表面色与文字色并补强状态色对比度，站牌头保持主题色，导航栏随之压黑。
- **老年模式**：设置页开关，页面根节点挂 `.elderly-mode`，`app.wxss` 尾部规则放大全局字号/按钮/输入框；辅助文字对比度 ≥ 4.5:1（`--color-text-tertiary` 不允许再浅）。
- **动效体系**：只用 transform/opacity（合成层友好），时长 200–400ms，缓动统一 `cubic-bezier(0.22, 0.61, 0.36, 1)`；原语 `.anim-rise`（卡片上浮入场）/`.anim-pop`（对话框过冲回弹）/`.anim-sheet`（半屏弹层上滑）/`.anim-fade`，列表项配 inline `animation-delay` 做阶梯入场；页面级 `page-in` 0.25s；按压反馈统一 `hover-class="hover"`（原生 hover 约 50ms 生效，比 `:active` 跟手）。
- **骨架屏**：`.skeleton` 米纸色流光 + `.skeleton-card` 卡片占位，主要列表/详情页首屏先出骨架再出真实内容，骨架色跟随主题与深色模式。
- **三态完整性**：加载 / 空 / 错误三态分离——网络失败亮错误态（带「重新加载」入口），不冒充"暂无数据"；空态统一 `components/empty-state` 组件（icon/emoji + 主副文案 + 可选按钮）。
- **分享**：8 个页面实现 `onShareAppMessage`（首页/商城/商品详情/商品溯源/寄件/快递/实时公交/车辆详情），文案随上下文带商品名、单号或线路名。
- **长按复制单号**：快递/订单/溯源/通知/司机工作台与交接等场景运单号长按复制（`wx.setClipboardData`，系统自带"已复制"提示；复制后松手补发的 tap 被吞掉，防误触跳转）。
- **图片预览**：商品图、装车/妥投核验凭证、头像等点击调 `wx.previewImage` 放大查看。
- **触觉反馈**：`utils/feedback.js` 主操作成功时 `wx.vibrateShort`（light），低版本/不支持环境静默降级。

## 后端对接现状

- 已对接真实接口：登录注册（member 模块）、商城列表与详情与下单/订单页、寄件下单、包裹查询、我的寄货记录、司机端档案/班次/待装车/收益、多段联运交接（`driver/legs`/`handovers`/`handover/confirm`）、消息通知（`transport/notification/*`）、平台公告、意见反馈、收货地址、个人资料与修改密码、商品溯源轨迹。
- 平台公告：`GET /app-api/transport/notice/list`（免登录，上架公告按 sort 排序，最多 20 条），管理端「客货邮管理 → 公告管理」发布；首页拉取失败/为空时展示空态。表 `transport_notice`（platform 仓库 `sql/incremental/V007__notice.sql`）。
- 意见反馈：`POST /app-api/transport/feedback/create` + `GET /app-api/transport/feedback/page`（需登录，只查本人），管理端「运维客服 → 意见反馈」回复后小程序可见。表 `transport_feedback`（`sql/incremental/V008__feedback.sql`）。
- 收货地址：`/app-api/member/address/*`（member 模块标准接口），表 `member_address`（DDL 在 `sql/mysql/transport-menu.sql`）。
- 寄货到达预估：`send/track` 响应含 vehiclePlate/shiftCode/targetStation/estimatedArrivalTime/etaMinutes（取该订单最新调度方案明细，ETA 为未来时间才给分钟差），parcel 页据此展示「班次 + 预计到达」。
- 商品溯源：管理端发货时可关联承运车辆/班次（`transport_product_order.vehicle_id/shift_id`，老库走 `transport-schema-incremental.sql` 守卫式 ALTER）；`GET /app-api/transport/product-order/trace?id=`（需登录且本人订单）返回承运信息 + 线路站点 + 当天轨迹点（`transport_vehicle_location_track`，`sql/incremental/V009__vehicle_location_track.sql`，仅班次在途时落历史，上限 2000 点）+ 最新位置；未关联车辆时返回空数据，小程序显示「商品还未发车」。
- 司机端写操作闭环：`POST /app-api/transport/driver/depart`（发车）、`/arrive`（到站/终点完成班次）、`/pickup-confirm`（扫码装车）、`/deliver`（扫码妥投）、`/location`（位置上报）。班次执行状态落 `transport_shift_execution` 表（按天一条），车辆最新位置落 `transport_vehicle_location` 表（每车一行）；两张表见 `sql/incremental/V005__driver_execution.sql`。货运订单状态机：0待调度 → 1已入池 → 2已分配 → 3已发车 → 4已完成（5已取消）。
- 监控中心（管理端）车辆位置：司机上报 5 分钟内的真实位置优先，否则回退按时刻表的插值模拟（`MonitoringServiceImpl.fillTimetableSimulation`：当前班次窗口内按经停站 `planned_minutes` 线性插值，窗口外空闲停靠起点站，无班次不上图）。
- 实时公交（首页「附近公交 · 实时到站」）：`GET /app-api/transport/bus/realtime`、`/bus/lines`、`/bus/nearby`（均免登录）复用监控车辆位置，返回线路起终点/下一站/ETA/经度纬度；车辆带 `dataSource`（`REAL` 司机真实上报 / `SIMULATED` 时刻表模拟演示），小程序对 `SIMULATED` 显式标注「模拟演示」，不冒充真实位置。真实上报车辆按派单明细/当天班次执行回填班次与线路后才进公交列表（取不到则不上图，不猜线路）。
- 班次模拟车辆：无需司机开播也能看到在线车辆——班次时刻表数据（platform 仓库 `sql/mysql/transport-demo-data.sql` 的 `transport_shift` 06:30–20:30 共 10 班）覆盖运营时段，公交页与首页附近公交在运营时段内会有 3 辆标注「模拟演示」的班车沿真实站点插值移动；超出运营时段显示「当前不在运营时间」空态。后续完善方向：寄货流程「X班车距村口站还有Y分钟」按站 ETA 细化（当前为整单送达预估）。
- 首页天气走 Open-Meteo 免费接口（无 Key），失败时回退本地模拟（`utils/weather.js`）。
- 附近公交无在线车辆时展示「附近站点 + 关联线路 + 当前不在运营时间」空态（接口失败给可重试错误态），不展示硬编码假车辆；车辆位置的模拟/真实来源由 `dataSource` 标注。

## 登录鉴权链路

- 请求封装在 `utils/api.js`，统一处理 yudao 响应格式（`{code, msg, data}`）、`Authorization: Bearer <token>` 头与 401 踢回登录页。
- 登录走 platform 仓库 `yudao-module-member` 的 `/app-api/member/auth/*`：短信验证码登录（新用户自动注册）、微信小程序一键登录、手机号 + 密码登录。
- 会员数据存 `member_user` 表，由 platform 仓库 `sql/mysql/transport-menu.sql` 初始化。

## 上线前置条件

- **正式版必须配置 HTTPS 域名**：微信小程序正式环境只允许 HTTPS 请求，后端需有正式域名并配置 TLS 证书，不能继续使用 IP + HTTP。
- **合法域名需在微信公众平台登记**：`request` 合法域名与 `uploadFile` 合法域名是两个独立清单，都要在「微信公众平台 → 开发管理 → 开发设置 → 服务器域名」分别登记；只登记 request 不会自动覆盖 uploadFile。
- **当前配置仅供开发版**：`utils/config.js` 三环境（develop/trial/release）中 develop 为 `http://1.15.29.107/api`，仅能在微信开发者工具勾选「不校验合法域名」的开发版下使用；体验版/正式版用该地址会直接请求失败。
- **拍照上传依赖 uploadFile 域名**：寄货拍照（`pages/send/send.js`）与司机装车拍照（`pages/driver/workbench/workbench.js`）经 `utils/api.js` 的 `uploadFile` 上传照片，`uploadFile` 合法域名未登记时，上传在体验版/正式版直接失败。

## 位置权限

`app.json` 声明了 `scope.userLocation` 与 `requiredPrivateInfos`（getLocation/chooseLocation）。司机工作台行驶中每 10 秒通过 `wx.getLocation`（gcj02）获取真实位置并调用 `/app-api/transport/driver/location` 上报，与监控中心共用 `transport_vehicle_location` 数据链路。

## 联调步骤

1. 微信开发者工具「导入项目」选择本仓库根目录，使用仓库内 `project.config.json`。
2. 启动本机后端（默认 48080，见 platform 仓库 README），并确认数据库已执行 `transport-menu.sql`（含 `member_user`、`member_address` 与全部菜单）；商城联调还需 `transport-schema.sql` 中的 `transport_product` 表与 `transport-demo-data.sql` 中的商品演示数据；司机端写操作需 `transport_shift_execution` 与 `transport_vehicle_location` 两张表（新库直接 SOURCE 全量 `transport-schema.sql`，老库按序执行 `sql/incremental/` 的 V005~V009 入口；公告/反馈/轨迹表同理，新库全量、老库 V007/V008/V009）。
3. 勾选「不校验合法域名」后编译，走短信或账号密码登录验证 `/app-api` 连通性。

## 现实公交接入（两种 key，二选一即可）

"附近公交"分两层：**REAL_TRANSIT**（现实公交站点）与 **PROJECT_TRANSIT**（项目自建客货邮线路）+ 模拟车辆（SIMULATED，标注"模拟演示"）。
现实层有两条接入路线，**选一条配置即可**，都没配时不影响项目线路与模拟车辆（页面会注明"未配置现实公交数据源"），绝不伪造。

### 路线 A（高德微信小程序 key + 客户端 SDK，即官方 wx 插件路线）

1. 高德控制台 → 应用管理 → 创建应用 → 添加 Key → **服务平台选「微信小程序」**，绑定小程序 AppID `wx687e9bf8544ac559`；
2. SDK：`libs/amap-wx.js`（仓库已内置；如需最新版可从高德「微信小程序插件 → 相关下载」解压后覆盖，文件头部即 `function AMapWX(a){...}`，约 8KB）；
3. 微信公众平台 → 管理 → 开发设置 → **request 合法域名加入 `https://restapi.amap.com`**（开发版可在开发者工具勾"不校验合法域名"跳过）；
4. `utils/config.js` 的 `AMAP_MINI_KEY = '<你的 key>'`。

> 当前仓库已配置 `AMAP_MINI_KEY`（微信小程序类型 key，实测可返回真实公交站；`place/around` 的 `address` 字段实为"途经线路"，
> 已解析为站点线路标签）。**上线/体验版前必须完成第 3 步域名登记**，否则真机体验版会直接请求失败。
> 若该 key 需要更换，只需改 `utils/config.js` 一处；后端 Web 服务 key（路线 B）与此互不影响。

生效链路：`utils/transit-amap.js` 用 `AMapWX({key}).getPoiAround({ querytypes: '150700', location })` 拉公交车站 POI →
合并进 `/transport/bus/nearby` 的结果（标注 `dataSource=REAL_TRANSIT`、`transitProvider=AMAP_MINI`），首页与「实时公交」页共用。
特点：key 与 AppID/域名绑定，放小程序里是安全的；不需要后端参与。

### 路线 B（后端代理：高德 Web 服务 key）

在服务器配 `AMAP_KEY=<Web服务 key>`（`/opt/cargo-post/app.env`）或 `yudao.transport.amap.key`（`/opt/cargo-post/config/application-dev.yaml`）。
后端 `AmapTransitProvider` 走 `place/around` 返回真实站点，前端无需 key、无需新增合法域名。
注意：**Web 服务 key 不能放客户端**（可被盗用），只能配在后端。

路由优先级：后端现实层已返回（`realTransitAvailable=true`）→ 客户端不再请求高德（省配额，避免双份数据）；否则客户端层补齐。

## 实时公交页（车来了式）与统一定位

页面结构（`pages/bus/index`）：**定位状态条 → 概览（附近 N 个公交站 · M 条线路）→ 地图（45vh，第一视觉焦点）
→ 附近线路（默认 6 条，可展开全部）→ 正在运行车辆列表**。地图上含：我的位置（`marker-me.png`）、公交站、
运行车辆（真实=绿色 `/images/marker-bus-real.png`，模拟=橙色 `/images/marker-bus-sim.png`）、当前线路 polyline。

- **统一定位**：全项目只有 `utils/location.js` 调用 `wx.getLocation({type:'gcj02'})`（页面禁止直调）；
  高德链路 = 设备定位（拿 accuracy）+ `amap-wx.js` 逆地理（拿 city/district），全程 **GCJ-02**，不做页面级坐标换算。
  统一输出 `{success, latitude, longitude, accuracy, timestamp, source, level, district, city}`，
  `source ∈ AMAP | CACHE | MANUAL | UNKNOWN`；日志前缀 `[AMAP_LOCATION]`。
- **搜索半径**（唯一实现 `location.nearbyRadius`）：accuracy ≤100m → 5000m；100~500m → 8000m；>500m → 15000m（后端另有上限）。
- **定位状态文案**：`已定位 · 精度 35m` / `定位精度较低 · 已扩大搜索范围` / `无法获取当前位置`；地图上有「回到我的位置」。
- **站点去重**：键 = 规范化名称（去掉 `(公交站)` 等后缀）+ 5 位小数坐标；同名同坐标合并为一条，**线路取并集**（客户端
  `transit-amap.dedupeStations`、后端 `AmapTransitProvider.dedupe`、合并层 `AppBusServiceImpl.dedupeNearbyStations` 同规则）。
- **车辆移动**：15s 刷新只更新目标坐标，`utils/bus-motion.js` 用**单一定时器**在 1.2s 内插值平滑移动（约 12 帧），
  只重设 markers，不重置地图中心/polyline；用户拖动地图后不再抢回中心；`onHide/onUnload` 清理刷新定时器与动画。
- **来源不伪装**：现实公交站点/线路来自高德并标注"现实公交"；项目客货邮线路标注"客货邮"；模拟车辆标注"模拟演示"，真实上报才显示"实时"。

真机验证步骤：

1. 打开小程序 → 「实时公交」：先看到定位状态与地图（而不是几十个站点列表）；
2. 地图上应有蓝点「我的位置」+ 周边公交站 + 运行车辆（橙色 = 模拟演示）；拖动地图后中心不会被刷新抢回；
3. 点「附近线路」中某条线路 → 地图 polyline 与车辆切到该线路；点车辆 marker 或列表卡片 → 进详情（详情页含地图 +
   车辆实时位置 + 下一站 + ETA + 数据来源）；
4. 走动几十~几百米后下拉刷新或点「定位」→ 附近站点/车辆随位置变化。

## 故障排查：「登录/商城下单/寄货提交」统一失败

现象：商品能浏览、公交/站点能加载（读接口正常），但发短信验证码、登录、商城下单、寄货提交一律失败，后端返回 `{"code":500,"msg":"系统异常"}`。

判定：这是**后端写链路**问题，不是小程序问题（小程序只能用弹窗把真实原因说清楚：`pages/goods/detail/detail.js` 下单失败弹窗显示后端 `msg`；401 会记录来源页，重新登录后回到原页，收货信息不丢）。

排查顺序（服务器上执行，脚本见 platform 仓库 [deployment.md](https://github.com/cgp-team/cargo-post-platform/blob/master/docs/deployment.md)）：

1. `bash deploy/scripts/diagnose-backend.sh`：一次输出健康检查、读写链路探测、磁盘、本机 Redis/MySQL 自检与日志。
2. 若第 3/4 步（发验证码/登录）返回 500 且本机 Redis 读写正常 → 后端连的 Redis（默认 yudao 公共演示 Redis）写命令被拒，按脚本结论把后端 Redis 指到本机容器并重启；部署流水线已内置同样的自检与切换（`Ensure backend has a writable Redis`）。
3. 若磁盘满或 MySQL 只读 → 先释放空间/恢复挂载，再重启后端并复测。

## 订单全链路动线

一条寄货订单从下单到妥投的完整流转（便于联调时对照各环节）：

1. **用户端**：我要寄货（填货物/体积/类型/件数 + 拍照）→ 提交（承运审核：普通货自动通过 → 待入池）；
2. **后台**：班次调度页归集待入池订单 → 智能调度出方案（自动选场站与候选车辆）→ 方案审核通过后订单进入「已分配」；
3. **司机端**：工作台「扫码装车 → 发车 → 到站妥投」（`driverDepart` 只依赖"司机名下 + 方案已下发"）；
4. **用户端**：快递页「我的寄货」→ 车辆「车快到了」高亮提醒（≤10 分钟）→ 点它跳实时公交看车在动。

> 联调前如需清一次旧数据：执行 platform 仓库 `sql/mysql/demo-reset.sql`（把 已入池/已分配/已发车 订单放回「待入池」，并清掉当天的调度方案；**不删除会员/商品/站点/班次等基础数据**，含只读校验 SQL）。

## 相关仓库

- [cargo-post-platform](https://github.com/cgp-team/cargo-post-platform)：管理端（Vue 3）+ 业务后端（Spring Boot）+ 路线规划算法服务。后端接口契约、部署运维、数据库脚本均在该仓库。

## 许可证

[MIT](https://github.com/cgp-team/cargo-post-platform/blob/master/LICENSE)。基于 cargo-post-platform 拆分，许可证随原仓库保留。
