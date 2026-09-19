/**
 * Scripts on the trading post: who gets suspended, who does not, and what a
 * suspended account can still do.
 *
 *   npx tsx scripts/check_market_guard.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { CARD_SCHEMA, engine, normalizeId } from '../cards-api.js'
import { makeMarketApi, TRADE_DAYS, TRADE_PULLS } from '../market-api.js'
import { judge, GUARD } from '../market-guard.js'
import { displayName } from '../names.js'
process.env.PHONE_GATE = '0'

// ---- the rules, on paper
const now = Date.parse('2026-09-18T12:00:00Z')
const buy = (agoMin: number, age: number, seller: string) => ({ made: now - agoMin * 60_000, created: now - agoMin * 60_000 - age * 1000, seller })
assert.equal(judge([], now).verdict, null)
assert.equal(judge([buy(5, 60, 'a'), buy(50, 90, 'b'), buy(90, 200, 'c')], now).verdict, null, '几分钟后才买到的，是正常人')
assert.equal(judge([buy(5, 3, 'a'), buy(50, 4, 'b')], now).verdict, 'watch', '两次秒拍只是值得看一眼')
assert.deepEqual([judge([buy(5, 3, 'a'), buy(50, 4, 'b'), buy(90, 2, 'c')], now).verdict, judge([buy(5, 3, 'a'), buy(50, 4, 'b'), buy(90, 2, 'c')], now).rule], ['ban', 'A'])
assert.notEqual(judge([buy(5, 1, 'a'), buy(50, 1, 'a'), buy(90, 1, 'a'), buy(95, 1, 'a')], now).verdict, 'ban', '朋友之间约好的秒拍是同一个卖家，不算脚本')
assert.notEqual(judge([buy(1500, 3, 'a'), buy(1600, 4, 'b'), buy(1700, 2, 'c')], now).verdict, 'ban', '一天以前的不算在今天头上')
const slow = Array.from({ length: GUARD.QUICK_N }, (_, i) => buy(10 + i * 30, 30, `s${i % 5}`))
assert.deepEqual([judge(slow, now).verdict, judge(slow, now).rule], ['ban', 'B'])
const patient = Array.from({ length: 24 }, (_, i) => buy(i * 61 + 3000, 200, `s${i}`))
assert.deepEqual([judge(patient, now).verdict, judge(patient, now).rule], ['watch', 'C'], '全天候但不快：交给站长看，不自动封')
console.log('ok  规则：秒拍三家封、约好的同一卖家不封、隔天不算、慢脚本只上报')

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
const cardId = 'p:P1'
const idOf = (n: number) => `VM-${String(n).padStart(4, '0')}-2222-2222-2222-2222`
async function account(id: string, copies: number, coins = 1_000_000) {
  const state = engine.newGacha(id, 'test', '2026-09-14')
  state.pulls = TRADE_PULLS
  state.coins = coins
  if (copies) state.cards = { [cardId]: { id: cardId, level: 0, dupes: copies - 1, seen: copies, got: '2026-09-14' } }
  await sql`insert into card_accounts (id_hash, state, created)
            values (${hash(id)}, ${sql.json(state)}, now() - make_interval(days => ${TRADE_DAYS + 1}))
            on conflict (id_hash) do update set state = excluded.state`
}
const BOT = idOf(1), HUMAN = idOf(2)
await account(BOT, 1); await account(HUMAN, 0)
const sellers = [10, 11, 12, 13, 14, 15].map(idOf)
for (const s of sellers) await account(s, 3)
/** seller lists with a buy-now; the buyer takes it `age` seconds after it went up */
async function snipe(seller: string, buyer: string, age: number) {
  const listed = await call('list', { id: seller, cardId, ask: 1000, buyout: 2000 })
  assert(listed.ok, JSON.stringify(listed))
  const [l] = await sql`select id from card_listings where seller_h = ${hash(seller)} and status = 'open' order by id desc limit 1`
  await sql`update card_listings set created = now() - make_interval(secs => ${age}) where id = ${l.id}`
  return call('offer', { id: buyer, listing: String(l.id), price: 2000 })
}
const settle = async () => { await api.guard.check(hash(BOT)); await api.guard.check(hash(HUMAN)) }

