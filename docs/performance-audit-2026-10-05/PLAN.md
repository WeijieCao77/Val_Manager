# 代码结构、数据库与游玩卡顿优化方案

审查日期：2026-10-05。范围：当前工作区，包含原有未提交修改；本次只新增审查文档，没有修改业务代码或数据库。

## 1. 判断与建议顺序

可以做整合，也有明确的拆表价值。建议先解决 **排行榜扫描、前端主线程阻塞和重复数据传输**，再逐步拆账号资产；不建议第一步按用户分库、把所有 JSON 拆掉或整体重写。

现在至少有三类不同的“卡”：

| 玩家感受 | 当前代码中可确认的风险路径 | 优先处理 |
| --- | --- | --- |
| 进入卡牌/经理模式很慢 | 大块静态依赖、完整更新日志与游戏数据进入模式加载链 | 缩减模式必需依赖，测冷启动 |
| 点击比赛、榜单、交易后等待 | Worker 排队；排行榜 JSON 全表排名；整份账号读写与返回 | 榜单小表、短事务、按阶段计时 |
| 手机滚动、倒计时或推进不流畅 | 杯赛页面每秒更新；长货架节点累积；经理推进与存档同步执行 | 隔离时钟、控制节点、推进分片/Worker |

**以上是代码证据与风险定位，不是已证明的线上根因。** 本次没有获取生产数据库连接、峰值慢查询、用户设备记录或公网链路数据，因此不能说所有玩家卡顿都来自数据库，也不能承诺拆表后提升多少倍。

## 2. 已完成的检查与证据边界

- 检查入口、路由分发、账号动作、市场交易、全服杯/组队杯、存档、统计汇总和主要 React 页面，以及它们的共享引擎依赖。
- 在 `/private/tmp` 重新执行 Vite 生产构建：成功，268 个模块。没有覆盖现有 dist；这只验证前端打包，不等于通过 TypeScript、后端或完整业务测试。
- 在全新内存 PGlite 中执行当前 SCHEMAS 并读取表、列、索引和键约束：31 张表、73 个索引；另有 applySchema 创建的 schema_marks，因此源码描述的完整集合为 32 张表。PGlite 不用于证明 PostgreSQL 并发、磁盘或线上查询性能。
- 对重新生成的 JS 分析静态依赖闭包，整理加载体积；同时复核仓库旧压测原始 JSON，区分历史与当前实现。
- 参考 PostgreSQL 官方 TOAST、HOT、分区及索引文档。生产数据库版本仍需核实。

完整表结构见 [DATABASE_STRUCTURE.md](DATABASE_STRUCTURE.md)，可复核原始数据见 [schema.json](schema.json) 和 [evidence.json](evidence.json)。

## 3. 当前代码结构

```text
src/App.tsx                    URL/模式入口，按模式 lazy
├─ src/ui/CardMode.tsx          卡牌账号、全局状态、动作、页面切换
│  └─ src/ui/cards/*            开包/收藏/天梯/市场/杯赛等页面
└─ src/ManagerGame.tsx          经理模式状态、同步存档、页面切换
   └─ src/ui/*                 管理、比赛、资料、赛程等界面

src/engine/*                   同一套领域模型、规则、比赛和成长引擎
src/engine/server.ts           打包为 dist-server/engine.mjs，服务端复用
src/data/*                     世界、能力、资料、历史赛事和内容数据

server.js                      HTTP、静态资源、路由、连接池、健康与管理接口
├─ cards-api.js                 账号、动作、排名、匹配、请求去重
├─ market-api.js                市场、报价、结算、交换
├─ opencup-api.js/teamcup-api.js 赛事时钟、报名、赛果、奖励
├─ phone/profile/site/...       身份、跨模式成就、配置与管理
└─ analytics/stats/rollup       埋点、查询、汇总、保留与清理

match-worker.js/opencup-worker.js CPU 计算
db-schema.js/db-transactions.js  启动迁移和事务连接预留
scripts/*                       数据采集、平衡、测试、发布、数据库核验
```

优点：引擎和 UI 已分开，前后端共享规则；模式入口懒加载；交易与赛事已经有独立表。主要维护问题是后端职责集中在根目录大文件，SQL、缓存、请求协议、业务流程和维护任务交织。`cards-api.js` 约 84 KB、`market-api.js` 约 115 KB，不利于明确哪些变更影响资产、查询还是后台任务。

