/**
 * A retired card lives like any other card (owner, 2026-10-10): it levels to +5,
 * takes 进修, and is listed, bought and delivered on the market with its level
 * and its 进修 intact.
 *
 *   npx tsx scripts/check_retired_card_life.ts
 */
process.env.PHONE_GATE = '0'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { DUPES_FOR, MAX_LEVEL, RETIRED_CARDS, isPlayerCard } from '../src/engine/cards'
import type { PlayerCard } from '../src/engine/cards'
import { newGacha, playLevelOf } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) }, key: () => null, clear: () => store.clear(), get length() { return store.size },
}
const env = { today: '2026-10-10', now: Date.parse('2026-10-10T12:00:00+08:00'), seed: 3 }
const plain = (RETIRED_CARDS.filter(isPlayerCard) as PlayerCard[]).filter((c) => c.rarity !== 'mythic')
const target = plain.find((c) => c.rarity === 'gold')!
const feed = plain.filter((c) => c.id !== target.id && c.roles.some((r) => target.roles.includes(r))).slice(0, 5)

// ---- levels and 进修
const g = newGacha('RETLIFE', '审计', env.today)
g.coins = 1e7
g.cards[target.id] = { id: target.id, level: 0, dupes: DUPES_FOR.reduce((a, b) => a + b, 0), seen: 1 }
for (const c of feed) g.cards[c.id] = { id: c.id, level: 0, dupes: 1, seen: 2 }
for (let lv = 1; lv <= MAX_LEVEL; lv++) {
  const r = runAction(g, 'upgrade', { cardId: target.id }, env)
  assert(r.ok, `upgrade to +${lv}: ${r.ok ? '' : r.why}`)
}
assert.equal(g.cards[target.id].level, MAX_LEVEL)
const before = playLevelOf(g, target.id)
const ev = runAction(g, 'evolve', { cardId: target.id, attr: 'aim', feed: feed.map((c) => c.id) }, env)
assert(ev.ok, `进修: ${ev.ok ? '' : ev.why}`)
assert(playLevelOf(g, target.id) > before, '进修 counts in a match')
console.log(`ok   退役金卡 ${target.ign} 升到 +${MAX_LEVEL}，用 5 张退役卡进修（瞄准 +${(ev.result as { gain: number }).gain}）`)

// ---- the market: list, buy now, delivered with level and 进修
const { CARD_SCHEMA, makeCardApi, normalizeId } = await import('../cards-api.js')
const { displayName } = await import('../names.js')
const { makeMarketApi, TRADE_DAYS, TRADE_PULLS } = await import('../market-api.js')
const engine = await import('../src/engine/server.ts')
const db = new PGlite()
const sql = makeSql(db)
await db.exec(CARD_SCHEMA)
interface Res { code: number; body: Record<string, unknown> }
const deps = {
  readBody: (req: { body: string }) => Promise.resolve(req.body),
  json: (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body },
  rateLimited: () => false,
}
const market = makeMarketApi(sql, { ...deps, normalizeId, displayName, engine, token: 'x', tokenFrom: () => '', tokenOk: () => false, timer: false } as never)
const cards = makeCardApi(sql, deps as never)
const call = async (path: string, body: unknown) => {
  const res: Res = { code: 0, body: {} }
  const which = path.startsWith('/api/card/') ? cards : market
  if (which === market) { await market.settleDue({ chores: true }); market.forgetMenus() }
  await which.route({ body: JSON.stringify(body), method: 'POST', headers: {} } as never, res as never, path, 't')
  return res.body as Record<string, unknown>
}
const hashOf = (id: string) => createHash('sha256').update(id).digest('hex')
const SELLER = 'VM-RRRR-RRRR-RRRR-RRRR-RRR1', BUYER = 'VM-RRRR-RRRR-RRRR-RRRR-RRR2'
const owned = g.cards[target.id]
await sql`insert into card_accounts (id_hash, name, state, created) values (${hashOf(SELLER)}, '卖家',
  ${sql.json({ coins: 0, pulls: TRADE_PULLS, cards: { [target.id]: { id: target.id, level: owned.level, dupes: 0, evo: owned.evo } } })}, now() - make_interval(days => ${TRADE_DAYS + 1}))`
await sql`insert into card_accounts (id_hash, name, state, created) values (${hashOf(BUYER)}, '买家',
  ${sql.json({ coins: 50000, pulls: TRADE_PULLS, cards: {} })}, now() - make_interval(days => ${TRADE_DAYS + 1}))`
const listed = await call('/api/market/list', { id: SELLER, cardId: target.id, ask: 2000, buyout: 5000, level: MAX_LEVEL })
assert(listed.ok, `list: ${JSON.stringify(listed)}`)
await sql`update card_listings set created = now() - interval '2 minutes' where id = ${String(listed.id)}::bigint`
const shelf = await call('/api/market/browse', { id: BUYER, filter: { series: 'retired' } })
assert((shelf.listings as { id: string }[]).some((l) => l.id === String(listed.id)), 'the 退役 filter finds it on the shelf')
const bought = await call('/api/market/offer', { id: BUYER, listing: String(listed.id), price: 5000 })
assert(bought.ok && bought.bought, `buy: ${JSON.stringify(bought)}`)
await call('/api/card/act', { id: BUYER, action: 'mail_take', args: {}, client: {} })
const [row] = await sql`select state from card_accounts where id_hash = ${hashOf(BUYER)}`
const got = row.state.cards[target.id]
assert(got && got.level === MAX_LEVEL, `delivered at +5: ${JSON.stringify(got)}`)
assert.deepEqual(got.evo, owned.evo, '进修 travels with the card')
console.log('ok   退役卡挂牌、按「退役选手」系列筛得到、一口价成交，买家收到 +5 和进修')
await db.close()
console.log('全部通过')
