/**
 * Cup sign-up never queues behind the background connection (2026-10-06).
 *
 *   PG_TEST_URL=postgres://postgres@127.0.0.1:55439/postgres npx tsx scripts/pg/check_cup_join_pools.ts
 *
 * Production runs one background connection (DB_POOL_BG=1) for the clock's work: settling auctions, starting and
 * playing cup rounds. Join and leave used to take their transaction there too, and on 2026-10-06 04:00 UTC a 组队杯
 * sign-up waited 30 s for it and answered 500 (「db: transaction gave up — bg: 等了 30 秒也没拿到数据库连接」).
 *
 * Real PostgreSQL with the production pool shapes, in a throwaway verify_* database:
 *   1. the background connection held by a long statement — both cups still take a sign-up and a withdrawal at once;
 *   2. a cup's row lock held (a start in progress) — the sign-up answers 「正在开赛」 within a few seconds instead of
 *      sitting on an interactive connection until the start ends, and the seat count is still right afterwards.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import postgres from 'postgres'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { safeTransactions } from '../../db-transactions.js'
import { newGacha } from '../../src/engine/gacha'
import { CUP_TEAMS } from '../../src/engine/cupTeams'

const base = process.env.PG_TEST_URL
if (!base) { console.log('SKIP: PG_TEST_URL not set'); process.exit(0) }
const { CARD_SCHEMA, makeCardApi, normalizeId } = await import('../../cards-api.js')
const { OPEN_CUP_SCHEMA, OPEN_CUP_V2_SCHEMA, makeOpenCupApi } = await import('../../opencup-api.js')
const { TEAM_CUP_SCHEMA, makeTeamCupApi } = await import('../../teamcup-api.js')
const { displayName } = await import('../../names.js')
const engine = await import('../../src/engine/server.ts')

const name = `verify_${Date.now()}_${randomBytes(4).toString('hex')}`
const admin = postgres(base, { max: 1, onnotice: () => {} })
await admin.unsafe(`create database ${name}`)
const url = new URL(base); url.pathname = `/${name}`
const pool = (max: number, label: string) => safeTransactions(postgres(url.toString(), { max, onnotice: () => {} }), label)
const sql = pool(4, 'main')
const bg = pool(1, 'bg')
const side = postgres(url.toString(), { max: 2, onnotice: () => {} })
let failed = false
try {
  await sql.unsafe(CARD_SCHEMA).simple()
  await sql.unsafe(OPEN_CUP_SCHEMA).simple()
  await sql.unsafe(OPEN_CUP_V2_SCHEMA).simple()
  await sql.unsafe(TEAM_CUP_SCHEMA).simple()
  const json = (r: any, code: number, body: any) => { r.code = code; r.body = body }
  const clock = () => Date.parse('2026-09-19T03:20:00Z')
  const deps = { json, readBody: async (r: any) => r.body, rateLimited: () => false, normalizeId, displayName, engine, timer: false, clock, bg }
  const cards = makeCardApi(sql, deps as never)
  const solo = makeOpenCupApi(sql, deps as never)
  const team = makeTeamCupApi(sql, deps as never)
  const call = async (api: any, path: string, body: any) => {
    const r: any = {}; const t = performance.now()
    await api.route({ method: 'POST', body: JSON.stringify(body), headers: {} }, r, path, 'pools')
    return { ...r.body, ms: Math.round(performance.now() - t) }
  }
  const hash = (id: string) => createHash('sha256').update(id).digest('hex')
  const ids = ['VM-P00A-P00B-P00C-P00D-P00E', 'VM-P01A-P01B-P01C-P01D-P01E', 'VM-P02A-P02B-P02C-P02D-P02E']
  for (const id of ids) {
    assert.equal((await call(cards, '/api/card/claim', { id, name: '连接测试' })).ok, true)
    const g = newGacha(id, '连接测试', '2026-09-10'); g.coins = 1000; g.pulls = 100
    g.squad = structuredClone(CUP_TEAMS[0].squad)
    for (const c of [...g.squad.slots, g.squad.coach].filter(Boolean) as string[]) g.cards[c] = { id: c, level: 0, dupes: 0, seen: 1, got: '2026-09-10' }
    await sql`update card_accounts set state = ${sql.json(g)}, created = now() - interval '9 days', verified = now() where id_hash = ${hash(id)}`
  }

  // 1. the background connection busy for four seconds
  // a postgres.js query runs only once something asks for its result: `.then` starts it now
  const busy = bg`select pg_sleep(4)`.then(() => true)
  await new Promise((r) => setTimeout(r, 200))
  const [a, b] = await Promise.all([
    call(solo, '/api/card/opencup/join', { id: ids[0] }),
    call(team, '/api/card/teamcup/join', { id: ids[0] }),
  ])
  assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(b.ok, true, JSON.stringify(b))
  assert.ok(a.ms < 2000 && b.ms < 2000, `sign-ups waited for the background connection: ${a.ms} / ${b.ms} ms`)
  const [c, d] = await Promise.all([
    call(solo, '/api/card/opencup/leave', { id: ids[0] }),
    call(team, '/api/card/teamcup/leave', { id: ids[0] }),
  ])
  assert.equal(c.ok, true, JSON.stringify(c)); assert.equal(d.ok, true, JSON.stringify(d))
  assert.ok(c.ms < 2000 && d.ms < 2000, `withdrawals waited for the background connection: ${c.ms} / ${d.ms} ms`)
  await busy
  console.log(`ok background connection busy: both cups signed up in ${a.ms} / ${b.ms} ms, withdrew in ${c.ms} / ${d.ms} ms`)

  // 2. a start holding the cup's row lock for six seconds — met by a COLD instance (a fresh api, as after a deploy or
  // at a new slot), whose first step makes the cup's row before the seat transaction: that step is under the limit too
  for (const [label, make, table, entries, path] of [
    ['全服杯', makeOpenCupApi, 'open_cups', 'open_cup_entries', '/api/card/opencup/join'],
    ['组队杯', makeTeamCupApi, 'team_cups', 'team_cup_entries', '/api/card/teamcup/join'],
  ] as const) {
    const cold = (make as any)(sql, deps as never)
    const [cup] = await sql.unsafe(`select id from ${table} where status = 'open' order by starts limit 1`)
    const holding = side.begin(async (tx) => {
      await tx.unsafe(`select id from ${table} where id = $1 for update`, [cup.id])
      await tx`select pg_sleep(6)`
    })
    await new Promise((r) => setTimeout(r, 200))
    const e = await call(cold, path, { id: ids[1] })
    assert.equal(e.ok, false, `${label}: ${JSON.stringify(e)}`)
    assert.match(String(e.why), /正在开赛/)
    assert.ok(e.ms < 5000, `${label}: a cold sign-up during a start held its connection for ${e.ms} ms`)
    await holding
    const f = await call(cold, path, { id: ids[1] })
    assert.equal(f.ok, true, `${label}: ${JSON.stringify(f)}`)
    const n = await sql.unsafe(`select count(*)::int as n from ${entries} where cup_id = $1 and id_hash = $2`, [cup.id, hash(ids[1])])
    assert.equal(n[0].n, 1)
    console.log(`ok ${label} row lock held by a start, cold instance: 「${e.why}」 in ${e.ms} ms; signed up once it ended`)
  }
} catch (err) {
  failed = true
  console.error('FAIL', (err as Error).message)
} finally {
  await Promise.allSettled([sql.end({ timeout: 5 }), bg.end({ timeout: 5 }), side.end({ timeout: 5 })])
  await admin.unsafe(`drop database if exists ${name} with (force)`)
  await admin.end({ timeout: 5 })
}
process.exit(failed ? 1 : 0)