推荐渐进整理为 `server/http`、`server/services`、`server/repositories`、`server/jobs`、`server/observability`，保留 `src/engine` 的纯规则职责。先抽账号事务、查询投影和请求去重，其他模块随优化迁移。拆文件本身不增加吞吐，不以整理目录替代性能工作。

脚本建议按 `data/ratings/checks/load/release/db` 分类，明确执行入口和输入产物；analysis/output/preview 中的研究结果不进入运行时导入链。新增版本迁移放到 migrations，减少运行时 schema 文本与一次性修复混在一起。

## 4. 当前数据库结构与该拆什么

| 分组 | 当前表 | 当前用途与判断 |
| --- | --- | --- |
| 账号/资产 | card_accounts | 身份列、rev、seen、验证/风控列；资产、阵容、天梯、日志和玩法状态都在 state JSONB，是首要优化对象 |
| 市场 | card_listings、card_offers、card_swaps、market_bans | 已关系化；挂牌汇总列和部分索引已存在，优先看执行计划，不再泛泛要求“市场拆表” |
| 收件与身份 | card_mail、card_gifts、card_phones、card_sms | 已独立；邮件来源唯一性、已领取数据保留策略需逐项核验 |
| 请求去重 | card_requests | 复合主键 (id_hash, request_id)，保存动作及响应；高写入、清理与保留策略值得完善 |
| 匹配 | enc_entries | 国家队阵容已有小型投影表，可以参考这个模式处理其他匹配 |
| 全服杯 | open_cups、open_cup_entries、open_cup_matches、open_cup_payouts、open_cup_engine_builds | 已独立且有赛事快照/奖励收据；保持赛事历史与账号当前状态分开 |
| 组队杯 | team_cups、team_cup_entries、team_cup_ties、team_cup_payouts | 已独立；优化公共读取、定时计算和详情传输 |
| 统计 | events、visitors、daily_stats、rollup_state、rollup_day_visitors、rollup_day_sessions、rollup_day_counts | 原始事件与汇总已分开；后续按数据量评估分区/独立实例 |
| 其他 | site_profiles、site_config、champion_messages、champion_message_reviews、schema_marks | 保持独立，当前没有证据需要进一步拆分 |

这里的“拆表”需要区分：**把不同业务字段拆成小表**、**把同一日志表按时间分区**、**把业务分到不同数据库**。当前最有价值的是第一种；日志规模足够大时再做第二种；第三种放在容量和争用数据证明必要之后。

### 4.1 第一批：增加排名和匹配投影表，不立即改变资产真相源

建议新增：

| 表 | 建议核心字段/键 | 解决的问题 |
| --- | --- | --- |
| account_ladder | PK(account_id, season, league)，div、points、stars、wins、losses、eligible、source_rev | 榜单查询只读小列，不解析完整账号 JSON |
| account_matchmaking | PK(account_id, league)，season、div、score、valid、squad_snapshot JSONB、source_rev、updated_at | 匹配只读五人/教练及相关等级，不扫描收藏与历史 |
| account_presence（按指标决定） | account_id、last_seen | 降低账号资产行被访问时间更新牵连的频率 |

`account_id` 初期可以直接沿用现有 `id_hash`，无需同时引入一套 ID 迁移。排名候选索引为 `(season, league, div DESC, points DESC, stars DESC, wins DESC, account_id)`，按现有过滤规则考虑 `WHERE eligible` 部分索引；匹配候选索引为 `(season, league, div, score, account_id)`，配合有效阵容条件。最终组合依据真实 SQL 和 EXPLAIN 决定。

投影与账号修改在同一短事务内更新，初期 JSONB 仍为真相源。所有会影响投影的入口都必须覆盖：动作、改阵容、卡牌升级/分解、交易交付/邮件领取、改名、赛季切换、管理端修正/风控。不是只在天梯胜负时更新。

榜单拆成“缓存前 100”和“当前玩家自己的最新战绩/名次”。自己的精确名次可查询小表上排在本人前面的数量，也可按可接受的新鲜度读取排名快照；大用户量时 count 仍有成本，需要测量。避免为了一个人的最新数据强制重排整服。

匹配不要改成索引小表上的全表 `ORDER BY random()`；按赛季、段位与分数区间取有界候选，再在应用内抽取，稀疏区间逐步扩展，验证对手分布与原匹配公平性。

