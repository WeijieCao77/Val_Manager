/** Actual API races, executed by check_concurrency_pg.mjs on real PostgreSQL. */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../../pglite-sql.js'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { newGacha } from '../../src/engine/gacha'
import { CUP_TEAMS } from '../../src/engine/cupTeams'
const { CARD_SCHEMA, makeCardApi, normalizeId } = await import('../../cards-api.js')
const { makeMarketApi } = await import('../../market-api.js')
const { OPEN_CUP_SCHEMA, OPEN_CUP_V2_SCHEMA, makeOpenCupApi } = await import('../../opencup-api.js')
const { displayName } = await import('../../names.js')
const engine = await import('../../src/engine/server.ts')
const db = new PGlite(), sql = makeSql(db)
await db.exec(CARD_SCHEMA); await db.exec(OPEN_CUP_SCHEMA); await db.exec(OPEN_CUP_V2_SCHEMA)
const json = (r: any, code: number, body: any) => { r.code = code; r.body = body }
const deps = { json, readBody: async (r: any) => r.body, rateLimited: () => false, normalizeId, displayName, engine, timer: false }
const cards = makeCardApi(sql, deps), market = makeMarketApi(sql, deps)
async function call(api: any, path: string, body: any) { const r: any = {}; await api.route({ method: 'POST', body: JSON.stringify(body), headers: {} }, r, path, 'pg-races'); return r.body }
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ids = Array.from({length: 15}, (_, i) => `VM-CVPA-CVPB-CVPC-CVPD-CVP${alphabet[i]}`)
try {
 for (const id of ids) {
  assert.equal((await call(cards, '/api/card/claim', { id, name: '并发测试' })).ok, true)
  const g = newGacha(id, '并发测试', new Date().toISOString().slice(0, 10)); g.coins = 100000; g.pulls = 100
  g.squad = structuredClone(CUP_TEAMS[0].squad)
  for (const c of [...g.squad.slots, g.squad.coach].filter(Boolean) as string[]) g.cards[c] = {id: c, level: 0, dupes: 1, seen: 2}
  await sql`update card_accounts set state=${sql.json(g)}, created=now()-interval '9 days', verified=now() where id_hash=${hash(id)}`
 }
 const item = CUP_TEAMS[0].squad.slots[0]
 const listed = await call(market, '/api/market/list', { id: ids[0], cardId: item, ask: 1000, buyout: 1200, requestId: 'pg-list-concurrent-001' })
 assert.equal(listed.ok, true, JSON.stringify(listed))
 // past its 上架保护期, where a buy-now buys; the draw inside the first minute is raced below
 await sql`update card_listings set created = now() - interval '2 minutes' where id = ${listed.id}::bigint`
 const before = await sql`select sum((state->>'coins')::bigint)::text as coins from card_accounts where id_hash=any(${ids.slice(1).map(hash)})`
 const bids = await Promise.all(ids.slice(1).map((id, i) => call(market, '/api/market/offer', {id, listing: listed.id, price: 1200, requestId: `pg-buyer-race-${i}-0001`})))
 assert.equal(bids.filter(x => x.ok).length, 1, JSON.stringify(bids))
 const after = await sql`select sum((state->>'coins')::bigint)::text as coins from card_accounts where id_hash=any(${ids.slice(1).map(hash)})`
 assert.equal(Number(before[0].coins) - Number(after[0].coins), 1200)
 const won = await sql`select count(*)::int as n from card_mail where kind='bought' and card_id=${item}`
 assert.equal(won[0].n, 1)
 console.log('ok real parallel buyout: one card, one debit, fourteen contenders')
 {
  // the same fourteen, inside the first minute: every one of them is an entry, debited once; the draw pays one and refunds thirteen
  const item2 = CUP_TEAMS[0].squad.slots[1]
  const put = await call(market, '/api/market/list', { id: ids[0], cardId: item2, ask: 1000, buyout: 1200, requestId: 'pg-list-concurrent-002' })
  assert.equal(put.ok, true, JSON.stringify(put))
  const buyers = ids.slice(1)
  const entries = await Promise.all(buyers.map((id, i) => call(market, '/api/market/offer', {id, listing: put.id, price: 1200, requestId: `pg-draw-race-${i}-0001`})))
  assert.equal(entries.filter(x => x.ok && x.entered).length, buyers.length, JSON.stringify(entries.find(x => !x.ok)))
  const open = await sql`select count(*)::int as n, count(distinct buyer_h)::int as who from card_offers where listing=${put.id}::bigint and status='open'`
  assert.deepEqual([open[0].n, open[0].who], [buyers.length, buyers.length])
  await sql`update card_listings set created = created - interval '61 seconds', draw_at = draw_at - interval '61 seconds' where id = ${put.id}::bigint`
  await Promise.all([market.settleDue(), market.settleDue(), call(market, '/api/market/offer', {id: buyers[0], listing: put.id, price: 1200, requestId: 'pg-draw-late-000001'})])
  const ended = await sql`select status, count(*)::int as n from card_offers where listing=${put.id}::bigint group by status`
  assert.deepEqual(Object.fromEntries(ended.map((r: any) => [r.status, r.n])), { accepted: 1, expired: buyers.length - 1 })
  const refunds = await sql`select count(*)::int as n, coalesce(sum(coins),0)::int as coins from card_mail where kind='outbid' and body->>'draw' is not null`
  assert.deepEqual([refunds[0].n, refunds[0].coins], [buyers.length - 1, (buyers.length - 1) * 1200])
  const paid = await sql`select count(*)::int as n from card_mail where kind='sold' and coins=1200 and body->>'cardId'=${item2}`
  assert.equal(paid[0].n, 1)
  console.log('ok real parallel draw: fourteen entries, one winner, thirteen refunds, one payment')
 }
 const cup = makeOpenCupApi(sql, {...deps, engine: {...engine, OPEN_CUP_MAX: 4}, clock: () => Date.parse('2026-09-19T03:20:00Z')})
 for (const id of ids.slice(0, 3)) assert.equal((await call(cup, '/api/card/opencup/join', {id})).ok, true)
 const joins = await Promise.all(ids.slice(3).map(id => call(cup, '/api/card/opencup/join', {id})))
 assert.equal(joins.filter(x => x.ok).length, 1, JSON.stringify(joins))
 const entrants = await sql`select count(*)::int as n from open_cup_entries`
 assert.equal(entrants[0].n, 4)
 console.log('ok real parallel final registration seat: exactly one admitted; capacity 4')
} finally { await db.close() }
