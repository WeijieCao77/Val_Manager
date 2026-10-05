# 三处修复的再次复核

日期：2026-10-05。范围：当前未提交工作区；只新增复核证据，没有修改业务实现。原报告保留为当时版本的记录。

结论：三处修复的主体实现成立，新增测试与类型检查通过；仍有 2 个 P2 边界遗漏，建议补齐后完成验收。真实 PostgreSQL 双事务交错仍未测试。

## 已确认修复

- Dashboard 在每个完整模拟日后调用 markUnsaved；ManagerGame 隐藏、pagehide、卸载、打开存档与重启路径查看 dirtyRef。runTurn 开始前检查 mountedRef，因此离开后的启动回调不再推进一天。
- 投影触发器失败后记录 account_projection_dirty，记录失败则账号写入失败；后续成功写入或 repairDirty 可以清除记录。读取端新增健康检查与旧扫描回退，解决“投影失败但永久无恢复入口”的主体问题。
- 回填/修复调用 account_reproject_v1，从账号行 FOR SHARE 加锁读取当前 state，完整投影包括删除；不再把旧快照传给 insert-only 回填。逻辑上消除了原来删行后被旧快照复活的入口；实际 PG 等锁后的读和多实例交错还需单独验证。
- 两个新检查已加入 audit-checks.json；更新日志表述已收窄。

## 1. [P2] 保存失败后仍提前清除未保存标记

位置：`src/ManagerGame.tsx:152–154`。

saveNow 在 autosave 调用之前就清空 timer 和 dirtyRef。如果存储发生临时错误，catch 只显示告警，没有把 dirtyRef 恢复。之后页面隐藏/退出的 flush 看不到待保存状态，不再重试，即使存储已经恢复可用。

本次从 ManagerGame AST 提取实际 saveNow 回调，注入一次临时 autosave 异常，然后恢复存储、执行相同 flush 条件。结果：dirtyRef=false，保存尝试始终为 1。新增 check_manager_turn_abort 中的源码断言恰好要求提前清掉标记，因此没有覆盖保存失败状态。

修复建议：开始保存前可以清 timer，但只有确实保存成功后才清 dirtyRef；异常保留脏标记。对 autosave 的 behind 返回状态单独定义处理，不把拒绝覆盖误当成持久化成功。回归测试应执行真实 saveNow 和退出 flush，验证先失败再恢复后第二次保存发生。

## 2. [P2] 已缓存的对手池绕过健康检查，修复后也不失效

位置：`cards-api.js:1550–1555`（rivalsNear）及 `1083–1086`（repairDirty 回调）。

projectionUsable 只在 refreshRivals 中执行；rivalsNear 在缓存未过 60 秒时直接返回 rivalAll/rivalCache，不检测脏投影。修复成功只把 cleanAt 清零，没有失效对手样本。因而“有任何待修复账号时，对手池回退旧扫描”的承诺并不覆盖已热缓存的服务进程。

复现步骤（同一 makeCardApi 实例）：

1. 完成回填，先访问 /top 和 /rivals，预热健康状态与对手池。
2. 用与提交测试相同的临时 CHECK 故障注入，让积分 7→5000、suspect=true 的投影失败；恢复约束，不再写账号。
3. 推进测试时钟 6 秒（超过健康检查 5 秒，未超过对手缓存 60 秒），再次访问 /rivals。
4. 结果：仍返回该账号，dirty 仍未清，说明没有检测并触发修复。
5. 请求 /top 后修复完成；立刻请求 /rivals，仍返回该账号，而数据库投影已将其标记排除。

这是有界缓存遗漏，区别于上一轮无限期未修复的问题；常规刷新最终可以恢复。但当前补丁在异常恢复期间仍会使用已明确不可信的阵容，并且永久约束错误时单纯依赖 refreshRivals 的 stale-while-refresh 可能继续提供旧样本。

修复建议：对缓存命中也执行受控健康检查；从 clean 转 dirty 时使基于投影的缓存失效，阻止正在执行的旧构建重新填回；修复成功后重建相关缓存。若旧扫描回退仍复用缓存，应确保该缓存是在有效来源/代次上构建，不能把投影旧样本当作回退结果。新增测试保持同一 API 实例预热后注入失败；不要像当前第 5 节那样创建全新 api3 才测回退。公共榜单缓存也应加入同类用例。

## 本次验证与边界

| 验证 | 结果 |
| --- | --- |
| node --import tsx scripts/check_account_projection.ts | 通过 |
| node --import tsx scripts/check_manager_turn_abort.ts | 通过 |
| tsc --noEmit --incremental false | 通过 |
| 两个检查进入常规审计清单 | 已确认，总清单 186 项 |
| 新增补充测试 | 两个遗漏均复现 |
| 全量审计 | 读取到 Claude 任务日志仅有 `Audit all: 186/186 checks` 开始行；尚无最终 PASS/FAIL，不能声称通过 |
| 真实 PostgreSQL 并发/手机实机 | 本次未执行；不把用户提供的浏览器测试描述当作本次独立实测 |

复现程序：[recheck-repro.mjs](recheck-repro.mjs)，运行 `node --import tsx docs/performance-audit-2026-10-05/recheck-repro.mjs`；结果：[recheck-repro-results.json](recheck-repro-results.json)。数据库部分只使用全新内存 PGlite；时钟推进是测试内隔离的 Date.now 替换，结束恢复。

原 [review-repro.mjs](review-repro.mjs) 使用旧函数签名，是历史复现；其报错不能作为新实现通过的证据。应以新增回归和本次热缓存/失败存储测试为准。

建议先补齐这两个边界，待 186 项全量审计最终结果，再进行 PG_TEST_URL 下回填与用户写入、双实例回填、双账号交易交错验证。当前没有测试 PG 配置，也没有安装数据库；本次没有执行 Homebrew 安装或访问生产。
