/**
 * 洛杉矶征途: one team's road through VALORANT Champions 2023, replayed in order —
 * 首尔征途's rules (engine/eventRoute.ts) on the 34 series of event 1657: the
 * four GSL groups, then the eight-team double-elimination playoff, the format
 * Seoul 2024 used again. Each team fields its five on event attributes at
 * level 0, on the event's seven maps. The two 洛杉矶包 are the account's, once,
 * and apart from 首尔征途's and 曼谷征途's.
 */
import SERIES from '../data/losangeles2023_series.json'
import { LOS_ANGELES_CARDS } from './cards'
import { LOS_ANGELES_TEAMS } from './losangeles2023'
import { makeEventRoute } from './eventRoute'
import type { SeriesRow } from './eventRoute'

// seoulRoute.ts's order: no team plays both of a pair that share a depth (Winner's/Elimination,
// Lower Round 1/Upper Semifinals, Lower Round 3/Upper Final), so this order is every team's order.
const ROUNDS = [
  'Opening', "Winner's", 'Elimination', 'Decider',
  'Upper Quarterfinals', 'Lower Round 1', 'Upper Semifinals', 'Lower Round 2',
  'Lower Round 3', 'Upper Final', 'Lower Final', 'Grand Final',
] as const
const ROUND_CN: Record<(typeof ROUNDS)[number], string> = {
  Opening: '首轮', "Winner's": '胜者组', Elimination: '败者组', Decider: '决胜局',
  'Upper Quarterfinals': '胜者组四分之一决赛', 'Lower Round 1': '败者组第一轮',
  'Upper Semifinals': '胜者组半决赛', 'Lower Round 2': '败者组第二轮',
  'Lower Round 3': '败者组第三轮', 'Upper Final': '胜者组决赛',
  'Lower Final': '败者组决赛', 'Grand Final': '总决赛',
}
const roundOf = (stage: string): number => {
  const i = ROUNDS.findIndex((r) => stage.includes(r))
  if (i < 0) throw new Error(`unknown Los Angeles round: ${stage}`)
  return i
}
/** 「小组赛 D 组胜者组」, 「总决赛」 — from VLR's stage label. */
export function stageName(stage: string): string {
  const round = ROUND_CN[ROUNDS[roundOf(stage)]]
  const group = stage.match(/\(([A-D])\)/)?.[1]
  return group ? `小组赛 ${group} 组${round}` : round
}

const route = makeEventRoute({
  label: '洛杉矶征途', packLabel: '洛杉矶包', pack: 'losangeles2023', key: 'losAngelesRoute',
  teams: LOS_ANGELES_TEAMS, cards: LOS_ANGELES_CARDS, mapsOf: (c) => c.losAngeles?.maps ?? 0,
  series: SERIES.series as SeriesRow[], roundOf, stageName,
})

/** Every team's road, in the order it was played. */
export const LOS_ANGELES_ROUTES = route.ROUTES
/** The seven maps every series of the event was played on. */
export const LOS_ANGELES_POOL = route.POOL
/** The five each team takes the stage with. */
export const LOS_ANGELES_FIVES = route.FIVES
/** the whole road, for the shared 征途 screen */
export const LOS_ANGELES_ROUTE = route
export const {
  cleanRoute: cleanLosAngelesRoute, routeState: losAngelesRouteState, startRoute: startLosAngelesRoute,
  quitRoute: quitLosAngelesRoute, recordRoute: recordLosAngelesRoute,
} = route
