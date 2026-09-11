/**
 * Two +2s make a +3: an upgraded copy of a card you already hold waits as a
 * spare, and a spare comes apart into duplicates.
 *
 *   npx tsx scripts/check_dismantle.ts
 *
 * Reported from the group: 「两张 +2 的 Smoggy 没法合起来变成 +3」, and a card
 * bought already upgraded was a loss the moment it arrived. The second copy's
 * levels used to vanish into one plain duplicate on the way in.
 */
import { migrateGacha, mergeClientFields, newGacha, upgrade, upgradeCost, SERVER_KEYS } from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'
import { COINS_FOR } from '../src/engine/cards'
import { applyMail, escrowCard } from '../src/engine/market'
import type { MailItem } from '../src/engine/market'
import { dismantle, dismantleFee, dismantleYield } from '../src/engine/dismantle'
import { runAction } from '../src/engine/cardActions'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const CARD = 'p:P12'
const ENV = { now: Date.parse('2026-09-11T04:00:00Z'), today: '2026-09-11', seed: 7 }
const fresh = (n: string): GachaState => newGacha(`VM-TEST-DSMT-${n}-0000-0000`, '审计', '2026-09-11')
const own = (g: GachaState, level: number, dupes: number, spares?: number[]) => {
  g.cards[CARD] = { id: CARD, level, dupes, seen: 1 + dupes, got: '2026-09-11', ...(spares ? { spares } : {}) }
}
const item = (level: number): MailItem => ({
  kind: 'bought', cardId: CARD, level, coins: 0, pack: null, count: 1, body: { price: 900 }, at: 1_700_000_000_000,
})
const show = (g: GachaState) => {
  const c = g.cards[CARD]
  return c ? `+${c.level}，重复 ${c.dupes}，备用 ${JSON.stringify(c.spares ?? [])}` : '没有这张卡'
}

// ---- the report: two +2 make a +3
{
  const g = fresh('TWO2')
  g.coins = 10_000
  own(g, 2, 0)
  applyMail(g, [item(2)])
  check('已有 +2 再收到 +2：用的还是 +2，另一张留作备用 +2',
    g.cards[CARD].level === 2 && g.cards[CARD].dupes === 0 && JSON.stringify(g.cards[CARD].spares) === '[2]', show(g))
  check('备用卡不算重复卡，还升不了', !upgradeCost(g, CARD).can)
  const r = runAction(g, 'dismantle', { cardId: CARD, level: 2 }, ENV)
  check('拆解 +2：花 260 金币，得 3 张重复卡，备用卡没了',
    r.ok && g.coins === 10_000 - 260 && g.cards[CARD].dupes === 3 && g.cards[CARD].spares === undefined, show(g))
  const coins = g.coins
  check('再升一级就是 +3', upgrade(g, CARD) && g.cards[CARD].level === 3 && g.cards[CARD].dupes === 1, show(g))
  check('升级按 +2 → +3 的价扣', coins - g.coins === COINS_FOR[2], `扣了 ${coins - g.coins}`)
}

// ---- what taking apart costs and returns
check('拆解费 +1…+5：80 / 260 / 660 / 1500 / 3300',
  [1, 2, 3, 4, 5].map(dismantleFee).join('/') === '80/260/660/1500/3300', [1, 2, 3, 4, 5].map(dismantleFee).join('/'))
check('拆出重复卡 +1…+5：2 / 3 / 5 / 8 / 13 张',
  [1, 2, 3, 4, 5].map(dismantleYield).join('/') === '2/3/5/8/13', [1, 2, 3, 4, 5].map(dismantleYield).join('/'))

// ---- refusals change nothing
{
  const g = fresh('NOPE')
  g.coins = 10_000
  own(g, 2, 1)
  const before = JSON.stringify(g.cards[CARD])
  check('没有备用卡拆不了', !dismantle(g, CARD, 2).ok && JSON.stringify(g.cards[CARD]) === before)
  check('主卡不能拿来拆', !dismantle(g, CARD, 2).ok && g.cards[CARD].level === 2)
  const h = fresh('POOR')
  own(h, 3, 0, [3])
  h.coins = 100
  const r = dismantle(h, CARD, 3)
  check('金币不够拆不了，金币和卡都不动', !r.ok && h.coins === 100 && JSON.stringify(h.cards[CARD].spares) === '[3]', r.ok ? '' : r.why)
  check('不认识的卡拆不了', !dismantle(h, 'p:NOSUCHCARD', 1).ok)
}

