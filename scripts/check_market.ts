/**
 * The trading post, and the promise that nobody is left holding nothing.
 *
 *   npx tsx scripts/check_market.ts
 *
 * A market between players who are never online at the same time has one real
 * failure mode: somebody acts, the other side never comes back, and a card or
 * a pile of coins is stranded. So both sides pay in when they act and collect
 * afterwards — listing escrows the CARD, bidding escrows the COINS — and every
 * outcome has to end with the escrow in somebody's inbox.
 *
 * Since 2026-09-07 a listing is an auction: a start price, a day on the
 * clock, the top bid wins and the seller has no say. A bid must clear the
 * last by a step, the beaten bidder is refunded at once, a late bid stretches
 * the clock, a bid is binding both ways, and a buy-now price ends it on the
 * spot. Listings from before the change (no `ends`) still run out on the old
 * rules — ±10% offers, the seller answering, three days before an unanswered
 * offer goes home — and that path is checked here too.
 */
process.env.ENGINE_FROM_SOURCE = '1'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { createHash } from 'node:crypto'
import { ALL_CARDS, SALVAGE } from '../src/engine/cards'
// real cards of each metal: the server reads the metal off the card table now
const idOf = (rarity: string) => ALL_CARDS.find((c) => c.rarity === rarity && c.kind === 'player')!.id
const MYTHIC = idOf('mythic'), BRONZE = idOf('bronze'), GOLD = idOf('gold')
const { CARD_SCHEMA, makeCardApi, normalizeId } = await import('../cards-api.js')
const { displayName } = await import('../names.js')
const {
  AUCTION_HOURS, AUCTION_MIN_HOURS, AUCTION_MAX_HOURS, BID_STEP, BUYOUT_MIN, HAGGLE, IGNORE_LIMIT, MAX_LISTINGS, OFFER_DAYS,
  PAGE, PAGE_MAX, SALVAGE_FLOOR, SNIPE_MINUTES, TRADE_DAYS, TRADE_PULLS, askFloor, makeMarketApi, minBid,
} = await import('../market-api.js')
const engine = await import('../src/engine/server.ts')

const db = new PGlite()
const sql = makeSql(db)
await db.exec(CARD_SCHEMA)

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

interface Res { code: number; body: Record<string, unknown> }
const api = makeMarketApi(sql, {
  readBody: (req: { body: string }) => Promise.resolve(req.body),
  json: (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body },
  normalizeId, displayName, rateLimited: () => false, engine,
  token: 'devtoken',
  tokenFrom: (req: { headers?: { authorization?: string } }) => (req.headers?.authorization ?? '').replace(/^Bearer\s+/i, ''),
  tokenOk: (given: string, expected: string) => given === expected,
} as never)
// the inbox is collected through the card api now — the server applies it
const cardsApi = makeCardApi(sql, {
  readBody: (req: { body: string }) => Promise.resolve(req.body),
  json: (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body },
  rateLimited: () => false,
} as never)

const call = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
  const res: Res = { code: 0, body: {} }
  const which = path.startsWith('/api/card/') ? cardsApi : api
  await which.route({ body: JSON.stringify(body), method: 'POST', headers } as never, res as never, path, 't')
  return Object.assign(res.body, { _code: res.code })
}

const hashOf = (id: string) => createHash('sha256').update(id).digest('hex')
const SELLER = 'VM-SSSS-SSSS-SSSS-SSSS-SSSS'
const BUYER = 'VM-BBBB-BBBB-BBBB-BBBB-BBBB'
const OTHER = 'VM-CCCC-CCCC-CCCC-CCCC-CCCC'

// Every account here has played enough to trade, and is old enough to, unless
// a test says otherwise — the gate is checked on its own further down.
const account = (id: string, name: string, coins: number, cards: Record<string, unknown>,
  pulls = TRADE_PULLS, ageDays = TRADE_DAYS + 1) =>
  sql`insert into card_accounts (id_hash, name, state, created) values (${hashOf(id)}, ${name},
    ${JSON.stringify({ coins, cards, pulls })}, now() - make_interval(days => ${ageDays}))`
const coinsOf = async (id: string) => (await sql`select (state->>'coins')::int as coins
  from card_accounts where id_hash = ${hashOf(id)}`)[0].coins as number
const listingRow = async (lid: string) => (await sql`
  select status, ignored, ends, buyout from card_listings where id = ${lid}::bigint`)[0] as
  { status: string; ignored: number; ends: string | Date | null; buyout: number | null }
const endsIn = async (lid: string, minutes: number) =>
  sql`update card_listings set ends = now() + make_interval(mins => ${minutes}) where id = ${lid}::bigint`

await account(SELLER, '卖家', 100, { 'p:P1': { id: 'p:P1', level: 3, dupes: 0 } })
// enough for every bid this file makes without collecting refunds in between
const BUYER_COINS = 20000
await account(BUYER, '买家', BUYER_COINS, {})
await account(OTHER, '路人', 5000, {})

const inbox = async (id: string) =>
  ((await call('/api/card/act', { id, action: 'mail_take', args: {}, client: {} })).result as
    { mail: { kind: string; cardId: string | null; coins: number; level: number; body?: Record<string, unknown> }[] }).mail

// ---- listing ------------------------------------------------------------
let r = await call('/api/market/list', { id: SELLER, cardId: 'p:P1', ask: 1000, level: 3 })
check('挂得上去（哪怕只有一张，不是重复卡）', r.ok === true, JSON.stringify(r))
const LID = String(r.id)
{
  const ends = Number(r.ends)
  const hours = (ends - Date.now()) / 3_600_000
  check(`挂出去就是 ${AUCTION_HOURS} 小时的竞拍`, hours > AUCTION_HOURS - 0.05 && hours <= AUCTION_HOURS + 0.05, hours.toFixed(2))
}

r = await call('/api/market/list', { id: SELLER, cardId: 'p:P9', ask: 1000 })
check('没有的卡挂不上去', r.notOwned === true, JSON.stringify(r))
r = await call('/api/market/list', { id: SELLER, cardId: 'p:P1', ask: 1000 })
check('同一张卡不能挂两次——它已经离开了账号', r.notOwned === true, JSON.stringify(r))
check('挂出的一刻，卡就不在服务器的账号里了',
  !((await sql`select state->'cards' as cards from card_accounts where id_hash = ${hashOf(SELLER)}` as unknown as { cards: Record<string, unknown> }[])[0].cards['p:P1']))
r = await call('/api/market/list', { id: SELLER, cardId: 'p:P1', ask: 5 })
check('价格有下限', r.bad === true, JSON.stringify(r))