### 4.2 第二批：按读写边界拆账号资产

只有第一批和传输优化完成后，再评估：

| 表 | 建议内容 |
| --- | --- |
| account_wallet | 金币、相关资源、钱包版本 |
| account_cards | PK(account_id, card_id)，等级、重复数量、进修状态 |
| account_inventory | 卡包、保底等开包状态；可先保留一块小 JSON |
| account_loadouts | 当前阵容与预设、版本 |
| account_progress | 每日任务、征途与玩法状态；复杂稀疏字段保留 JSONB |
| account_history/match_reports | 记录摘要与可按需读取的战报 |

目的：改阵容不重写整个收藏；交易不重写玩法历史；比赛不反复传回所有卡牌。不是追求每个字段一张表。钱包、收藏和保底必须在一个业务事务内一致提交；市场多账号操作采用固定锁顺序；继续保留 requestId 去重与版本检查。引擎需要一份 GachaState 时由 repository 组装，后续再针对动作读取必要数据，避免为了组装状态出现 N+1 查询。

第一批只新增可重建投影，回退到旧读取相对容易。第二批迁移资产真相源后，不能简单切开关回退：须保证旧格式同步完整或执行经验证的反向迁移。

## 5. 当前仍存在的具体优化点

### P1：排行榜全账号扫描与缓存提前失效

证据：`cards-api.js` 的 `topRows`、`rankedRows`（约 1018、1151 行）。排名仍从 card_accounts.state 中取赛季及战绩，对符合条件的账号做窗口排名，返回所有排名行，然后在 Node 过滤前 100 与本人。它使用交互池 sql。

20 秒缓存与同服单次构建已存在，但 `topRows` 会因当前用户 ladder_at 晚于缓存时间而失效；`act.commit` 对一般动作和领取邮件也更新 ladder_at。因此持续有人操作后看榜时，实际刷新频率可能比 TTL 高很多。并发合并只能合并正在执行的一次，不能消除连续重建。

建议：先分离本人新鲜度与公共榜单；查询返回有界榜单行；移到排名小表。短期把重建放受控读预算并后台刷新，但仍测共享数据库负载。不能只加 LIMIT 100 就声称没有全量排序，也不能把查询挪到统计池就声称不再争用 CPU/IO。

### P1：匹配仍扫描 JSON，且与重统计共用慢池

证据：`rivalRows`（约 1439 行）提取所有未标记账号的阵容，按段位随机排序抽样；`refreshRivals` 有 60 秒缓存、单次构建和旧样本继续服务。国家队 enc_entries 已存在，当前主天梯仍没有等价小表。

建议：采用 account_matchmaking；冷启动受控预热，刷新失败保留可用旧样本并监测样本年龄。统计池同时服务后台报表、埋点、汇总与匹配刷新，可能互相排队；先限制重报表并发，再判断是否需单独匹配读预算。分连接池只隔离连接名额，不隔离同一数据库的锁、CPU、IO。

### P1：小改动仍整份账号读写、传输与本地镜像

证据：`cards-api.js` load/save/act、`market-api.js` 多个资产动作仍返回 state；`src/engine/account.ts` 接收后 `writeMirror` 同步 JSON.stringify + localStorage.setItem。服务器响应压缩已异步化，但 `server.js` 中 JSON.stringify 仍同步执行。

建议先加可选增量协议：`baseRev → rev + changes + result`。基线不一致、旧客户端或未知状态时返回全量；每个模块定义字段替换、删除及顺序规则，不用客户端猜测差异。交易和领取邮件统一套用。镜像存储合并写入；较大镜像迁到 IndexedDB。记录序列化、压缩、返回字节、客户端解析/应用/镜像耗时。异步压缩并不能消除 JSON 解析与主线程存储成本。

### P1：经理推进和存档仍在浏览器主线程

证据：`src/ui/Dashboard.tsx:93` 的 step 只用 setTimeout 延迟 10 ms，随后同步执行 advanceDay/advanceToNextMatch；后者可以一次推进多天。`src/ManagerGame.tsx:155` commit 同步 autosave；`src/engine/save.ts:51` packState 遍历赛程并 JSON.stringify，随后写 localStorage。

