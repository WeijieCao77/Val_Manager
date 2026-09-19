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
const verdictOf = (list: ReturnType<typeof buy>[]) => { const j = judge(list, now); return [j.verdict, j.rule] }
assert.equal(judge([], now).verdict, null)
assert.equal(judge([buy(5, 75, 'a'), buy(50, 90, 'b'), buy(90, 200, 'c')], now).verdict, null, '几分钟后才买到的，是正常人')
// a person wins a race in 3–6 s routinely (the live ledger, 2026-09-19): that alone is nothing
assert.equal(judge(Array.from({ length: 12 }, (_, i) => buy(10 + i * 20, 3 + i % 4, `s${i}`)), now).verdict, null, '一天手快十来次，不算')
assert.deepEqual(verdictOf([5, 50, 90, 130, 170].map((m) => buy(m, 0.9, 'a'))), ['ban', 'A'], '两秒内五次，哪怕同一个卖家：手做不到')
assert.equal(judge([5, 50, 90, 130].map((m) => buy(m, 0.9, 'a')), now).verdict, 'watch', '四次还不封')
assert.equal(judge([buy(5, 0.7, 'a'), buy(50, 1.2, 'b')], now).verdict, 'watch')
assert.notEqual(judge([1500, 1600, 1700, 1800, 1900].map((m) => buy(m, 0.8, 'a')), now).verdict, 'ban', '一天以前的不算在今天头上')
// a hand-over between friends or to an alt: a hundred quick purchases, one seller
const handover = Array.from({ length: 100 }, (_, i) => buy(5 + i * 10, 10, 'friend'))
assert.deepEqual(verdictOf(handover), ['ban', 'E'], '大小号来回倒：一天从同一个卖家手里快买三十张')
assert.deepEqual(verdictOf(handover.slice(0, 12)), ['watch', 'loop'], '朋友之间转十来张：只给站长看')
assert.equal(judge(handover.slice(0, 8), now).verdict, null, '转几张不算什么')
// after the protected minute the race starts when it ENDS: a buy at 60.5 s is as inhuman as one at 0.5 s
assert.deepEqual(verdictOf([5, 50, 90, 130, 170].map((m) => buy(m, 60.5, `s${m}`))), ['ban', 'A'])
assert.equal(judge([5, 50, 90, 130, 170].map((m) => buy(m, 30, `s${m}`)), now).verdict, null, '保护期中间报名中签的，不是秒拍')
// a sniper: forty-five races won today, from fifteen people
const sniper = Array.from({ length: 45 }, (_, i) => buy(5 + i * 25, 6 + i % 20, `s${i % 15}`))
assert.deepEqual(verdictOf(sniper), ['watch', 'B'], '多家快买过线：上报给站长，不自动封（站长 2026-09-19：稳一点）')
// the edge the live data showed (26–39 on a best day): a person's to judge
const keen = Array.from({ length: 30 }, (_, i) => buy(5 + i * 25, 12, `s${i % 20}`))
assert.deepEqual(verdictOf(keen), ['watch', 'near'])
// Collecting is not trading. The same forty-five races won today — but forty-five DIFFERENT cards, none sold on:
// somebody ticking 「没有的卡」 and filling a collection. And a hundred cards from one prolific seller, likewise.
const kept = (list: ReturnType<typeof buy>[]) => list.map((b, i) => ({ ...b, card_id: `p:P${i}`, flipped: false }))
assert.notEqual(judge(kept(sniper), now).verdict, 'ban', '一天快买四十五张不同的卡、都留着：是在集卡，不封')
assert.deepEqual([judge(kept(sniper), now).counts.quickCapped, judge(kept(sniper), now).counts.trading], [0, 0])
assert.notEqual(judge(kept(handover), now).verdict, 'ban', '从同一个卖家手里买一百张不同的卡、都留着：也是集卡')
assert.equal(judge(kept(handover), now).counts.trading, 0)
// the same purchases, but the same few cards over and over, or put straight back on the shelf: trading
assert.deepEqual(verdictOf(sniper.map((b, i) => ({ ...b, card_id: `p:P${i % 5}`, flipped: false }))), ['watch', 'B'], '四十五次里四十次是重复买同五张卡：按四十次算，过线上报')
assert.deepEqual(verdictOf(sniper.map((b, i) => ({ ...b, card_id: `p:P${i % 10}`, flipped: false }))), ['watch', 'near'], '三十五次重复：差一点，只上报')
assert.deepEqual(verdictOf(kept(handover).map((b) => ({ ...b, flipped: true }))), ['ban', 'E'], '买来又挂出去：是来回倒，不是集卡')
// what a body cannot do stays what it was, whatever is bought
assert.deepEqual(verdictOf(kept([5, 50, 90, 130, 170].map((m) => buy(m, 0.9, 'a')))), ['ban', 'A'])
// the patient version: twenty a day, every day
const patientSniper = Array.from({ length: 140 }, (_, i) => buy(30 + i * 70, 20, `s${i % 40}`))
assert.deepEqual(verdictOf(patientSniper), ['watch', 'C'])
// slow but never asleep
const sleepless = Array.from({ length: 120 }, (_, i) => buy(i * 61 + 10, 200, `s${i % 50}`))
assert.deepEqual(verdictOf(sleepless), ['watch', 'D'], '买得不快，但一天 24 个钟点有 20 个在买：上报')
// …and the owner can hand any of them back to the machine
assert.deepEqual([judge(sleepless, now, new Set(['A', 'D', 'E'])).verdict, judge(patientSniper, now, new Set(['C'])).verdict], ['ban', 'ban'])
// a ring does not get out by waiting: thirty trading purchases from one seller, each an hour after the listing
assert.deepEqual(verdictOf(Array.from({ length: 32 }, (_, i) => ({ ...buy(5 + i * 20, 3600, 'alt'), card_id: `p:P${i % 4}`, flipped: true }))), ['ban', 'E'], '等一个小时再买也一样：同一个卖家、同几张卡来回倒')
// a collector with coins: a hundred and fifty different cards in a day, most of them long on the shelf, all kept
assert.equal(judge(Array.from({ length: 150 }, (_, i) => ({ ...buy(2 + i * 9, 300 + i * 40, `s${i % 60}`), card_id: `p:C${i}`, flipped: false })), now).verdict, null, '有钱的收集党一天扫一百五十张不同的卡：不封，也不上报')
console.log('ok  规则：两秒内五次封；多家快买四十次封；同一卖家一天三十张封；手快的真人不封；集卡（每张只买一次、不转卖）不计')

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
  const r = await call('offer', { id: buyer, listing: String(l.id), price: 2000 })
  if (!r.entered) return r
  // 上架保护期: inside the first minute that was an entry in a draw. Let the minute pass — the listing and the
  // entry moved back together, so the entry is still `age` seconds after the listing — and draw: one entrant wins.
  await sql`update card_offers set made = made - interval '61 seconds' where listing = ${l.id}`
  await sql`update card_listings set created = created - interval '61 seconds', draw_at = draw_at - interval '61 seconds' where id = ${l.id}`
  await api.settleDue()
  const [won] = await sql`select status from card_offers where listing = ${l.id} and buyer_h = ${hash(buyer)}`
  return { ...r, bought: won?.status === 'accepted' }
}
const settle = async () => { await api.guard.check(hash(BOT)); await api.guard.check(hash(HUMAN)) }

