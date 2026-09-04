/**
 * A card bought, gifted or swapped in keeps the level it was raised to.
 *
 *   npx tsx scripts/check_traded_level.ts
 *
 * Reported from the group: 「我本身有一个没升过级的 BABYBAY，在市场买了一个
 * +1 的，然后点原装的那张升级，结果吃了 +1 的把普通的升成了 +1」——one plain
 * copy swallowed for nothing. Both halves of that are one bug: the collection
 * holds one level per card, and a delivery into a card you already own used
 * to become a plain duplicate with its level thrown away. The upgrade that
 * followed was then just an ordinary upgrade eating an ordinary spare.
 *
 * The rule this checks: the higher of the two levels is the card you keep,
 * the other copy becomes the spare. Nothing a seller gave up disappears on
 * the way in.
 */
import { newGacha, upgrade, upgradeCost } from '../src/engine/gacha'
import { COINS_FOR, DUPES_FOR } from '../src/engine/cards'
import { applyMail, escrowCard } from '../src/engine/market'
import type { MailItem } from '../src/engine/market'
import type { GachaState } from '../src/engine/gacha'

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

const CARD = 'p:P12' // BABYBAY, silver
const fresh = (name: string): GachaState => newGacha(`VM-TEST-${name}-0000-0000-0000`, '审计', '2026-09-02')
const own = (g: GachaState, level: number, dupes: number) => {
  g.cards[CARD] = { id: CARD, level, dupes, seen: 1 + dupes, got: '2026-09-02' }
}
const item = (level: number): MailItem => ({
  kind: 'bought', cardId: CARD, level, coins: 0, pack: null, count: 1,
  body: { price: 900 }, at: 1_700_000_000_000,
})
const show = (g: GachaState) => {
  const c = g.cards[CARD]
  return c ? `+${c.level}，重复 ${c.dupes}` : '没有这张卡'
}

// ---- the seller's side: a +1 with no spare leaves as a +1
{
  const s = fresh('SELL')
  own(s, 1, 0)
  const out = escrowCard(s, CARD)
  check('卖家挂出唯一一张 +1，出去的是 +1', out.ok && out.level === 1, `level=${out.level}`)
  const t = fresh('SELL2')
  own(t, 1, 2)
  const spare = escrowCard(t, CARD)
  check('有重复卡时先出重复卡，等级是 0', spare.ok && spare.level === 0 && t.cards[CARD].level === 1,
    `出去 +${spare.level}，自己还是 ${show(t)}`)
}

// ---- the report, played out end to end
{
  const g = fresh('BUYR')
  own(g, 0, 0)
  const coins0 = g.coins
  applyMail(g, [item(1)])
  check('原装 +0 的人买到一张 +1：手上那张就是 +1，旧的那张变重复卡',
    g.cards[CARD].level === 1 && g.cards[CARD].dupes === 1, show(g))

  // and the upgrade that follows is an ordinary upgrade, not a surprise
  const cost = upgradeCost(g, CARD)
  check('接着还能升级，用的是那张重复卡', cost.can && cost.to === 2,
    `需要 ${cost.dupes} 张重复卡 + ${cost.coins} 金币，升到 +${cost.to}`)
  upgrade(g, CARD)
  check('升完是 +2、重复卡用掉', g.cards[CARD].level === 2 && g.cards[CARD].dupes === 0, show(g))
  check('金币按 +1 → +2 的价扣', coins0 - g.coins === COINS_FOR[1], `扣了 ${coins0 - g.coins}`)
}

// ---- the other direction: a plain copy never demotes what you raised
{
  const g = fresh('KEEP')
  own(g, 3, 0)
  applyMail(g, [item(0)])
  check('已经 +3 的人收到一张普通卡：还是 +3，多一张重复卡',
    g.cards[CARD].level === 3 && g.cards[CARD].dupes === 1, show(g))

  const h = fresh('KEP2')
  own(h, 3, 0)
  applyMail(h, [item(2)])
  check('收到的 +2 比手上的 +3 低：留着高的那张',
    h.cards[CARD].level === 3 && h.cards[CARD].dupes === 1, show(h))
}

// ---- nothing owned yet: it arrives at the level it left with
{
  const g = fresh('NEW0')
  applyMail(g, [item(2)])
  check('一张都没有的人收到 +2：直接是 +2', g.cards[CARD].level === 2 && g.cards[CARD].dupes === 0, show(g))
}

// ---- conservation: what one side gives up is what the other side gets
{
  const seller = fresh('CONS')
  own(seller, 2, 0)
  const buyer = fresh('CONB')
  own(buyer, 0, 0)
  const out = escrowCard(seller, CARD)
  applyMail(buyer, [item(out.level)])
  const before = 1 + 1 // one plain each side, plus the two levels the seller raised
  const after = (buyer.cards[CARD].dupes + 1)
  check('卖家的 +2 到了买家手上还是 +2', buyer.cards[CARD].level === 2, show(buyer))
  check('两边的卡加起来没多也没少', after === before, `${after} 张`)
  check('卖家那边空了', !seller.cards[CARD], seller.cards[CARD] ? show(seller) : '没有这张卡')
}

console.log(bad ? `\n${bad} 项不对` : `\n全部通过（重复卡门槛 ${DUPES_FOR.join('/')}）`)
process.exit(bad ? 1 : 0)