const shelf = await call('/api/market/browse', { id: BUYER })
const one = (shelf.listings as { id: string; ask: number; seller: string; cardId: string; ends: number | null; min: number; best: number | null; bids: number }[])[0]
check('买家看得到这张挂牌', one?.id === LID && one.ask === 1000, JSON.stringify(one))
check('卖家名字带出来，而且是过滤过的', /卖家 #/.test(one?.seller ?? ''), one?.seller)
check('货架上写着截止时间、起拍就是第一口的最低价', typeof one.ends === 'number' && one.min === 1000 && one.best === null && one.bids === 0, JSON.stringify(one))
check('回复里公示规则', shelf.hours === AUCTION_HOURS && shelf.step === BID_STEP && shelf.snipe === SNIPE_MINUTES && shelf.buyoutMin === BUYOUT_MIN,
  JSON.stringify([shelf.hours, shelf.step, shelf.snipe, shelf.buyoutMin]))

// ---- bidding: a step at a time, the beaten one refunded at once -----------
r = await call('/api/market/offer', { id: BUYER, listing: LID, price: 900 })
check('低于起拍价的出价被拒，回复里写着最低', r.low === true && r.min === 1000, JSON.stringify(r))
r = await call('/api/market/offer', { id: SELLER, listing: LID, price: 1000 })
check('不能给自己的挂牌出价', r.self === true, JSON.stringify(r))
r = await call('/api/market/offer', { id: BUYER, listing: LID, price: 1000 })
check('按起拍价出第一口可以', r.ok === true && r.price === 1000, JSON.stringify(r))
check('出价的一刻，金币就从服务器的账号里扣走了', await coinsOf(BUYER) === BUYER_COINS - 1000, String(await coinsOf(BUYER)))
r = await call('/api/market/offer', { id: BUYER, listing: LID, price: 1200 })
check('自己领先时不能再加', r.leading === true, JSON.stringify(r))
const sm = await inbox(SELLER)
check('卖家收到「有人出价」的通知', sm.some((m) => m.kind === 'offer_made'), JSON.stringify(sm.map((m) => m.kind)))

check('下一口的最低价是当前最高再加一步', minBid(1000, 1000) === 1050 && minBid(1000, 1050) === 1103 && minBid(1000, null) === 1000,
  `${minBid(1000, 1000)} / ${minBid(1000, 1050)}`)
r = await call('/api/market/offer', { id: OTHER, listing: LID, price: 1040 })
check('第二个人加得不够一步，被拒', r.low === true && r.min === 1050, JSON.stringify(r))
r = await call('/api/market/offer', { id: OTHER, listing: LID, price: 1050 })
check('加够一步就压过去了', r.ok === true && r.price === 1050, JSON.stringify(r))
{
  const back = await inbox(BUYER)
  const ob = back.find((m) => m.kind === 'overbid')
  check('被压过的那一刻，前一个人的金币立刻退回信箱', ob?.coins === 1000 && Number(ob?.body?.by) === 1050, JSON.stringify(back.map((m) => [m.kind, m.coins])))
  check('领了之后金币到账', await coinsOf(BUYER) === BUYER_COINS, String(await coinsOf(BUYER)))
  const s2 = await inbox(SELLER)
  check('之后的每一口不再骚扰卖家', !s2.some((m) => m.kind === 'offer_made'), JSON.stringify(s2.map((m) => m.kind)))
  const view = (await call('/api/market/browse', { id: BUYER })).listings as { id: string; best: number; min: number; bids: number; offers: number; bid: boolean }[]
  const row = view.find((l) => l.id === LID)!
  check('货架上：当前最高 1050，下一口至少 1103，两人出过价，站着的只有一口', row.best === 1050 && row.min === 1103 && row.bids === 2 && row.offers === 1, JSON.stringify(row))
  check('被压过的人不再标「已出价」', row.bid === false)
  const lead = (await call('/api/market/browse', { id: OTHER })).listings as { id: string; bid: boolean }[]
  check('领先的人标着「已出价」', lead.find((l) => l.id === LID)!.bid === true)
  r = await call('/api/market/offer', { id: BUYER, listing: LID, price: 1103 })
  check('被压过的人可以再出', r.ok === true && r.price === 1103, JSON.stringify(r))
}

// ---- binding: nobody backs out ---------------------------------------------
{
  const mine = await call('/api/market/offers', { id: SELLER })
  const inb = mine.inbound as { id: string; price: number; ends: number | null }[]
  check('卖家看到的是当前最高一口，带着截止时间', inb.length === 1 && inb[0].price === 1103 && typeof inb[0].ends === 'number', JSON.stringify(inb))
  r = await call('/api/market/answer', { id: SELLER, offer: inb[0].id, accept: true })
  check('卖家不能自己拍板成交', r.auction === true, JSON.stringify(r))
  r = await call('/api/market/answer', { id: SELLER, offer: inb[0].id, accept: false })
  check('也不能拒绝', r.auction === true, JSON.stringify(r))
  r = await call('/api/market/unlist', { id: SELLER, listing: LID })
  check('有人出价之后卖家撤不了牌', r.bound === true, JSON.stringify(r))
  const q = await call('/api/market/offers', { id: BUYER })
  const my = (q.outbound as { id: string; price: number; ends: number | null }[]).find((o) => o.price === 1103)!
  check('买家看到自己领先的一口，带着截止时间', !!my && typeof my.ends === 'number', JSON.stringify(q.outbound))
  r = await call('/api/market/withdraw', { id: BUYER, offer: my.id })
  check('竞拍的出价撤不回', r.binding === true, JSON.stringify(r))
  check('金币还在托管里', await coinsOf(BUYER) === BUYER_COINS - 1103, String(await coinsOf(BUYER)))
}

// ---- the last minutes stretch --------------------------------------------
{
  await endsIn(LID, 3)
  const before = new Date((await listingRow(LID)).ends!).getTime()
  r = await call('/api/market/offer', { id: OTHER, listing: LID, price: 1200 })
  check('最后几分钟里有人出价，出得上', r.ok === true, JSON.stringify(r))
  const after = new Date((await listingRow(LID)).ends!).getTime()
  const gained = (after - before) / 60000
  check(`截止顺延到 ${SNIPE_MINUTES} 分钟后`, gained > SNIPE_MINUTES - 3.2 && gained < SNIPE_MINUTES - 2.8 && Number(r.ends) === after, `${gained.toFixed(2)} 分钟`)
  await endsIn(LID, 60)
  const far = new Date((await listingRow(LID)).ends!).getTime()
  r = await call('/api/market/offer', { id: BUYER, listing: LID, price: 1300 })
  check('离截止还远的出价不动时钟', r.ok === true && new Date((await listingRow(LID)).ends!).getTime() === far, JSON.stringify(r))
  // the stretching has a ceiling: an hour past the day, and no further
  await sql`update card_listings set created = now() - make_interval(hours => ${AUCTION_HOURS}, mins => 55) where id = ${LID}::bigint`
  await endsIn(LID, 3)
  r = await call('/api/market/offer', { id: OTHER, listing: LID, price: 1400 })
  const capped = (new Date((await listingRow(LID)).ends!).getTime() - Date.now()) / 60000
  check('顺延到头只到「一天加一小时」', r.ok === true && capped > 4.5 && capped < 5.5, `${capped.toFixed(2)} 分钟`)
  await sql`update card_listings set created = now() - make_interval(hours => ${AUCTION_HOURS}, mins => 70) where id = ${LID}::bigint`
  await endsIn(LID, 3)
  const fixed = new Date((await listingRow(LID)).ends!).getTime()
  r = await call('/api/market/offer', { id: BUYER, listing: LID, price: 1500 })
  check('过了上限，再晚的出价也不再顺延', r.ok === true && new Date((await listingRow(LID)).ends!).getTime() === fixed, JSON.stringify(r))
  await sql`update card_listings set created = now() where id = ${LID}::bigint`
}

// ---- the hammer: time up, the top bid takes the card --------------------------
{
  await inbox(OTHER); await inbox(BUYER); await inbox(SELLER)
  await endsIn(LID, -1)
  const seen = await call('/api/market/browse', { id: OTHER })   // any read settles
  check('到时之后货架上没有它了', !(seen.listings as { id: string }[]).some((l) => l.id === LID))
  check('挂牌记为已卖出', (await listingRow(LID)).status === 'sold')
  const bm = await inbox(BUYER)
  const got = bm.find((m) => m.kind === 'bought')
  check('最高价的人收到卡，强化等级一起带过来', got?.cardId === 'p:P1' && got.level === 3 && Number(got.body?.price) === 1500, JSON.stringify(got))
  const sm2 = await inbox(SELLER)
  check('卖家收到成交价', sm2.some((m) => m.kind === 'sold' && m.coins === 1500), JSON.stringify(sm2.map((m) => [m.kind, m.coins])))
  const om = await inbox(OTHER)
  check('结算时没人被退第二次钱', om.length === 0, JSON.stringify(om.map((m) => [m.kind, m.coins])))
  check('路人的钱早在被压过时就退了，一分不少', await coinsOf(OTHER) === 5000, String(await coinsOf(OTHER)))
  check('买家的钱正好少了成交价', await coinsOf(BUYER) === BUYER_COINS - 1500, String(await coinsOf(BUYER)))
}

// ---- 一口价 -----------------------------------------------------------------
{
  const S2 = 'VM-DDDD-DDDD-DDDD-DDDD-DDDD'
  await account(S2, '卖二', 0, { 'p:P2': { id: 'p:P2', dupes: 0 } })
  let x = await call('/api/market/list', { id: S2, cardId: 'p:P2', ask: 1000, buyout: 1100 })
  check(`一口价低于起拍价的 ${BUYOUT_MIN} 倍，挂不了`, x.badBuyout === true && x.min === 1200, JSON.stringify(x))
  x = await call('/api/market/list', { id: S2, cardId: 'p:P2', ask: 1000, buyout: 1500 })
  check('一口价够高就挂得上', x.ok === true, JSON.stringify(x))
  const l2 = String(x.id)
  const row = (await call('/api/market/browse', { id: BUYER })).listings as { id: string; buyout: number | null }[]
  check('货架上写着一口价', row.find((l) => l.id === l2)!.buyout === 1500)
  await inbox(BUYER)
  const before = await coinsOf(BUYER)
  x = await call('/api/market/offer', { id: BUYER, listing: l2, price: 2000 })
  check('出到一口价以上就是一口价成交，只收一口价', x.ok === true && x.bought === true && x.price === 1500, JSON.stringify(x))
  check('扣的是 1500 不是 2000', await coinsOf(BUYER) === before - 1500, String(await coinsOf(BUYER)))
  check('挂牌立刻记为卖出', (await listingRow(l2)).status === 'sold')
  const bm = await inbox(BUYER)
  check('卡马上到买家信箱', bm.some((m) => m.kind === 'bought' && m.cardId === 'p:P2'), JSON.stringify(bm.map((m) => m.kind)))
  const sm3 = await inbox(S2)
  check('卖家马上收到 1500', sm3.some((m) => m.kind === 'sold' && m.coins === 1500), JSON.stringify(sm3.map((m) => [m.kind, m.coins])))
  x = await call('/api/market/offer', { id: OTHER, listing: l2, price: 1500 })
  check('成交之后再出价，牌已经不在了', x.gone === true, JSON.stringify(x))
}

// ---- 拍多久卖家自己定 ---------------------------------------------------------
{
  const S9 = 'VM-TTTT-TTTT-TTTT-TTTT-TTTT'
  await account(S9, '卖九', 0, { 'p:P21': { id: 'p:P21', dupes: 0 }, 'p:P22': { id: 'p:P22', dupes: 0 }, 'p:P23': { id: 'p:P23', dupes: 0 } })
  let x = await call('/api/market/list', { id: S9, cardId: 'p:P21', ask: 1000, hours: 1 })
  check(`短于 ${AUCTION_MIN_HOURS} 小时挂不了`, x.badHours === true && x.min === AUCTION_MIN_HOURS && x.max === AUCTION_MAX_HOURS, JSON.stringify(x))
  x = await call('/api/market/list', { id: S9, cardId: 'p:P21', ask: 1000, hours: 30 })
  check(`长于 ${AUCTION_MAX_HOURS} 小时也挂不了`, x.badHours === true, JSON.stringify(x))
  x = await call('/api/market/list', { id: S9, cardId: 'p:P21', ask: 1000, hours: 2 })
  const two = (Number(x.ends) - Date.now()) / 3_600_000
  check('挂 2 小时就是 2 小时后截止', x.ok === true && x.hours === 2 && two > 1.95 && two <= 2.05, `${two.toFixed(2)} h`)
  const short = String(x.id)
  x = await call('/api/market/list', { id: S9, cardId: 'p:P22', ask: 1000 })
  const dflt = (Number(x.ends) - Date.now()) / 3_600_000
  check(`没说多久就是 ${AUCTION_HOURS} 小时（老客户端）`, x.ok === true && x.hours === AUCTION_HOURS && dflt > AUCTION_HOURS - 0.05, `${dflt.toFixed(2)} h`)
  const row = (await call('/api/market/browse', { id: BUYER })).listings as { id: string; hours: number }[]
  check('货架上带着各自的时长', row.find((l) => l.id === short)!.hours === 2 && row.find((l) => l.id === String(x.id))!.hours === AUCTION_HOURS)
  // the stretch cap follows the listing's own length: two hours, plus the hour
  await sql`update card_listings set created = now() - make_interval(hours => 2, mins => 55) where id = ${short}::bigint`
  await endsIn(short, 3)
  await inbox(BUYER)
  x = await call('/api/market/offer', { id: BUYER, listing: short, price: 1000 })
  const capped = (new Date((await listingRow(short)).ends!).getTime() - Date.now()) / 60000
  check('2 小时的拍卖顺延到头是「2 小时加 1 小时」', x.ok === true && capped > 4.5 && capped < 5.5, `${capped.toFixed(2)} 分钟`)
  await endsIn(short, -1)
  await call('/api/market/browse', { id: BUYER })
  check('到时照样结算', (await listingRow(short)).status === 'sold')
  await inbox(BUYER); await inbox(S9)
}

// ---- 到时没人出价，卡回家 ------------------------------------------------------
{
  const S3 = 'VM-EEEE-EEEE-EEEE-EEEE-EEEE'
  await account(S3, '卖三', 0, { 'p:P3': { id: 'p:P3', dupes: 0, level: 2 } })
  const l3 = String((await call('/api/market/list', { id: S3, cardId: 'p:P3', ask: 1000, level: 2 })).id)
  await endsIn(l3, -1)
  await call('/api/market/browse', { id: BUYER })
  check('到时没人出价，挂牌结束', (await listingRow(l3)).status === 'expired')
  const home = await inbox(S3)
  check('卡原样退回卖家，等级也在', home.some((m) => m.kind === 'unsold' && m.cardId === 'p:P3' && m.level === 2), JSON.stringify(home))
  const late = await call('/api/market/offer', { id: BUYER, listing: l3, price: 1000 })
  check('过了时再出价，出不了', late.gone === true, JSON.stringify(late))
}

// ---- 没人出价时卖家可以撤 ------------------------------------------------------
{
  const S4 = 'VM-FFFF-FFFF-FFFF-FFFF-FFFF'
  await account(S4, '卖四', 0, { 'p:P4': { id: 'p:P4', dupes: 0, level: 5 } })
  const l4 = String((await call('/api/market/list', { id: S4, cardId: 'p:P4', ask: 2000, level: 5 })).id)
  const nope = await call('/api/market/unlist', { id: BUYER, listing: l4 })
  check('别人撤不了你的挂牌', nope.gone === true, JSON.stringify(nope))
  const u = await call('/api/market/unlist', { id: S4, listing: l4 })
  check('没人出价时可以自己撤回挂牌', u.ok === true && u.refunded === 0, JSON.stringify(u))
  const home = await inbox(S4)
  check('撤回后卡回来，等级也在', home.some((m) => m.kind === 'listing_pulled' && m.cardId === 'p:P4' && m.level === 5), JSON.stringify(home))
}

// ---- 没钱不能出价 --------------------------------------------------------
{
  const S5 = 'VM-GGGG-GGGG-GGGG-GGGG-GGGG'
  await account(S5, '卖五', 0, { 'p:P5': { id: 'p:P5', dupes: 0 } })
  const l5 = String((await call('/api/market/list', { id: S5, cardId: 'p:P5', ask: 100000 })).id)
  const poor = await call('/api/market/offer', { id: BUYER, listing: l5, price: 100000 })
  check('金币不够就出不了价', poor.broke === true, JSON.stringify(poor))
  const bad = await call('/api/market/withdraw', { id: BUYER, offer: 'abc' })
  check('乱写的报价编号回 400', bad.bad === true, JSON.stringify(bad))
}

// ---- 改版前挂出的牌，按旧规则走完 -----------------------------------------------
{
  // an old listing has no `ends`: offers within ±10%, the seller answers,
  // three days before an unanswered offer goes home, three of those and the
  // listing comes down. Planted straight into the table, as the old code left it.
  const S6 = 'VM-PPPP-PPPP-PPPP-PPPP-PPPP'
  await account(S6, '旧牌', 0, {})
  const old = String((await sql`
    insert into card_listings (seller_h, card_id, level, ask) values (${hashOf(S6)}, 'p:P6', 1, 1000) returning id`)[0].id)
  const view = (await call('/api/market/browse', { id: BUYER })).listings as { id: string; ends: number | null; min: number }[]
  check('旧牌在货架上没有截止时间，最低价就是标价', view.find((l) => l.id === old)!.ends === null && view.find((l) => l.id === old)!.min === 1000)
  let x = await call('/api/market/offer', { id: BUYER, listing: old, price: 800 })
  check('旧牌：低于 −10% 的报价被拒', x.range === true && x.lo === 900, JSON.stringify(x))
  x = await call('/api/market/offer', { id: BUYER, listing: old, price: 1200 })
  check('旧牌：高于 +10% 也被拒', x.range === true && x.hi === 1100, JSON.stringify(x))
  x = await call('/api/market/offer', { id: BUYER, listing: old, price: 900 })
  check('旧牌：−10% 可以', x.ok === true, JSON.stringify(x))
  x = await call('/api/market/offer', { id: BUYER, listing: old, price: 950 })
  check('旧牌：同一个人不能挂两个报价', x.already === true, JSON.stringify(x))
  x = await call('/api/market/offer', { id: OTHER, listing: old, price: 1050 })
  check('旧牌：第二个人也能出价，两个报价并存', x.ok === true, JSON.stringify(x))
  const q = await call('/api/market/offers', { id: BUYER })
  const mine = (q.outbound as { id: string; price: number; ends: number | null }[]).find((o) => o.price === 900)!
  check('旧牌的报价没有截止时间', mine.ends === null, JSON.stringify(mine))
  x = await call('/api/market/withdraw', { id: BUYER, offer: mine.id })
  check('旧牌的报价买家可以撤回', x.ok === true && x.coins === 900, JSON.stringify(x))
  await inbox(BUYER)
  const inb = (await call('/api/market/offers', { id: S6 })).inbound as { id: string; price: number }[]
  check('卖家看到剩下的那个报价', inb.length === 1 && inb[0].price === 1050, JSON.stringify(inb))
  x = await call('/api/market/answer', { id: S6, offer: inb[0].id, accept: true })
  check('旧牌：卖家可以接受', x.ok === true && x.price === 1050, JSON.stringify(x))
  const om = await inbox(OTHER)
  check('旧牌成交后买家收到卡', om.some((m) => m.kind === 'bought' && m.cardId === 'p:P6' && m.level === 1), JSON.stringify(om.map((m) => m.kind)))
  const s6 = await inbox(S6)
  check('旧牌成交后卖家收到钱', s6.some((m) => m.kind === 'sold' && m.coins === 1050))

  // the three-day clock only ticks for old listings
  const old2 = String((await sql`
    insert into card_listings (seller_h, card_id, level, ask) values (${hashOf(S6)}, 'p:P7', 0, 1000) returning id`)[0].id)
  await call('/api/market/offer', { id: BUYER, listing: old2, price: 1000 })
  await inbox(BUYER)
  await sql`update card_offers set made = now() - make_interval(days => ${OFFER_DAYS + 1}) where status = 'open'`
  await call('/api/market/browse', { id: BUYER })
  const back = await inbox(BUYER)
  check(`旧牌：${OFFER_DAYS} 天没人理，报价退回`, back.some((m) => m.kind === 'offer_expired' && m.coins === 1000), JSON.stringify(back.map((m) => [m.kind, m.coins])))
  check('旧牌：算卖家一次「没反馈」', (await listingRow(old2)).ignored === 1)
  for (let i = 0; i < IGNORE_LIMIT; i++) {
    await call('/api/market/offer', { id: BUYER, listing: old2, price: 1000 })
    await sql`update card_offers set made = now() - make_interval(days => ${OFFER_DAYS + 1}) where status = 'open'`
    await call('/api/market/browse', { id: BUYER })
  }
  check(`旧牌：连续 ${IGNORE_LIMIT} 次没反馈自动下架`, (await listingRow(old2)).status === 'expired')
  check('旧牌下架，卡回卖家', (await inbox(S6)).some((m) => m.kind === 'listing_expired' && m.cardId === 'p:P7'))
  await inbox(BUYER)

  // and a live auction's bid does NOT age out
  const S7 = 'VM-WWWW-WWWW-WWWW-WWWW-WWWW'
  await account(S7, '卖七', 0, { 'p:P8': { id: 'p:P8', dupes: 0 } })
  const l7 = String((await call('/api/market/list', { id: S7, cardId: 'p:P8', ask: 1000 })).id)
  await call('/api/market/offer', { id: BUYER, listing: l7, price: 1000 })
  await sql`update card_offers set made = now() - make_interval(days => ${OFFER_DAYS + 1}) where status = 'open'`
  await call('/api/market/browse', { id: BUYER })
  const still = await sql`select status from card_offers where listing = ${l7}::bigint`
  check('竞拍的出价不会因为「三天」而过期', still[0].status === 'open' && (await listingRow(l7)).ignored === 0, JSON.stringify(still))
  await endsIn(l7, -1)
  await call('/api/market/browse', { id: BUYER })
  check('它只在到时结算', (await listingRow(l7)).status === 'sold')
  await inbox(BUYER); await inbox(S7)
}

// ---- 改版前的挂牌一次全退 (2026-09-07) ---------------------------------------
{
  const S8 = 'VM-RRRR-RRRR-RRRR-RRRR-RRRR'
  await account(S8, '旧牌二', 0, {})
  const a = String((await sql`
    insert into card_listings (seller_h, card_id, level, ask) values (${hashOf(S8)}, 'p:P11', 2, 1000) returning id`)[0].id)
  const b = String((await sql`
    insert into card_listings (seller_h, card_id, level, ask) values (${hashOf(S8)}, 'p:P12', 0, 1000) returning id`)[0].id)
  await inbox(BUYER)
  const before = await coinsOf(BUYER)
  await call('/api/market/offer', { id: BUYER, listing: a, price: 1000 })
  check('旧牌上还挂着一个报价', await coinsOf(BUYER) === before - 1000)
  const live = String((await call('/api/market/list', { id: S8 === S8 ? OTHER : OTHER, cardId: 'p:P13', ask: 1000 })).id ?? '')
  void live
  let x = await call('/api/market/retire_legacy', {})
  check('没带 token 是 404', x._code === 404, JSON.stringify(x))
  x = await call('/api/market/retire_legacy', {}, { authorization: 'Bearer wrong' })
  check('错的 token 也是 404', x._code === 404, JSON.stringify(x))
  x = await call('/api/market/retire_legacy', {}, { authorization: 'Bearer devtoken' })
  check('对的 token：两张旧牌下架，一个报价退回', x.ok === true && x.listings === 2 && x.offers === 1, JSON.stringify(x))
  check('两张旧牌都关了', (await listingRow(a)).status === 'pulled' && (await listingRow(b)).status === 'pulled')
  const home = await inbox(S8)
  check('卡回到卖家信箱，等级也在', home.filter((m) => m.kind === 'listing_retired').length === 2
    && home.some((m) => m.cardId === 'p:P11' && m.level === 2), JSON.stringify(home.map((m) => [m.kind, m.cardId, m.level])))
  const rb = await inbox(BUYER)
  check('托管的报价退了钱', rb.some((m) => m.kind === 'offer_expired' && m.coins === 1000) && await coinsOf(BUYER) === before,
    JSON.stringify(rb.map((m) => [m.kind, m.coins])))
  const view = (await call('/api/market/browse', { id: BUYER })).listings as { ends: number | null; mine: boolean }[]
  check('货架上不再有旧规则的牌', view.every((l) => l.ends != null), String(view.filter((l) => l.ends == null).length))
  x = await call('/api/market/retire_legacy', {}, { authorization: 'Bearer devtoken' })
  check('再跑一次没东西可退', x.ok === true && x.listings === 0 && x.offers === 0, JSON.stringify(x))
}

// ---- 挂牌价不能低于分解价 ------------------------------------------------
//
// A flat floor made the market a better alt-account funnel than the gifting it
// replaced: list for 50, buy it from your own throwaway account, done. The
// floor is what the game itself would pay, so it costs a real seller nothing —
// below salvage you would simply salvage it and take the same coins now.
{
  check('服务器的分解价表和游戏里的一致',
    JSON.stringify(SALVAGE_FLOOR) === JSON.stringify(SALVAGE),
    `${JSON.stringify(SALVAGE_FLOOR)} vs ${JSON.stringify(SALVAGE)}`)
  await account('VM-HHHH-HHHH-HHHH-HHHH-HHHH', '小号', 0, {
    [MYTHIC]: { id: MYTHIC, dupes: 0 }, [BRONZE]: { id: BRONZE, dupes: 0 },
  })
  const ALT = 'VM-HHHH-HHHH-HHHH-HHHH-HHHH'
  // the request says bronze; the card table says 彩卡, and the table wins
  let x = await call('/api/market/list', { id: ALT, cardId: MYTHIC, ask: 50, rarity: 'bronze' })
  check('彩卡不能挂 50 金币甩给大号——金属看卡表，不看请求', x.bad === true && x.min === SALVAGE.mythic,
    JSON.stringify(x))
  x = await call('/api/market/list', { id: ALT, cardId: MYTHIC, ask: SALVAGE.mythic, rarity: 'mythic' })
  check('挂到分解价就可以', x.ok === true, JSON.stringify(x))
  x = await call('/api/market/list', { id: ALT, cardId: BRONZE, ask: 60, rarity: 'bronze' })
  check('铜卡的下限低得多，正常出货不受影响', x.ok === true, JSON.stringify(x))
  x = await call('/api/market/list', { id: ALT, cardId: 'p:M9', ask: 60, rarity: 'bronze' })
  check('卡表里没有的编号挂不了', x.notOwned === true, JSON.stringify(x))
  check('下限就是分解价', askFloor('gold') === SALVAGE.gold && askFloor('silver') === SALVAGE.silver,
    `${askFloor('gold')} / ${askFloor('silver')}`)
}

// ---- 新号进不来 ---------------------------------------------------------
//
// The price floor stopped cards moving between accounts for free, but not an
// alt selling commons at salvage, which is still cheaper than pulling them.
// What kills that is making the alt itself expensive: a throwaway has to be
// played for the better part of a week before it can trade at all.
{
  const NEW = 'VM-NEWW-NEWW-NEWW-NEWW-NEWW'
  await account(NEW, '新号', 9999, { [GOLD]: { id: GOLD, dupes: 0 } }, 11)  // a day-zero account
  let x = await call('/api/market/list', { id: NEW, cardId: GOLD, ask: 700, rarity: 'gold' })
  check('新号挂不了牌', x.newbie === true && x.need === TRADE_PULLS && x.have === 11,
    JSON.stringify(x))

  const shelfNow = await call('/api/market/browse', { id: NEW })
  check('但货架照样能看', (shelfNow.listings as unknown[]).length > 0)
  check('而且告诉他还差多少',
    (shelfNow.gate as { need: number; have: number })?.have === 11, JSON.stringify(shelfNow.gate))

  const anyOpen = (shelfNow.listings as { id: string; ask: number }[])[0]
  x = await call('/api/market/offer', { id: NEW, listing: anyOpen.id, price: anyOpen.ask })
  check('新号也出不了价', x.newbie === true, JSON.stringify(x))

  // open enough packs and the door opens
  await sql`update card_accounts set state = jsonb_set(state, '{pulls}', ${String(TRADE_PULLS)}::jsonb)
            where id_hash = ${hashOf(NEW)}`
  x = await call('/api/market/list', { id: NEW, cardId: GOLD, ask: 700, rarity: 'gold' })
  check(`开够 ${TRADE_PULLS} 抽就能挂了`, x.ok === true, JSON.stringify(x))
  const g2 = await call('/api/market/browse', { id: NEW })
  check('到门槛之后就不再提示了', g2.gate === null, JSON.stringify(g2.gate))

  // Enough pulls is not enough on the first day. Waiting is the one thing that
  // cannot be done faster by spreading it over several accounts at once.
  const FRESH = 'VM-FRSH-FRSH-FRSH-FRSH-FRSH'
  await account(FRESH, '今天的号', 9999, { [GOLD]: { id: GOLD, dupes: 0 } }, TRADE_PULLS + 20, 0)
  x = await call('/api/market/list', { id: FRESH, cardId: GOLD, ask: 700, rarity: 'gold' })
  const wait = Number(x.wait)
  check(`抽数够了、账号不满 ${TRADE_DAYS} 天也挂不了`, x.newbie === true && Number(x.have) >= TRADE_PULLS
    && x.days === TRADE_DAYS && wait > TRADE_DAYS * 86_400 - 120 && wait <= TRADE_DAYS * 86_400, JSON.stringify(x))
  const fresh = await call('/api/market/browse', { id: FRESH })
  check('货架上写着还要等多久', Number((fresh.gate as { wait?: number } | null)?.wait) > 0, JSON.stringify(fresh.gate))
  x = await call('/api/market/offer', { id: FRESH, listing: anyOpen.id, price: anyOpen.ask })
  check('不满三天也出不了价', x.newbie === true, JSON.stringify(x))
  await sql`update card_accounts set created = now() - make_interval(days => ${TRADE_DAYS}, mins => 1)
            where id_hash = ${hashOf(FRESH)}`
  x = await call('/api/market/list', { id: FRESH, cardId: GOLD, ask: 700, rarity: 'gold' })
  check(`满 ${TRADE_DAYS} 天就能挂了`, x.ok === true, JSON.stringify(x))
  check('满了之后货架不再提示', (await call('/api/market/browse', { id: FRESH })).gate === null)
}

// ---- 货架分页：全站的牌都够得着，筛选筛的是全站而不是这一页 ----------------
{
  // 「我挂的卡别人看不见，但另一个人看得见」(2026-09-08)：货架只发最新的
  // 400 张，按最快结束排序，而全站有 1,428 张——那 400 张只覆盖未来五个
  // 小时，挂一天的卡前十九个小时对谁都不存在，而且窗口一直在动，所以两个
  // 人隔一小时看到的是两个市场。现在是一页一页往后翻，顺序和筛选都由服务器
  // 定，没有够不着的牌。
  const S8 = 'VM-KKKK-KKKK-KKKK-KKKK-KKKK'
  await account(S8, '老牌', 0, { [GOLD]: { id: GOLD, dupes: 0 } })
  const old = String((await call('/api/market/list', { id: S8, cardId: GOLD, ask: 2000 })).id)
  // one listing per card id and MAX_LISTINGS per seller, so the flood is
  // many sellers with a few distinct cards each
  const used = new Set([GOLD, BRONZE, MYTHIC])
  const stock = ALL_CARDS.filter((c) => c.kind === 'player' && !used.has(c.id) && /^p:P\d{2,}$/.test(c.id))
    .slice(0, PAGE * 2 + 5)
  const askOf = (c: { rarity: string }, i: number) => Math.max(1000, askFloor(c.rarity)) + i
  let listed = 0
  for (let i = 0; i < stock.length; i += MAX_LISTINGS) {
    const cards = stock.slice(i, i + MAX_LISTINGS)
    const flood = `VM-MMMM-MMMM-MMMM-MMMM-M${String(i / MAX_LISTINGS).padStart(3, '0')}`
    await account(flood, `刷屏${i}`, 0, Object.fromEntries(cards.map((c) => [c.id, { id: c.id, dupes: 0 }])))
    for (const c of cards) {
      // a spread of prices and of closing times, so the orders are telling apart
      const r = await call('/api/market/list', {
        id: flood, cardId: c.id, ask: askOf(c, stock.indexOf(c)), hours: 2 + (stock.indexOf(c) % 23),
      })
      if (r.ok) listed++
    }
  }
  check(`货架被灌了 ${listed} 张新牌`, listed === stock.length, `${listed}/${stock.length}`)

  interface Row { id: string; mine: boolean; ends: number | null; ask: number; best: number | null; cardId: string }
  interface Page {
    ok: boolean; listings: Row[]; own: Row[]; next: string | null
    total?: number; pool?: [string, number][]
  }
  const browse = (body: Record<string, unknown>) =>
    call('/api/market/browse', { id: S8, ...body }) as Promise<Page & { _code: number }>
  /** every page of a shelf, in order, and how many requests it took */
  const walk = async (body: Record<string, unknown>, cap = 40) => {
    const rows: Row[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const p: Page = await browse({ ...body, ...(cursor ? { cursor } : {}) })
      rows.push(...p.listings)
      cursor = p.next
      pages++
    } while (cursor && pages < cap)
    return { rows, pages }
  }

  /** everything on the market that is not S8's, which is what a page of the shelf draws from */
  const theirs = async () => Number((await sql`select count(*)::int as n from card_listings
    where status = 'open' and seller_h <> ${hashOf(S8)}`)[0].n)
  const stocked = await theirs()

  const first = await browse({})
  check('自己那张老牌在 own 里，一页就全给', first.own.length === 1 && first.own[0].id === old,
    JSON.stringify(first.own.map((l) => l.id)))
  check('自己的牌不混在别人的货架里', first.listings.every((l) => !l.mine))
  check(`一页 ${PAGE} 张`, first.listings.length === PAGE, String(first.listings.length))
  check('还有下一页', typeof first.next === 'string')
  check('第一页带着全站张数和筛选菜单的料', Number(first.total) === stocked + 1 && Array.isArray(first.pool),
    `total=${first.total}`)
  check('筛选菜单的料就是全站的牌，一张算一张',
    (first.pool ?? []).reduce((n, [, k]) => n + k, 0) === stocked,
    String((first.pool ?? []).reduce((n, [, k]) => n + k, 0)))

  const open = await walk({})
  check('翻到底能翻到别人全部的牌，一张不多一张不少',
    open.rows.length === stocked && new Set(open.rows.map((l) => l.id)).size === stocked,
    `${open.rows.length} 张 / ${new Set(open.rows.map((l) => l.id)).size} 个不重复 / 应为 ${stocked}`)
  check('翻页的第二页起不再重发全站统计',
    (await browse({ cursor: first.next as string })).total === undefined)
  check('按快结束排：一路不递减', open.rows.every((l, i) => i === 0 || (open.rows[i - 1].ends ?? 0) <= (l.ends ?? 0)))

  // the point of 「最新上架」: a card listed just now is on the first screen,
  // whatever it does to its own clock
  const fresh = 'VM-NNNN-NNNN-NNNN-NNNN-NNNN'
  await account(fresh, '刚挂的', 0, { [MYTHIC]: { id: MYTHIC, dupes: 0 } })
  const just = String((await call('/api/market/list', { id: fresh, cardId: MYTHIC, ask: 9000, hours: 24 })).id)
  const byNew = await browse({ sort: 'new' })
  check('最新上架：刚挂的那张在第一页第一个', byNew.listings[0]?.id === just, byNew.listings[0]?.id)
  const byEnds = await browse({ sort: 'ends' })
  check('同一张牌在「即将结束」里第一页是看不到的（所以才要两个标签页）',
    !byEnds.listings.some((l) => l.id === just))
  const newWalk = await walk({ sort: 'new' })
  check('最新上架翻到底也是全部，不重不漏',
    newWalk.rows.length === stocked + 1 && new Set(newWalk.rows.map((l) => l.id)).size === stocked + 1,
    String(newWalk.rows.length))

  const cheap = await walk({ sort: 'price' })
  const priceOf = (l: Row) => l.best ?? l.ask
  check('按价格从低到高：一路不递减', cheap.rows.every((l, i) => i === 0 || priceOf(cheap.rows[i - 1]) <= priceOf(l)))
  const dear = await walk({ sort: 'price_desc' })
  check('按价格从高到低：一路不递增', dear.rows.every((l, i) => i === 0 || priceOf(dear.rows[i - 1]) >= priceOf(l)))
  check('两个方向看到的是同一批牌', cheap.rows.length === dear.rows.length && cheap.rows.length === stocked + 1,
    `${cheap.rows.length} / ${dear.rows.length}`)

  // the fix itself: a filter that reaches past the page it was applied to
  const golds = new Set(ALL_CARDS.filter((c) => c.rarity === 'gold').map((c) => c.id))
  const goldWalk = await walk({ rarity: 'gold' })
  const goldTotal = open.rows.concat(newWalk.rows.filter((l) => l.id === just)).filter((l) => golds.has(l.cardId)).length
  check('筛金卡筛的是全站，不是这一页',
    goldWalk.rows.length === goldTotal && goldWalk.rows.every((l) => golds.has(l.cardId)),
    `${goldWalk.rows.length} / 应为 ${goldTotal}`)
  check('筛出来的菜单料也跟着筛选之外的条件走', Array.isArray((await browse({ rarity: 'gold' })).pool))
  const none = await browse({ q: '这个名字没有人叫' })
  check('搜不到就是空货架，不是整个货架', none.ok === true && none.listings.length === 0 && none.next === null)
  check('搜不到的时候自己的牌还在', none.own.length === 1)

  const band = await walk({ priceMin: 3000, priceMax: 6000 })
  check('价格区间：全都在区间里', band.rows.every((l) => priceOf(l) >= 3000 && priceOf(l) <= 6000))
  check('价格区间：区间里的一张都不少',
    band.rows.length === open.rows.concat(newWalk.rows.filter((l) => l.id === just))
      .filter((l) => priceOf(l) >= 3000 && priceOf(l) <= 6000).length,
    String(band.rows.length))

  // 「只看非重复」: a card you hold at that level or higher is a duplicate; one
  // ABOVE your level is an upgrade and belongs on the shelf, which is the whole
  // reason the toggle compares levels rather than just card ids
  const upSeller = 'VM-XXXX-XXXX-XXXX-XXXX-XXXX'
  // one listing per card id, so it has to be a card nothing above has listed
  const onSale = new Set((await sql`select distinct card_id from card_listings`)
    .map((r: { card_id: string }) => r.card_id))
  const UPCARD = ALL_CARDS.find((c) => c.kind === 'player' && !onSale.has(c.id))!
  await account(upSeller, '升级卡', 0, { [UPCARD.id]: { id: UPCARD.id, level: 2, dupes: 0 } })
  const upLid = String((await call('/api/market/list', {
    id: upSeller, cardId: UPCARD.id, ask: Math.max(1000, askFloor(UPCARD.rarity)),
  })).id)
  const picky = 'VM-YYYY-YYYY-YYYY-YYYY-YYYY'
  const dupe = open.rows[0]
  await account(picky, '挑剔', 0, {
    [dupe.cardId]: { id: dupe.cardId, level: 0, dupes: 0 },
    [UPCARD.id]: { id: UPCARD.id, level: 1, dupes: 0 },
  } as Record<string, unknown>)
  // picky sells nothing, so its shelf is every open listing there is; exactly
  // one of them — the same card at the same level — is the duplicate it hides
  const all = Number((await sql`select count(*)::int as n from card_listings where status = 'open'`)[0].n)
  const un = await walk({ id: picky, unowned: true })
  check('只看非重复：已经有的同级卡不出现', !un.rows.some((l) => l.id === dupe.id))
  check('只看非重复：比自己强化高的还在（那是升级不是重复）', un.rows.some((l) => l.id === upLid))
  check('只看非重复：其余的一张不少', un.rows.length === all - 1, `${un.rows.length} / 应为 ${all - 1}`)

  // paging that cannot be talked into nonsense
  check('换了排序的旧游标当没给，从头来一遍',
    (await browse({ sort: 'price', cursor: first.next as string })).listings.length === PAGE)
  check('伪造的游标也一样', (await browse({ cursor: 'not-a-cursor' })).listings.length === PAGE)
  check(`一页最多 ${PAGE_MAX} 张`, (await browse({ limit: 5000 })).listings.length === PAGE_MAX)
  const every = await theirs()
  const oneAt = await walk({ limit: 1 }, every + 5)
  check('一次一张也能翻完，不重不漏',
    oneAt.rows.length === every && new Set(oneAt.rows.map((l) => l.id)).size === every,
    `${oneAt.rows.length} / 应为 ${every}`)
  check('没有账号也能逛货架', ((await call('/api/market/browse', {})) as Page).listings.length === PAGE)
}

// ---- 一个人同时最多挂三张 (2026-09-05) ------------------------------------
{
  // the owner's rule: three at once; a sale or a withdrawal frees the seat.
  // Counted at the moment of listing, so what was up before stays up.
  const S9 = 'VM-QQQQ-QQQQ-QQQQ-QQQQ-QQQQ'
  const four = ALL_CARDS.filter((c) => c.kind === 'player' && /^p:P\d{3}$/.test(c.id) && ![GOLD, BRONZE, MYTHIC].includes(c.id)).slice(-4)
  await account(S9, '挂三张', 0, Object.fromEntries(four.map((c) => [c.id, { id: c.id, dupes: 0 }])))
  check('上限是三张', MAX_LISTINGS === 3, String(MAX_LISTINGS))
  const ids: string[] = []
  for (const c of four.slice(0, 3)) {
    const r = await call('/api/market/list', { id: S9, cardId: c.id, ask: 1000 })
    check(`第 ${ids.length + 1} 张挂得上`, r.ok === true, JSON.stringify(r))
    ids.push(String(r.id))
  }
  let r = await call('/api/market/list', { id: S9, cardId: four[3].id, ask: 1000 })
  check('第 4 张被拒，回复里写着上限', r.full === true && Number(r.max) === MAX_LISTINGS, JSON.stringify(r))
  const held = (await sql`select state->'cards' as cards from card_accounts where id_hash = ${hashOf(S9)}` as unknown as { cards: Record<string, unknown> }[])[0].cards
  check('被拒的那张还在账号里', !!held[four[3].id])
  await call('/api/market/unlist', { id: S9, listing: ids[0] })
  r = await call('/api/market/list', { id: S9, cardId: four[3].id, ask: 1000 })
  check('撤回一张之后，第 4 张挂得上', r.ok === true, JSON.stringify(r))
  const open = (await sql`select count(*)::int as n from card_listings where seller_h = ${hashOf(S9)} and status = 'open'`)[0].n
  check('此刻正好三张在架上', open === 3, String(open))
}

// ---- 每一笔托管最后都有人收到 -------------------------------------------
{
  const open = await sql`
    select count(*)::int as n from card_listings where status = 'open'`
  const escrowed = await sql`
    select count(*)::int as n from card_offers where status = 'open'`
  const stranded = await sql`
    select count(*)::int as n from card_mail where taken is null`
  console.log(`\n还在货架上的挂牌 ${open[0].n} 个，托管中的出价 ${escrowed[0].n} 个，`
    + `信箱里等着领的 ${stranded[0].n} 条`)
  // every closed listing and every settled offer must have produced mail
  const closedNoMail = await sql`
    select l.id from card_listings l
    where l.status in ('sold', 'pulled', 'expired')
      and not exists (select 1 from card_mail m
        where m.kind in ('sold', 'listing_pulled', 'listing_expired', 'unsold', 'listing_retired')
          and m.to_h = l.seller_h)`
  check('每一个已结束的挂牌都给卖家留了信', closedNoMail.length === 0,
    JSON.stringify(closedNoMail.map((x: { id: string }) => String(x.id))))
  const lostOffers = await sql`
    select o.id from card_offers o
    where o.status in ('expired', 'declined', 'withdrawn', 'outbid')
      and not exists (select 1 from card_mail m
        where m.to_h = o.buyer_h and m.coins = o.price
          and m.kind in ('offer_expired', 'offer_declined', 'offer_withdrawn', 'outbid', 'overbid'))`
  check('每一笔没成的出价都把钱还了回去', lostOffers.length === 0,
    JSON.stringify(lostOffers.map((x: { id: string }) => String(x.id))))
  const wonNoCard = await sql`
    select o.id from card_offers o join card_listings l on l.id = o.listing
    where o.status = 'accepted'
      and not exists (select 1 from card_mail m where m.to_h = o.buyer_h and m.kind = 'bought' and m.card_id = l.card_id)`
  check('每一笔成交都把卡寄给了买家', wonNoCard.length === 0, JSON.stringify(wonNoCard.map((x: { id: string }) => String(x.id))))
}

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
