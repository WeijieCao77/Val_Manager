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
import { SEOUL_CARDS, SQUAD_SLOTS } from './cards'
import type { PlayerCard, Squad } from './cards'
import { SEOUL_TEAMS } from './seoul2024'
import { note } from './gacha'
import type { GachaState, PackKind } from './gacha'

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

export const placementName = (p: number): string =>
  p === 1 ? '冠军' : p === 2 ? '亚军' : p === 3 ? '季军' : p === 4 ? '殿军'
    : p <= 6 ? '第 5–6 名' : p <= 8 ? '第 7–8 名' : p <= 12 ? '第 9–12 名' : '第 13–16 名'

export interface RouteStage {
  /** the VLR series id */
  series: string
  stage: string
  opp: string
  bo: 3 | 5
  /** the 2024 result, from this team's side */
  won: number
  lost: number
  maps: { map: string; mine: number; theirs: number }[]
}

type SeriesRow = { id: string; stage: string; a: string; b: string; maps: (string | number)[][] }
const ROWS = SERIES.series as SeriesRow[]

/** Every team's road, in the order it was played. */
export const SEOUL_ROUTES: Record<string, RouteStage[]> = Object.fromEntries(SEOUL_TEAMS.map((t) => [
  t.tag,
  ROWS.filter((s) => s.a === t.tag || s.b === t.tag)
    .sort((x, y) => roundOf(x.stage) - roundOf(y.stage))
    .map((s): RouteStage => {
      const home = s.a === t.tag
      const maps = s.maps.map(([map, x, y]) => ({
        map: String(map), mine: Number(home ? x : y), theirs: Number(home ? y : x),
      }))
      const won = maps.filter((m) => m.mine > m.theirs).length
      const lost = maps.length - won
      return { series: s.id, stage: stageName(s.stage), opp: home ? s.b : s.a, bo: Math.max(won, lost) === 3 ? 5 : 3, won, lost, maps }
    }),
]))

/** The seven maps every series of the event was played on. */
export const SEOUL_POOL: string[] = [...new Set(ROWS.flatMap((s) => s.maps.map((m) => String(m[0]))))].sort()

const hasRoute = (team: unknown): team is string =>
  typeof team === 'string' && Object.prototype.hasOwnProperty.call(SEOUL_ROUTES, team)

// Every seat to the player whose roles fit it; the ratings are the same five
// whichever way they sit, so only a misfit decides between orders.
function seatFive(tag: string): Squad {
  const pool = SEOUL_CARDS.filter((c) => c.clubTag === tag)
  let best: PlayerCard[] = []
  let score = -Infinity
  const visit = (picked: PlayerCard[], value: number) => {
    if (picked.length === SQUAD_SLOTS.length) {
      if (value > score) { score = value; best = picked }
      return
    }
    const role = SQUAD_SLOTS[picked.length]
    for (const c of pool) {
      if (picked.includes(c)) continue
      visit([...picked, c], value - (role === '自由人' || c.roles.includes(role) ? 0 : 1))
    }
  }
  visit([], 0)
  return { slots: best.map((c) => c.id), coach: null }
}
/** The five each team takes the stage with. */
export const SEOUL_FIVES: Record<string, Squad> = Object.fromEntries(SEOUL_TEAMS.map((t) => [t.tag, seatFive(t.tag)]))

export interface RouteLeg {
  /** index into the team's road */
  stage: number
  won: number
  lost: number
  /** 「Lotus 13:9」, one per map, your side first */
  maps: string[]
  at: number
}
export interface RouteRun {
  team: string
  /** the match to play next */
  stage: number
  /** matches lost on this road so far */
  losses: number
  startedAt: number
}
export interface RouteRecord {
  /** roads started */
  runs: number
  /** roads finished */
  clears: number
  /** the fewest losses over a finished road; null until there is one */
  best: number | null
  /** every match played on this road, oldest first — the last ROUTE_LEGS_MAX */
  legs: RouteLeg[]
}
export interface SeoulRouteState {
  run: RouteRun | null
  records: Record<string, RouteRecord>
  /** the account's two 首尔包, each paid once */
  firstWin: boolean
  firstClear: boolean
}

export const ROUTE_LEGS_MAX = 40
export const ROUTE_PACK: PackKind = 'seoul2024'

const count = (v: unknown): number => Math.max(0, Math.trunc(Number(v) || 0))

/**
 * The account's route state in a shape the rules can trust. Pure, so a screen
 * can read it; a run pointing at a team or a match that does not exist is
 * dropped rather than played.
 */
