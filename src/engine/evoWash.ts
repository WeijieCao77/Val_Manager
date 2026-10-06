/**
 * 洗掉进修: a card's 进修 taken off so it can be trained again.
 *
 * The owner (2026-10-06): players who trained the wrong attribute asked to start over, and the five
 * cards each 进修 ate do not come back — washing is a way to correct a choice, not a way to undo a cost.
 * The card stays at +5 with every 进修 slot free again.
 *
 * `spare` washes one of the extra trained +5 copies instead (OwnedCard.evoSpares, weakest first, the order
 * the card detail lists them in): it becomes a plain +5 spare, which can then be taken apart (dismantle.ts).
 */
import { MAX_LEVEL, cardById } from './cards'
import { cleanEvo } from './evolve'
import type { GachaState } from './gacha'
import { evoSparesOf, setEvoSpares, setSpares, sparesOf } from './inbox'

export function washEvo(
  g: GachaState, cardId: string, spare?: number | null,
): { ok: true } | { ok: false; why: string } {
  const owned = g.cards[cardId]
  if (!owned || !cardById(cardId)) return { ok: false, why: '还没有这张卡' }
  if (spare == null) {
    if (!cleanEvo(owned.evo)) return { ok: false, why: '这张卡没有进修过' }
    delete owned.evo
    return { ok: true }
  }
  const list = evoSparesOf(cardId, owned)
  const at = Math.trunc(Number(spare))
  if (!Number.isFinite(at) || at < 0 || at >= list.length) return { ok: false, why: '没有这张进修备用卡' }
  list.splice(at, 1)
  setEvoSpares(cardId, owned, list)
  setSpares(owned, [...sparesOf(owned), MAX_LEVEL])
  return { ok: true }
}