建议先分别计时“推进计算、比赛模拟、packState、存储”。多天推进在安全日边界让出主线程；若计算占主要耗时，使用浏览器 Worker，期间 UI 禁止冲突操作，由单一状态所有者提交结果。Worker 的状态复制成本也要测。长期存档用 IndexedDB 保存快照和详情，导出兼容旧 JSON；明确显示已保存版本，不能把“后台保存”做成用户看不到的数据丢失。

### P1：杯赛倒计时每秒驱动整页更新

证据：`src/ui/cards/OpenCup.tsx:50` 每秒 setNow；`TeamCup.tsx:52` 类似。组队杯有后台可见性判断，全服杯的秒级 timer 与到期后的 10 秒追问路径没有相同保护。网络轮询已有 45/60 秒节奏，不需要笼统改成“减少所有轮询”。

建议：时钟放到独立 Countdown 组件；对阵、排名和详情只在数据版本改变时刷新。统一轮询去重、取消、后台暂停和随机抖动，避免大量玩家在赛事时刻同时请求。旧数据继续显示加载状态；请求失败不清空整个赛事视图。考虑公共赛事摘要缓存，个人报名/奖励状态单独读取。SSE 可作为后续选择，先验证现有轮询的峰值负载。

### P2：模式初始加载与大内容依赖

本次新构建的静态 JS 依赖闭包如下，按文件去重、十进制 kB；gzip 为本地估算。排除 CSS、图片、API、动态可选模块和缓存影响，不是浏览器实测首屏流量。

| 模式/入口 | 未压缩静态 JS | gzip 估算 |
| --- | ---: | ---: |
| 应用入口含 React | 217.39 kB | 69.76 kB |
| 首页含共享依赖 | 453.78 kB | 162.83 kB |
| 卡牌模式含共享依赖 | 1,739.80 kB | 489.18 kB |
| 经理模式含共享依赖 | 2,068.19 kB | 588.64 kB |

入口已 lazy，但 CardMode 内 Packs、Collection、Squad、Challenge、Dossier 等仍静态导入；卡牌目录依赖世界数据。完整 changelog 单块约 178.85 kB，world 617.98 kB，CardMode 主块 163.99 kB。经理模式也带入卡牌与资料共享模块。入口还可能加载公告等动态内容，实际网络量必须浏览器复测。

建议：资料页与较重非默认页按需加载；首页/模式侧栏只加载最新几条更新，完整 changelog 延后；把卡牌展示用轻目录与模拟引擎世界数据拆开。真实比赛仍会需要规则与属性数据，因此收益取决于访问路径，不能承诺 lazy 一个页面就省掉全部引擎。历史 world、records、funPool 与开包 Three.js 渲染器已经动态加载，不应误报为首屏全部下载。

### P2：货架增长和重复渲染

证据：收藏已有 60 张分页、延迟搜索和 useMemo；市场已有游标分页、分块可见性优化和后台暂停。但 Market 用 chunks.map 渲染所有已加载块，继续滚动会累计 DOM；可见性优化不同于卸载屏外节点。`CardScale` 每个实例有 layout effect 和 ResizeObserver；CardCtx 每 30 秒时钟改变也会传播给订阅它的页面。

建议：长市场验证窗口化或有界页面保留，保留滚动锚点及选择状态；不要把已分页的收藏重新当成“600 张一次渲染”。拆时钟、动作方法、资产与页面状态订阅；memo 的比较必须包含等级/进修/版本，避免原地修改导致旧卡面。共享网格测量可替代大量相同尺寸观察器，但先测布局与滚动耗时。

开包渲染已有按需帧、DPR 上限 1.75、销毁与减弱动画支持；不能当成持续满帧运行的已证实根因。可增加用户“简化开包动画”，默认规则依据实机耗时和设备体验确定。

### P2：访问时间与清理任务仍制造写负载

load 每次更新 seen，seen 有 B-tree 索引；即使 state 不变也有行/索引写入，且与资产更新共享行。可先将 seen 更新节流为 5–10 分钟一次，保留真正业务状态的 saved；统计需求允许时再拆 presence。**只更新 seen 不等于重写整份 TOAST state**，其主要问题是行锁、索引和死元组，而不是每次访问都重写全部 JSON。

