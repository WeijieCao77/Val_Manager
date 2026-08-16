import { Rng, clamp } from './rng'
import { ratingOf } from './player'
import { squadOf } from './world'
import type { GameState, MatchResult, Player } from './types'

/**
 * How the five actually get on with each other.
 *
 * Team cohesion used to be one number averaged from teamwork and communication,
 * which meant a squad was either good at playing together or it wasn't. Real
 * rosters break down along specific lines: the one carrying resents the one who
 * keeps dying, a pair who came up together cover for each other, and a losing
 * run turns both into something the manager has to manage.
 *
 * Bonds run -100 (open feud) to +100 (they'd follow each other anywhere), are
 * symmetric, and default to a mild positive so a new signing is not born hated.
 */

export const NEUTRAL = 10

function key(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function bondBetween(state: GameState, a: string, b: string): number {
  if (a === b) return 100
  return state.bonds?.[key(a, b)] ?? NEUTRAL
}

function shift(state: GameState, a: string, b: string, delta: number): number {
  const k = key(a, b)
  const now = clamp((state.bonds?.[k] ?? NEUTRAL) + delta, -100, 100)
  state.bonds = { ...(state.bonds ?? {}), [k]: now }
  return now
}

/** The squad's cohesion, as the average bond across every pair. */
export function squadHarmony(state: GameState, teamId: string): number {
  const squad = squadOf(state, teamId)
  if (squad.length < 2) return NEUTRAL
  let sum = 0
  let n = 0
  for (let i = 0; i < squad.length; i++) {
    for (let j = i + 1; j < squad.length; j++) {
      sum += bondBetween(state, squad[i].id, squad[j].id)
      n++
    }
  }
  return n ? sum / n : NEUTRAL
}

/** The pairs a manager should know about: the worst feuds and the best duos. */
export function notableBonds(
  state: GameState, teamId: string,
): { a: Player; b: Player; value: number }[] {
  const squad = squadOf(state, teamId)
  const out: { a: Player; b: Player; value: number }[] = []
  for (let i = 0; i < squad.length; i++) {
    for (let j = i + 1; j < squad.length; j++) {
      out.push({ a: squad[i], b: squad[j], value: bondBetween(state, squad[i].id, squad[j].id) })
    }
  }
  return out.sort((x, y) => x.value - y.value)
}

/**
 * What a match did to the dressing room.
 *
 * Winning pulls everyone together a little. Losing is where it gets specific:
 * the players who performed look at the players who didn't, and the gap between
 * them is what the resentment is made of. A single bad game is survivable; a run
 * of them is what turns a squad on itself.
 */
export function applyMatchBonds(
  state: GameState, result: MatchResult, teamId: string, isA: boolean, rng: Rng, notes: string[],
): void {
  const won = (result.mapsWonA > result.mapsWonB) === isA
  const ids = (isA ? result.lineups?.a : result.lineups?.b) ?? state.teams[teamId]?.starters ?? []

  // add this match's lines up across maps, so the rating is the game they just
  // played rather than the season they are having
  const rated = ids
    .map((id) => {
      const p = state.players[id]
      if (!p) return null
      const t = { maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, damage: 0, clutches: 0, mvps: 0 }
      for (const ms of result.maps) {
        const l = ms.lines[id]
        if (!l) continue
        t.maps++; t.rounds += l.rounds; t.kills += l.kills; t.deaths += l.deaths
        t.assists += l.assists; t.firstKills += l.firstKills; t.firstDeaths += l.firstDeaths
        t.damage += l.damage; t.clutches += l.clutches
      }
      return t.maps ? { p, r: ratingOf(t) } : null
    })
    .filter((x): x is { p: Player; r: number } => !!x)
  if (rated.length < 2) return
  const avg = rated.reduce((s, x) => s + x.r, 0) / rated.length

  for (let i = 0; i < rated.length; i++) {
    for (let j = i + 1; j < rated.length; j++) {
      const x = rated[i]
      const y = rated[j]
      if (won) {
        // winning together is the cheapest team-building there is
        shift(state, x.p.id, y.p.id, rng.range(0.6, 1.8))
        continue
      }
      // A loss only costs them if one carried and the other didn't. Two players
      // who both played badly have nothing to hold against each other.
      const gap = Math.abs(x.r - y.r)
      const bothPoor = x.r < avg && y.r < avg
      if (gap < 0.35 || bothPoor) {
        shift(state, x.p.id, y.p.id, rng.range(-2, -0.3))
        continue
      }
      const carrier = x.r > y.r ? x : y
      const passenger = x.r > y.r ? y : x
      // an easy-going carrier lets it go; a proud one does not
      const patience = (carrier.p.attrs.teamwork + (100 - carrier.p.ambition)) / 200
      // Resentment compounds: the same grievance between two players who are
      // already at odds lands far harder than the first time it happened.
      const standing = bondBetween(state, x.p.id, y.p.id)
      const grudge = 1 + Math.max(0, -standing) / 55
      const damage = gap * rng.range(20, 34) * (1.35 - patience) * grudge
      const after = shift(state, x.p.id, y.p.id, -damage)

      // An argument is a thing that happens after a specific bad game, not a
      // hidden number crossing a line: one player carried, the other was well
      // off it, and they were already not getting on.
      if (gap >= 0.45 && after < 0) {
        notes.push(
          `💢 ${carrier.p.ign} 和 ${passenger.p.ign} 在赛后起了争执（${carrier.p.ign} ${carrier.r.toFixed(2)} / ${passenger.p.ign} ${passenger.r.toFixed(2)}）。`,
        )
        carrier.p.morale = clamp(carrier.p.morale - 5, 0, 100)
        passenger.p.morale = clamp(passenger.p.morale - 9, 0, 100)
      }
    }
  }
}

/**
 * The week's drift, plus whatever the manager did about it.
 *
 * Bonds decay toward neutral on their own — time heals, slowly — so a feud left
 * alone will fade, but far slower than a run of bad results creates one.
 */
export function weeklyBonds(state: GameState, rng: Rng, notes: string[]): void {
  const squad = squadOf(state, state.myTeam)
  const coachPull = ((state.teams[state.myTeam]?.coach?.motivation ?? 55) - 55) / 100

  for (let i = 0; i < squad.length; i++) {
    for (let j = i + 1; j < squad.length; j++) {
      const a = squad[i]
      const b = squad[j]
      const now = bondBetween(state, a.id, b.id)
      // a coach who is good with people pulls the room back together faster
      const heal = (NEUTRAL - now) * (0.012 + coachPull * 0.03)
      shift(state, a.id, b.id, heal + rng.range(-1, 1))
    }
  }

  // a feud that has festered starts costing the manager something visible
  for (const { a, b, value } of notableBonds(state, state.myTeam)) {
    if (value > -40) break
    if (!rng.chance(0.18)) continue
    a.morale = clamp(a.morale - 3, 0, 100)
    b.morale = clamp(b.morale - 3, 0, 100)
    a.grievance = clamp((a.grievance ?? 0) + 4, 0, 100)
    notes.push(`💢 ${a.ign} 与 ${b.ign} 的关系还没缓和，更衣室氛围受到影响。`)
  }
}

/** Pair work is the direct way to fix a relationship. */
export function duoBonded(state: GameState, a: string, b: string, amount: number): void {
  shift(state, a, b, amount)
}
