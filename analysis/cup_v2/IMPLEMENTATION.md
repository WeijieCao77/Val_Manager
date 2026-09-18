# 全服杯 v2 实施与验收记录

## 已实现

- 瑞士轮 BO3：两胜晋级、两败淘汰；首败不出局。所有晋级者进入 BO5 playoff，包括决赛。非二次幂人数安排入围轮，高种子轮空。
- 延续已落盘的 `openCupSwiss.ts`，补上小场全局精确配对（最多 9 人、945 个候选）和大场跨组有界修复，避免局部浮动选择制造可避免重赛。4–4096 人结构测试覆盖所有规模。
- 新增 format_version/phase/stage_round/playoff、参赛者瑞士/实胜/浮动/种子记录、比赛阶段/BO/租约字段。原三表主键与 v1 数据解释保留。
- 开赛原子锁定五人、等级、未取整分数及其构成、默契、战力、balance version、engine build hash。比赛使用冻结分数。
- 完整、可信的 engine/data bundle 按 SHA-256 压缩归档，每个构建只存一次。新杯固定 engine_hash；后续部署仍从数据库装载旧 bundle，在 CPU worker 内校验、解压、运行。旧 v1 没有 hash 时沿用 legacy 兼容路径。
- 默认每进程单个可复用 worker，计算不占数据库连接。引擎版本切换时销毁旧 worker；压缩包内存缓存最多两个。保存包和装载包均校验解压后 SHA-256，限制包大小。
- 有界后台任务：2 秒定时、每轮 tick 最多 64 场/1.5 秒预算（单场最多 30 秒超时）。领取任务使用 SKIP LOCKED、60 秒租约与随机令牌。陈旧令牌不能提交；失败保留原种子，10 秒后重试。
- 每场结果与双方战绩在同一短事务提交。只有全部比赛完成，才在赛事行锁下原子推进轮次。断电重启按数据库状态恢复。
- 瑞士实胜 20 金币、playoff 实胜 40 金币；轮空不伪造比分、不发实胜奖励。邮件与唯一 payout 收据在最终事务一次提交。
- 浏览不等待整杯模拟，使用后台数据库池。新增阶段/轮次比赛游标分页、瑞士战绩分组分页（每页 50）。页面含阶段规则、提前晋级、战绩、BO、赛程、结算状态与冻结评分明细。
- 清理仅限 done/void，长期未完成杯赛绝不因年龄被删除。历史引擎包仅在没有活跃/近期引用时清理。

## 已运行验证

- `node --import tsx scripts/check_open_cup_swiss.ts`：所有 4–4096 人规模，超过 1,048 万次瑞士配对；恰好参赛一次、确定性、三轮收敛、全体晋级进入 playoff、轮空/入围、105 分钟排期上界。
- `node --import tsx scripts/check_open_cup_v2.ts`：4/5/7/9/17/37/267 人，真实引擎 + PGlite SQL 完赛。首败继续、两胜两败、无虚假轮空比分、奖金额和唯一性、多人推进、快照、分页、故障恢复。
- `CUP_FIELDS=1024,4096 node --import tsx scripts/check_open_cup_v2.ts`：1,024 人 1,791 场/512 晋级；4,096 人 7,167 场/2,048 晋级；分别 768/3,072 份唯一奖励。最后配对修复后再次运行最终代码 4,096 人全杯并通过，见 `4096-final.log`；另有全规模结构回归。
- 故障注入：worker 抛错后租约重试、陈旧 worker 丢失租约后禁止写入、已更新赛果后战绩写入抛错同事务回滚、全新 runner 接手、30 天未完成杯赛保留。
- `node --import tsx scripts/check_open_cup_worker.ts`：worker 与直接调用真实引擎 BO3/BO5 × balance v1/v2 一致，故障/重启恢复。
- `node --import tsx scripts/check_open_cup_archive.ts`：压缩归档往返、单次存储、部署换包后旧杯继续同引擎、切换 worker、错 hash/损坏包拒绝。
- `node --import tsx scripts/check_open_cup.ts`：旧赛制全部既有检查通过，使用实际 worker。
- 类型检查与相关差异空白检查通过。

这些是本机真实引擎和 PGlite 的功能证据，**不是 PostgreSQL 多连接争锁或线上混合负载性能证明**。真实 PG、浏览器及发布验收由主任务统一完成。

## 发布与回滚

1. 先部署完整兼容代码，保持 `OPEN_CUP_FORMAT=1`。在旧版容器退出、迁移就绪和验收通过后，再设 `OPEN_CUP_FORMAT=2`。
2. 不能让尚不识别 format_version 的旧部署与正在推进 v2 杯的容器共存。新版本默认格式开关只决定新开赛；已开始 v2 按自己的版本继续。
3. `makeOpenCupApi` 生产需传后台池 `bg`、实际 bundle 字节 `engineBundle` 和 `cardPoolVersion=SHA256(bundle)`。engine archive 缺失或不匹配时拒绝静默改用当前引擎。
4. 回滚新赛事开关可以设回 1；保留兼容 v2 的程序完成已启动的 v2 杯。不能直接回退到不认识 v2 表字段和阶段的老程序。
5. engine_hash 归档冻结的是完整单场比赛引擎；配对、晋级和奖励由 format_version 路径解释。未来更改这些规则时必须新增/保留对应版本实现，不能在原 format=2 分支静默替换。
6. 不回滚或删除已经发放的资产。增量表列可保留；payout 唯一收据保持。

## 文件

`opencup-api.js`、`opencup-v2.js`、`opencup-worker.js`、`opencup-engine-archive.js`；`src/engine/openCupSwiss.ts`、`openCup.ts`、`openCupClient.ts`；`src/ui/cards/OpenCup.tsx`；四个新增 `check_open_cup_*` 脚本。