`sweepRequests` 仍由玩家动作触发，并使用交互池进行批量删除/裁剪；改为有界后台单次任务，监测清理滞后。现有代码 6 小时保留完整回复、3 天保留去重键，但 compactRequests 只保留 6 小时，并执行排他锁/TRUNCATE。手工压缩可能阻塞动作且缩短去重窗口，需要统一保留语义和维护执行时机。不要用频繁 TRUNCATE 或 VACUUM FULL 作为日常优化方案。

## 6. 分区、索引与数据库容量

**优先评估 events 的时间分区，card_requests 分区须单独设计唯一性。** 是否实施由真实行数、总空间/TOAST、清理耗时与查询时间范围决定，不以“表多就快”为判断依据。

events 的 `(session_id,n)` 条件唯一索引以及 card_requests 的 `(id_hash,request_id)` 主键，都不会直接满足按时间分区后跨分区唯一性的要求。需要保持独立的全局去重键表或设计请求键和可信分区定位协议；不能简单把时间加进唯一键就声称相同请求仍只执行一次。去重保留期仍要覆盖服务端承诺的重试窗口。

events 清理仍必须先汇总且确认水位、迟到/未提交事件处理，再删除或摘除分区。市场已成交、已领取邮件、历史战报和赛事结果按查询需求制定热数据保留策略；报价退款/奖品交付的账本证据不在结果落地前清理。

索引方面：市场已具备 open 部分索引、价格/结束/创建时间游标索引、card_id 与成交历史索引。先取真实常用筛选的 EXPLAIN 再决定是否补复合索引；宽泛 JSONB GIN 不是针对排名排序的替代方案。核验 `(to_h,id)` 未领取邮件等组合是否存在实际排序成本，不自动新增所有候选。

数据库采集：pg_stat_user_tables 的 live/dead、n_tup_upd/n_tup_hot_upd、最近 autovacuum；表/索引/TOAST 体积、WAL、磁盘余量、长事务和锁等待，及可用时 pg_stat_statements。已有 `/api/admin/db` 可先复用。调 autovacuum/fillfactor/池大小前看数据，资源不足时据峰值 CPU/IO/连接等待决定扩容或将重分析迁出。

## 7. 已有优化应保留，旧压测不要当作现状

当前已经实现：交互/后台/统计连接池默认 4/1/2；比赛 Worker 默认 2 线程、队列 200；动作按账号排队、计算不持有事务、最终 rev CAS；市场价格汇总与游标分页；匹配缓存旧样本继续服务；HTTP JSON 异步压缩；启动 schema 指纹、并发锁和 readyz；统计先汇总再清理。

历史 `LADDER_LOAD_REPORT.md` 描述的“同步比赛在事务内”已不符合当前 cards-api 的实现，不能照着旧结论重新安排相同工作。

较新的 `ladder_offtx_after_w2_q200.json` 在本机 PG18、闭环 300 并发且外围限流关闭的条件下记录：市场 p95 259.6 ms、账户 load p95 72.8 ms、天梯 p95 1,610.5 ms、事件循环 p99 13.3 ms；3,101 次天梯尝试成功 2,260 次，**841 次因排队过多业务拒绝，虽然 HTTP 都是 200**。这表明已有隔离优化有效，也表明压力能转移到比赛等待/拒绝。数据是历史测试，不是本次复测，也不等价于真实线上在线人数或当前容量。

下一轮报告同时列成功请求延迟、业务拒绝、吞吐和完成率，禁止只用 HTTP 200 或仅成功样本判断“不卡”。不要为了隐藏拒绝无限加长队列，也不要不看 CPU 就增 Worker 或数据库连接。

## 8. 实施顺序、工作量与验收

以下为熟悉项目的一名工程师的粗估，含针对性验证；实际周期取决于生产观测、兼容客户端与数据回填规模。阶段验收后再进入下一阶段。

