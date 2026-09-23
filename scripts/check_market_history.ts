/**
 * 成交记录 (2026-09-23): what a card has sold for, and how many hands the copy
 * on a listing has been through — /api/market/history in market-api.js.
 *
 *   npx tsx scripts/check_market_history.ts
 *
 * The owner asked whether a card's hands and its average price could be seen.
 * Sales are written straight into the tables here (a listing marked sold and
 * its accepted bid is what every settle path leaves behind), then read back.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { ALL_CARDS } from '../src/engine/cards'

const { CARD_SCHEMA, normalizeId } = await import('../cards-api.js')
const { displayName } = await import('../names.js')
const { makeMarketApi } = await import('../market-api.js')
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
  normalizeId, displayName, rateLimited: () => false, engine, timer: false,
} as never)
const call = async (body: unknown) => {
  const res: Res = { code: 0, body: {} }
  await api.route({ body: JSON.stringify(body), method: 'POST', headers: {} } as never, res as never, '/api/market/history', 't')
  return res.body as Record<string, any>
}

const X = ALL_CARDS.find((c) => c.rarity === 'gold' && c.kind === 'player')!.id
const Y = ALL_CARDS.find((c) => c.rarity === 'silver' && c.kind === 'player')!.id

/** a finished sale: seller → buyer at price, `daysAgo` */
async function sale(card: string, seller: string, buyer: string, price: number, daysAgo: number, level = 0) {
  const [l] = await sql`insert into card_listings (seller_h, card_id, level, ask, status, created, closed, ends)
    values (${seller}, ${card}, ${level}, ${price}, 'sold',
            now() - make_interval(days => ${daysAgo}, hours => 2), now() - make_interval(days => ${daysAgo}),
            now() - make_interval(days => ${daysAgo})) returning id`
  await sql`insert into card_offers (listing, buyer_h, price, status, made, settled)
    values (${l.id}, ${buyer}, ${price}, 'accepted', now() - make_interval(days => ${daysAgo}), now() - make_interval(days => ${daysAgo}))`
  // a losing bid on the same listing must not count
  await sql`insert into card_offers (listing, buyer_h, price, status) values (${l.id}, 'z', ${Math.round(price / 2)}, 'outbid')`
}

// the copy's road: a (pack) → b → c, and c has it on the shelf now
await sale(X, 'a', 'b', 500, 20)
await sale(X, 'b', 'c', 800, 10)
// another copy, raised to +2, sold between strangers this week
await sale(X, 'd', 'e', 1400, 2, 2)
// a different card entirely
await sale(Y, 'a', 'e', 90, 1)
// an unsold one of X is not a sale
await sql`insert into card_listings (seller_h, card_id, level, ask, status, created, closed) values ('q', ${X}, 0, 9999, 'expired', now(), now())`
const [open] = await sql`insert into card_listings (seller_h, card_id, level, ask, status, created, ends)
  values ('c', ${X}, 0, 900, 'open', now(), now() + interval '1 day') returning id`

let r = await call({ cardId: X, level: 0, listing: String(open.id) })
check('读得到', r.ok === true, JSON.stringify(r).slice(0, 200))
check('只数成交的，不数流拍、不数别的卡', r.sold === 3, `${r.sold}`)
check('均价是成交价的平均', r.avg === Math.round((500 + 800 + 1400) / 3), `${r.avg}`)
check('中位数', r.median === 800, `${r.median}`)
check('近 7 天只有一笔', r.week?.sold === 1 && r.week?.avg === 1400, JSON.stringify(r.week))
check('同等级（+0）均价', r.level?.sold === 2 && r.level?.avg === 650, JSON.stringify(r.level))
check('最近的排在前面', r.recent?.[0]?.price === 1400 && r.recent?.length === 3, JSON.stringify(r.recent?.map((x: any) => x.price)))
check('货架上这张是第 3 手（a 开出 → b → c）', r.hands?.count === 3, JSON.stringify(r.hands))
check('上一手 800，再上一手 500', r.hands?.trail?.[0]?.price === 800 && r.hands?.trail?.[1]?.price === 500)
check('不暴露买卖双方是谁', !JSON.stringify(r).includes('"b"') && !('seller_h' in (r.recent?.[0] ?? {})))

// a copy that has never changed hands
const [fresh] = await sql`insert into card_listings (seller_h, card_id, level, ask, status, created, ends)
  values ('d', ${X}, 0, 900, 'open', now(), now() + interval '1 day') returning id`
r = await call({ cardId: X, listing: String(fresh.id) })
check('自己开出来的是第 1 手', r.hands?.count === 1 && r.hands?.trail?.length === 0, JSON.stringify(r.hands))

// the listing must be of the card asked about
r = await call({ cardId: Y, listing: String(open.id) })
check('挂牌和卡对不上就不给手数', r.hands === null && r.sold === 1, JSON.stringify(r.hands))

// a buy that happened AFTER the listing went up is not where this copy came from
await sale(X, 'q', 'c', 300, 0)
r = await call({ cardId: X, listing: String(open.id) })
check('挂牌之后才买的那张不算这张的来路', r.hands?.count === 3, JSON.stringify(r.hands))

r = await call({ cardId: 'nope' })
check('不存在的卡直接拒绝', r.ok === false)
r = await call({ cardId: ALL_CARDS[ALL_CARDS.length - 1].id })
check('没成交过的卡：0 次，均价为空', r.ok === true && r.sold === 0 && r.avg === null, JSON.stringify(r))

console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
