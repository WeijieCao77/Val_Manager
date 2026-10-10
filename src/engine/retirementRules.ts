/**
 * How many retired players a five may field (owner, 2026-10-09).
 *
 * Ordinary play — every ladder but 传奇联赛, the cups, 全服杯, 组队杯, 国家队杯,
 * friend rooms — takes at most two. A retired coach is not a player and does
 * not count. The mark is the card catalogue's (`retired` on the card), never
 * the client's say-so, so a save cannot talk its way past it.
 */
import { cardById, isPlayerCard } from './cards'

export const RETIRED_STARTER_LIMIT = 2

export const retiredStarters = (slots: readonly (string | null | undefined)[]): number =>
  slots.filter((id) => {
    const c = id ? cardById(id) : undefined
    return isPlayerCard(c) && c.retired === true
  }).length

export function retiredLimit(slots: readonly (string | null | undefined)[]): { ok: true } | { ok: false; why: string } {
  const n = retiredStarters(slots)
  return n > RETIRED_STARTER_LIMIT
    ? { ok: false, why: `首发最多上 ${RETIRED_STARTER_LIMIT} 名退役选手，现在有 ${n} 名。` }
    : { ok: true }
}
