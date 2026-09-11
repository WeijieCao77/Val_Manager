/**
 * 拆解: an upgraded spare taken back apart into duplicates.
 *
 * A second copy of a card you already hold keeps its level as a spare (see
 * restoreCard in engine/inbox.ts) instead of being flattened into one plain
 * duplicate, and this is what makes the spare worth keeping: it comes apart
 * into itself plus the duplicates that were spent raising it, and those raise
 * the card you play. 「两张 +2 没法合成 +3」 was the report — one +2 comes apart
 * into three duplicates, and two of them take the other to +3.
 *
 * The coins spent levelling the spare do not come back, and taking it apart
 * costs a fifth of them on top, so it is a way to use a card you would
 * otherwise have wasted, not a way to turn a market buy into coins.
 */
import { COINS_FOR, DUPES_FOR, MAX_LEVEL, cardById } from './cards'
import type { GachaState } from './gacha'
import { setSpares, sparesOf } from './inbox'

export const DISMANTLE_SHARE = 0.2

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** Coins to take a +level spare apart: a fifth of what raising it cost, to the ten. */
export const dismantleFee = (level: number): number =>
  Math.round((sum(COINS_FOR.slice(0, level)) * DISMANTLE_SHARE) / 10) * 10

/** Duplicates a +level spare comes apart into: itself, and every copy raising it ate. */
export const dismantleYield = (level: number): number => 1 + sum(DUPES_FOR.slice(0, level))

export function dismantle(
  g: GachaState, cardId: string, level: number,
): { ok: true; dupes: number; coins: number } | { ok: false; why: string } {
  const owned = g.cards[cardId]
  if (!owned || !cardById(cardId)) return { ok: false, why: '还没有这张卡' }
  const lv = Math.trunc(Number(level) || 0)
  const spares = sparesOf(owned)
  const at = spares.indexOf(lv)
  if (lv < 1 || lv > MAX_LEVEL || at < 0) return { ok: false, why: `没有 +${lv} 的备用卡` }
  const coins = dismantleFee(lv)
  if (g.coins < coins) return { ok: false, why: `金币不够，拆解要 ${coins} 金币` }
  spares.splice(at, 1)
  setSpares(owned, spares)
  const dupes = dismantleYield(lv)
  owned.dupes = (owned.dupes ?? 0) + dupes
  g.coins -= coins
  return { ok: true, dupes, coins }
}
