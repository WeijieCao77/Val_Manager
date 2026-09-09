/**
 * A bad boot migration must not take card mode offline. (2026-09-09)
 *
 *   npx tsx scripts/check_schema_boot.ts
 *
 * What happened: a Railway deploy overlaps containers, so two processes ran
 * the same `alter table … add column if not exists` list at once against a
 * database that was still serving writes, and Postgres killed one of them.
 * The throw reached the catch around the whole database block, `sql` went
 * null, and that process served every card route as
 * 「暂时读不到排行榜（离线或服务器忙）」 for as long as it lived. Nothing
 * retried and nothing recovered; the site was up and the game was not.
 *
 * The rules being checked:
 *   - a migration that fails once and then succeeds is simply retried
 *   - a migration that never succeeds, on a database whose tables are already
 *     there, does NOT throw — the connection is kept and the game runs
 *   - a migration that never succeeds on an EMPTY database does throw, because
 *     there is genuinely nothing to serve
 *   - the DDL runs inside one transaction holding an advisory lock, which is
 *     what stops two containers from deadlocking in the first place
 *   - every schema the server needs is in the list, and the list is what the
 *     local pglite branch applies too
 */
import { applySchema, SCHEMAS } from '../db-schema.js'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

/** a stand-in for postgres.js: records what ran, and fails on demand */
const fakeSql = (opts: { failTimes: number; tables: boolean }) => {
  const ran: string[] = []
  let attempts = 0
  const tx = { unsafe: async (q: string) => { ran.push(q); return [] } }
  const sql = {
    ran,
    get attempts() { return attempts },
    begin: async (fn: (tx: typeof tx) => Promise<void>) => {
      attempts++
      if (attempts <= opts.failTimes) throw new Error('deadlock detected')
      await fn(tx)
    },
    unsafe: async (q: string) => {
      ran.push(q)
      return q.includes('to_regclass') ? [{ t: opts.tables ? 'card_accounts' : null }] : []
    },
  }
  return sql
}

// ---- the list itself -------------------------------------------------------
{
  console.log('=== 建表清单 ===')
  check('五份 schema 都在', SCHEMAS.length === 5, `${SCHEMAS.length} 份`)
  check('每份都不是空的', SCHEMAS.every((s) => typeof s === 'string' && s.trim().length > 40))
  const all = SCHEMAS.join('\n')
  for (const t of ['card_accounts', 'card_listings', 'events']) {
    check(`建了 ${t}`, all.includes(t))
  }
  check('没有 concurrently（那个不能放进事务）', !/concurrently/i.test(all))
}

// ---- a hiccup is retried ---------------------------------------------------
{
  console.log('\n=== 撞一次锁就重试 ===')
  const sql = fakeSql({ failTimes: 1, tables: true })
  let threw = ''
  await applySchema(sql as never).catch((e: Error) => { threw = e.message })
  check('第一次失败，第二次成功', !threw && sql.attempts === 2, threw || `${sql.attempts} 次`)
  check('五份 schema 都真的跑了', SCHEMAS.every((s) => sql.ran.includes(s)))
}

// ---- the lock and the timeout are actually taken ---------------------------
{
  console.log('\n=== 两个容器不会互相咬住 ===')
  const sql = fakeSql({ failTimes: 0, tables: true })
  await applySchema(sql as never)
  const lock = sql.ran.find((q) => q.includes('pg_advisory_xact_lock'))
  check('DDL 前先拿咨询锁', !!lock, lock ?? '没有')
  check('锁在事务里，事务结束自动放', !!lock?.includes('xact'))
  check('等锁有上限，不会挂死', sql.ran.some((q) => q.includes('lock_timeout')))
  const lockAt = sql.ran.findIndex((q) => q.includes('pg_advisory_xact_lock'))
  const firstDdl = sql.ran.findIndex((q) => q === SCHEMAS[0])
  check('先上锁再建表', lockAt >= 0 && firstDdl > lockAt, `锁 ${lockAt} · 建表 ${firstDdl}`)
}

// ---- the important one: a migration that never works ----------------------
{
  console.log('\n=== 迁移一直失败 ===')
  const sql = fakeSql({ failTimes: 99, tables: true })
  let threw = ''
  await applySchema(sql as never).catch((e: Error) => { threw = e.message })
  check('表都在的话就不抛，卡牌模式照常开', !threw, threw)
  check('试了不止一次', sql.attempts >= 4, `${sql.attempts} 次`)
  check('确认过表在不在', sql.ran.some((q) => q.includes('to_regclass')))

  const empty = fakeSql({ failTimes: 99, tables: false })
  let threw2 = ''
  await applySchema(empty as never).catch((e: Error) => { threw2 = e.message })
  check('空库还是要抛，不然只会 500', !!threw2, threw2 || '居然没抛')
}

// ---- and the server does not smother it ------------------------------------
{
  console.log('\n=== server.js 的接法 ===')
  const src = await import('node:fs').then((fs) => fs.readFileSync('server.js', 'utf8'))
  check('server.js 用的是这个函数', src.includes('await applySchema(sql)'))
  check('本地 pglite 用的是同一份清单', src.includes('for (const schema of SCHEMAS)'))
  check('没有人再一条条 unsafe 建表', !/await sql\.unsafe\((SCHEMA|CARD_SCHEMA|SITE_SCHEMA)\)/.test(src))
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
