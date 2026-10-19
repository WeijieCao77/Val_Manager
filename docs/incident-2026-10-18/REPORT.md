# card_accounts / open_cup_entries 整表扫描（2026-10-18）

生产 10-18 的 pg_stat：card_accounts（83 MB 堆，约 7.4 万行）31 万次顺序扫描、100 亿 seq_tup_read；open_cup_entries（44 MB，约 3.3 万行）11.2 万次、39 亿。21 秒采样里约 97% 的块读来自这几张表的堆，折合约每 8 秒整读一次 open_cup_entries、每 20 秒整读一次 card_accounts。两张表都超过 32 MB 的环形缓冲上限，每次扫描都从慢盘读。

这一轮没能读生产（权限分类器拒绝了 `railway ssh … psql`），下面的计划和数字来自本机 PG 18.6 上按生产规模造的数据（`scripts/pg/scan-fixture.ts`：7.4 万账号、堆 90 MB；3.4 万条报名；5.5 万条对手投影），并在 PGlite 上复核。

## 找到并修掉的

| 语句 | 频率 | 原计划 | 改法 | 本机缓冲（前 → 后） |
|---|---|---|---|---|
| 全服杯公开页的「往届冠军」`opencup-api.js` publicState | 公开状态缓存 5 秒；有人开着杯赛页（每页 60 秒轮询）或有人报名/退出/打完一轮就重建 | `place = 1 and cup_id in (select jsonb_array_elements…)`：哈希半连接，**整表扫 open_cup_entries** | 按主键 `(cup_id, champion)` 连 open_cups 取每届冠军那一行 | 2,973 页（整表）→ 34 页 |
| 天梯对手池 `account-projection.js` rivalSample | 有天梯对局时每分钟一次 | 规划器估 `n <= 80` 留下三分之一行，选哈希连接：**整表扫 card_accounts**，account_rivals 再扫一遍 | 抽中的几百个 id 经 `offset 0` 的 lateral 子查询按主键取 | 14,152 → 7,082 缓冲；card_accounts 从 11,514 页整读变成 720 次主键查找 |
| 杯赛每小时清理 `opencup-api.js` prune | 每小时 | `cup_id in (select id from open_cups …)`：哈希半连接，**整表扫 open_cup_entries**（和 open_cup_matches） | `cup_id = any(array(select …))`，按主键探测 | 整表 → 约 10 页 |
| 对战码查找 `cards-api.js` friend / friend_cards，`market-guard.js` byCode | 每次查好友对战码；站长按码查人 | `left(id_hash, $1)` 和参数化 `like` 前缀都不是 card_code_idx 的表达式，**通用计划整表扫 card_accounts**（自定义计划没事；预备语句一旦落到通用计划就扫） | 统一写成 `left(id_hash, 8) = $1` | 通用计划：整表 → 索引 |
| 排行榜「我的名次」`account-projection.js` boardOwn | 每次看榜 | 一个 count 覆盖「排在前面或同分更小」，旁边还有 `$league = 'open' or wins + losses > 0`：位图 OR，前面每一行都回堆读 account_ladder | 拆成两段索引范围（严格在前 + 同分 id 更小）；公开榜不带 losses 条件，两段都是只读索引；其他赛道仍要回堆读 losses | 名次靠后的账号：1,935（堆 1,134）→ 809（只读索引），61 ms → 4 ms |

检查：`scripts/check_scan_plans.ts`（已进审计清单）。跑真实代码路径（「我的名次」另查公开榜上两段计数都是 Index Only Scan），抓下发出的每条语句，按自带参数和 `GENERIC_PLAN` 各 EXPLAIN 一次，两张热表不许出现 Seq Scan；旧写法作对照，必须在这份数据上仍然扫描。把四个源文件改回旧版时三项失败。真实 PG：`PG_TEST_URL=… npx tsx scripts/check_scan_plans.ts`。

## 没能确认的：card_accounts 每 20 秒一次

上面的对手池每分钟最多一次，解释不了「每 20 秒一次」和 31 万次扫描。最吻合的是**排行榜的旧扫描还在服役**：`projectionUsable()` 为假（投影没回填完，或 `account_projection_dirty` 里有一行一直修不好）时，`scannedTopRows` 每 20 秒（`TOP_TTL`）每个榜重建一次，每次读全部存档；对手池也回到 `rivalRows` 全表扫描。`repairDirty` 遇到第一个仍然失败的账号就抛出，十分钟后再试，所以一个修不好的账号就能让整站一直走旧扫描。

`/api/admin/perf` 的 `cards` 现在多了 `projection: { ready, clean, scans: { board, rivals } }` 和 `rivals.source`，部署后看一眼就知道。也可以直接在生产上只读地问：

```sql
select * from account_projection_marks;
select count(*), min(at), max(at), left(min(why), 160) from account_projection_dirty;
-- 有 pg_stat_statements 的话，按块读排序就是答案
select calls, shared_blks_read, left(query, 160) from pg_stat_statements order by shared_blks_read desc limit 15;
```

「我的名次」改写后，和旧扫描逐个账号比过名次（check_account_projection，所有榜共 8,386 次，0 次不一致）。

还有一件范围外的：自动 ANALYZE 对 card_accounts 采样 3 万行，在 1.06 万页的表上几乎是整读，这部分算在 heap_blks_read 里但不算 seq_scan。
