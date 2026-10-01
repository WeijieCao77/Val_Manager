/**
 * 首尔征途: one team's road through Champions Seoul 2024, replayed in order.
 *
 * The road is history and stays history. The opponents and their order are
 * the ones the team met in August 2024, and winning a match it lost does not
 * change who comes next — that is a rewritten result, not a rewritten bracket.
 * A bracket that branches on your results would be a different mode.
 *
 * Both sides field the 2024 five on event attributes at level 0, with no
 * coach (there are no 2024 coach cards). A collection and its upgrades have
 * no say, which is the point: the year is the same for everybody.
 *
 * Nothing costs 体力 and a lost match is played again for free. With the
 * fives fixed that makes every match close to a coin toss (37–65% in the
 * offline measurement), so what a run keeps is its losses: a team's record is
 * the fewest losses over a finished road. The two 首尔包 are the account's,
 * once — the first match won anywhere, and the first road finished.
 */
import SERIES from '../data/seoul2024_series.json'
import { SEOUL_CARDS } from './cards'
import { SEOUL_TEAMS } from './seoul2024'
import { makeEventRoute } from './eventRoute'
import type { EventRouteState, SeriesRow } from './eventRoute'
import type { PackKind } from './gacha'

export { ROUTE_LEGS_MAX, placementName } from './eventRoute'
export type { RouteLeg, RouteOutcome, RouteRecord, RouteRun, RouteStage } from './eventRoute'
export type SeoulRouteState = EventRouteState

// VLR's round names, in the order a team can meet them. No team plays both of
// a pair that share a depth (Winner's/Elimination, Lower Round 1/Upper
// Semifinals, Lower Round 3/Upper Final), so this order is every team's order.
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
  if (i < 0) throw new Error(`unknown Seoul round: ${stage}`)
  return i
}
/** 「小组赛 D 组胜者组」, 「总决赛」 — from VLR's stage label. */
export function stageName(stage: string): string {
  const round = ROUND_CN[ROUNDS[roundOf(stage)]]
  const group = stage.match(/\(([A-D])\)/)?.[1]
  return group ? `小组赛 ${group} 组${round}` : round
}

export const ROUTE_PACK: PackKind = 'seoul2024'

const route = makeEventRoute({
  label: '首尔征途', packLabel: '首尔包', pack: ROUTE_PACK, key: 'seoulRoute',
  teams: SEOUL_TEAMS, cards: SEOUL_CARDS, mapsOf: (c) => c.seoul?.maps ?? 0,
  series: SERIES.series as SeriesRow[], roundOf, stageName,
})

/** Every team's road, in the order it was played. */
export const SEOUL_ROUTES = route.ROUTES
/** The seven maps every series of the event was played on. */
export const SEOUL_POOL = route.POOL
/** The five each team takes the stage with. */
export const SEOUL_FIVES = route.FIVES
export const { cleanRoute, routeState, startRoute, quitRoute, recordRoute } = route
/** the whole road, for the shared 征途 screen */
export const SEOUL_ROUTE = route
