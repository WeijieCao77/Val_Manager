/**
 * The trading post, and the promise that nobody is left holding nothing.
 *
 *   npx tsx scripts/check_market.ts
 *
 * A market between players who are never online at the same time has one real
 * failure mode: somebody acts, the other side never comes back, and a card or
 * a pile of coins is stranded. So both sides pay in when they act and collect
 * afterwards — listing escrows the CARD, offering escrows the COINS — and every
 * outcome has to end with the escrow in somebody's inbox.
 *
 * That is what most of this file checks. The rest is the arithmetic the group
 * asked for: ±10% haggling, three days before an unanswered offer is withdrawn,
 * three ignored offers before the listing comes down.
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
  HAGGLE, IGNORE_LIMIT, MAX_LISTINGS, OFFER_DAYS, SALVAGE_FLOOR, SHELF, TRADE_PULLS, askFloor, makeMarketApi,
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
} as never)
// the inbox is collected through the card api now — the server applies it
const cardsApi = makeCardApi(sql, {
  readBody: (req: { body: string }) => Promise.resolve(req.body),
  json: (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body },
  rateLimited: () => false,
} as never)

const call = async (path: string, body: unknown) => {
  const res: Res = { code: 0, body: {} }
  const which = path.startsWith('/api/card/') ? cardsApi : api
  await which.route({ body: JSON.stringify(body), method: 'POST' } as never, res as never, path, 't')
  return res.body
}

const hashOf = (id: string) => createHash('sha256').update(id).digest('hex')
const SELLER = 'VM-SSSS-SSSS-SSSS-SSSS-SSSS'
const BUYER = 'VM-BBBB-BBBB-BBBB-BBBB-BBBB'
const OTHER = 'VM-CCCC-CCCC-CCCC-CCCC-CCCC'

// Every account here has played enough to trade unless a test says otherwise —
// the gate is checked on its own further down.
const account = (id: string, name: string, coins: number, cards: Record<string, unknown>,
  pulls = TRADE_PULLS) =>
  sql`insert into card_accounts (id_hash, name, state) values (${hashOf(id)}, ${name},
    ${JSON.stringify({ coins, cards, pulls })})`

await account(SELLER, '卖家', 100, { 'p:P1': { id: 'p:P1', level: 3, dupes: 0 } })
await account(BUYER, '买家', 5000, {})
await account(OTHER, '路人', 5000, {})

const inbox = async (id: string) =>
  ((await call('/api/card/act', { id, action: 'mail_take', args: {}, client: {} })).result as
    { mail: { kind: string; cardId: string | null; coins: number; level: number }[] }).mail

// ---- listing ------------------------------------------------------------
let r = await call('/api/market/list', { id: SELLER, cardId: 'p:P1', ask: 1000, level: 3 })
check('挂得上去（哪怕只有一张，不是重复卡）', r.ok === true, JSON.stringify(r))
const LID = String(r.id)

r = await call('/api/market/list', { id: SELLER, cardId: 'p:P9', ask: 1000 })
check('没有的卡挂不上去', r.notOwned === true, JSON.stringify(r))
r = await call('/api/market/list', { id: SELLER, cardId: 'p:P1', ask: 1000 })
check('同一张卡不能挂两次——它已经离开了账号', r.notOwned === true, JSON.stringify(r))
check('挂出的一刻，卡就不在服务器的账号里了',
  !((await sql`select state->'cards' as cards from card_accounts where id_hash = ${hashOf(SELLER)}` as unknown as { cards: Record<string, unknown> }[])[0].cards['p:P1']))
r = await call('/api/market/list', { id: SELLER, cardId: 'p:P1', ask: 5 })
check('价格有下限', r.bad === true, JSON.stringify(r))

const shelf = await call('/api/market/browse', { id: BUYER })
const one = (shelf.listings as { id: string; ask: number; seller: string; cardId: string }[])[0]
check('买家看得到这张挂牌', one?.id === LID && one.ask === 1000, JSON.stringify(one))
check('卖家名字带出来，而且是过滤过的', /卖家 #/.test(one?.seller ?? ''), one?.seller)
check('公示还价范围', shelf.haggle === HAGGLE, String(shelf.haggle))

// ---- haggling, ±10% -----------------------------------------------------
r = await call('/api/market/offer', { id: BUYER, listing: LID, price: 800 })
check('低于 −10% 的报价被拒', r.range === true && r.lo === 900, JSON.stringify(r))
r = await call('/api/market/offer', { id: BUYER, listing: LID, price: 1200 })
check('高于 +10% 的报价也被拒', r.range === true && r.hi === 1100, JSON.stringify(r))
r = await call('/api/market/offer', { id: SELLER, listing: LID, price: 1000 })
check('不能给自己的挂牌出价', r.self === true, JSON.stringify(r))
r = await call('/api/market/offer', { id: BUYER, listing: LID, price: 900 })
check('刚好 −10% 可以', r.ok === true, JSON.stringify(r))
check('出价的一刻，金币就从服务器的账号里扣走了',
  Number((await sql`select state->>'coins' as coins from card_accounts where id_hash = ${hashOf(BUYER)}` as unknown as { coins: string }[])[0].coins) === 5000 - 900)
r = await call('/api/market/offer', { id: BUYER, listing: LID, price: 950 })
check('同一个人不能在一张牌上挂两个报价', r.already === true, JSON.stringify(r))

// the seller is told
const sm = await inbox(SELLER)
check('卖家收到「有人出价」的通知', sm.some((m) => m.kind === 'offer_made'),
  JSON.stringify(sm.map((m) => m.kind)))

// ---- a second bidder, then a sale --------------------------------------
r = await call('/api/market/offer', { id: OTHER, listing: LID, price: 1050 })
check('第二个人也能出价', r.ok === true, JSON.stringify(r))

const mine = await call('/api/market/offers', { id: SELLER })
const inb = mine.inbound as { id: string; price: number; who: string }[]
check('卖家看得到两个报价，价高的在前', inb.length === 2 && inb[0].price === 1050,
  JSON.stringify(inb.map((x) => x.price)))

r = await call('/api/market/answer', { id: SELLER, offer: inb[0].id, accept: true })
check('成交', r.ok === true && r.price === 1050, JSON.stringify(r))

const bm = await inbox(OTHER)
const gotCard = bm.find((m) => m.kind === 'bought')
check('买到的人收到卡，强化等级一起带过来', gotCard?.cardId === 'p:P1' && gotCard.level === 3,
  JSON.stringify(gotCard))
const sm2 = await inbox(SELLER)
check('卖家收到钱', sm2.some((m) => m.kind === 'sold' && m.coins === 1050),
  JSON.stringify(sm2.map((m) => [m.kind, m.coins])))
const bm2 = await inbox(BUYER)
check('没抢到的人，钱原路退回', bm2.some((m) => m.kind === 'outbid' && m.coins === 900),
  JSON.stringify(bm2.map((m) => [m.kind, m.coins])))

const after = await call('/api/market/browse', { id: BUYER })
check('卖掉之后就从货架上消失了', (after.listings as unknown[]).length === 0)

// ---- 三天没回复，报价自动撤回 -------------------------------------------
{
  await account('VM-DDDD-DDDD-DDDD-DDDD-DDDD', '卖二', 0, { 'p:P2': { id: 'p:P2', dupes: 0 } })
  const S2 = 'VM-DDDD-DDDD-DDDD-DDDD-DDDD'
  const l2 = String((await call('/api/market/list', { id: S2, cardId: 'p:P2', ask: 1000 })).id)
  await call('/api/market/offer', { id: BUYER, listing: l2, price: 1000 })
  await inbox(BUYER); await inbox(S2)
  // the clock, moved by hand
  await sql`update card_offers set made = now() - make_interval(days => ${OFFER_DAYS + 1})
            where status = 'open'`
  const seen = await call('/api/market/browse', { id: BUYER })   // any read sweeps
  void seen
  const back = await inbox(BUYER)
  check(`${OFFER_DAYS} 天没人理，报价自动撤回，金币退回`,
    back.some((m) => m.kind === 'offer_expired' && m.coins === 1000),
    JSON.stringify(back.map((m) => [m.kind, m.coins])))
  const still = await sql`select ignored, status from card_listings where id = ${l2}::bigint`
  check('这次算卖家一次「没反馈」', still[0].ignored === 1 && still[0].status === 'open',
    JSON.stringify(still[0]))

  // three in a row and it comes off the shelf
  for (let i = 0; i < IGNORE_LIMIT; i++) {
    await call('/api/market/offer', { id: BUYER, listing: l2, price: 1000 })
    await sql`update card_offers set made = now() - make_interval(days => ${OFFER_DAYS + 1})
              where status = 'open'`
    await call('/api/market/browse', { id: BUYER })
  }
  const gone = await sql`select status from card_listings where id = ${l2}::bigint`
  check(`连续 ${IGNORE_LIMIT} 次没反馈，挂牌自动下架`, gone[0].status === 'expired', gone[0].status)
  const home = await inbox(S2)
  check('下架之后卡回到卖家手里',
    home.some((m) => m.kind === 'listing_expired' && m.cardId === 'p:P2'),
    JSON.stringify(home.map((m) => [m.kind, m.cardId])))
  const refund = await inbox(BUYER)
  check('那几次报价的钱也都退了',
    refund.filter((m) => m.kind === 'offer_expired').length >= 1,
    JSON.stringify(refund.map((m) => [m.kind, m.coins])))
}

// ---- 拒绝报价，不算「没反馈」 -------------------------------------------
{
  const S3 = 'VM-EEEE-EEEE-EEEE-EEEE-EEEE'
  await account(S3, '卖三', 0, { 'p:P3': { id: 'p:P3', dupes: 0 } })
  const l3 = String((await call('/api/market/list', { id: S3, cardId: 'p:P3', ask: 1000 })).id)
  await call('/api/market/offer', { id: BUYER, listing: l3, price: 1000 })
  const q = await call('/api/market/offers', { id: S3 })
  const oid = (q.inbound as { id: string }[])[0].id
  const d = await call('/api/market/answer', { id: S3, offer: oid, accept: false })
  check('可以拒绝报价', d.declined === true, JSON.stringify(d))
  const st = await sql`select ignored, status from card_listings where id = ${l3}::bigint`
  check('拒绝也是一种回复，不计入「没反馈」', st[0].ignored === 0 && st[0].status === 'open',
    JSON.stringify(st[0]))
  const rb = await inbox(BUYER)
  check('被拒之后钱退回来', rb.some((m) => m.kind === 'offer_declined' && m.coins === 1000),
    JSON.stringify(rb.map((m) => [m.kind, m.coins])))
}

// ---- 自己撤回挂牌 --------------------------------------------------------
{
  const S4 = 'VM-FFFF-FFFF-FFFF-FFFF-FFFF'
  await account(S4, '卖四', 0, { 'p:P4': { id: 'p:P4', dupes: 0, level: 5 } })
  const l4 = String((await call('/api/market/list', { id: S4, cardId: 'p:P4', ask: 2000, level: 5 })).id)
  await call('/api/market/offer', { id: BUYER, listing: l4, price: 2000 })
  await inbox(BUYER)
  const u = await call('/api/market/unlist', { id: S4, listing: l4 })
  check('可以自己撤回挂牌', u.ok === true && u.refunded === 1, JSON.stringify(u))
  const home = await inbox(S4)
  check('撤回后卡回来，等级也在',
    home.some((m) => m.kind === 'listing_pulled' && m.cardId === 'p:P4' && m.level === 5),
    JSON.stringify(home))
  const rb = await inbox(BUYER)
  check('挂在上面的报价，钱也退了', rb.some((m) => m.kind === 'offer_expired' && m.coins === 2000))
  const nope = await call('/api/market/unlist', { id: BUYER, listing: l4 })
  check('别人撤不了你的挂牌', nope.gone === true, JSON.stringify(nope))
}

// ---- 买家自己撤回报价 ----------------------------------------------------
// 「如果卖家一直不同意报价钱就卡在那了」——三天的钟对一个不再上线的卖家太长。
{
  const S7 = 'VM-WWWW-WWWW-WWWW-WWWW-WWWW'
  await account(S7, '卖七', 0, { 'p:P7': { id: 'p:P7', dupes: 0 } })
  const l7 = String((await call('/api/market/list', { id: S7, cardId: 'p:P7', ask: 1000 })).id)
  const coinsOf = async (id: string) => (await sql`select (state->>'coins')::int as coins
    from card_accounts where id_hash = ${hashOf(id)}`)[0].coins as number
  await inbox(BUYER)
  const before = await coinsOf(BUYER)
  await call('/api/market/offer', { id: BUYER, listing: l7, price: 1000 })
  check('出价后金币先被托管', await coinsOf(BUYER) === before - 1000)
  const q = await call('/api/market/offers', { id: BUYER })
  const mine = (q.outbound as { id: string; price: number }[]).find((o) => o.price === 1000)!
  const nope = await call('/api/market/withdraw', { id: OTHER, offer: mine.id })
  check('别人撤不了你的报价', nope.gone === true, JSON.stringify(nope))
  const w = await call('/api/market/withdraw', { id: BUYER, offer: mine.id })
  check('买家可以自己撤回报价', w.ok === true && w.coins === 1000, JSON.stringify(w))
  const again = await call('/api/market/withdraw', { id: BUYER, offer: mine.id })
  check('同一个报价撤不了第二次', again.gone === true, JSON.stringify(again))
  const rb = await inbox(BUYER)
  check('撤回的金币回到信箱', rb.some((m) => m.kind === 'offer_withdrawn' && m.coins === 1000),
    JSON.stringify(rb.map((m) => [m.kind, m.coins])))
  check('领了之后金币到账', await coinsOf(BUYER) === before, `${await coinsOf(BUYER)} vs ${before}`)
  const st = await sql`select ignored, status from card_listings where id = ${l7}::bigint`
  check('挂牌还在，也不算卖家「没反馈」', st[0].status === 'open' && st[0].ignored === 0, JSON.stringify(st[0]))
  const sq = await call('/api/market/offers', { id: S7 })
  check('卖家那边这个报价消失了', !(sq.inbound as { id: string }[]).some((o) => o.id === mine.id))
  const acc = await call('/api/market/answer', { id: S7, offer: mine.id, accept: true })
  check('卖家再想接受也接受不了', acc.gone === true, JSON.stringify(acc))
  const shelf = await call('/api/market/browse', { id: BUYER })
  const row = (shelf.listings as { id: string; bid: boolean; offers: number }[]).find((l) => l.id === l7)!
  check('货架上不再标「已出价」', row.bid === false && row.offers === 0, JSON.stringify(row))
  const re = await call('/api/market/offer', { id: BUYER, listing: l7, price: 950 })
  check('撤回之后可以再出一次', re.ok === true, JSON.stringify(re))
  const bad = await call('/api/market/withdraw', { id: BUYER, offer: 'abc' })
  check('乱写的报价编号回 400', bad.bad === true, JSON.stringify(bad))
}

// ---- 没钱不能出价 --------------------------------------------------------
{
  const S5 = 'VM-GGGG-GGGG-GGGG-GGGG-GGGG'
  await account(S5, '卖五', 0, { 'p:P5': { id: 'p:P5', dupes: 0 } })
  const l5 = String((await call('/api/market/list', { id: S5, cardId: 'p:P5', ask: 100000 })).id)
  const poor = await call('/api/market/offer', { id: BUYER, listing: l5, price: 100000 })
  check('金币不够就出不了价', poor.broke === true, JSON.stringify(poor))
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

  const anyOpen = (shelfNow.listings as { id: string }[])[0]
  x = await call('/api/market/offer', { id: NEW, listing: anyOpen.id, price: 60 })
  check('新号也出不了价', x.newbie === true, JSON.stringify(x))

  // open enough packs and the door opens
  await sql`update card_accounts set state = jsonb_set(state, '{pulls}', ${String(TRADE_PULLS)}::jsonb)
            where id_hash = ${hashOf(NEW)}`
  x = await call('/api/market/list', { id: NEW, cardId: GOLD, ask: 700, rarity: 'gold' })
  check(`开够 ${TRADE_PULLS} 抽就能挂了`, x.ok === true, JSON.stringify(x))
  const g2 = await call('/api/market/browse', { id: NEW })
  check('到门槛之后就不再提示了', g2.gate === null, JSON.stringify(g2.gate))
}

// ---- 下架那一刻还挂着的报价，钱也要退 ----------------------------------------
{
  // Three ignored offers take a listing down. If a FOURTH, fresh offer is
  // sitting on it at that moment — somebody bid the day before the shelf gave
  // up — the listing's death used to mark that offer expired without mailing
  // the coins home. 「出价的金币被卡了」, from the group, 2026-09-03.
  const S6 = 'VM-AAAA-AAAA-AAAA-AAAA-AAAA'
  await account(S6, '卖六', 0, { 'p:P6': { id: 'p:P6', dupes: 0 } })
  const l6 = String((await call('/api/market/list', { id: S6, cardId: 'p:P6', ask: 1000 })).id)
  const before = (await sql`select (state->>'coins')::int as coins from card_accounts
    where id_hash = ${hashOf(OTHER)}`)[0].coins as number
  for (let i = 0; i < IGNORE_LIMIT; i++) {
    await call('/api/market/offer', { id: BUYER, listing: l6, price: 1000 })
    if (i === IGNORE_LIMIT - 1) {
      // the fresh bid, made before the last ignored one is swept
      const fresh = await call('/api/market/offer', { id: OTHER, listing: l6, price: 950 })
      check('路人的新报价挂上去了', fresh.ok === true, JSON.stringify(fresh))
    }
    await sql`update card_offers set made = now() - make_interval(days => ${OFFER_DAYS + 1})
              where status = 'open' and buyer_h = ${hashOf(BUYER)}`
    await call('/api/market/browse', { id: BUYER })
  }
  const dead = await sql`select status from card_listings where id = ${l6}::bigint`
  check('第三次没反馈，挂牌下架了', dead[0].status === 'expired', dead[0].status)
  const left = await sql`select status from card_offers
    where listing = ${l6}::bigint and buyer_h = ${hashOf(OTHER)}`
  check('路人的报价随之结束', left[0]?.status === 'expired', JSON.stringify(left))
  const back = await inbox(OTHER)
  check('下架时还挂着的报价，钱退回了路人',
    back.some((m) => m.kind === 'offer_expired' && m.coins === 950),
    JSON.stringify(back.map((m) => [m.kind, m.coins])))
  const after = (await sql`select (state->>'coins')::int as coins from card_accounts
    where id_hash = ${hashOf(OTHER)}`)[0].coins as number
  check('领完信箱，路人的金币一分不少', after === before, `${before} -> ${after}`)
}

// ---- 自己挂的牌永远看得见，哪怕货架上后来又多了几百张 ------------------------
{
  // 「我挂了一张金卡消失了，也没有别人报价」(2026-09-03)：货架只取最新的
  // 120 张，「我挂的牌」又是从同一份货架里筛出来的，所以别人一多挂，自己的
  // 老牌就从自己页面上消失了，也从所有买家眼前消失了——卡还在托管里。
  const S7 = 'VM-KKKK-KKKK-KKKK-KKKK-KKKK'
  await account(S7, '老牌', 0, { [GOLD]: { id: GOLD, dupes: 0 } })
  const old = String((await call('/api/market/list', { id: S7, cardId: GOLD, ask: 2000 })).id)
  // one listing per card id and MAX_LISTINGS per seller, so the flood is
  // many sellers with a few distinct cards each
  const used = new Set([GOLD, BRONZE, MYTHIC])
  const stock = ALL_CARDS.filter((c) => c.kind === 'player' && !used.has(c.id) && /^p:P\d{2,}$/.test(c.id)).slice(0, SHELF + 5)
  let listed = 0
  for (let i = 0; i < stock.length; i += MAX_LISTINGS) {
    const cards = stock.slice(i, i + MAX_LISTINGS)
    const flood = `VM-MMMM-MMMM-MMMM-MMMM-M${String(i / MAX_LISTINGS).padStart(3, '0')}`
    await account(flood, `刷屏${i}`, 0, Object.fromEntries(cards.map((c) => [c.id, { id: c.id, dupes: 0 }])))
    for (const c of cards) {
      const r = await call('/api/market/list', { id: flood, cardId: c.id, ask: 1000 })
      if (r.ok) listed++
    }
  }
  check(`货架被灌了 ${listed} 张新牌`, listed === stock.length, `${listed}/${stock.length}`)
  const seen = await call('/api/market/browse', { id: S7 })
  const rows = seen.listings as { id: string; mine: boolean }[]
  check('自己那张老牌还在自己眼前，标着 mine', rows.some((l) => l.id === old && l.mine), `${rows.length} 张里没有`)
  check(`别人的只取最新 ${SHELF} 张`, rows.filter((l) => !l.mine).length === SHELF, String(rows.filter((l) => !l.mine).length))
  check('回复里说了货架上一共有多少张', Number(seen.total) >= stock.length + 1, String(seen.total))
  const other = await call('/api/market/browse', { id: BUYER })
  check('买家看不到被挤出窗口的老牌（这是下一步要做的分页，先把事实写下来）',
    !(other.listings as { id: string }[]).some((l) => l.id === old))
}

// ---- 每一笔托管最后都有人收到 -------------------------------------------
{
  const open = await sql`
    select count(*)::int as n from card_listings where status = 'open'`
  const escrowed = await sql`
    select count(*)::int as n from card_offers where status = 'open'`
  const stranded = await sql`
    select count(*)::int as n from card_mail where taken is null`
  console.log(`\n还在货架上的挂牌 ${open[0].n} 个，托管中的报价 ${escrowed[0].n} 个，`
    + `信箱里等着领的 ${stranded[0].n} 条`)
  // every closed listing and every settled offer must have produced mail
  const closedNoMail = await sql`
    select l.id from card_listings l
    where l.status in ('sold', 'pulled', 'expired')
      and not exists (select 1 from card_mail m
        where m.kind in ('sold', 'listing_pulled', 'listing_expired')
          and m.to_h = l.seller_h)`
  check('每一个已结束的挂牌都给卖家留了信', closedNoMail.length === 0,
    JSON.stringify(closedNoMail.map((x: { id: string }) => String(x.id))))
  const lostOffers = await sql`
    select o.id from card_offers o
    where o.status in ('expired', 'declined', 'withdrawn')
      and not exists (select 1 from card_mail m
        where m.to_h = o.buyer_h and m.coins = o.price)`
  check('每一笔失败的报价都把钱还了回去', lostOffers.length === 0,
    JSON.stringify(lostOffers.map((x: { id: string }) => String(x.id))))
}

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
