/**
 * 历史档的真实新人: a career started in 2023, 2024 or 2025 meets the players
 * who really arrived in the years after — at their real clubs, at the start of
 * the season they arrived in.
 *
 * Agents and maps already come in on their real dates (eras.ts). People did
 * not: a 2024 career's 2026 had nobody in it who first played in 2025 or 2026,
 * so the world only aged. scripts/build_arrivals.py lists, for 2024, 2025 and
 * 2026, everyone on a modelled roster that year who was not in the world the
 * year before, with that year's record. When a historical career reaches the
 * year:
 *
 *  - an AI club that still exists signs its real newcomer (and lets its
 *    weakest bench player go if the roster is full) — 「青训提拔」 for a
 *    teenager, 「签下」 otherwise;
 *  - the manager's own club: the newcomer is a free agent reserved for him
 *    for four weeks — the manager decides, nothing is forced onto his roster;
 *  - a club that does not exist in this career: a tier-one newcomer joins the
 *    free agents.
 *
 * Someone already in the career (returning after a year away, or picked up as
 * a prospect) is skipped: one person, one record. The data is loaded lazily
 * by historical careers only and registered here (registerArrivals); a day
 * whose year has not been processed yet processes it.
 */
import { playerFromRaw, autoStarters } from './world'
import type { RawPlayer } from './world'
import { agentAvailable } from './eras'
import { seedAgentPro } from './agents'
import { contractLength, expectedSalary, recomputeOverall, refreshValue } from './player'
import { recordJoin } from './history'
import { careerDayOf } from './clock'
import { squadOf } from './roster'
import { Rng, hashStr } from './rng'
import { defaultContract } from './types'
import type { GameState, Player } from './types'

export interface ArrivalRow extends RawPlayer { clubTag: string; clubTier: number }
export interface ArrivalsFile { years: Record<string, ArrivalRow[]> }

/** how long the manager's own club's newcomer waits for his offer, in days */
export const RESERVE_DAYS = 28
const ROSTER_MAX = 7

let DATA: ArrivalsFile | null = null
export const registerArrivals = (data: ArrivalsFile): void => { DATA = data }
export const arrivalsLoaded = (): boolean => !!DATA

/** Bring in every year's newcomers this career has reached and not yet met. */
export function applyArrivals(state: GameState, notes: string[]): void {
  if (!DATA || state.startYear == null || state.startYear >= 2026) return
  state.arrivalsDone ??= []
  for (const key of Object.keys(DATA.years).sort()) {
    const year = Number(key)
    if (year <= state.startYear || year > state.year || state.arrivalsDone.includes(year)) continue
    arrive(state, year, DATA.years[key], notes)
    state.arrivalsDone.push(year)
  }
}

function arrive(state: GameState, year: number, rows: ArrivalRow[], notes: string[]): void {
  const out = (a: string) => agentAvailable({ year, day: 0 }, a)
  const signed: string[] = []
  const free: string[] = []
  const released: string[] = []
  const newcomers = new Set<string>()
  for (const row of rows) {
    if (state.players[row.id]) continue
    const club = state.teams[row.teamId ?? '']
    const sameClub = !!club && club.tag === row.clubTag
    if (!sameClub && row.clubTier !== 1) continue

    const p = playerFromRaw({ ...row, teamId: null, contractYears: 0 } as RawPlayer, state.seed, out, year)
    for (const k of ['clubTag', 'clubTier', 'agentUse', 'agentR'] as const) delete (p as unknown as Record<string, unknown>)[k]
    p.agentPro = seedAgentPro({ ...p, agentUse: row.agentUse } as Player, out)
    recomputeOverall(p)
    if (p.potential < p.overall) p.potential = p.overall
    p.teamId = null
    p.contractYears = 0
    p.salary = 0
    p.clubHist = []
    refreshValue(p)
    state.players[p.id] = p
    const how = p.age <= 19 ? '从青训提拔' : '签下'

    if (sameClub && club.id === state.myTeam) {
      // his real club is ours: the call is the manager's
      p.reservedFor = { team: club.id, until: careerDayOf(state) + RESERVE_DAYS }
      const line = `📋 现实中 ${p.ign}（${p.age} 岁，${p.overall}）${year} 年${p.age <= 19 ? '从青训提上' : '加盟了'} ${club.name}。他现在是自由人，${RESERVE_DAYS} 天内只等你的报价。`
      notes.push(line)
      state.news.push({ day: state.day, kind: 'transfer', important: true, text: line })
      continue
    }
    if (sameClub) {
      // the AI club makes room the way the real one did: a club that brought
      // in four new men replaced starters, not just its bench — its weakest
      // goes, never a newcomer of this same winter
      if (club.roster.length >= ROSTER_MAX) {
        const out = squadOf(state, club.id)
          .filter((x) => !newcomers.has(x.id))
          .sort((a, b) => a.overall - b.overall)[0]
        if (out) {
          club.roster = club.roster.filter((id) => id !== out.id)
          club.starters = club.starters.filter((id) => id !== out.id)
          out.teamId = null
          out.contractYears = 0
          out.listed = false
          released.push(`${out.ign}（${club.tag}）`)
        }
      }
      if (club.roster.length >= ROSTER_MAX) { free.push(p.ign); continue }
      newcomers.add(p.id)
      const rng = new Rng(hashStr(`arrive:${state.seed}:${year}:${p.id}`))
      p.teamId = club.id
      p.contractYears = row.contractYears || contractLength(p, rng, squadOf(state, club.id))
      p.salary = expectedSalary(p, club.tier)
      p.contract = defaultContract(p.salary, p.contractYears)
      club.roster.push(p.id)
      recordJoin(state, p, club.id)
      club.starters = autoStarters(state, club.id)
      signed.push(`${club.tag} ${how} ${p.ign}`)
      continue
    }
    free.push(p.ign)
  }
  if (signed.length) {
    state.news.push({
      day: state.day, kind: 'transfer',
      text: `📋 ${year} 年的真实新人到队：${signed.slice(0, 10).join('、')}${signed.length > 10 ? ` 等 ${signed.length} 人` : ''}。`,
    })
  }
  if (released.length) {
    state.news.push({
      day: state.day, kind: 'transfer',
      text: `📤 为新人腾位置离队：${released.slice(0, 10).join('、')}${released.length > 10 ? ` 等 ${released.length} 人` : ''}。`,
    })
  }
  if (free.length) {
    state.news.push({
      day: state.day, kind: 'transfer',
      text: `🆕 ${year} 年的新面孔进入自由人市场：${free.slice(0, 10).join('、')}${free.length > 10 ? ` 等 ${free.length} 人` : ''}。`,
    })
  }
}

/** Is this free agent waiting for one club's offer, and is that club not this one? */
export const reservedAgainst = (state: Pick<GameState, 'year' | 'day'>, p: Player, teamId: string): boolean =>
  !!p.reservedFor && p.reservedFor.team !== teamId && p.reservedFor.until > careerDayOf(state)
