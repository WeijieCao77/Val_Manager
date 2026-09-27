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
// these checks backdate trades and bans; the live start line (market-guard.js guardFrom) would hide them
process.env.MARKET_GUARD_FROM = '2000-01-01T00:00:00Z'

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
// owner, 2026-09-27 (「只买了一个一口价就被封」): one dear sale between strangers is only reported
assert.equal(judgeTransfers([t(30, 'alt', false, 168_397, 860)], now).verdict, 'watch', '和陌生人只有这一笔：只上报，不封')
// owner, the same day: 「一天内超过两次」 — two accounts with three trades inside 24 h, one of them absurd
assert.equal(judgeTransfers([t(30, 'alt', false, 168_397, 860), t(200, 'alt', false, 900, 860)], now).verdict, 'watch', '一天两次、其中一笔巨额：只上报')
assert.equal(judgeTransfers([t(30, 'alt', false, 168_397, 860), t(200, 'alt', false, 900, 860), t(60 * 30, 'alt', false, 900, 860)], now).verdict, 'watch', '第三次在一天以前：不够')
const dump = judgeTransfers([t(30, 'alt', false, 168_397, 860), t(200, 'alt', false, 900, 860), t(400, 'alt', false, 880, 860)], now)
assert.deepEqual([dump.verdict, dump.rule, dump.others], ['ban', 'F', ['alt']], '一天内成交三次、其中一笔巨额：卖家这边也算')
assert.deepEqual(judgeTransfers([t(30, 'main', true, 168_397, 860), t(50, 'main', true, 700, 860), t(70, 'main', true, 800, 860)], now).others, ['main'], '买家这边一样')
assert.equal(judgeTransfers([t(30, 'x', true, 18_000, 1000)], now).verdict, null, '和陌生人一笔 18 倍：什么都不算')
assert.equal(judgeTransfers([t(30, 'x', true, 18_000, 1000), t(90, 'x', true, 900, 1000), t(95, 'x', true, 900, 1000)], now).verdict, 'watch', '一天三次、其中一笔 18 倍高出一万七：只上报')
assert.equal(judgeTransfers([t(30, 'x', true, 25_000, 1000), t(90, 'x', true, 900, 1000), t(95, 'x', true, 900, 1000)], now).verdict, 'watch', '25 倍但只高出两万四：只上报')
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
assert.equal(judgeTransfers([t(30, 'alt', false, 168_397, 860), t(90, 'alt', false, 900, 860), t(95, 'alt', false, 900, 860)], now, new Set(['A', 'E'])).verdict, 'watch')
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
assert.equal(await api.guard.banOf(hash(ALT)), null, '两个号之间只有这一笔：不封（只上报）')
// …and they trade again, and again: three trades in a day, one of them absurd
await account(ALT, [fair], 200_000)
assert((await sale(ALT, MAIN, fair, 800, 1000)).bought)
assert.equal(await api.guard.banOf(hash(ALT)), null, '一天两次：还不够')
assert((await sale(ALT, MAIN, fair, 800, 1000)).bought)
const altBan = await api.guard.banOf(hash(ALT))
const mainBan = await api.guard.banOf(hash(MAIN))
assert(altBan && mainBan, '买的小号和卖的大号都停')
assert(mainBan!.why.includes('③ 高价倒钱') && mainBan!.why.includes('168397') && mainBan!.why.includes('卖给') && mainBan!.why.includes('24 小时内成交了 3 次'), mainBan!.why)
assert(altBan!.why.includes('③ 高价倒钱') && altBan!.why.includes('买下') && altBan!.why.includes('#' + hash(MAIN).slice(0, 4).toUpperCase()), altBan!.why)
console.log('   大号看到：', mainBan!.why)
console.log('   小号看到：', altBan!.why)
assert((await call('list', { id: MAIN, cardId: fair, ask: 800, rarity: 'gold', level: 0 })).banned, '大号不能再挂')
console.log('ok  冷门金卡挂 16.8 万一口价、小号拍下：两个号都停交易 —', mainBan!.why)
// the shop and the fan, four sales one way at the card's price: then the fan sells one back — five in a day, both ways
await account(FAN, [fair])
assert((await sale(FAN, SHOP, fair, 800, 1000)).bought)
const shopBan = await api.guard.banOf(hash(SHOP))
const fanBan = await api.guard.banOf(hash(FAN))
assert(shopBan && fanBan, '互相成交的两个号都停')
assert(shopBan!.why.includes('④ 两个号互相成交') && shopBan!.why.includes('24 小时内成交 5 次') && shopBan!.why.includes('互相买过'), shopBan!.why)
assert(fanBan!.why.includes('④') && fanBan!.why.includes('#' + hash(SHOP).slice(0, 4).toUpperCase()), fanBan!.why)
console.log('ok  一天内互相成交：两个号都停 —', shopBan!.why)
const report = await call('guard', {}, TOKEN)
assert(report.ok && report.bans.filter((b: any) => b.rule === 'F').length === 2 && report.bans.filter((b: any) => b.rule === 'G').length === 2, JSON.stringify(report.bans.map((b: any) => b.rule)))
assert(report.moving.sales.length === 1 && report.moving.sales[0].price === 168_397 && report.moving.sales[0].seller.code === hash(MAIN).slice(0, 8).toUpperCase())
// the start line (owner, 2026-09-27: only what was done after 12:00 counts): judged from before the trades,
// every suspension stands and says what it is for; moved past them, every one is lifted
const kept = await call('guard', { action: 'recheck' }, TOKEN)
assert(kept.ok && kept.kept.length === 4 && kept.lifted.length === 0, JSON.stringify(kept))
assert(kept.kept.every((k: any) => /^(F|G)$/.test(k.rule) && k.why.length > 10))
process.env.MARKET_GUARD_FROM = new Date(Date.now() + 1000).toISOString()
const cleared = await call('guard', { action: 'recheck' }, TOKEN)
assert(cleared.ok && cleared.kept.length === 0 && cleared.lifted.length === 4, JSON.stringify(cleared))
assert.equal(await api.guard.banOf(hash(MAIN)), null)
assert.equal(await api.guard.banOf(hash(SHOP)), null)
process.env.MARKET_GUARD_FROM = '2000-01-01T00:00:00Z'
console.log('ok  起算时间之前的违规不算：重新核对后，之前的暂停全部解除；之后还违规的保留并写明原因')
const tr = await call('guard', { action: 'transfers' }, TOKEN)
assert(tr.ok && tr.fSales === 1 && tr.sales === 8)
console.log('ok  站长名单里有这笔成交和两个号的证据')
await db.close()
