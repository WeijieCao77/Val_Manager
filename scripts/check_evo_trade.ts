/**
 * 进修过的卡能卖、能换，进修跟着卡走；洗掉进修。
 *
 *   npx tsx scripts/check_evo_trade.ts
 *
 * Reported 2026-10-06: a card that had been through 进修 could not be listed — the market said
 * 「服务器还没同步这张卡」, because escrowCard refused the trained card itself. The owner's rules:
 * the 进修 goes with the card to whoever gets it, and when that player already holds the card
 * nothing is lost — the stronger copy plays and the other waits as a trained spare. And 洗掉进修
 * clears it for a fresh start, the cards it ate not coming back.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { BASE_PLAYER_CARDS, MAX_LEVEL } from '../src/engine/cards'
import { migrateGacha, newGacha, playLevelOf } from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import { evoRating } from '../src/engine/evolve'
import type { Evo } from '../src/engine/evolve'
import { applyMail, escrowCard, evoSparesOf, sparesOf } from '../src/engine/inbox'
import type { MailItem } from '../src/engine/inbox'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const card = BASE_PLAYER_CARDS.filter((c) => c.role === '决斗者').sort((a, b) => b.rating - a.rating)[4]
const CARD = card.id
const SMALL: Evo = { n: 1, add: { aim: 1 } }
const BIG: Evo = { n: 2, add: { aim: 4 } }
const fresh = (name: string): GachaState => {
  const g = newGacha(`VM-TEST-${name}-0000-0000-0000`, '审计', '2026-09-20')
  g.cards = {}
  return g
}
const own = (g: GachaState, level: number, dupes = 0, evo?: Evo) => {
  g.cards[CARD] = { id: CARD, level, dupes, seen: 1 + dupes, got: '2026-09-20', ...(evo ? { evo } : {}) }
}
const item = (level: number, evo?: Evo): MailItem => ({
  kind: 'bought', cardId: CARD, level, coins: 0, pack: null, count: 1,
  body: evo ? { price: 900, evo } : { price: 900 }, at: 1_700_000_000_000,
})
const env = (n = 1) => ({ now: Date.parse('2026-10-06T06:00:00Z') + n * 1000, today: '2026-10-06', seed: 7 + n })
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// ---- the seller: the trained card leaves, last, with its 进修
{
  const s = fresh('SELL')
  own(s, MAX_LEVEL, 1, BIG)
  const first = escrowCard(s, CARD)
  check('有重复卡时先出重复卡，进修留在卡上', first.ok && first.level === 0 && !first.evo && same(s.cards[CARD].evo, BIG))
  const second = escrowCard(s, CARD)
  check('只剩进修过的那张：能挂出去，带着进修', second.ok && second.level === MAX_LEVEL && same(second.evo, BIG), JSON.stringify(second))
  check('挂出去后账号里没有这张卡了', !s.cards[CARD])

  const t = fresh('SEL2')
  own(t, MAX_LEVEL, 0, BIG)
  t.cards[CARD].spares = [3]
  const a = escrowCard(t, CARD)
  check('有 +3 备用卡时先出备用卡', a.ok && a.level === 3 && !a.evo && same(t.cards[CARD].evo, BIG))
  const b = escrowCard(t, CARD)
  check('再挂就是进修过的那张', b.ok && b.level === MAX_LEVEL && same(b.evo, BIG) && !t.cards[CARD])
}

// ---- the buyer: the 进修 arrives, and nothing is thrown away
{
  const g = fresh('NEW0')
  applyMail(g, [item(MAX_LEVEL, BIG)])
  check('没有这张卡的人买到：+5 带进修', g.cards[CARD].level === MAX_LEVEL && same(g.cards[CARD].evo, BIG))
  check('信箱里写着进修过', /进修过/.test(g.mail?.[0]?.text ?? ''), g.mail?.[0]?.text)

  const h = fresh('LOW2')
  own(h, 2)
  applyMail(h, [item(MAX_LEVEL, BIG)])
  check('手上是 +2：买来的进修卡成为主卡，+2 留作备用', h.cards[CARD].level === MAX_LEVEL && same(h.cards[CARD].evo, BIG) && same(sparesOf(h.cards[CARD]), [2]))

  const z = fresh('ZERO')
  own(z, 0)
  applyMail(z, [item(MAX_LEVEL, SMALL)])
  check('手上是 +0：进修卡成为主卡，+0 变重复卡', same(z.cards[CARD].evo, SMALL) && z.cards[CARD].dupes === 1)

  const p = fresh('PLN5')
  own(p, MAX_LEVEL)
  applyMail(p, [item(MAX_LEVEL, SMALL)])
  check('手上是没进修的 +5：进修卡上场，原来的 +5 留作备用', same(p.cards[CARD].evo, SMALL) && same(sparesOf(p.cards[CARD]), [MAX_LEVEL]))

  const w = fresh('WEAK')
  own(w, MAX_LEVEL, 0, SMALL)
  applyMail(w, [item(MAX_LEVEL, BIG)])
  check('两张都进修过：强的上场，弱的整张留作进修备用卡',
    same(w.cards[CARD].evo, BIG) && same(evoSparesOf(CARD, w.cards[CARD]), [SMALL]), JSON.stringify(w.cards[CARD]))
  check('上场的是强的那张（战力按它算）', playLevelOf(w, CARD) > MAX_LEVEL + evoRating(card, SMALL) / 10)

  const k = fresh('KEEP')
  own(k, MAX_LEVEL, 0, BIG)
  applyMail(k, [item(MAX_LEVEL, SMALL)])
  check('买来的比手上的弱：手上的不动，买来的留作进修备用卡',
    same(k.cards[CARD].evo, BIG) && same(evoSparesOf(CARD, k.cards[CARD]), [SMALL]))
  applyMail(k, [item(3)])
  check('再来一张 +3：照旧留作 +3 备用', same(sparesOf(k.cards[CARD]), [3]) && same(k.cards[CARD].evo, BIG))

  // and they leave in order: the +3, then the weaker trained spare, then the card itself
  const out = [escrowCard(k, CARD), escrowCard(k, CARD), escrowCard(k, CARD)]
  check('挂出顺序：+3 备用 → 进修备用卡 → 主卡',
    out[0].level === 3 && same(out[1].evo, SMALL) && same(out[2].evo, BIG) && !k.cards[CARD], JSON.stringify(out))

  const s = migrateGacha(structuredClone(w), 'VM-TEST-WEAK-0000-0000-0000')
  check('读档后进修备用卡还在', same(evoSparesOf(CARD, s.cards[CARD]), [SMALL]))
}

// ---- 洗掉进修
{
  const g = fresh('WASH')
  own(g, MAX_LEVEL, 7, BIG)
  const coins = g.coins
  let r = runAction(g, 'evo_wash', { cardId: CARD }, env(1))
  check('洗掉进修：成功，卡还是 +5，进修清空', r.ok && g.cards[CARD].level === MAX_LEVEL && !g.cards[CARD].evo)
  check('洗掉不退卡、不花钱', g.cards[CARD].dupes === 7 && g.coins === coins)
  check('洗掉后等级回到 +5', playLevelOf(g, CARD) === MAX_LEVEL)
  r = runAction(g, 'evo_wash', { cardId: CARD }, env(2))
  check('没进修过的卡洗不了', !r.ok)
  // and it can be trained again from zero
  const feed = BASE_PLAYER_CARDS.filter((c) => c.role === card.role && c.id !== CARD).slice(0, 5)
  for (const c of feed) g.cards[c.id] = { id: c.id, level: 0, dupes: 1, seen: 2, got: '2026-09-20' }
  r = runAction(g, 'evolve', { cardId: CARD, attr: 'aim', feed: feed.map((c) => c.id) }, env(3))
  check('洗掉后可以重新进修，次数从 1 开始', r.ok && g.cards[CARD].evo?.n === 1, JSON.stringify(r))

  const h = fresh('WSP1')
  own(h, MAX_LEVEL, 0, BIG)
  h.cards[CARD].evoSpares = [SMALL]
  r = runAction(h, 'evo_wash', { cardId: CARD, spare: 0 }, env(4))
  check('洗掉进修备用卡：变成普通 +5 备用，主卡不动',
    r.ok && !h.cards[CARD].evoSpares && same(sparesOf(h.cards[CARD]), [MAX_LEVEL]) && same(h.cards[CARD].evo, BIG))
  r = runAction(h, 'evo_wash', { cardId: CARD, spare: 0 }, env(5))
  check('没有的进修备用卡洗不了', !r.ok)
}

// ---- the server, end to end: list → buy-now → mail; unlist; swap
{
  const { CARD_SCHEMA, makeCardApi, normalizeId } = await import('../cards-api.js')
  const { displayName } = await import('../names.js')
  const { TRADE_DAYS, TRADE_PULLS, makeMarketApi } = await import('../market-api.js')
  const engine = await import('../src/engine/server.ts')
  const db = new PGlite()
  const sql = makeSql(db)
  await db.exec(CARD_SCHEMA)
  interface Res { code: number; body: Record<string, unknown> }
  const opts = {
    readBody: (req: { body: string }) => Promise.resolve(req.body),
    json: (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body },
    normalizeId, displayName, rateLimited: () => false, engine, token: 'devtoken',
    tokenFrom: () => '', tokenOk: () => false, timer: false,
  }
  const api = makeMarketApi(sql, opts as never)
  const cardsApi = makeCardApi(sql, opts as never)
  const call = async (path: string, body: unknown) => {
    const res: Res = { code: 0, body: {} }
    const which = path.startsWith('/api/card/') ? cardsApi : api
    if (which === api) { await api.settleDue({ chores: true }); api.forgetMenus() }
    await which.route({ body: JSON.stringify(body), method: 'POST', headers: {} } as never, res as never, path, 't')
    return Object.assign(res.body, { _code: res.code })
  }
  const hashOf = (id: string) => createHash('sha256').update(id).digest('hex')
  const account = (id: string, coins: number, cards: Record<string, unknown>) =>
    sql`insert into card_accounts (id_hash, name, state, created) values (${hashOf(id)}, ${'审计'},
      ${sql.json({ coins, cards, pulls: TRADE_PULLS })}, now() - make_interval(days => ${TRADE_DAYS + 1}))`
  const cardsOf = async (id: string) => (await sql`select state->'cards' as cards from card_accounts where id_hash = ${hashOf(id)}`)[0].cards as Record<string, { level: number; evo?: Evo; evoSpares?: Evo[]; spares?: number[] }>
  const take = (id: string) => call('/api/card/act', { id, action: 'mail_take', args: {}, client: {} })

  const SELLER = 'VM-SEVE-SEVE-SEVE-SEVE-SEVE'
  const BUYER = 'VM-BEVE-BEVE-BEVE-BEVE-BEVE'
  const THIRD = 'VM-TEVE-TEVE-TEVE-TEVE-TEVE'
  const other = BASE_PLAYER_CARDS.find((c) => c.rarity === card.rarity && c.id !== CARD)!.id
  await account(SELLER, 100, { [CARD]: { id: CARD, level: MAX_LEVEL, dupes: 0, seen: 1, evo: BIG } })
  await account(BUYER, 50000, { [CARD]: { id: CARD, level: MAX_LEVEL, dupes: 0, seen: 1, evo: SMALL } })
  await account(THIRD, 100, { [other]: { id: other, level: 2, dupes: 0, seen: 1 } })

  let r = await call('/api/market/list', { id: SELLER, cardId: CARD, ask: 3000, buyout: 4000, level: MAX_LEVEL })
  check('服务器：进修过的唯一一张卡挂得上去', r.ok === true, JSON.stringify(r))
  const lid = String(r.id)
  const shelf = await call('/api/market/browse', { id: BUYER })
  const tile = (shelf.listings as { id: string; evo?: Evo }[]).find((l) => l.id === lid)
  check('货架上看得到这张卡的进修', same(tile?.evo, BIG), JSON.stringify(tile))
  // past the 上架保护期, so the buy-now buys rather than entering a draw
  await sql`update card_listings set created = now() - interval '5 minutes' where id = ${lid}::bigint`
  r = await call('/api/market/offer', { id: BUYER, listing: lid, price: 4000 })
  check('服务器：一口价买下', r.ok === true, JSON.stringify(r))
  await take(BUYER)
  const got = (await cardsOf(BUYER))[CARD]
  check('服务器：买家手上强的上场、自己原来那张整张留作进修备用卡',
    same(got?.evo, BIG) && same(got?.evoSpares, [SMALL]), JSON.stringify(got))

  // unlisting brings the 进修 home
  r = await call('/api/market/list', { id: BUYER, cardId: CARD, ask: 3000 })
  check('服务器：先挂出去的是较弱的进修备用卡', r.ok === true && same((await cardsOf(BUYER))[CARD]?.evo, BIG) && !(await cardsOf(BUYER))[CARD]?.evoSpares, JSON.stringify(r))
  r = await call('/api/market/unlist', { id: BUYER, listing: String(r.id) })
  await take(BUYER)
  check('服务器：撤回后进修备用卡原样回来', same((await cardsOf(BUYER))[CARD]?.evoSpares, [SMALL]), JSON.stringify((await cardsOf(BUYER))[CARD]))

  // a swap: BUYER offers a trained copy for THIRD's card of the same metal
  r = await call('/api/market/swap', { id: BUYER, giveId: CARD, wantId: other, code: hashOf(THIRD).slice(0, 8) })
  check('服务器：进修卡可以拿去交换', r.ok === true, JSON.stringify(r))
  const sw = await call('/api/market/swaps', { id: THIRD })
  const offer = (sw.inbound as { id: string; giveEvo?: Evo }[])[0]
  check('交换列表里写着这张卡的进修', same(offer?.giveEvo, SMALL), JSON.stringify(offer))
  r = await call('/api/market/swap_answer', { id: THIRD, swap: offer.id, accept: true })
  check('服务器：对方接受交换', r.ok === true, JSON.stringify(r))
  await take(THIRD)
  check('服务器：换到的卡带着进修', same((await cardsOf(THIRD))[CARD]?.evo, SMALL), JSON.stringify((await cardsOf(THIRD))[CARD]))
}

console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