// ---- how an arrival sits beside what you hold
{
  const a = fresh('ARR1'); own(a, 0, 0); applyMail(a, [item(2)])
  check('+0 收到 +2：用 +2，原来那张变重复卡', a.cards[CARD].level === 2 && a.cards[CARD].dupes === 1 && !a.cards[CARD].spares, show(a))
  const b = fresh('ARR2'); own(b, 1, 0); applyMail(b, [item(3)])
  check('+1 收到 +3：用 +3，+1 留作备用', b.cards[CARD].level === 3 && JSON.stringify(b.cards[CARD].spares) === '[1]', show(b))
  const c = fresh('ARR3'); own(c, 3, 0, [2]); applyMail(c, [item(1)])
  check('备用卡按等级从低到高排', JSON.stringify(c.cards[CARD].spares) === '[1,2]', show(c))
  const d = fresh('ARR4'); own(d, 2, 0); applyMail(d, [item(0)])
  check('收到普通卡照旧是重复卡', d.cards[CARD].dupes === 1 && !d.cards[CARD].spares, show(d))
}

// ---- which copy leaves for the market or a swap
{
  const g = fresh('ESCR')
  own(g, 3, 1, [1, 2])
  const order = [escrowCard(g, CARD).level, escrowCard(g, CARD).level, escrowCard(g, CARD).level]
  check('先出重复卡，再出最低的备用卡', order.join(',') === '0,1,2', order.join(','))
  const last = escrowCard(g, CARD)
  check('最后才出主卡，带着 +3 出去，收藏里没了', last.level === 3 && !g.cards[CARD], `出去 +${last.level}，${show(g)}`)

  const h = fresh('PROM')
  own(h, 3, 0, [1])
  const out = escrowCard(h, CARD, 3)
  check('指明交出主卡时，剩下的备用卡顶上来', out.level === 3 && h.cards[CARD].level === 1 && !h.cards[CARD].spares, show(h))

  // conservation across a trade: the seller's +2 spare is the buyer's +2 spare
  const seller = fresh('CONS'); own(seller, 2, 0, [2])
  const buyer = fresh('CONB'); own(buyer, 2, 0)
  const sent = escrowCard(seller, CARD)
  applyMail(buyer, [item(sent.level)])
  check('卖掉备用 +2：卖家主卡还是 +2，买家多一张备用 +2',
    seller.cards[CARD].level === 2 && !seller.cards[CARD].spares && JSON.stringify(buyer.cards[CARD].spares) === '[2]',
    `卖家 ${show(seller)}；买家 ${show(buyer)}`)
}

// ---- old and hand-edited saves
{
  const g = fresh('MIGR')
  own(g, 3, 0, [0, 9, 'x', 2, 1.7] as never)
  const m = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
  check('存档里乱写的备用卡被清掉，只留合法等级', JSON.stringify(m.cards[CARD].spares) === '[1,2]', JSON.stringify(m.cards[CARD].spares))
  const e = fresh('EMPT')
  own(e, 1, 0, [] as number[])
  check('空的备用卡字段被去掉', migrateGacha(JSON.parse(JSON.stringify(e)), e.id).cards[CARD].spares === undefined)
  check('卡是服务端字段，客户端存档写不进备用卡', (SERVER_KEYS as readonly string[]).includes('cards'))
  const server = fresh('SRVR'); own(server, 2, 0)
  mergeClientFields(server, { cards: { [CARD]: { id: CARD, level: 5, dupes: 9, seen: 1, got: '', spares: [5, 5] } } } as never)
  check('客户端传来的 cards 被忽略', server.cards[CARD].level === 2 && !server.cards[CARD].spares, show(server))
}

console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
