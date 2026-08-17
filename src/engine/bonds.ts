import { Rng, clamp, hashStr } from './rng'
import { ratingOf } from './player'
import { squadOf } from './world'
import { skillMod } from './manager'
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

/**
 * How many months two players have been team-mates.
 *
 * Both joined dates are club join dates, so the overlap starts at the later of
 * the two and runs to today. Missing data means no bonus rather than a guess.
 */
function sharedMonths(a: string | undefined, b: string | undefined, state: GameState): number {
  if (!a || !b) return 0
  const later = a > b ? a : b
  const [y, m] = later.split('-').map(Number)
  if (!y || !m) return 0
  // the season calendar starts in January of state.year
  const now = state.year * 12 + Math.floor(state.day / 28) + 1
  return Math.max(0, now - (y * 12 + m))
}

/** Pairs that spend the round working off each other. */
const PAIRED: Record<string, string> = {
  决斗者: '先锋',   // the entry and the one opening space for him
  先锋: '决斗者',
  控场: '哨卫',     // the two holding the site together
  哨卫: '控场',
}

/**
 * What two players think of each other before they have played a game.
 *
 * A flat starting value made every squad identical on day one, which is both
 * dull and wrong: a roster is not five strangers drawn at random. The factors
 * below are the ones the data actually supports — who shares a language, who is
 * the same age, who works directly with whom in a round, and how easy each of
 * them is to get on with. Deterministic, so a save reloads to the same room.
 */
export function initialBond(state: GameState, aId: string, bId: string): number {
  const a = state.players[aId]
  const b = state.players[bId]
  if (!a || !b) return NEUTRAL

  // They are team-mates before they are anything else: five professionals who
  // practise together every day. Starting from ~2 and letting modifiers do all
  // the work put pairs with no shared history at zero or below — a feud before
  // a ball was kicked, which is not what a roster looks like and reads badly to
  // anyone who follows these players. The base is high and the modifiers are
  // narrow: history and rapport still separate pairs, by a dozen points rather
  // than by forty.
  let v = 44

  // Years side by side. This is the strongest signal there is: a core that has
  // been together for three seasons is not in the same room as the man who
  // signed in January, and it is the one thing the other factors cannot fake.
  // The curve is square-root because the first year together is worth far more
  // than the fifth: 1yr +15, 2yr +21, 4yr +29, capped at 34. Scaled against the
  // real spread — a median player joined about a year ago, and only ~12% have
  // been at their club since 2023 or earlier, so a long core should stand out.
  const months = sharedMonths(a.joined, b.joined, state)
  if (months > 0) v += Math.min(10, Math.sqrt(months) * 1.35)

  // sharing a first language is the single biggest divider in a real roster
  if (a.nat && b.nat && a.nat === b.nat) v += 4
  else if (a.nat && b.nat) v -= 2

  const ageGap = Math.abs(a.age - b.age)
  if (ageGap <= 2) v += 3
  else if (ageGap >= 7) v -= 2

  // the two who have to talk every round get closer faster
  const ra = a.role
  const rb = b.role
  if (PAIRED[ra] === rb) v += 3
  if (ra === rb) v += 1          // same role, same problems

  // some people are simply easier to play with
  v += (a.attrs.teamwork + b.attrs.teamwork - 140) * 0.05
  v += (a.attrs.communication + b.attrs.communication - 140) * 0.035

  // a little grit so two similar pairs are not identical
  const jitter = (hashStr(`bond:${key(aId, bId)}`) % 7) - 3
  // the floor is a starting point, not a ceiling on ill feeling: a bad run can
  // still drive a pair well below it, it just cannot begin there
  return clamp(Math.round(v + jitter), 30, 74)
}

export function bondBetween(state: GameState, a: string, b: string): number {
  if (a === b) return 100
  const stored = state.bonds?.[key(a, b)]
  return stored ?? initialBond(state, a, b)
}

function shift(state: GameState, a: string, b: string, delta: number): number {
  const k = key(a, b)
  const now = clamp(bondBetween(state, a, b) + delta, -100, 100)
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
      // 更衣室 is the manager's own lever on the room, alongside the coach's
      const heal = (NEUTRAL - now) * (0.012 + coachPull * 0.03) *
        skillMod(state.manager, 'locker', 0.012)
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
