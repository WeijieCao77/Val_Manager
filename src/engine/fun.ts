/**
 * 娱乐模式 (beta): retired players and streamers in the free-agent pool.
 *
 * A 2026 career started in 娱乐模式 adds src/data/funPool.json to the world
 * (scripts/build_fun_pool.py): every retired player who is not on a bench now,
 * and the streamers the owner named. Nobody is invented — each is a real
 * person with his last real season behind him. What this file decides is what
 * the years away did to him, and what 人气 is worth to a club.
 *
 * 复出 — a retired player arrives at what his last season was, less two things:
 *  - age: past 27 a body slows down whether it plays or not (reaction −1 and
 *    aim −0.5 a year). Permanent.
 *  - rust: the years without a team. Mechanics fade slowly (a streamer still
 *    plays every day, so his fade slower still); what a team builds — utility,
 *    teamwork, communication, the call — fades fastest. Rust comes back: every
 *    week on a club returns an eighth of what is left, at least half a point,
 *    so most of it is back inside a stage. Ordinary training then takes him on
 *    towards his ceiling: the best he has been, plus a point or two for a man
 *    still young enough to grow (24 or under +2, 27 or under +1).
 *
 * 人气 (fame 1–3, streamers and the retired who stream to a big audience):
 *  - platforms pay him far more for a 直播合同 (commercial.ts streamOffer)
 *  - his audience lifts the club's reputation a little every week he is on it
 *  - he asks for more money, and streaming nights cost him some training
 *
 * AI clubs do not approach these players — they come back for the manager's
 * club or not at all — and nobody in the pool announces a second retirement
 * while he is still without a club.
 */
import { clamp } from './rng'
import { recomputeOverall, refreshValue } from './player'
import { ATTR_KEYS } from './types'
import type { Attrs, GameState, Player } from './types'

export type FunKind = 'retired' | 'streamer'
export type Fame = 0 | 1 | 2 | 3

/** what a row of funPool.json holds beyond an ordinary world record */
export interface FunRow {
  id: string
  ign: string
  kind: FunKind
  fame: Fame
  /** age on 1 January 2026 */
  age: number
  ageEstimated?: boolean
  lastYear?: number | null
  lastClub?: string | null
  /** the best overall he had in any of our worlds; null for a streamer who never played tier one */
  peak?: number | null
  tier1?: boolean
  attrs: Attrs
  overall?: number | null
  [k: string]: unknown
}

export interface Comeback {
  kind: FunKind
  fame: Fame
  lastYear?: number
  lastClub?: string
  /** the part of each attribute the years away took, still to come back */
  rust: Partial<Record<keyof Attrs, number>>
  /** how much rust he arrived with, for the progress bar */
  rustStart: number
}

/** the year a 娱乐模式 career starts in — the pool is built for it */
export const FUN_YEAR = 2026

const MECH: (keyof Attrs)[] = ['aim', 'reaction']
const SENSE: (keyof Attrs)[] = ['awareness', 'clutch']
const TEAM: (keyof Attrs)[] = ['utility', 'teamwork', 'communication', 'igl']

/** rust per year without a team, by attribute group; a streamer still plays every day */
export const RUST_PER_YEAR = {
  mech: { retired: 1.0, streamer: 0.4 },
  sense: { retired: 1.0, streamer: 0.6 },
  team: 2.0,
} as const
/** at most this many years count: past three, nobody is getting any rustier at the game itself */
export const RUST_YEARS_MAX = 3
/** what a week on a club gives back: this share of the rust left, at least RECOVER_MIN a point */
export const RECOVER_SHARE = 1 / 8
export const RECOVER_MIN = 0.5

/** platforms pay for an audience — added to streamOffer's draw */
export const FAME_DRAW: Record<Fame, number> = { 0: 0, 1: 10, 2: 20, 3: 32 }
/** reputation the club gains each week he is on it */
export const FAME_REP_WEEK: Record<Fame, number> = { 0: 0, 1: 0.02, 2: 0.04, 3: 0.06 }
/** what he asks over an ordinary player of his ability (kept in player.ts, which fun.ts imports) */
export { FAME_WAGE } from './player'
/** personal training, after the nights on stream */
export const FAME_TRAIN: Record<Fame, number> = { 0: 1, 1: 0.95, 2: 0.9, 3: 0.85 }

/** funPool.json columns that are not player fields (build_fun_pool.py) */
const ROW_ONLY = ['kind', 'fame', 'lastYear', 'lastClub', 'peak', 'tier1', 'img', 'note', 'like'] as const

/** room past his best for a man still young enough to grow */
export const headroomFor = (age: number): number => age <= 24 ? 2 : age <= 27 ? 1 : 0

const isStreamer = (row: Pick<FunRow, 'kind' | 'fame'>): boolean => row.kind === 'streamer' || row.fame > 0

/** Years of team play he has missed by `year`: none for a streamer who never had a team. */
export function yearsAway(row: Pick<FunRow, 'kind' | 'lastYear'>, year: number): number {
  if (!row.lastYear) return 0
  return clamp(year - row.lastYear, 0, RUST_YEARS_MAX)
}

