import { clamp } from './rng'
import { ATTR_KEYS } from './types'
import type { Attrs, Player, Stats } from './types'

/** Must stay in sync with scripts/extract.py so imported and in-game players agree. */
export const ATTR_WEIGHT: Record<keyof Attrs, number> = {
  aim: 0.20, reaction: 0.15, awareness: 0.17, utility: 0.14,
  clutch: 0.12, teamwork: 0.10, communication: 0.08, igl: 0.04,
}

export function recomputeOverall(p: Player): number {
  let v = 0
  for (const k of ATTR_KEYS) v += p.attrs[k] * ATTR_WEIGHT[k]
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

export function expectedSalary(p: Player, tier: 1 | 2): number {
  let base = 15000 * Math.exp((p.overall - 55) / 12)
  if (tier === 2) base *= 0.3
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
