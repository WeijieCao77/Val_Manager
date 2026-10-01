/**
 * 曼谷征途: one team's road through Masters Bangkok 2025, replayed in order —
 * 首尔征途's rules (engine/eventRoute.ts) on the 16 series of event 2281:
 * the Swiss stage, then the four-team double-elimination playoff. Each team
 * fields its five most-played (T1 fielded six) on event attributes at level 0,
 * on the event's seven maps. The two 曼谷包 are the account's, once, and apart
 * from 首尔征途's.
 */
import SERIES from '../data/bangkok2025_series.json'
import { BANGKOK_CARDS } from './cards'
import { BANGKOK_TEAMS } from './bangkok2025'
import { makeEventRoute } from './eventRoute'
import type { SeriesRow } from './eventRoute'

// The order a team can meet the rounds in. A Swiss round is 「Swiss Stage: Round 2 (1-0)」; in the playoff
// no team plays both of Lower Round 1 and Upper Final, which sit at the same depth.
const PLAYOFF = ['Upper Semifinals', 'Lower Round 1', 'Upper Final', 'Lower Final', 'Grand Final'] as const
const PLAYOFF_CN: Record<(typeof PLAYOFF)[number], string> = {
  'Upper Semifinals': '胜者组半决赛', 'Lower Round 1': '败者组第一轮',
  'Upper Final': '胜者组决赛', 'Lower Final': '败者组决赛', 'Grand Final': '总决赛',
}
const swissRound = (stage: string): number | null => {
  const m = stage.match(/^Swiss Stage: Round (\d)/)
  return m ? Number(m[1]) : null
}
const roundOf = (stage: string): number => {
  const swiss = swissRound(stage)
  if (swiss !== null) return swiss - 1
  const i = PLAYOFF.findIndex((r) => stage.endsWith(r))
  if (i < 0) throw new Error(`unknown Bangkok round: ${stage}`)
  return 3 + i
}
/** 「瑞士轮第 2 轮（1-0）」, 「胜者组半决赛」 — from VLR's stage label. */
export function stageName(stage: string): string {
  const swiss = swissRound(stage)
  if (swiss !== null) {
    const record = stage.match(/\((\d-\d)\)/)?.[1]
    return `瑞士轮第 ${swiss} 轮${record ? `（${record}）` : ''}`
  }
  return PLAYOFF_CN[PLAYOFF[roundOf(stage) - 3]]
}

const route = makeEventRoute({
  label: '曼谷征途', packLabel: '曼谷包', pack: 'bangkok2025', key: 'bangkokRoute',
  teams: BANGKOK_TEAMS, cards: BANGKOK_CARDS, mapsOf: (c) => c.bangkok?.maps ?? 0,
  series: SERIES.series as SeriesRow[], roundOf, stageName,
})

/** Every team's road, in the order it was played. */
export const BANGKOK_ROUTES = route.ROUTES
/** The seven maps every series of the event was played on. */
export const BANGKOK_POOL = route.POOL
/** The five each team takes the stage with. */
export const BANGKOK_FIVES = route.FIVES
/** the whole road, for the shared 征途 screen */
export const BANGKOK_ROUTE = route
export const {
  cleanRoute: cleanBangkokRoute, routeState: bangkokRouteState, startRoute: startBangkokRoute,
  quitRoute: quitBangkokRoute, recordRoute: recordBangkokRoute,
} = route
