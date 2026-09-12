# 首尔 2024 冠军赛收藏系列

2026-09-11 按用户决定改为：首尔包 3000 金币；总评和能力按出场地图数向本届平均收缩（6 图）；PRX 指挥 d4v41。仍为离线方案，无 commit、无部署，等用户本地看过卡面再定。[冠军强度与售价测算](../../analysis/seoul_launch.md) 里的 EDG 加强与补缺是在收缩前测的，尚未采用。

数值复核见 [首尔平衡报告](../../analysis/seoul_balance.md)；`analysis/seoul_balance.json` 已按上述改动重跑。

交付入口：开瓦包 `/cards` 的首尔专题货架；公开完整图鉴 `/seoul-2024`。所有改动仅在工作区，无 commit、无部署。

- 16 支战队、80 位实际登场选手，001–080 固定编号；不计未登场替补或教练。
- 当届 roster/数据冻结在 `src/data/seoul2024.json`。VLR 现行页面把历史 DRX 显示为 KRX，按 Riot 当届官方名单纠正为 DRX；FNATIC 收录 hiro，不收录未登场的 Leo。
- 独立卡 ID `s24:<VLR ID>`；已存在选手沿用相同 person ID，不能与普通/传奇版本重复上阵。11 位现有数据库缺少的选手保留历史 ID，仅在卡牌竞技场中构建角色，不加入 2026 生涯名单。
- 首尔包：3000 金币 / 3 张 / 至少一银；基础金卡 12%、银卡 38%（指挥和先锋位加分后金卡变成 23 张，按 8% 集齐 80 张中位要 314 包，改 12% 回到 232 包左右），采用现有金卡软硬保底，不出彩卡，也不累积或消耗彩卡保底。概率面板自动使用实际开包引擎测量。
- 赛事卡只能从赛事包抽取；现有普通、赛区、位置包卡池与赛区奖励分母保持原样。现有俱乐部全队收藏按普通名单计算，不被赛事版本扩充人数。
- 首尔卡沿用重复卡、升级、交易和上阵规则；收藏页提供「首尔 2024」筛选。

## 设计

官方 Champions 标识 + 黑色底材 + 香槟金印刷 + 首尔视觉中的折射蓝；超新星放射细线贯穿正面、卡背和铝箔包。图鉴可按队伍 / 选手搜索，并切换卡背。主位置按当届英雄使用比例汇总到位置后排序，避免把多名决斗英雄合计占多数的选手标为先锋。卡包在既有 Three.js 撕包模型上更换前后印刷；WebGL 不可用时显示同版式备用包装。

选手卡保留当届战队、国家/地区代码、独立编号、ACS、K/D、出场地图数。大号 0–99 能力值为游戏换算，不是 Riot 官方评分，也不是 VLR Rating。公式：Rating、ACS、KPR、KAST、APR 先按阶段加权，每张图按「回合数 × 该轮权重」计入：小组赛 1，季后赛前段（上半区八强、败者组前两轮）1.5，上半区四强到败者组决赛 2，总决赛 3。逐图数据由 `scripts/fetch_seoul2024_maps.py` 从 vlr 比赛页抓取，`scripts/build_seoul_stages.mjs` 写入 `src/data/seoul2024_stages.json`；残局没有逐图记录，仍用整届数据。然后各自按 `(本人 × 地图数 + 本届按图加权平均 × 6) / (地图数 + 6)` 收缩，再算 `70 + (收缩后 Rating - 0.75) * 45`。之后加两项 Rating 看不到的贡献：指挥按战队名次加分，冠军 +6、亚军 +5、三四名 +4、5–8 名 +3、9–12 名 +2、13–16 名 +1（指挥属性同样加）；先锋位按 KAST 和场均助攻高出本届平均多少（两项标准分之和，限 0–3）乘以打先锋英雄的比例加分。四舍五入后限制 55–96；金卡 >=84，银卡 >=76，其他为铜卡（23 金 / 51 银 / 6 铜）。例：ZmjjKK 小组赛 0.93、总决赛 1.39，整届平均 1.10，加权后 1.17，总评 85 → 87；nobody 79 → 85；S1Mon 81 → 84。同一选手单图 VLR Rating 的标准差是 0.32（`scripts/cache/vlr_matches.json` 14,575 条单图记录），4 张图的样本误差约 ±7 分，比金银差距还大，所以小样本向本届平均靠。卡面上的 ACS、K/D、地图数仍是原始记录。80 人用同一公式，详见 `src/engine/seoul2024.ts`。

预览全部卡面：`node scripts/render_seoul_cards.mjs`，输出单文件 `analysis/seoul_cards.html`（原快照总评 → 现在总评，可按总评排序、只看稀有度变化）。

## 素材与数据来源