/**
 * Turn the record of his last season into the man who walks back in.
 *
 * `p` is the player createNewGame built from the row (attributes as of the
 * last season, age as of now). Returns him rusted, with his ceiling set.
 */
export function makeComeback(p: Player, row: FunRow, year = FUN_YEAR): Player {
  const away = yearsAway(row, year)
  const stream = isStreamer(row)
  // age: every birthday past 27 since his last season (age now minus the years since)
  const ageThen = row.lastYear ? p.age - (year - row.lastYear) : p.age
  const decline = { aim: 0, reaction: 0 }
  for (let a = Math.max(ageThen, 27); a < p.age; a++) { decline.reaction += 1; decline.aim += 0.5 }
  p.attrs.reaction = clamp(Math.round(p.attrs.reaction - decline.reaction), 20, 99)
  p.attrs.aim = clamp(Math.round(p.attrs.aim - decline.aim), 20, 99)
  // what he will be once the rust is gone
  const restored = recomputeOverall(p)

  const rust: Comeback['rust'] = {}
  let total = 0
  for (const k of ATTR_KEYS) {
    const per = MECH.includes(k) ? RUST_PER_YEAR.mech[stream ? 'streamer' : 'retired']
      : SENSE.includes(k) ? RUST_PER_YEAR.sense[stream ? 'streamer' : 'retired']
      : TEAM.includes(k) ? RUST_PER_YEAR.team : 0
    const r = Math.min(Math.round(per * away), p.attrs[k] - 20)
    if (r > 0) { rust[k] = r; p.attrs[k] -= r; total += r }
  }
  recomputeOverall(p)

  // the ceiling: the best he has been (or what he will be once back), and a
  // man still young enough to grow — TenZ is 24 — a point or two past it
  // a streamer who never had a team has the team game still to learn: two points at any age
  const learn = !row.lastYear ? 2 : 0
  p.potential = clamp(Math.max(restored, row.peak ?? restored) + Math.max(headroomFor(p.age), learn), restored, 99)

  p.comeback = {
    kind: row.kind, fame: row.fame,
    ...(row.lastYear ? { lastYear: row.lastYear } : {}),
    ...(row.lastClub ? { lastClub: row.lastClub } : {}),
    rust, rustStart: total,
  }
  // the pool's own columns stay in the pool: comeback holds what the game needs
  for (const k of ROW_ONLY) delete (p as unknown as Record<string, unknown>)[k]
  p.teamId = null
  p.contractYears = 0
  p.salary = 0
  p.retiring = false
  // a man who has not played in a while is not in form, but he wants this
  p.form = 62
  p.morale = 78
  p.fatigue = 0
  refreshValue(p)
  return p
}

/** Weekly: a comeback player on a club gets some of his old self back. */
export function recoverRust(state: GameState, notes: string[]): void {
  for (const p of Object.values(state.players)) {
    const cb = p.comeback
    if (!cb || !p.teamId) continue
    let left = 0
    for (const k of Object.keys(cb.rust) as (keyof Attrs)[]) {
      const r = cb.rust[k] ?? 0
      if (r <= 0) { delete cb.rust[k]; continue }
      const back = Math.min(r, Math.max(RECOVER_MIN, r * RECOVER_SHARE))
      cb.rust[k] = Math.round((r - back) * 100) / 100
      // whole points only, the way training pays: the fraction waits in the rust
      const whole = Math.floor(r) - Math.floor(r - back)
      if (whole > 0) p.attrs[k] = clamp(p.attrs[k] + whole, 20, 99)
      if ((cb.rust[k] ?? 0) <= 0.01) delete cb.rust[k]
      else left += cb.rust[k] ?? 0
    }
    const before = p.overall
    recomputeOverall(p)
    refreshValue(p)
    if (p.teamId === state.myTeam && p.overall > before) {
      notes.push(left > 0 ? `🔁 ${p.ign} 慢慢找回状态，能力回到 ${p.overall}。` : `🔁 ${p.ign} 状态完全找回来了，能力 ${p.overall}。`)
    }
  }
}

/** Weekly: his audience follows him to the club. */
export function fameWeek(state: GameState): void {
  const team = state.teams[state.myTeam]
  if (!team) return
  for (const pid of team.roster) {
    const fame = state.players[pid]?.comeback?.fame ?? 0
    if (fame) team.reputation = clamp(team.reputation + FAME_REP_WEEK[fame], 0, 99)
  }
}

/** How much of the rust is back, 0–1 (1 when there never was any). */
export function rustRecovered(p: Player): number {
  const cb = p.comeback
  if (!cb || !cb.rustStart) return 1
  const left = Object.values(cb.rust).reduce<number>((a, b) => a + (b ?? 0), 0)
  return clamp(1 - left / cb.rustStart, 0, 1)
}

/** AI clubs never chase them: they come back for the manager's club or not at all. */
export const aiMayApproach = (p: Player): boolean => !p.comeback

export const fameOf = (p: Player): Fame => p.comeback?.fame ?? 0

export const FAME_LABEL: Record<Fame, string> = { 0: '', 1: '主播', 2: '知名主播', 3: '顶流主播' }
