/**
 * 全队收藏 — the clubs whose players you hold, one card of each man.
 *
 * Asked for by the owner —「解锁 PRX 全队、EDG 全队、NRG 全队」— and derived
 * from the collection each time rather than stored, since nothing is paid
 * out for it yet.
 *
 * Moved out of gacha.ts and fixed on the way: it used to check the ordinary
 * card's id, so a彩卡 — the same man on another night — did not count.
 * Somebody holding 2024 首尔 FMVP ZmjjKK and every other EDG card was told
 * they were still missing ZmjjKK. A club is complete when you hold SOME card
 * of each of its players; which night is your business. (The copy still in
 * gacha.ts is unused and goes when the pack work there lands.)
 */
import { ALL_CARDS, isPlayerCard, personOf } from './cards'
import type { PlayerCard } from './cards'
import { WORLD_TEAMS } from './teams'
import type { GachaState } from './gacha'

export interface ClubSet {
  clubId: string
  tag: string
  name: string
  region: string
  tier: number
  total: number
  owned: number
  done: boolean
  /** the players still missing, strongest first, for the「还缺」line */
  missing: string[]
}

/** each club's ordinary player cards — the彩卡 are other cards of the same men */
const CLUB_CARDS: Map<string, PlayerCard[]> = (() => {
  const by = new Map<string, PlayerCard[]>()
  for (const c of ALL_CARDS) {
    if (!isPlayerCard(c) || c.rarity === 'mythic' || !c.clubId) continue
    const list = by.get(c.clubId) ?? []
    list.push(c)
    by.set(c.clubId, list)
  }
  for (const list of by.values()) list.sort((a, b) => b.rating - a.rating)
  return by
})()

/** every card that IS this person: his ordinary card and each of his彩卡 */
const CARDS_OF: Map<string, string[]> = (() => {
  const by = new Map<string, string[]>()
  for (const c of ALL_CARDS) {
    if (!isPlayerCard(c)) continue
    const who = personOf(c)
    by.set(who, [...(by.get(who) ?? []), c.id])
  }
  return by
})()

/** Do you hold this man, on any night? */
export const holdsPerson = (g: GachaState, c: PlayerCard): boolean =>
  (CARDS_OF.get(personOf(c)) ?? [c.id]).some((id) => !!g.cards[id])

export function clubSets(g: GachaState): ClubSet[] {
  const out: ClubSet[] = []
  for (const t of WORLD_TEAMS) {
    const cards = CLUB_CARDS.get(t.id)
    if (!cards || cards.length < 5) continue
    const missing = cards.filter((c) => !holdsPerson(g, c)).map((c) => c.ign)
    out.push({
      clubId: t.id, tag: t.tag, name: t.name, region: t.region, tier: t.tier,
      total: cards.length, owned: cards.length - missing.length, done: missing.length === 0, missing,
    })
  }
  // the ones you have finished first, then the nearest to finished
  return out.sort((a, b) => Number(b.done) - Number(a.done)
    || (b.owned / b.total) - (a.owned / a.total) || a.tier - b.tier || a.tag.localeCompare(b.tag))
}
