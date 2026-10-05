# 真实 PostgreSQL 并发验收

仅使用独立、可销毁的测试 PostgreSQL，绝对不要传生产数据库 URL。

```sh
PG_TEST_URL=postgres://postgres@127.0.0.1:55439/postgres node scripts/pg/check_concurrency_pg.mjs
```

远端专用测试实例还需 `PG_TEST_ISOLATED=1`。账号需要创建数据库权限；每个脚本创建随机命名 `verify_*` 数据库，使用12连接池，结束后强制删除该测试库。不会复用或清空URL所指原数据库的业务表。URL不输出到日志。

可只跑一项：

```sh
PG_TEST_URL=... node scripts/pg/check_concurrency_pg.mjs check_idempotency
PG_TEST_URL=... node scripts/pg/check_concurrency_pg.mjs pg/races pg/check_rollup_delay
```

覆盖：
- 原 `check_load_race` 的旧load迁移与竞争资产更新CAS。
- 原 `check_idempotency` 的响应丢失重试、相同请求并发、异参拒绝、批量邮件和旧请求墓碑。
- 原 `check_market_sweep` 的积压无阻塞读取、有界批处理、两个实例同时结算、坏行回滚和补偿。
- 原 `check_open_cup_v2` 的4/5/7/9/17/37/267人瑞士轮、故障重试、快照和奖励唯一性。
- 原 `check_refund_repair` 的双实例退款与提交前异常回滚。
- 原 `check_open_cup` 的历史赛事并发推进/恢复及奖励一致性。
- `pg/races` 的14买家同时一口价购买：仅扣一份金币且仅交付一张卡；12人同时争最后一个报名名额（测试容量设4，生产算法不变）。
- `pg/check_rollup_delay` 中较小序号事件保持未提交、较大序号先提交；观察PG实际ShareLock等待，确认汇总等候后纳入两条事件且重复汇总不追加。

运行器保留原断言，仅替换数据库适配器。市场测试中有两项驱动差异在内存中适配：JSON夹具使用postgres.js的json参数；故障注入解开postgres.js的Parameter后仍针对同一挂牌抛错。临时脚本使用源码绝对路径和tsx执行，保留杯赛worker的import.meta文件位置；不打包为单文件，避免worker重入测试。

最终部署验收仍需真实混合负载、浏览器与生产就绪检查。这些测试不代表已经测出线上吞吐上限。

## 本机混合负载诊断

```sh
PG_TEST_URL=postgres://postgres@127.0.0.1:55439/postgres node --import tsx scripts/pg/check_mixed_load.mjs
```

创建独立测试库，实际本机HTTP请求调用生产API模块。交互/后台/统计池分别4/1/2连接；512个账户、1500条有效挂牌，每档加入1000条到期挂牌，同时计算一届512人真实引擎瑞士杯并执行统计折叠。依次50、100、300个无思考时间的闭环并发会话，每档请求至少15秒，等待同档杯赛计算结束后记录结果。请求包括GET健康、POST账户load、货架browse、peek、幂等签到。

为了测服务而非触发单IP限流，fixture禁用外围限流和手机号门禁；不经CDN、TLS、静态资源与真实手机。结果不是公网峰值容量，不直接用于承诺在线人数。统计文件默认为 `analysis/balance_v2/mixed_load_pg.json`，包含接口分位延迟、状态码、业务拒绝、后台错误和比赛完成数。


默认运行器和混合fixture均使用生产 `db-transactions.js` 的 `safeTransactions`；不扩大池预算。问题诊断可使用 `PG_LOAD_RAW_BEGIN=1` 对照原驱动begin，`PG_LOAD_WAVES=300`只运行300档，`PG_LOAD_OUT=...`指定数据文件。`PG_LOAD_MAX_PIPELINE`仅为诊断变量，**不是推荐部署配置**：设置1曾明显增加驱动事务错误，禁止据此套用生产。


## 实际server启动与定时维护门禁

```sh
PG_TEST_URL=postgres://postgres@127.0.0.1:55439/postgres node scripts/pg/check_release_server.mjs
node scripts/pg/check_history_maintenance.mjs
```

`check_release_server`启动真实server并在独立PG上持有迁移锁：验证health存活、ready/API暂不接流；放锁后验证全部feature、唯一约束和release指纹。测试专用loader把三分钟和每小时timer加速至100/150ms，确认实际server维护回调不崩溃；仅显式测试进程使用此loader，生产时钟不变。随后运行正式verify_deployment对本机server核验backend、engine与全部前端字节。独立maintenance测试覆盖单飞、压力阈值合并、汇总失败不清理、清理失败后恢复以及定时器拒绝处理。


## 实际天梯诊断

```sh
PG_TEST_URL=postgres://postgres@127.0.0.1:55439/postgres PG_LOAD_ACTION=ladder PG_LOAD_OUT=analysis/balance_v2/mixed_load_pg_ladder.json node --import tsx scripts/pg/check_mixed_load.mjs
```

50/100/300档使用450个不同账号；每号30体力、最多15次唯一requestId的真实BO5，绝不恢复体力。记录实际匹配类型、BO5地图数、数据库胜负/体力核对、失败原因、事务reserve等待/持有分位和天梯在途期间的市场分位。默认512个fixture账号，所选档位人数之和不能超出512。可用PG_LOAD_WAVES=300只测一档。

## 排行榜投影（account-projection.js）的真实并发验收（2026-10-05）

本机起一个一次性 PG（Homebrew `postgresql@18`）：

```sh
PG=/opt/homebrew/opt/postgresql@18/bin; D=$(mktemp -d)/pgdata
$PG/initdb -D $D -U postgres --auth=trust -E UTF8 --locale=en_US.UTF-8
LC_ALL=en_US.UTF-8 $PG/pg_ctl -D $D -o "-p 55439 -k /tmp -c listen_addresses=127.0.0.1" -l $D.log start
```

macOS 上不设 `LC_ALL` 会报 `postmaster became multithreaded during startup` 起不来。

```sh
PG_TEST_URL=postgres://postgres@127.0.0.1:55439/postgres node --import tsx scripts/pg/check_projection_pg.ts
PG_PROJ_N=20000 PG_TEST_URL=... node --import tsx scripts/pg/check_projection_pg.ts   # 回填窗口更长
```

覆盖：启动迁移（安装、第二次不锁、只补缺失触发器）；重新投影在写入者的行锁上等待、读到提交后的新存档（被删的行不复活），以及反向——写入等重新投影提交后覆盖；两个实例同时回填 + 8 个写入者 + 按固定顺序加锁的双账号交易，结束后每行投影与存档推算逐条一致、无死锁、无待修复；投影失败记入待修复并修复；并发写入下 /top、/rivals 全部成功。2026-10-05 一次 2 万账号的运行：回填与写入重叠 7 秒、12.4 万次写入、2 万笔交易，0 错误、0 不一致。

已有的并发检查也可以在装好投影触发器的情况下重跑（每次账号写入都会触发它）：

```sh
PG_WITH_PROJECTION=1 PG_TEST_URL=... node scripts/pg/check_concurrency_pg.mjs
PG_WITH_PROJECTION=1 PG_TEST_URL=... node scripts/pg/check_concurrency_pg.mjs check_squad_sync check_save_race check_ladder_match
```

`check_cards_api` 不能走这个改写器：它按相对路径读 `public/faces/*.webp`，复制到临时目录后找不到文件（与投影无关，不加投影也一样）。
