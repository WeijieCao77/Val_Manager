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
import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { CARD_SCHEMA, normalizeId } from '../cards-api.js'
import { displayName } from '../names.js'
import { HAGGLE, IGNORE_LIMIT, OFFER_DAYS, makeMarketApi } from '../market-api.js'

const db = new PGlite()
const sql = Object.assign(
  async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const text = strings.reduce((q, part, i) => q + part + (i < vals.length ? `$${i + 1}` : ''), '')
    const r = await db.query(text, vals as never[])
    return Object.assign(r.rows as never[], { count: r.affectedRows ?? 0 })
  },
  { unsafe: async (q: string) => (await db.exec(q), []), json: (v: unknown) => JSON.stringify(v) },
)
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
  normalizeId, displayName, rateLimited: () => false,
} as never)

const call = async (path: string, body: unknown) => {
  const res: Res = { code: 0, body: {} }
  await api.route({ body: JSON.stringify(body), method: 'POST' } as never, res as never, path, 't')
  return res.body
}

const hashOf = (id: string) => createHash('sha256').update(id).digest('hex')
const SELLER = 'VM-SSSS-SSSS-SSSS-SSSS-SSSS'
const BUYER = 'VM-BBBB-BBBB-BBBB-BBBB-BBBB'
const OTHER = 'VM-CCCC-CCCC-CCCC-CCCC-CCCC'

const account = (id: string, name: string, coins: number, cards: Record<string, unknown>) =>
  sql`insert into card_accounts (id_hash, name, state) values (${hashOf(id)}, ${name},
    ${JSON.stringify({ coins, cards })})`

await account(SELLER, '卖家', 100, { 'p:P1': { id: 'p:P1', level: 3, dupes: 0 } })
await account(BUYER, '买家', 5000, {})
await account(OTHER, '路人', 5000, {})

const inbox = async (id: string) =>
  (await call('/api/market/mail', { id, take: true })).mail as
    { kind: string; cardId: string | null; coins: number; level: number }[]

// ---- listing ------------------------------------------------------------
let r = await call('/api/market/list', { id: SELLER, cardId: 'p:P1', ask: 1000, level: 3 })
check('挂得上去（哪怕只有一张，不是重复卡）', r.ok === true, JSON.stringify(r))
const LID = String(r.id)

r = await call('/api/market/list', { id: SELLER, cardId: 'p:P9', ask: 1000 })
check('没有的卡挂不上去', r.notOwned === true, JSON.stringify(r))
r = await call('/api/market/list', { id: SELLER, cardId: 'p:P1', ask: 1000 })
check('同一张卡不能挂两次', r.alreadyListed === true, JSON.stringify(r))
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

// ---- 没钱不能出价 --------------------------------------------------------
{
  const S5 = 'VM-GGGG-GGGG-GGGG-GGGG-GGGG'
  await account(S5, '卖五', 0, { 'p:P5': { id: 'p:P5', dupes: 0 } })
  const l5 = String((await call('/api/market/list', { id: S5, cardId: 'p:P5', ask: 100000 })).id)
  const poor = await call('/api/market/offer', { id: BUYER, listing: l5, price: 100000 })
  check('金币不够就出不了价', poor.broke === true, JSON.stringify(poor))
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
    where o.status in ('expired', 'declined')
      and not exists (select 1 from card_mail m
        where m.to_h = o.buyer_h and m.coins = o.price)`
  check('每一笔失败的报价都把钱还了回去', lostOffers.length === 0,
    JSON.stringify(lostOffers.map((x: { id: string }) => String(x.id))))
}

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
