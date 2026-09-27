/**
 * 倒卡: coins moved between accounts through the market (rules F and G in market-guard.js) — who is
 * suspended, who is not, and that both sides of it are.
 *
 *   npx tsx scripts/check_market_transfer.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { CARD_SCHEMA, engine, normalizeId } from '../cards-api.js'
import { makeMarketApi, TRADE_DAYS, TRADE_PULLS } from '../market-api.js'
import { judgeTransfers, saleValue } from '../market-guard.js'
import { displayName } from '../names.js'
process.env.PHONE_GATE = '0'
// the rules as they suspend (they report only until the owner turns them on)
process.env.MARKET_GUARD_AUTO = 'A,E,F,G'

// ---- what a card is worth
const gold = engine.ALL_CARDS.filter((c) => c.rarity === 'gold').map((c) => c.id)
const refRows = [
  { card_id: gold[0], level: 0, n: 40, med: 860 },
  { card_id: gold[1], level: 0, n: 12, med: 1200 },
  { card_id: gold[2], level: 0, n: 9, med: 1000 },
  { card_id: gold[3], level: 0, n: 2, med: 90_000 },
]
const value = saleValue(refRows, (id: string) => engine.cardById(id))
assert.deepEqual(value(gold[0], 0), { ref: 860, n: 40, from: 'card' }, '卖过很多次的卡：按它自己的中位价')
assert.equal(value(gold[3], 0).from, 'rarity', '只成交过两次（哪怕都是自己人高价倒的）：按同稀有度估')
assert.equal(value(gold[3], 0).ref, 1000, '同稀有度同等级的中位价')
assert.equal(value(gold[9], 0).ref, 1000, '冷门卡从没卖过：也按同稀有度')
const bronze = engine.ALL_CARDS.find((c) => c.rarity === 'bronze')!.id
assert.deepEqual(value(bronze, 0), { ref: 60, n: 0, from: 'floor' }, '整个稀有度都没有行情：按分解价')
console.log('ok  一张卡值多少：自己的中位价，冷门卡按同稀有度，最低是分解价')

// ---- the rules, on paper
const now = Date.parse('2026-09-26T12:00:00Z')
const t = (agoMin: number, other: string, bought: boolean, price: number, ref = 1000) => ({ at: now - agoMin * 60_000, other, bought, price, ref })
assert.equal(judgeTransfers([], now).verdict, null)
// the screenshot: a gold that sells for 860, 起拍 700, 一口价 168,397, bought by an alt
const dump = judgeTransfers([t(30, 'alt', false, 168_397, 860)], now)
assert.deepEqual([dump.verdict, dump.rule, dump.others], ['ban', 'F', ['alt']], '冷门卡巨额一口价：卖家这边也算')
assert.deepEqual(judgeTransfers([t(30, 'main', true, 168_397, 860)], now).others, ['main'], '买家这边一样')
assert.equal(judgeTransfers([t(30, 'x', true, 18_000, 1000)], now).verdict, 'watch', '18 倍、高出一万七：只上报')
assert.equal(judgeTransfers([t(30, 'x', true, 25_000, 1000)], now).verdict, 'watch', '25 倍但只高出两万四：只上报')
assert.equal(judgeTransfers([t(30, 'x', true, 300_000, 200_000)], now).verdict, null, '彩卡贵一点成交：倍数不够，不算')
assert.equal(judgeTransfers([t(60 * 25, 'alt', false, 168_397, 860)], now).verdict, null, '一天以前的不在这里算（站长名单里看得到）')
// two accounts trading again and again
assert.equal(judgeTransfers([t(10, 'b', true, 1000), t(200, 'b', false, 1100)], now).verdict, 'watch', '一天互相买两次：只上报')
const loop = judgeTransfers([t(10, 'b', true, 1000), t(200, 'b', false, 1100), t(400, 'b', true, 900)], now)
assert.deepEqual([loop.verdict, loop.rule, loop.others], ['ban', 'G', ['b']], '一天内互相成交三次：封')
assert.equal(judgeTransfers([t(10, 'b', true, 5000), t(200, 'b', true, 4000), t(400, 'b', true, 900)], now).rule, 'G', '一天从同一个号手里三次，两次是市价三倍以上：封')
// a collector ticking 「没有的卡」 buys from the same prolific seller all day at fair prices: never
const collector = Array.from({ length: 12 }, (_, i) => t(10 + i * 60, 'shop', true, 900 + i * 50))
assert.equal(judgeTransfers(collector, now).verdict, null, '从同一个大卖家手里按市价买十二张：是集卡，不算')
assert.equal(judgeTransfers([...collector.slice(0, 5), t(5, 'shop', true, 3500)], now).verdict, null, '其中一张买贵了：还不算')
// the owner can take either back to report-only
assert.equal(judgeTransfers([t(30, 'alt', false, 168_397, 860)], now, new Set(['A', 'E'])).verdict, 'watch')
console.log('ok  规则：一笔离谱高价（F）双方都停；两个号一天互相成交三次（G）双方都停；按市价从同一卖家买很多不算')

// ---- on the real market
const db = new PGlite()
await db.exec(CARD_SCHEMA)
const sql = makeSql(db)
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
const TOKEN = 'owner-token'
const api = makeMarketApi(sql, {
  engine, normalizeId, displayName, rateLimited: () => false, timer: false,
  token: TOKEN, tokenFrom: (req: { token?: string }) => req.token ?? null, tokenOk: (a: string, b: string) => a === b,
  readBody: async (req: { body: unknown }) => JSON.stringify(req.body),
  json: (res: { body?: any }, _status: number, body: any) => { res.body = body },
} as never)
async function call(action: string, body: object, token?: string) {
  const res: { body?: any } = {}
  await api.route({ body, token, url: `/api/market/${action}` }, res, `/api/market/${action}`, 'test')
  return res.body
}
const idOf = (n: number) => `VM-${String(n).padStart(4, '0')}-3333-3333-3333-3333`
const cold = gold[5]
const fair = gold[6]
async function account(id: string, cards: string[], coins = 1_000_000) {
  const state = engine.newGacha(id, 'test', '2026-09-14')
  state.pulls = TRADE_PULLS
  state.coins = coins
  state.cards = Object.fromEntries(cards.map((c) => [c, { id: c, level: 0, dupes: 4, seen: 5, got: '2026-09-14' }]))
  await sql`insert into card_accounts (id_hash, state, created)
            values (${hash(id)}, ${sql.json(state)}, now() - make_interval(days => ${TRADE_DAYS + 1}))
            on conflict (id_hash) do update set state = excluded.state`
}
const MAIN = idOf(1), ALT = idOf(2), SHOP = idOf(3), FAN = idOf(4)
await account(MAIN, [cold, fair]); await account(ALT, [], 200_000); await account(SHOP, [fair]); await account(FAN, [])
/** seller lists with a buy-now; the buyer takes it after the protected minute */
async function sale(seller: string, buyer: string, cardId: string, ask: number, buyout: number) {
  const listed = await call('list', { id: seller, cardId, ask, buyout, rarity: 'gold', level: 0 })
  assert(listed.ok, JSON.stringify(listed))
  const [l] = await sql`select id from card_listings where seller_h = ${hash(seller)} and status = 'open' order by id desc limit 1`
  await sql`update card_listings set created = now() - interval '5 minutes' where id = ${l.id}`
  const r = await call('offer', { id: buyer, listing: String(l.id), price: buyout })
  await api.guard.check(hash(buyer))
  return r
}
// a market for `fair`: it sells for about 1000 from a shop to a fan, again and again
for (let i = 0; i < 4; i++) assert((await sale(SHOP, FAN, fair, 800, 1000 + i * 10)).bought)
assert.equal(await api.guard.banOf(hash(FAN)), null, '从同一个号手里按市价买四张：不算')
assert.equal(await api.guard.banOf(hash(SHOP)), null)
// the screenshot: the main puts up a cold gold at 700 with a 168,397 buy-now; the alt empties itself into it
assert((await sale(MAIN, ALT, cold, 700, 168_397)).bought)
const altBan = await api.guard.banOf(hash(ALT))
const mainBan = await api.guard.banOf(hash(MAIN))
assert(altBan && mainBan, '买的小号和卖的大号都停')
assert(/倒卡/.test(mainBan!.why), mainBan!.why)
assert((await call('list', { id: MAIN, cardId: fair, ask: 800, rarity: 'gold', level: 0 })).banned, '大号不能再挂')
console.log('ok  冷门金卡挂 16.8 万一口价、小号拍下：两个号都停交易 —', mainBan!.why)
const report = await call('guard', {}, TOKEN)
assert(report.ok && report.bans.filter((b: any) => b.rule === 'F').length === 2)
assert(report.moving.sales.length === 1 && report.moving.sales[0].price === 168_397 && report.moving.sales[0].seller.code === hash(MAIN).slice(0, 8).toUpperCase())
const tr = await call('guard', { action: 'transfers' }, TOKEN)
assert(tr.ok && tr.fSales === 1 && tr.sales === 5)
console.log('ok  站长名单里有这笔成交和两个号的证据')
await db.close()