export function cleanRoute(raw: unknown): SeoulRouteState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof SeoulRouteState, unknown>>
  const held = (r.records && typeof r.records === 'object' ? r.records : {}) as Record<string, unknown>
  const records: Record<string, RouteRecord> = {}
  for (const t of SEOUL_TEAMS) {
    const x = held[t.tag] as Partial<RouteRecord> | undefined
    if (!x || typeof x !== 'object') continue
    const road = SEOUL_ROUTES[t.tag]
    records[t.tag] = {
      runs: count(x.runs),
      clears: count(x.clears),
      best: x.best === null || x.best === undefined ? null : count(x.best),
      legs: (Array.isArray(x.legs) ? x.legs : [])
        .filter((l): l is RouteLeg => !!l && typeof l === 'object'
          && Number.isInteger(l.stage) && l.stage >= 0 && l.stage < road.length && Array.isArray(l.maps))
        .map((l) => ({ stage: l.stage, won: count(l.won), lost: count(l.lost), maps: l.maps.map(String).slice(0, 5), at: count(l.at) }))
        .slice(-ROUTE_LEGS_MAX),
    }
  }
  const run = r.run as Partial<RouteRun> | null | undefined
  const stage = Number(run?.stage)
  return {
    run: run && typeof run === 'object' && hasRoute(run.team)
      && Number.isInteger(stage) && stage >= 0 && stage < SEOUL_ROUTES[run.team].length
      ? { team: run.team, stage, losses: count(run.losses), startedAt: count(run.startedAt) }
      : null,
    records,
    firstWin: r.firstWin === true,
    firstClear: r.firstClear === true,
  }
}

/** The same, written back onto the account for an action to change. */
export function routeState(g: GachaState): SeoulRouteState {
  const s = cleanRoute(g.seoulRoute)
  g.seoulRoute = s
  return s
}

const recordOf = (s: SeoulRouteState, team: string): RouteRecord =>
  (s.records[team] ??= { runs: 0, clears: 0, best: null, legs: [] })

/** Set out on a team's road. Starting another team gives up the road in progress. */
export function startRoute(g: GachaState, team: unknown, now: number): { ok: true } | { ok: false; why: string } {
  if (!hasRoute(team)) return { ok: false, why: '没有这支队' }
  const s = routeState(g)
  // a second tap on 出发 before the first reply lands starts nothing new
  if (s.run?.team === team && s.run.stage === 0 && s.run.losses === 0) return { ok: true }
  s.run = { team, stage: 0, losses: 0, startedAt: now }
  recordOf(s, team).runs++
  return { ok: true }
}

export function quitRoute(g: GachaState): void {
  routeState(g).run = null
}

export interface RouteOutcome {
  win: boolean
  /** won a match the team lost in 2024 */
  rewrote: boolean
  /** losses on this road so far, this match included */
  losses: number
  /** this win finished the road */
  cleared: boolean
  /** the record before this finish, to tell a new one */
  bestBefore: number | null
  /** 首尔包 this match paid */
  packs: number
}

/** Put a played match on the road: advance on a win, count a loss, pay the firsts. */
export function recordRoute(
  g: GachaState, leg: { won: number; lost: number; maps: string[] }, now: number,
): RouteOutcome | null {
  const s = routeState(g)
  const run = s.run
  if (!run) return null
  const road = SEOUL_ROUTES[run.team]
  const played = road[run.stage]
  const rec = recordOf(s, run.team)
  rec.legs.push({ stage: run.stage, won: leg.won, lost: leg.lost, maps: leg.maps, at: now })
  if (rec.legs.length > ROUTE_LEGS_MAX) rec.legs.splice(0, rec.legs.length - ROUTE_LEGS_MAX)

  const win = leg.won > leg.lost
  let packs = 0
  if (!win) run.losses++
  else {
    run.stage++
    if (!s.firstWin) {
      s.firstWin = true
      packs++
      note(g, '首尔征途：第一次赢下比赛，首尔包 +1')
    }
  }
  const cleared = win && run.stage >= road.length
  const bestBefore = rec.best
  if (cleared) {
    rec.clears++
    rec.best = rec.best === null ? run.losses : Math.min(rec.best, run.losses)
    if (!s.firstClear) {
      s.firstClear = true
      packs++
      note(g, `首尔征途：第一次打通（${run.team}），首尔包 +1`)
    }
    s.run = null
  }
  if (packs) g.packs[ROUTE_PACK] = (g.packs[ROUTE_PACK] ?? 0) + packs
  return { win, rewrote: win && played.won < played.lost, losses: run.losses, cleared, bestBefore, packs }
}