// a person: three purchases, minutes after the listing
for (const s of sellers.slice(0, 3)) assert((await snipe(s, HUMAN, 240)).bought)
await settle()
assert.equal(await api.guard.banOf(hash(HUMAN)), null)
console.log('ok  几分钟后买下三张的人照常交易')

// a script: three sellers, a second or two each
for (const s of sellers.slice(0, 2)) assert((await snipe(s, BOT, 2)).bought)
await settle()
assert.equal(await api.guard.banOf(hash(BOT)), null, '两次还不封')
assert((await snipe(sellers[2], BOT, 1)).bought)
await settle()
const ban = await api.guard.banOf(hash(BOT))
assert(ban && ban.until > Date.now() + 2.9 * 86_400_000 && ban.until < Date.now() + 3.1 * 86_400_000, '第一次三天')
console.log('ok  三家秒拍：自动暂停三天 —', ban!.why)

const refusedBuy = await snipe(sellers[3], BOT, 1)
assert(refusedBuy.banned && !refusedBuy.ok && typeof refusedBuy.why === 'string')
const refusedList = await call('list', { id: BOT, cardId, ask: 1000 })
assert(refusedList.banned)
const refusedSwap = await call('swap', { id: BOT, code: hash(HUMAN).slice(0, 8), giveId: cardId, wantId: cardId })
assert(refusedSwap.banned)
const shelf = await call('browse', { id: BOT })
assert(shelf.ok && shelf.ban?.until === ban!.until, '货架照常看，并告诉他被暂停到什么时候')
assert.equal((await call('browse', { id: HUMAN })).ban, undefined)
assert((await call('mail', { id: BOT })).ok !== false, '邮件照常领')
const coins = (await sql`select (state->>'coins')::int as c from card_accounts where id_hash = ${hash(BOT)}`)[0].c
assert.equal(coins, 1_000_000 - 3 * 2000, '被拒的那次没有扣钱')
console.log('ok  暂停期间不能买、不能挂、不能换；能看、能领；被拒不扣钱')

// the owner's view, and the owner's hand
assert.equal((await call('guard', {}, 'wrong')).ok, false)
const report = await call('guard', {}, TOKEN); if (process.env.DEBUG) console.log(JSON.stringify(report).slice(0, 900))
assert(report.ok && report.bans.length === 1 && report.bans[0].running && report.bans[0].rule === 'A')
assert(report.bans[0].code === hash(BOT).slice(0, 8).toUpperCase() && report.bans[0].evidence.counts.fast === 3)
const lifted = await call('guard', { code: hash(BOT).slice(0, 8), action: 'lift' }, TOKEN)
assert(lifted.ok && lifted.lifted === 1)
assert.equal(await api.guard.banOf(hash(BOT)), null)
await settle()
assert.equal(await api.guard.banOf(hash(BOT)), null, '解封以后，之前的不再算')
console.log('ok  站长看得到证据，能解封；解封后旧账不重算')

// again after a real ban has run out: five days
await sql`update market_bans set lifted = null, until = now() - interval '1 minute', made = now() - interval '3 days'`
await sql`update card_offers set made = made - interval '4 days'`
api.guard.invalidate()
for (const s of sellers.slice(3, 6)) assert((await snipe(s, BOT, 2)).bought)
await settle()
const again = await api.guard.banOf(hash(BOT))
assert(again && again.until > Date.now() + 4.9 * 86_400_000, '再犯五天')
const manual = await call('guard', { code: hash(HUMAN).slice(0, 8), action: 'ban', days: 4, note: '群里举报' }, TOKEN)
assert(manual.ok && (await api.guard.banOf(hash(HUMAN))))
console.log('ok  再犯五天；站长可手动暂停')
await db.close()