- Riot 官方赛事介绍、日期、16 队名单及参赛队海报：https://valorantesports.com/en-SG/news/everything-you-need-to-know-champions-seoul
- 80 位实际登场选手与完整赛事统计：https://www.vlr.gg/event/stats/2097/valorant-champions-2024
- 官方参赛队海报：https://cmsassets.rgpub.io/sanity/images/dsfx7636/news/3f7cc4b27ca8c4f0eefb0f929371471cf93eddd2-1920x1080.jpg
- Champions 标识（赛事页面使用）：https://owcdn.net/img/63067806d167d.png
- 头像：Riot Games 官方 Flickr（valorantesports）上首尔冠军赛 Features Day（2024-07-30）的单人照，80 人各一张，逐张按照片说明核对本人（Riot 的写法：heybay 为 HeiB、AtaKaptan 为 ATA KAPTAN、whzy 为 whz），不与彩卡照片重复；按人脸裁成 400px 正方形。照片为 All Rights Reserved，来源页记在 `src/data/seoul2024_faces.json`，流程见 `scripts/seoul2024_faces.py`（download / sheet / flickr / crop）与 `scripts/face_boxes.swift`。原资料照仍在 JSON 的 `face` 字段，作为缺图时的回退。Liquipedia commons 只有 19 人有当届照片，且多为比赛现场照，未采用。

所有素材已存储于项目 `public` 中。图鉴底部也提供可见的来源链接和头像说明；没有把自制包装描述为官方商品。

## 验证

`node --import tsx scripts/check_seoul2024.ts` 检查名单/头像完整、所有卡可达、12,000 次抽卡结果、银卡保底、金币扣款、彩卡保底隔离、普通池隔离、存档往返、同人排重、历史选手真实对局和旧系列/俱乐部人数。

另运行生产构建、既有卡牌检查、卡牌 API、赛区卡包和随机性回归。收藏详情标注当届数据与数值来源，历史选手链接到其真实 VLR 主页。浏览器检查完整图鉴、战队与姓名组合筛选、卡背切换及 390px 窄屏布局（无横向溢出）；使用本地临时账号实际购买首尔包，验证扣款、撕包、三张卡逐张翻面、结果入库、收藏筛选和详情入口，刷新后仍保留 3/80 收藏及 400 金币。当前系列为可用工作区实现，未发布线上。

2026-09-11 改动后重跑：check_seoul2024、tsc、card_check、check_cards_api、check_mythic_floor、check_club_balance 40（改为只取普通俱乐部卡，之前同一人被选两次）、check_pack_rng 400、check_series 600 全部通过。

## 首尔征途（2026-09-12，离线）

入口是开瓦包的「首尔征途」标签。选一支 2024 首尔队，按当年的真实赛程逐场打：对手和顺序照当年，赢了才打下一场，输了免费重打。赢下当年输掉的比赛记为「改写历史」，后面的对手不变，所以这不是按胜负分支的赛制。

- 双方都用当届五人：本队 5 张赛事卡按位置排座（`SEOUL_FIVES`），0 级，不带教练，不看玩家的收藏和等级。
- 地图只在当年的 7 张里 ban/pick：Abyss、Ascent、Bind、Haven、Icebox、Lotus、Sunset。每场先打乱图池顺序，因为地图偏好全部相同时，`runVeto` 会偏向列表位置；按字母顺序排时，Sunset 只占 7% 的地图，打乱后 7 张图各占 13%–15%。
- 不花体力，也不动金币、收藏和天梯。
- 奖励全账号只有两个首尔包：第一次赢下一场给一个，第一次打通任意一支队再给一个。之后只记纪录，即每支队最少输几场打通；每支队保留最近 40 场的结果。
- 数据与代码：
  - 赛程数据在 `src/data/seoul2024_series.json`（34 场系列赛、86 张图），由 `node scripts/build_seoul_series.mjs` 从 vlr 缓存生成。
  - 引擎在 `src/engine/seoulRoute.ts`，服务端操作 `seoul_start` / `seoul_play` / `seoul_quit` 在 `src/engine/cardActions.ts`，界面在 `src/ui/cards/SeoulRoute.tsx`。
- 离线测算走的是生产路径，每个对阵 200 个种子：单场胜率 31%–67%，打通一条路线平均要打 4.5–14.8 场，一场不输打通的概率 0.7%–19.6%。每场模拟约 7 毫秒。
- 验证：`npx tsx scripts/check_seoul_route.ts` 检查以下内容。
  - 16 条路线与当年赛果一致，双方视角一致，BO5 正确。
  - 地图都在图池内，且分布均匀。
  - 不花体力，两个包只给一次，纪录取最少输场。
  - 客户端改不了进度，坏存档被丢弃，没有卡的账号也能打。
- 这个检查还没有加入 `npm run audit`，也还没有更新日志条目。