// a person: three purchases, minutes after the listing
for (const s of sellers.slice(0, 3)) assert((await snipe(s, HUMAN, 240)).bought)
await settle()
assert.equal(await api.guard.banOf(hash(HUMAN)), null)
console.log('ok  几分钟后买下三张的人照常交易')

// a script: bought within a second or two of the listing, five times
for (const s of sellers.slice(0, 4)) assert((await snipe(s, BOT, 1)).bought)
await settle()
assert.equal(await api.guard.banOf(hash(BOT)), null, '四次还不封')
assert((await snipe(sellers[4], BOT, 1)).bought)
await settle()
const ban = await api.guard.banOf(hash(BOT))
assert(ban && ban.until > Date.now() + 2.9 * 86_400_000 && ban.until < Date.now() + 3.1 * 86_400_000, '第一次三天')
console.log('ok  两秒内买下五次：自动暂停三天 —', ban!.why)

const refusedBuy = await snipe(sellers[5], BOT, 1)
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
assert.equal(coins, 1_000_000 - 5 * 2000, '被拒的那次没有扣钱')
console.log('ok  暂停期间不能买、不能挂、不能换；能看、能领；被拒不扣钱')

// the owner's view, and the owner's hand
assert.equal((await call('guard', {}, 'wrong')).ok, false)
const report = await call('guard', {}, TOKEN); if (process.env.DEBUG) console.log(JSON.stringify(report).slice(0, 900))
assert(report.ok && report.bans.length === 1 && report.bans[0].running && report.bans[0].rule === 'A')
assert(report.bans[0].code === hash(BOT).slice(0, 8).toUpperCase() && report.bans[0].evidence.counts.ultra === 5)
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
for (const s of sellers.slice(0, 5)) assert((await snipe(s, BOT, 1)).bought)
await settle()
const again = await api.guard.banOf(hash(BOT))
assert(again && again.until > Date.now() + 4.9 * 86_400_000, '再犯五天')
const manual = await call('guard', { code: hash(HUMAN).slice(0, 8), action: 'ban', days: 4, note: '群里举报' }, TOKEN)
assert(manual.ok && (await api.guard.banOf(hash(HUMAN))))
const wk = await call('guard', { action: 'weekly' }, TOKEN)
assert(wk.ok && wk.buyers >= 1 && wk.all.length === wk.buyers && wk.all.every((n: number, i: number) => i === 0 || n >= wk.all[i - 1]))
assert(!JSON.stringify(wk).includes(hash(BOT).slice(0, 8)), '只有计数，没有账号')
console.log('ok  再犯五天；站长可手动暂停')
await db.close()
