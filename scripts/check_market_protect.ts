/**
 * 上架保护期: in a listing's first minute 一口价 enters a draw; when the minute
 * is up one entry wins at random and every other coin goes home.
 *
 *   npx tsx scripts/check_market_protect.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { CARD_SCHEMA, engine, normalizeId } from '../cards-api.js'
import { makeMarketApi, PROTECT_SEC, TRADE_DAYS, TRADE_PULLS } from '../market-api.js'
import { judge } from '../market-guard.js'
import { displayName } from '../names.js'
process.env.PHONE_GATE = '0'
process.env.MARKET_GUARD = 'watch'

const db = new PGlite()
await db.exec(CARD_SCHEMA)
const sql = makeSql(db)
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
const api = makeMarketApi(sql, {
  engine, normalizeId, displayName, rateLimited: () => false, timer: false,
  readBody: async (req: { body: unknown }) => JSON.stringify(req.body),
  json: (res: { body?: any }, _status: number, body: any) => { res.body = body },
} as never)
async function call(action: string, body: object) {
  const res: { body?: any } = {}
  await api.route({ body }, res, `/api/market/${action}`, 'test')
  return res.body
}
const cardId = 'p:P1'
const idOf = (n: number) => `VM-${String(n).padStart(4, '0')}-3333-3333-3333-3333`
const START = 1_000_000
async function account(id: string, copies: number) {
  const state = engine.newGacha(id, 'test', '2026-09-14')
  state.pulls = TRADE_PULLS
  state.coins = START
  if (copies) state.cards = { [cardId]: { id: cardId, level: 0, dupes: copies - 1, seen: copies, got: '2026-09-14' } }
  await sql`insert into card_accounts (id_hash, state, created)
            values (${hash(id)}, ${sql.json(state)}, now() - make_interval(days => ${TRADE_DAYS + 1}))
            on conflict (id_hash) do update set state = excluded.state`
}
const coinsOf = async (id: string) => (await sql`select (state->>'coins')::int as c from card_accounts where id_hash = ${hash(id)}`)[0].c
const owed = async (id: string) => (await sql`select coalesce(sum(coins), 0)::int as c from card_mail where to_h = ${hash(id)} and taken is null`)[0].c
const SELLER = idOf(1), A = idOf(2), B = idOf(3), C = idOf(4)
await account(SELLER, 60); for (const x of [A, B, C]) await account(x, 0)
async function put(): Promise<string> {
  const r = await call('list', { id: SELLER, cardId, ask: 1000, buyout: 2000 })
  assert(r.ok, JSON.stringify(r))
  return r.id
}
const age = (lid: string, secs: number) => sql`
  update card_listings set created = now() - make_interval(secs => ${secs}),
         draw_at = case when draw_at is null then null else now() - make_interval(secs => ${secs}) + make_interval(secs => ${PROTECT_SEC}) end
  where id = ${lid}::bigint`
const row = async (lid: string) => (await sql`select status, draw_at from card_listings where id = ${lid}::bigint`)[0]

// 1. the first minute: entries, not purchases
let lid = await put()
const shelf = await call('browse', { id: A, sort: 'new' })
assert(shelf.listings.find((l: any) => l.id === lid)?.drawAt > Date.now(), '货架告诉客户端这张还在保护期')
const low = await call('offer', { id: C, listing: lid, price: 1000 })
assert(low.ok && !low.entered, '保护期里照常可以出价')
const a1 = await call('offer', { id: A, listing: lid, price: 2000 })
assert(a1.ok && a1.entered && !a1.bought && a1.drawAt > Date.now(), JSON.stringify(a1))
assert.equal(await owed(C), 1000, '低于一口价的出价在有人报名时退回')
const a2 = await call('offer', { id: A, listing: lid, price: 2000 })
assert(!a2.ok && a2.leading && a2.entered, '同一个人不能报两次')
const b1 = await call('offer', { id: B, listing: lid, price: 5000 })
assert(b1.ok && b1.entered && b1.price === 2000, '出得再高也按一口价报名')
const c2 = await call('offer', { id: C, listing: lid, price: 1500 })
assert(!c2.ok && c2.low && c2.min === 2000, '有人报名后只能按一口价进')
assert.deepEqual([await coinsOf(A), await coinsOf(B)], [START - 2000, START - 2000], '报名冻结一口价，只冻一次')
assert.equal((await row(lid)).status, 'open')
assert(!(await call('unlist', { id: SELLER, listing: lid })).ok, '有人报名后卖家不能撤')
await api.settleDue()
assert.equal((await row(lid)).status, 'open', '没到一分钟不开奖')
console.log('ok  第一分钟：一口价是报名，冻结金币、不成交、不能重复报、卖家不能撤')

// 2. the minute is up: one winner, everyone else whole
await age(lid, PROTECT_SEC + 1)
await api.settleDue()
assert.equal((await row(lid)).status, 'sold')
const got = await sql`select to_h, kind, coins, body from card_mail where kind in ('bought', 'outbid', 'sold') and (body->>'draw' is not null or kind = 'sold') order by id`
const winner = got.find((m: any) => m.kind === 'bought')!, loser = got.find((m: any) => m.kind === 'outbid')!
assert([hash(A), hash(B)].includes(winner.to_h) && [hash(A), hash(B)].includes(loser.to_h) && winner.to_h !== loser.to_h)
assert.equal(loser.coins, 2000); assert.equal(Number(loser.body.draw), 2)
assert.equal(got.filter((m: any) => m.kind === 'sold').reduce((n: number, m: any) => n + m.coins, 0), 2000, '卖家只收一份钱')
console.log('ok  满一分钟：随机一人成交，其余金币原数退回，卖家收一份')

// 3. it really is a draw
let aWins = 0
const ROUNDS = 40
for (let i = 0; i < ROUNDS; i++) {
  await account(A, 0); await account(B, 0)
  lid = await put()
  // B enters first every time: first come must not be first served
  assert((await call('offer', { id: B, listing: lid, price: 2000 })).entered)
  assert((await call('offer', { id: A, listing: lid, price: 2000 })).entered)
  await age(lid, PROTECT_SEC + 1)
  await api.settleDue()
  const w = await sql`select buyer_h from card_offers where listing = ${lid}::bigint and status = 'accepted'`
  assert.equal(w.length, 1)
  if (w[0].buyer_h === hash(A)) aWins++
  await account(SELLER, 60)
  await sql`delete from card_listings where false`
}
assert(aWins >= 8 && aWins <= 32, `后报名的人 ${ROUNDS} 次里中了 ${aWins} 次`)
console.log(`ok  是抽签不是先到先得：后报名的人 ${ROUNDS} 次里中了 ${aWins} 次`)

// 4. after the minute with nobody entered: 一口价 buys at once, as before
await account(A, 0); await account(B, 0); await account(C, 0)
lid = await put()
await age(lid, PROTECT_SEC + 5)
const late = await call('browse', { id: A, sort: 'new' })
assert.equal(late.listings.find((l: any) => l.id === lid)?.drawAt, null)
const instant = await call('offer', { id: A, listing: lid, price: 2000 })
assert(instant.ok && instant.bought && !instant.entered)
console.log('ok  过了一分钟、没人报名：一口价照旧立刻成交')

// 5. the minute is up, entries waiting, the settler has not come by yet: a late buyer does not jump the draw
lid = await put()
assert((await call('offer', { id: B, listing: lid, price: 2000 })).entered)
await age(lid, PROTECT_SEC + 2)
const before = await coinsOf(C)
const jump = await call('offer', { id: C, listing: lid, price: 2000 })
assert(!jump.ok && jump.gone, JSON.stringify(jump))
assert.equal(await coinsOf(C), before, '来晚的人没被扣钱')
const sold = await sql`select buyer_h from card_offers where listing = ${lid}::bigint and status = 'accepted'`
assert.equal(sold[0]?.buyer_h, hash(B), '卡归报了名的人')
console.log('ok  开奖前一刻来的人抢不走：当场开奖，归报名的人')

// 6. the guard still sees a script: an entry two seconds after the listing counts, won or lost
const t = Date.now()
const lost = (agoMin: number) => ({ made: t - agoMin * 60_000, created: t - agoMin * 60_000 - 900, seller: 's', won: false })
assert.deepEqual([judge([1, 5, 9, 13, 17].map(lost), t).verdict, judge([1, 5, 9, 13, 17].map(lost), t).rule], ['ban', 'A'])
assert.equal(judge(Array.from({ length: 60 }, (_, i) => ({ made: t - i * 60_000, created: t - i * 60_000 - 20_000, seller: `s${i}`, won: false })), t).verdict, null, '没中的报名不算进买入量')
console.log('ok  封脚本规则：两秒内报名照样算；没中的不算买入量')
await db.close()
