/**
 * The shelf off the listing summaries: the same shelf, read off indexes.
 *
 *   npx tsx scripts/check_market_shelf.ts [listings=15000]
 *
 * 2026-09-18. The shelf query aggregated every offer of every open listing
 * and sorted the lot to return sixty rows. It now reads cur_price / top_bid /
 * open_n / bid_n off the listing — written in the bid's own transaction — and
 * each order walks an index. This builds a market the size the review
 * measured (15,000 listings, five offers each), and checks: both queries page
 * through exactly the same listings with the same numbers on them; the new
 * one's plans use the indexes and never touch card_offers; the summaries are
 * backfilled, verified, repaired when wrong, and the switch is off until then.
 * Timings are printed for THIS machine's in-process database and mean nothing
 * about production.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'

const { CARD_SCHEMA, normalizeId } = await import('../cards-api.js')
const { displayName } = await import('../names.js')
const { makeMarketApi } = await import('../market-api.js')
const engine = await import('../src/engine/server.ts')

const N = Number(process.argv[2] ?? 15000)
let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const db = new PGlite(), sql = makeSql(db)
await db.exec(CARD_SCHEMA)
const hashOf = (id: string) => createHash('sha256').update(id).digest('hex')
interface Res { code: number; body: Record<string, any> }
const make = (useSummary: boolean) => makeMarketApi(sql, {
  readBody: (req: { body: string }) => Promise.resolve(req.body),
  json: (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body },
  normalizeId, displayName, rateLimited: () => false, engine, timer: false, useSummary,
} as never)
const fast = make(true), slow = make(false)
const call = async (api: ReturnType<typeof make>, path: string, body: unknown) => {
  const res: Res = { code: 0, body: {} }
  await api.route({ body: JSON.stringify(body), method: 'POST', headers: {} } as never, res as never, path, 't')
  return res.body
}

// ---- a market: N auctions over the real card ids, five offers on most, legacy listings too
// (Crockford letters only: an L or an O in an id is read as a 1 or a 0, and the hash with it)
const ME = 'VM-TEST-0000-0000-0000-0001'
const cards = engine.ALL_CARDS.map((c: { id: string }) => c.id)
await sql`insert into card_accounts (id_hash, name, state, created, verified) values
  (${hashOf(ME)}, '看货架的', ${JSON.stringify({ coins: 9, cards: { [cards[0]]: { id: cards[0], level: 1, dupes: 0 } }, pulls: 99 })}, now() - interval '9 days', now())`
await sql`insert into card_accounts (id_hash, name, state, created)
  select 'seller' || g, '卖家' || g, '{}'::jsonb, now() - interval '9 days' from generate_series(1, 400) g`
await db.query(`
  insert into card_listings (seller_h, card_id, level, ask, ends, buyout, hours, created)
  select 'seller' || (1 + g % 400), ($1::text[])[1 + g % $2], g % 4, (100 + (g::bigint * 7919) % 5000)::int,
         now() + make_interval(mins => (5 + (g::bigint * 104729) % 1400)::int), case when g % 9 = 0 then 9000 else null end, 24,
         now() - make_interval(secs => ((g::bigint * 15485863) % 80000)::int)
    from generate_series(1, $3) g`, [cards, cards.length, N])
// 40 listings from before the auctions (no end), and 300 whose time is up but are not settled yet
await sql`insert into card_listings (seller_h, card_id, level, ask, created) select 'seller' || g, ${cards[1]}, 0, 400 + g, now() - interval '5 days' from generate_series(1, 40) g`
await sql`insert into card_listings (seller_h, card_id, level, ask, ends, hours) select 'seller' || g, ${cards[2]}, 0, 300, now() - interval '1 minute', 24 from generate_series(1, 300) g`
// offers: four beaten and one standing on four listings in five; ME leads a few
await sql`insert into card_offers (listing, buyer_h, price, status, made)
  select l.id, 'bidder' || k, l.ask + k * 60, case when k = 5 then 'open' else 'outbid' end, now() - make_interval(mins => 60 - k)
    from card_listings l, generate_series(1, 5) k where l.id % 5 <> 0 and l.ends > now()`
await sql`update card_offers set buyer_h = ${hashOf(ME)} where status = 'open' and listing % 97 = 1`
await sql`insert into card_offers (listing, buyer_h, price) select id, 'bidder1', ask from card_listings where ends is null and id % 2 = 0`
const open = (await sql`select count(*)::int as n from card_listings where status = 'open' and (ends is null or ends > now())`)[0].n
console.log(`${open} open listings, ${(await sql`select count(*)::int as n from card_offers`)[0].n} offers`)

// ---- the switch is off until the summaries are there and agree
check('回填之前：开关是关的，货架走旧查询', fast.summaryLive() === false)
const pre = await call(fast, '/api/market/browse', { id: ME })
check('旧查询照常回答', pre.ok === true && pre.listings.length === 60 && pre.total === open, `total ${pre.total}`)
const t0 = Date.now()
await fast.settleDue({ chores: true, budgetMs: 60_000 })
check('首轮回填有界，未全部完成时保留旧读路径', !fast.summaryLive())
for (let tick = 0; tick < 400 && !fast.summaryLive(); tick++) await fast.settleDue({ chores: true })
console.log(`backfill + verify + settling 300: ${Date.now() - t0} ms`)
check('回填、核对之后开关打开', fast.summaryLive() === true)
const holes = (await sql`select count(*)::int as n from card_listings where status = 'open' and cur_price is null`)[0].n
check('没有一张开着的挂牌缺摘要', holes === 0, String(holes))

// ---- both queries: the same shelf
const walk = async (api: ReturnType<typeof make>, body: Record<string, unknown>) => {
  const out: any[] = []
  let cursor: string | undefined
  let pages = 0
  const t = Date.now()
  do {
    const p = await call(api, '/api/market/browse', { id: ME, ...body, ...(cursor ? { cursor } : {}) })
    out.push(...p.listings)
    cursor = p.next ?? undefined
    pages++
  } while (cursor && pages < 1000)
  return { rows: out, ms: Date.now() - t, pages }
}
const facts = (l: any) => `${l.id}|${l.best}|${l.bids}|${l.offers}|${l.bid}|${l.min}|${l.ends}`
const cases: [string, Record<string, unknown>][] = [
  ['即将结束', { sort: 'ends' }], ['最新上架', { sort: 'new' }], ['价格升序', { sort: 'price' }], ['价格降序', { sort: 'price_desc' }],
  ['价格区间 500–900', { sort: 'price', priceMin: 500, priceMax: 900 }], ['只看金卡', { sort: 'ends', rarity: 'gold' }],
  ['只看非重复', { sort: 'new', unowned: true }],
]
for (const [name, body] of cases) {
  const a = await walk(fast, body), b = await walk(slow, body)
  const ida = a.rows.map((l) => l.id), idb = b.rows.map((l) => l.id)
  const same = new Set(ida).size === ida.length && ida.length === idb.length && new Set([...ida, ...idb]).size === ida.length
  const factsSame = [...a.rows].map(facts).sort().join('\n') === [...b.rows].map(facts).sort().join('\n')
  // the order: identical, except that equal prices may run either way in the descending order
  const key = (l: any) => (body.sort === 'price' || body.sort === 'price_desc') ? (l.best ?? l.ask) : body.sort === 'new' ? 0 : (l.ends ?? Infinity)
  const ordered = body.sort === 'price_desc'
    ? a.rows.every((l, i) => i === 0 || key(a.rows[i - 1]) >= key(l))
    : body.sort === 'new' ? ida.join() === idb.join()
      : a.rows.every((l, i) => i === 0 || key(a.rows[i - 1]) <= key(l)) && (body.sort !== 'ends' || ida.join() === idb.join())
  check(`${name}：两种查询翻到底是同一批牌、同样的数字、同样的次序`, same && factsSame && ordered,
    `${ida.length} 张 / ${a.pages} 页；新 ${a.ms} ms，旧 ${b.ms} ms`)
}
const f1 = await call(fast, '/api/market/browse', { id: ME }), s1 = await call(slow, '/api/market/browse', { id: ME })
slow.forgetMenus(); fast.forgetMenus()
check('全站张数和筛选菜单的料两边一致', f1.total === s1.total
  && JSON.stringify([...f1.pool].sort()) === JSON.stringify([...s1.pool].sort()), `total ${f1.total}`)
check('「你领先」两边一致', f1.listings.filter((l: any) => l.bid).length === s1.listings.filter((l: any) => l.bid).length)

// ---- the plans
const plan = async (q: string) => (await db.query<{ 'QUERY PLAN': string }>(`explain ${q}`)).rows.map((r) => r['QUERY PLAN']).join('\n')
await db.exec('analyze card_listings; analyze card_offers;')
const base = `from card_listings l where l.status = 'open' and l.ends > now() and l.seller_h <> 'x'`
const pEnds = await plan(`select l.id ${base} and (l.ends, l.id) > (now() + interval '3 hours', 5000) order by l.ends, l.id limit 60`)
const pNew = await plan(`select l.id from card_listings l where l.status = 'open' and (l.ends is null or l.ends > now()) and l.seller_h <> 'x' and (l.created < now() - interval '3 hours' or (l.created = now() and l.id > 5)) order by l.created desc, l.id limit 60`)
const pPrice = await plan(`select l.id from card_listings l where l.status = 'open' and (l.ends is null or l.ends > now()) and l.seller_h <> 'x' and (l.cur_price, l.id) > (2500, 5000) order by l.cur_price, l.id limit 60`)
const pDesc = await plan(`select l.id from card_listings l where l.status = 'open' and (l.ends is null or l.ends > now()) and l.seller_h <> 'x' and (l.cur_price, l.id) < (2500, 5000) order by l.cur_price desc, l.id desc limit 60`)
check('即将结束（深翻页）：走 (ends, id) 索引，不排序', /listing_shelf_ends_idx/.test(pEnds) && !/Sort/.test(pEnds), pEnds.split('\n')[1]?.trim())
check('最新上架：走 (created desc, id) 索引，不排序', /listing_shelf_new_idx/.test(pNew) && !/Sort/.test(pNew), pNew.split('\n')[1]?.trim())
check('价格升序（深翻页）：走 (cur_price, id) 索引，不排序', /listing_shelf_price_idx/.test(pPrice) && !/Sort/.test(pPrice), pPrice.split('\n')[1]?.trim())
check('价格降序：同一个索引倒着走，不排序', /Backward.*listing_shelf_price_idx/.test(pDesc) && !/Sort/.test(pDesc), pDesc.split('\n')[1]?.trim())
check('四个计划都不碰 card_offers', ![pEnds, pNew, pPrice, pDesc].some((p) => /card_offers/.test(p)))

// ---- a summary that is wrong is found, repaired, and said
await sql`update card_listings set cur_price = 1, top_bid = 1, top_buyer_h = 'wrong' where id = (select min(id) from card_listings where status = 'open' and ends > now())`
await fast.settleDue({ chores: true })
const fixed = (await sql`
  select l.cur_price, (select max(price) from card_offers f where f.listing = l.id and f.status = 'open') as best, l.ask
    from card_listings l where id = (select min(id) from card_listings where status = 'open' and ends > now())`)[0]
check('被改坏的摘要在下一次核对里按出价账本重建', fixed.cur_price === (fixed.best ?? fixed.ask), JSON.stringify(fixed))

// ---- a bid moves the summary in its own transaction
await sql`update card_accounts set state = jsonb_set(state, '{coins}', '900000') where id_hash = ${hashOf(ME)}`
const target = f1.listings.find((l: any) => !l.bid)
const bid = await call(fast, '/api/market/offer', { id: ME, listing: target.id, price: target.min })
const after = (await sql`select cur_price, top_bid, top_buyer_h, open_n, bid_n from card_listings where id = ${target.id}::bigint`)[0]
check('出价成功的同时摘要已经是新价、新领先者', bid.ok === true && after.cur_price === target.min && after.top_bid === target.min
  && after.top_buyer_h === hashOf(ME) && after.open_n === 1 && after.bid_n === target.bids + 1, JSON.stringify(after))
const seen = (await call(fast, '/api/market/peek', { id: ME, ids: [target.id] })).listings[0]
check('货架上随即是「你领先」', seen?.bid === true && seen.best === target.min)

await db.close()
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