| 阶段 | 工作 | 粗估 | 验收重点 |
| --- | --- | --- | --- |
| A：建立线上基线 | 复用 perf/db；补接口全程、非事务查询等待、序列化/传输与前端分段计时 | 1–2 人日，外加 24–48 小时高峰采样 | 能区分服务器排队、SQL、网络、主线程；收集设备/页面/操作/版本且不采集账号密钥 |
| B：快速减负 | 榜单公共缓存与本人分开；杯赛时钟隔离；轮询去重/抖动；seen 节流；去重清理后台化；更新日志按需加载 | 3–5 人日 | 同负载下重建次数、写入和渲染降低；切页/后台恢复没有错误 |
| C：查询结构 | 排名/匹配投影、完整写入口覆盖、回填校验、旧新查询对比 | 5–8 人日 | 榜单与匹配路径不再读大 state；名次/赛季/阵容与旧规则一致 |
| D：传输和经理流畅度 | 增量响应与全量回退；镜像/存档异步化；经理推进分片，按实测评估 Worker；市场窗口化 | 5–10 人日 | 小改动传输明显下降；长存档与长货架仍流畅；版本冲突及导入/导出正确 |
| E：容量优化 | 按证据拆资产、请求回复/战报、日志分区；需要时独立分析实例 | 分项估算，资产迁移通常 1–3 周 | 资产原子性、去重、重试、回退与存储成本全部验证 |

建议第一轮目标（待基线校准，不是现在已达到的指标）：相同测试地域/设备下，小读写 API 服务端 p95 <300 ms、p99 <1 s；天梯成功请求 p95 <1.5 s，正常预期峰值业务拒绝率 <1%；前端交互 p75 INP <200 ms，主要操作无持续 >200 ms 主线程任务。公网端到端延迟另列，不能混为服务端指标。

压测用现有 `scripts/pg/check_mixed_load.mjs` 扩展：加入榜单访问、缓存冷启动、真实尺寸账号 JSON、卡牌更新/交易/邮件/杯赛重叠；数据规模分 1 万/5 万/10 万账号或按实际基线缩放。会话模拟加入思考时间，同时保留无思考极限档；分别测稳定期、部署重叠和清理窗口。所有写压测只在独立测试 PostgreSQL 执行。

浏览器验收至少覆盖手机 Safari、Android Chrome/常见内嵌浏览器与桌面；冷/热缓存、弱网、长货架、丰富收藏、三至五赛季存档；记录操作完成、INP/长任务、滚动帧时间、内存和存档恢复。桌面构建成功不能替代手机验证。

## 9. 迁移和发布方法

新增表/字段 → 新代码同事务写投影 → 按稳定账号键分批回填 → 使用 source_rev 防止旧回填覆盖新数据 → 对旧/新读取做影子比较 → 小流量切换 → 扩大流量。回填时只读取所需 JSON 路径，每批限制数量和时间；不在启动迁移里做无界全库回填。

排名与匹配必须核验赛季滚动、历史未活跃账号、不同 league、疑似账号排除、等级/进修变化和当前阵容可用性。资产阶段另外覆盖购买、退款、发卡、邮件重复领取、同请求并发、双设备操作、响应丢失与部署重叠。复用现有 PG 并发核验，不以 PGlite 的串行行为证明并发正确。

运行时保留 schema 就绪检查，真实迁移改为有版本任务。大型索引考虑 CONCURRENTLY，并单独执行、校验无效索引、处理失败重试；不能塞进当前 applySchema 的事务块。长数据修复和空间回收与发布分开安排，监测锁等待和交互延迟。

## 10. 仍需线上证据确认的事项

当前生产 release 与本地工作区是否一致；实际 PG 版本和部署资源/实例数量；各表真实大小、增长率、死元组与索引命中；高峰慢 SQL 和池等待；玩家主要卡在经理还是卡牌、页面与操作分布；中国访问链路/CDN 与用户设备性能。本次未访问生产，以上均保持待确认。

下一步应先落地 A+B，并同步设计排名/匹配投影。这样可以先获得玩家能感知的减负，也能以实测决定后续资产拆表和扩容的范围。

## 技术依据

- [PostgreSQL TOAST](https://www.postgresql.org/docs/current/storage-toast.html)：大字段存储及未修改字段更新时的复用；用于区分整份 state 修改与单独 seen 更新的成本。
- [PostgreSQL HOT](https://www.postgresql.org/docs/current/storage-hot.html)：被索引列更新与 HOT 条件；用于分析 seen 的索引写负载。
- [PostgreSQL 表分区](https://www.postgresql.org/docs/current/ddl-partitioning.html)：分区裁剪及唯一键限制；用于日志分区和去重设计。
- [PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html)：CONCURRENTLY 的执行与限制。
- [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)：ANALYZE 会实际执行查询；生产先采集已有统计/普通计划，重查询实际执行在受控窗口或测试库进行。
