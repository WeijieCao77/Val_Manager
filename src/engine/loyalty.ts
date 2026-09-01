/**
 * 归属感: how attached a player is to this CLUB.
 *
 * It sat still for the whole game — set once when the world was built and
 * never written again — which produced a dead end the group found before I
 * did: a renewal refused with 「对这支球队没有太深的归属感」, and the answer to
 * 「忠诚度怎么刷呀」 being that you cannot. A game that names a blocker and
 * offers no remedy is worse than one that says nothing.
 *
 * The obvious fix — move it on how well the manager treats him — would have
 * made it a second copy of trust. So the two are split along the line that
 * actually separates them:
 *
 *   忠诚 is about the CLUB. Years served, trophies lifted here, and whether
 *          the club has ever tried to sell him. Sack the manager and it
 *          survives, because none of it was about the manager.
 *   信任 is about YOU. Rotation, fatigue, commercial days, promises kept.
 *          Follow the manager out of the door and it means nothing.
 *
 * That is the test for anything added here: if a new manager walking in would
 * reasonably inherit it, it belongs in loyalty; if it walks out with the old
 * one, it belongs in trust. Playing time is deliberately absent from this file
 * for exactly that reason — it is the manager's decision, and it already moves
 * trust and grievance.
 *
 * Everything moves slowly. A player is not talked into belonging.
 */
import { clamp } from './rng'
import type { GameState, Player } from './types'

/** Where a player starts at a club he has just joined. */
export const LOYALTY_NEW = 38

/**
 * A season survived together.
 *
 * The curve flattens: the fourth year at a club is worth less than the first,
 * because by then he is already a club man and the number is near its ceiling.
 * Measured against the real spread — median loyalty in the data is 59 — this
 * takes a signing from 38 to roughly 60 over four seasons, which is the point
 * at which a renewal stops being an argument.
 */
export const yearlyGain = (loyalty: number): number =>
  clamp((78 - loyalty) * 0.16, 0.4, 7)

/** What lifting a trophy while he was here is worth. */
export const TITLE_LOYALTY = { regional: 2.5, international: 5 } as const

/** Being put on the list is the club telling him what he is worth to it. */
export const LISTED_COST = 14
/** Turning down real money for him says the opposite, and he hears that too. */
export const KEPT_GAIN = 4
/** Choosing to stay is itself a commitment. */
export const RENEWAL_GAIN = 5

export const loyaltyOf = (p: Player): number => p.loyalty ?? 50

export function shiftLoyalty(p: Player, delta: number): number {
  p.loyalty = Math.round(clamp(loyaltyOf(p) + delta, 0, 99))
  return p.loyalty
}

/** 「在这里待了三年」/「刚来」 — the reading, not the number. */
export function loyaltyLabel(v: number): string {
  if (v >= 80) return '把这里当家'
  if (v >= 62) return '有归属感'
  if (v >= 45) return '还行'
  if (v >= 28) return '谈不上归属感'
  return '随时会走'
}

/**
 * A new club is a new start.
 *
 * Attachment is to a place, so it cannot travel with him. A 90-loyalty club
 * legend bought in January was, until this existed, instantly 90-loyal to us —
 * which read as the game not noticing he had moved.
 *
 * Somebody coming home is the exception worth honouring: a player returning to
 * a club he has played for before keeps a good part of what he had.
 */
export function loyaltyOnJoin(p: Player, toTeamId: string): void {
  const been = (p.clubHist ?? []).some((s) => s.team === toTeamId)
  p.loyalty = been
    ? Math.round(clamp(Math.max(LOYALTY_NEW + 14, loyaltyOf(p) * 0.7), 0, 99))
    : LOYALTY_NEW
}

/**
 * The winter pass: everyone in the world gets a year older at their club.
 *
 * League-wide on purpose. Applied only to our own squad, ours would slowly
 * become unpoachable while every other club's stayed as easy to raid as on day
 * one — the asymmetry would be invisible and would quietly break the market.
 */
export function growLoyalty(state: GameState): void {
  for (const p of Object.values(state.players)) {
    if (!p.teamId) continue
    // a season that started somewhere else is not a season served here
    if (p.joinedYear === state.year) continue
    shiftLoyalty(p, yearlyGain(loyaltyOf(p)))
  }
}

/**
 * Being put up for sale, at most once a season.
 *
 * A listing lapses after a fortnight and a permanently surplus player gets
 * re-listed at every window, which charged him four or five times a year and
 * drained the league: measured at −7.7 average loyalty across five seasons,
 * with twenty-nine players on the floor. The second listing in the same year
 * tells him nothing the first one did not.
 */
export function loyaltyOnListed(state: GameState, p: Player): void {
  if (p.loyaltyHitYear === state.year) return
  p.loyaltyHitYear = state.year
  shiftLoyalty(p, -LISTED_COST)
}

/** Everyone who was at the club when it won something. */
export function titleLoyalty(state: GameState, teamId: string, international: boolean): void {
  const gain = international ? TITLE_LOYALTY.international : TITLE_LOYALTY.regional
  for (const id of state.teams[teamId]?.roster ?? []) {
    const p = state.players[id]
    if (p) shiftLoyalty(p, gain)
  }
}
