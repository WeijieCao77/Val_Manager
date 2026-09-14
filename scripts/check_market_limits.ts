/** Market slot limits and escrowed inventory under concurrent requests. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { CARD_SCHEMA, engine, normalizeId } from '../cards-api.js'
import { makeMarketApi, MAX_LISTINGS, TRADE_DAYS, TRADE_PULLS } from '../market-api.js'
import { displayName } from '../names.js'
process.env.PHONE_GATE = '0'
const db = new PGlite()
await db.exec(CARD_SCHEMA)
const sql = makeSql(db)
const A = 'VM-2222-2222-2222-2222-2222', B = 'VM-3333-3333-3333-3333-3333'
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
const cardId = 'p:P1'
const api = makeMarketApi(sql, {
  engine, normalizeId, displayName, rateLimited: () => false,
  readBody: async (req: { body: unknown }) => JSON.stringify(req.body),
  json: (res: { body?: any }, _status: number, body: any) => { res.body = body },
} as never)
async function call(action: string, body: object) {
  const res: { body?: any } = {}
  await api.route({ body }, res, `/api/market/${action}`, 'test')
  return res.body
}
async function account(id: string, count: number) {
  const state = engine.newGacha(id, 'test', '2026-09-14')
  state.pulls = TRADE_PULLS
  state.cards = { [cardId]: { id: cardId, level: 0, dupes: count - 1, seen: count, got: '2026-09-14' } }
  await sql`insert into card_accounts (id_hash, state, created)
            values (${hash(id)}, ${sql.json(state)}, now() - make_interval(days => ${TRADE_DAYS + 1}))
            on conflict (id_hash) do update set state = excluded.state`
}
const list = () => call('list', { id: A, cardId, ask: 10000 })
await account(A, 3)
for (let i = 0; i < 3; i++) assert((await list()).ok, 'Each of three actual copies can be escrowed')
assert.equal((await sql`select state->'cards'->${cardId} as owned from card_accounts where id_hash = ${hash(A)}`)[0].owned, null)
assert.equal((await sql`select count(*)::int as n from card_listings where status = 'open'`)[0].n, 3)
console.log('ok  三张同卡可分别上架，已托管卡不再重复扣减可用库存')

await sql`delete from card_listings`
await account(A, 10)
for (let i = 0; i < MAX_LISTINGS - 1; i++) await list()
const simultaneous = await Promise.all(Array.from({ length: 5 }, list))
assert.equal(simultaneous.filter((r) => r.ok).length, 1)
assert(simultaneous.filter((r) => !r.ok).every((r) => r.full && r.max === MAX_LISTINGS))
assert.equal((await sql`select count(*)::int as n from card_listings where status = 'open'`)[0].n, MAX_LISTINGS)
assert.equal(Number((await sql`select state->'cards'->${cardId}->>'dupes' as n from card_accounts where id_hash = ${hash(A)}`)[0].n) + 1, 10 - MAX_LISTINGS)
console.log('ok  同账号并发上架仅占最后一席，失败请求不扣库存')

await account(A, 10)
await account(B, 1)
const swap = () => call('swap', { id: A, code: hash(B).slice(0, 8), giveId: cardId, wantId: cardId })
for (let i = 0; i < 4; i++) assert((await swap()).ok)
const before = (await sql`select state from card_accounts where id_hash = ${hash(A)}`)[0].state
const swaps = await Promise.all(Array.from({ length: 5 }, swap))
assert.equal(swaps.filter((r) => r.ok).length, 1)
assert(swaps.filter((r) => !r.ok).every((r) => r.full && r.max === 5))
assert.equal((await sql`select count(*)::int as n from card_swaps where status = 'open'`)[0].n, 5)
const after = (await sql`select state from card_accounts where id_hash = ${hash(A)}`)[0].state
assert.equal(after.cards[cardId].dupes, before.cards[cardId].dupes - 1)
assert.equal(after.daily.stamina, before.daily.stamina - 1)
console.log('ok  同账号并发换卡仅占第五席，失败请求不扣卡或体力')
await db.close()
