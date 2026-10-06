# 四项卡顿修复复核

2026-10-06，当前未提交工作区。结论：优化方向成立，常规回归通过；新增了两个可复现的 P2 边界问题，建议补齐后再发布。本次未改业务代码或部署生产。

## 已确认的改动

- 请求回复清理改为按 at 索引从持久游标向前扫描，单批最多 50,000 行；不再以未压缩 JSON 条件反复寻找旧回复。保留请求号，现有幂等/回复清理回归通过。
- 小时清理增加增量计数 memo，正常顺序提交时可以避免每小时的大 OFFSET。但现有 stats/rollup 回归不传入 memo，不能验证新增计数路径。
- 报名、退出移到 main 池的短事务，保留杯赛行锁、容量检查和重复报名检查。真实 PG 中占住 bg 连接时，两种杯赛报名分别约 6/8 ms，退出约 2/1 ms；预热实例遇到开赛行锁时约 3,006 ms 返回提示。新增原测试通过。
- 已缓存的上赛季/预测榜到期后先返回旧缓存，单个后台任务重建；冷启动第一次仍等待。SQL 子查询增加执行边界，避免反复提取同一大 JSON，方向合理。

用户提供的 44–65 ms 与 2,261→620 ms 基准，本次未按相同规模独立重测，不能视为本次实测。完整 rollup+prune、真实网络和浏览器端的改善仍需验收。

## 1. [P2] 增量清理把可见最大 ID 当作提交边界，漏算迟提交行

位置：`stats.js:596–600`、`632–635`。

查询只计算 `id > memo.top` 的新增行，然后把当前可见的最大 id 存为新的 top。序列编号按分配顺序产生，不代表事务提交顺序：较小 id 未提交时，较大 id 已提交，游标就会越过较小 id。它后来提交，下一轮不会再计入增量。

真实 PostgreSQL 复现：

1. 12 行、cap=10，第一次清理后 memo.top=12，保留 10 行。
2. 事务插入 id=13 但保持未提交；另一连接插入 id=14 并提交。这些插入发生在前一轮 rollup 的锁释放之后，已汇总边界仍为 12。
3. 清理看到 id=14，算新增 1 行，删掉一行，将 memo.top 推到 14，memo.rows=10。
4. 提交 id=13；下一轮汇总现已覆盖到 14，清理仍只数 id>14，发现 0 行。实际保留 11 行，memo 仍称只有 10 行。

复现已执行，结果：`actual=11, expected=10`。这里没有删除未汇总数据，但“准确保持上限”的保证不成立；误差可持续到每日重新建立锚点，持续并发会累积误差。下轮 rollup 的 SHARE 锁不能修复已经跳过的计数。

建议：计数游标需基于已证明不会再有迟提交行的边界。稳定边界内的计数和仍可能迟提交的尾部区间应分开维护，不能简单用 max(id)；也不能只把 top 截到 foldedUpTo 却继续沿用包含尾部行的 rows，造成重复计数。增加真实双连接回归，覆盖晚提交、ID 空洞、水位落后和锚点重建。

复现：[prune-memo-repro.mjs](prune-memo-repro.mjs)，命令：

```sh
PG_TEST_URL=postgres://... node --import tsx docs/incident-2026-10-06/prune-memo-repro.mjs
```

结果：[fix-review-prune-results.json](fix-review-prune-results.json)。仅允许独立本机测试 PG，脚本创建并删除自己的随机数据库。

## 2. [P2] 冷实例先执行 ensureOpen，绕过新增的 3 秒锁超时

位置：`opencup-api.js:238–240`、`703`。

join 在进入 seatTx 之前执行 `ensureOpen(now, sql)`。新 API 实例或换时段时，known 未命中，会直接执行 INSERT ... ON CONFLICT DO UPDATE。若同一杯赛行正由开赛事务锁住，这条查询会先等待，尚未进入设置了 3 秒 lock_timeout 的事务。

复现只对新增 PG 测试做一个改动：第 2 段的行锁检查使用全新的 makeOpenCupApi 实例。持锁 6 秒时，报名约 5,814 ms 后成功，而非约 3 秒返回“正在开赛”。原测试先在第 1 段报名预热了 known，因而跳过 ensureOpen，没覆盖冷入口。

这会占住一个交互连接；多个冷入口等待可能影响开包、登录等请求。移动连接解决了排队来源，但超时保护尚未覆盖整个交互写入路径。

建议：ensureOpen 的交互查询也放入受限短事务，保证异常被转成同样的忙碌提示；known 只能在提交成功后确认。保留开赛、报名及容量的同一行锁规则。回归应分别覆盖冷实例/已预热实例、后台连接占用和同一杯赛行锁。

复现：[cup-cold-lock-repro.mts](cup-cold-lock-repro.mts)；输出：[fix-review-pg-results.json](fix-review-pg-results.json)。运行：

```sh
PG_TEST_URL=postgres://... node --import tsx docs/incident-2026-10-06/cup-cold-lock-repro.mts
```

## 本次验证

| 检查 | 结果 |
| --- | --- |
| check_idempotency.ts | 通过 |
| check_last_season.ts | 通过 |
| check_stats_sql.ts | 通过，未覆盖 memo |
| check_rollup.ts | 通过，未覆盖 memo |
| 无增量 TypeScript 检查 | 通过 |
| 新 check_cup_join_pools.ts，真实 PG 18.6 | 通过 |
| 增量清理晚提交复现，真实 PG 18.6 | 失败，确认上述问题 |
| 冷实例报名行锁复现，真实 PG 18.6 | 失败，确认上述问题 |

测试使用一次性本机 PostgreSQL，结束后自动停库并删除各脚本测试库。本次未运行全量审计或手机实机。

后续仍需检验请求游标的大量同 at 边界是否能持续前进、多实例维护的计数一致性，以及完整维护窗口下交互的尾延迟。新杯赛 PG 脚本尚未进入常规审计清单；需要一个有 PG 的 CI/发布检查入口，避免因 PG_TEST_URL 未配置而 SKIP 被误当作实测通过。
