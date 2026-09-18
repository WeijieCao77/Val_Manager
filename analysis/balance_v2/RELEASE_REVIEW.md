# 发布接线与启动门禁复核

2026-09-18，工作区最终集成版本复核；未部署，不接触生产。

## 已确认的接线

- server三个PostgreSQL连接池统一套用safeTransactions，维持交互4、后台1、统计2预算。
- Railway部署healthcheckPath为/readyz；/healthz只证明进程存活。
- applySchema异步执行；成功返回ready:true，迁移重试后仍未完整则返回ready:false，不能因旧表存在就接流量。
- schema未就绪时API返回503；就绪要求数据库ping成功、所有必需字段及四类唯一约束有效。
- releaseFingerprint覆盖根目录后端JS、package/lock、Railway配置、退款脚本、预压缩脚本及engine bundle；前端另做逐文件字节比较。
- verify_deployment同时比较health和ready的release指纹，并逐键要求必需features=true，避免空对象误通过和滚动部署不同容器混读。

## 实际隔离验证

`logs/real_pg_readiness.log`：31个真实schema、缺列、缺唯一约束、仅部分唯一索引及catalog故障场景全部通过，真实PG18。

`logs/release_server_timers.log`：启动实际server并持有数据库迁移锁；health=200而ready/API=503；放锁后ready=200，全部feature和指纹正确。正式verify_deployment检查后端、engine和28个前端文件字节一致，EXIT=0。

测试专用loader加速实际server的三分钟boot、每小时维护回调；两个回调确实执行，进程保持存活且无维护错误。测试loader不会用于生产。

## 发现并补齐的启动崩溃

原集成server存在keepHistory调用而无定义，三分钟timer触发会ReferenceError退出。新增history-maintenance.js，提供单飞fold→按水位prune；并发压力请求可合并更低行数阈值，fold失败绝不清理，失败后下一轮可以重试。server定时器显式catch，防止未处理promise拒绝退出。

`scripts/pg/check_history_maintenance.mjs`验证上述失败与恢复路径全部通过；这不是通过吞掉失败假装成功，维护调用仍以拒绝返回给调用者，定时器负责记录错误。

## 审查链尾段

从check_qr开始的执行清单见audit_tail_commands.json；逐项结果见audit_tail_results.json，日志为logs/audit_tail_*.log。check_urls首次被沙箱禁止本机监听，提升到本机测试权限后通过。运行尚未完成时不要据此宣称全部46项通过。
