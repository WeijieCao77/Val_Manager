/** Local server SQL parity: analytics uses postgres.js's bulk INSERT builder. */
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { SCHEMA } from '../analytics.js'
const db = new PGlite()
const sql = makeSql(db)
await sql.unsafe(SCHEMA)
const rows = [0, 1].map((n) => ({
  n, client_t: Date.now(), visitor_id: 'local-visitor', session_id: 'local-session', seq: 1,
  device: 'desktop', tz: 480, name: "page'); drop table events; --", props: { mode: 'cards', round: n },
}))
const write = (batch: typeof rows) => sql`insert into events ${sql(batch,
  'n', 'client_t', 'visitor_id', 'session_id', 'seq', 'device', 'tz', 'name', 'props')}
  on conflict do nothing returning n, name, props`
const first = await write(rows)
assert.equal(first.count, 2)
assert.equal(first[0].name, rows[0].name)
assert.deepEqual(first[1].props, rows[1].props)
assert.equal((await write(rows)).count, 0)
assert.equal((await sql.unsafe('select count(*)::int as n from events'))[0].n, 2)
console.log('ok  生产analytics批量语句在PGlite正确参数化、存JSON并去重，unsafe返回查询结果')

// A fragment and later ordinary parameter must share one placeholder sequence.
await sql.unsafe('create table numbered (n int primary key, value text)')
const upsert = await sql`insert into numbered ${sql([{ n: 1, value: 'first' }], 'n', 'value')}
  on conflict (n) do update set value = ${'replacement'} returning value`
assert.equal(upsert[0].value, 'first')
await sql`insert into numbered ${sql([{ n: 1, value: 'ignored' }], 'n', 'value')}
  on conflict (n) do update set value = ${'replacement'}`
assert.equal((await sql`select value from ${sql('numbered')} where n = ${1}`)[0].value, 'replacement')
await assert.rejects(sql.begin(async (tx) => {
  await tx`insert into numbered ${tx([{ n: 2, value: 'rollback' }], 'n', 'value')}`
  throw new Error('injected rollback')
}))
assert.equal((await sql`select count(*)::int as n from numbered`)[0].n, 1)
console.log('ok  构造片段与普通参数编号正确，动态标识符安全引用，事务回滚有效')
await db.close()
