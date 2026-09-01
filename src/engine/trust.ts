import { Rng, clamp } from './rng'
import { bondBetween } from './bonds'
import { skillMod } from './manager'
import { squadOf } from './roster'
import type { GameState, Player } from './types'

/**
 * How much a player believes the manager is handling them well.
 *
 * Deliberately a third axis, not a rename of one we have:
 *
 *   morale     — how they feel this week. Volatile, moved by results.
 *   grievance  — one specific complaint: I was promised a role I am not getting.
 *   trust      — a slow verdict on the manager, built from everything you have
 *                done to them over months. It is the one that decides whether
 *                they will re-sign, and whether they give you the benefit of
 *                the doubt during a bad run.
 *
 * It moves in small amounts and recovers slowly, so a season of overworking a
 * squad is not undone by one good week.
 */

export const TRUST_START = 62

export const trustOf = (p: Player): number => p.trust ?? TRUST_START

function shift(p: Player, delta: number): void {
  p.trust = clamp(trustOf(p) + delta, 0, 100)
}

/** A reading a manager can act on. */
export function trustLabel(v: number): string {
  if (v >= 82) return '完全信任'
  if (v >= 66) return '信任'
  if (v >= 48) return '中立'
  if (v >= 30) return '有保留'
  return '已失去信任'
}

/**
 * The week's verdict.
 *
 * Every term here is something the manager chose to do, which is the point —
 * trust should never move for reasons the player cannot attribute to you.
 */
export function weeklyTrust(state: GameState, rng: Rng, notes: string[]): void {
  const team = state.teams[state.myTeam]
  if (!team) return
  const care = skillMod(state.manager, 'locker', 0.006)

  for (const p of squadOf(state, state.myTeam)) {
    const before = trustOf(p)
    let d = 0

    // worked into the ground, week after week
    if (p.fatigue >= 85) d -= 2.2
    else if (p.fatigue >= 70) d -= 1.0
    else if (p.fatigue <= 35) d += 0.3

    // commercial work they did not sign up to do this much of
    const gigs = state.commercialDays?.[p.id] ?? 0
    if (gigs >= 3) d -= 2.6
    else if (gigs === 2) d -= 1.2

    // streaming is their own deal, so it costs less — but it still costs
    if (p.stream && p.stream.nights >= 4) d -= 0.6

    // a promise being kept, or not, is the loudest signal there is
    const promised = p.contract?.promisedRole
    const starting = team.starters.includes(p.id)
    if (promised === 'star' || promised === 'starter') d += starting ? 0.4 : -2.4
    else if (starting) d += 0.15

    // being injured and not rested reads as being used up
    if (p.injuredUntil > state.day && (state.training[p.id] ?? 'rest') !== 'rest') d -= 0.8

    // a manager who is good with people gets more benefit of the doubt
    d = d > 0 ? d * care : d / care
    // Trust is easy to lose and slow to earn: gains shrink as it climbs, so
    // simply not doing anything wrong plateaus around 'trusts you' rather than
    // running to the ceiling, while one bad stretch still bites at full force.
    if (d > 0) d *= clamp((96 - trustOf(p)) / 34, 0, 1)
    d += (TRUST_START - trustOf(p)) * 0.02

    shift(p, d + rng.range(-0.3, 0.3))

    const now = trustOf(p)
    if (before >= 40 && now < 40) {
      notes.push(`💢 ${p.ign} 开始怀疑俱乐部是不是在合理使用他。`)
    }
    if (before >= 25 && now < 25) {
      notes.push(`🚨 ${p.ign} 已经不信任管理层，续约几乎不可能谈成。`)
      p.grievance = clamp((p.grievance ?? 0) + 12, 0, 100)
    }
  }
}

/** Winning together buys goodwill; a bad run spends it. */
export function trustAfterMatch(state: GameState, won: boolean, ids: string[]): void {
  for (const id of ids) {
    const p = state.players[id]
    if (!p || p.teamId !== state.myTeam) continue
    shift(p, won ? 0.35 : -0.5)
  }
}

/**
 * Dropping a player who did nothing wrong.
 *
 * Rotation is part of the job, so this only bites when the player being benched
 * is in form — being dropped while playing well is the thing that reads as
 * arbitrary.
 */
export function trustOnBench(p: Player): void {
  const deserved = p.form >= 68 || p.overall >= 78
  shift(p, deserved ? -4.5 : -1.2)
}

/**
 * Selling someone the dressing room liked.
 *
 * The cost lands on whoever was close to them, scaled by how close — which is
 * what makes a long-serving core expensive to break up.
 */
export function trustOnDeparture(
  state: GameState, leaving: Player, notes: string[],
): void {
  for (const p of squadOf(state, state.myTeam)) {
    if (p.id === leaving.id) continue
    const bond = bondBetween(state, p.id, leaving.id)
    if (bond <= 15) continue
    const hit = Math.min(9, (bond - 15) * 0.16)
    shift(p, -hit)
    p.morale = clamp(p.morale - hit * 0.7, 0, 100)
    if (hit >= 5) {
      notes.push(`💔 ${p.ign} 对 ${leaving.ign} 的离队反应强烈（关系 ${Math.round(bond)}）。`)
    }
  }
}

/** Who would take the departure of this player badly, and how badly. */
export function departureImpact(
  state: GameState, leaving: Player,
): { p: Player; bond: number; hit: number }[] {
  return squadOf(state, state.myTeam)
    .filter((p) => p.id !== leaving.id)
    .map((p) => {
      const bond = bondBetween(state, p.id, leaving.id)
      return { p, bond, hit: bond <= 15 ? 0 : Math.min(9, (bond - 15) * 0.16) }
    })
    .filter((x) => x.hit > 0)
    .sort((a, b) => b.hit - a.hit)
}
