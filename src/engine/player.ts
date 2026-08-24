import { clamp } from './rng'
import type { Rng } from './rng'
import { ATTR_KEYS } from './types'
import type { Attrs, Player, Role, Stats } from './types'

/** Must stay in sync with scripts/extract.py so imported and in-game players agree. */
export const ATTR_WEIGHT: Record<keyof Attrs, number> = {
  aim: 0.20, reaction: 0.15, awareness: 0.17, utility: 0.14,
  clutch: 0.12, teamwork: 0.10, communication: 0.08, igl: 0.04,
}

/**
 * What each role is actually judged on. Mirrors ROLE_WEIGHT in
 * scripts/build_world.py, which is where every player's opening rating comes
 * from — the two must be identical.
 *
 * They were not. build_world weighted a duelist on aim and reaction; this file
 * re-derived him on the flat table the moment anything recomputed him, which
 * training, ageing and covering a second role all do. 94 of 515 players moved
 * three or more points on that first recompute and duelists lost 1.7 on
 * average, up to 6 — quietly undoing the role weighting itself.
 */
export const ROLE_WEIGHT: Record<Role, Record<keyof Attrs, number>> = {
  决斗者: { aim: 0.28, reaction: 0.22, clutch: 0.16, awareness: 0.12,
    utility: 0.08, teamwork: 0.07, communication: 0.05, igl: 0.02 },
  先锋: { aim: 0.17, reaction: 0.15, awareness: 0.20, utility: 0.20,
    clutch: 0.09, teamwork: 0.10, communication: 0.07, igl: 0.02 },
  控场: { aim: 0.15, reaction: 0.11, awareness: 0.20, utility: 0.22,
    clutch: 0.09, teamwork: 0.13, communication: 0.08, igl: 0.02 },
  哨卫: { aim: 0.19, reaction: 0.12, awareness: 0.22, utility: 0.15,
    clutch: 0.15, teamwork: 0.10, communication: 0.05, igl: 0.02 },
  自由人: { ...ATTR_WEIGHT },
}

/** The weights this player is judged on. */
export const weightsFor = (p: Pick<Player, 'role'>): Record<keyof Attrs, number> =>
  ROLE_WEIGHT[p.role] ?? ATTR_WEIGHT

export function recomputeOverall(p: Player): number {
  const w = weightsFor(p)
  let v = p.stageBonus ?? 0
  for (const k of ATTR_KEYS) v += p.attrs[k] * w[k]
  p.overall = Math.round(clamp(v, 30, 99))
  return p.overall
}

export function marketValue(p: Player): number {
  let v = 20000 * Math.exp((p.overall - 55) / 10.5)
  if (p.age <= 21) v *= 1.45
  else if (p.age <= 24) v *= 1.15
  else if (p.age >= 28) v *= 0.55
  else if (p.age >= 26) v *= 0.8
  v *= 1 + (p.potential - p.overall) / 100
  // form and morale move the asking price around the edges
  v *= 1 + (p.form - 70) / 400
  return Math.round(v / 1000) * 1000
}

/**
 * What this player expects to be paid, per year.
 *
 * These two constants must stay identical to SALARY_BASE / TIER2_WAGE in
 * scripts/build_world.py — that is where a new world's wage bill comes from,
 * and this is what re-signing the same squad costs. See the note there for why
 * the base is 33000 rather than 15000.
 */
export const SALARY_BASE = 33000
export const TIER2_WAGE = 0.14

export function expectedSalary(p: Player, tier: 1 | 2): number {
  let base = SALARY_BASE * Math.exp((p.overall - 55) / 12)
  if (tier === 2) base *= TIER2_WAGE
  base *= 1 + (p.ambition - 60) / 320
  return Math.round(base / 1000) * 1000
}

export function refreshValue(p: Player): void {
  p.value = marketValue(p)
}

/** Derived per-round numbers used all over the UI. */
export function statLine(s: Stats) {
  const r = s.rounds || 1
  const m = s.maps || 1
  return {
    kd: s.deaths ? s.kills / s.deaths : s.kills,
    kpr: s.kills / r,
    dpr: s.deaths / r,
    apr: s.assists / r,
    adr: s.damage / r,
    acs: (s.damage / r) * 1.45,
    kills: s.kills,
    maps: s.maps,
    fkDiff: s.firstKills - s.firstDeaths,
    perMap: s.kills / m,
  }
}

export const AGE_PEAK = 24

/** Yearly attribute drift: growth for the young, decline for veterans. */
export function ageDrift(p: Player): number {
  if (p.age <= 21) return 1.0
  if (p.age <= 24) return 0.65
  if (p.age <= 26) return 0.3
  if (p.age <= 28) return -0.25
  if (p.age <= 30) return -0.9
  return -1.6
}

export const roleColor = (role: string): string =>
  ({
    决斗者: '#ff4655', 先锋: '#f6c445', 控场: '#7b6cff', 哨卫: '#3ad6a0', 自由人: '#8ea2b8',
  })[role] ?? '#8ea2b8'

/** VLR-style composite rating, calibrated so an average starter sits at ~1.00. */
export const ratingOf = (s: { kills: number; deaths: number; assists: number; rounds: number }) => {
  if (!s.rounds) return 0
  const kpr = s.kills / s.rounds
  const dpr = s.deaths / s.rounds
  const apr = s.assists / s.rounds
  return clamp(0.52 + kpr * 1.15 + apr * 0.28 - dpr * 0.55, 0, 3)
}

/**
 * How long a club ties a player down for, 1-4 years.
 *
 * The world file deals these out across a whole squad so a club's deals never
 * all run out together — see `deal_contract_years` in scripts/build_world.py.
 * Re-signings have to preserve that, and judgement alone does not: a club
 * would like to give its young talent four years and its veterans one, but
 * that preference drifts as a squad matures — everyone's ceiling closes in,
 * everyone starts looking like a one-year renewal, and four seasons later
 * forty clubs are back to a cliff (measured in scripts/check_contracts.ts).
 *
 * So the crowded years are avoided first and the preference only breaks ties.
 * A club that already has two deals ending in two years signs the next man for
 * three, which is what a real front office does and what keeps the stagger
 * alive however the squad ages.
 */
export function contractLength(p: Player, rng: Rng, squad: Player[] = []): number {
  // age leads, ceiling only nudges: a squad's remaining ceiling closes as it
  // matures, so a preference weighted on that alone slides towards one-year
  // deals for everybody. The league's age spread does not move — clubs keep
  // signing teenagers — so an age-led score keeps its shape season after season.
  const tie = Math.max(0, 27 - p.age) + (p.potential - p.overall) * 0.8
  const want = tie >= 14.2 ? 4 : tie >= 10 ? 3 : tie >= 6 ? 2 : 1
  let best = want
  let bestCost = Infinity
  for (const y of [1, 2, 3, 4]) {
    const crowd = squad.filter((q) => q.id !== p.id && q.contractYears === y).length
    // crowding outweighs preference by more than the widest preference gap,
    // so a club never stacks a third deal onto a year that already has two
    const cost = crowd * 4 + Math.abs(y - want) + rng.range(0, 0.6)
    if (cost < bestCost) {
      bestCost = cost
      best = y
    }
  }
  return best
}
