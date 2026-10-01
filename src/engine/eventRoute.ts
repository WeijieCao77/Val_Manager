/**
 * 征途: one team's road through a past event, replayed in order — the rules
 * 首尔征途 was built with (engine/seoulRoute.ts), for any event that has its
 * series on file. 曼谷征途 (engine/bangkokRoute.ts) is the second.
 *
 * The road is history and stays history. The opponents and their order are
 * the ones the team met that year, and winning a match it lost does not
 * change who comes next — that is a rewritten result, not a rewritten bracket.
 *
 * Both sides field the event's five on event attributes at level 0, with no
 * coach. A collection and its upgrades have no say, which is the point: the
 * year is the same for everybody.
 *
 * Nothing costs 体力 and a lost match is played again for free, so what a run
 * keeps is its losses: a team's record is the fewest losses over a finished
 * road. The event's two packs are the account's, once — the first match won
 * anywhere, and the first road finished.
 */
import { SQUAD_SLOTS } from './cards'
import type { PlayerCard, Squad } from './cards'
import { note } from './gacha'
import type { GachaState, PackKind } from './gacha'

export const placementName = (p: number): string =>
  p === 1 ? '冠军' : p === 2 ? '亚军' : p === 3 ? '季军' : p === 4 ? '殿军'
    : p <= 6 ? '第 5–6 名' : p <= 8 ? '第 7–8 名' : p <= 12 ? '第 9–12 名' : '第 13–16 名'

export interface RouteStage {
  /** the VLR series id */
  series: string
  stage: string
  opp: string
  bo: 3 | 5
  /** the event's result, from this team's side */
  won: number
  lost: number
  maps: { map: string; mine: number; theirs: number }[]
}
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
export interface EventRouteState {
  run: RouteRun | null
  records: Record<string, RouteRecord>
  /** the account's two event packs, each paid once */
  firstWin: boolean
  firstClear: boolean
}
export interface RouteOutcome {
  win: boolean
  /** won a match the team lost that year */
  rewrote: boolean
  /** losses on this road so far, this match included */
  losses: number
  /** this win finished the road */
  cleared: boolean
  /** the record before this finish, to tell a new one */
  bestBefore: number | null
  /** event packs this match paid */
  packs: number
}

export const ROUTE_LEGS_MAX = 40

export type SeriesRow = { id: string; stage: string; a: string; b: string; maps: (string | number)[][] }
export interface EventTeam { tag: string; name: string; placement: number }

export interface EventRouteConfig {
  /** 「首尔征途」 — in the log lines */
  label: string
  /** 「首尔包」 */
  packLabel: string
  pack: PackKind
  /** where on the account the state lives */
  key: 'seoulRoute' | 'bangkokRoute'
  teams: readonly EventTeam[]
  /** the event's cards; a team fields its five most-played */
  cards: readonly PlayerCard[]
  mapsOf: (card: PlayerCard) => number
  series: readonly SeriesRow[]
  /** a VLR stage label's place in the order a team can meet the rounds */
  roundOf: (stage: string) => number
  /** and its Chinese name */
  stageName: (stage: string) => string
}

const count = (v: unknown): number => Math.max(0, Math.trunc(Number(v) || 0))

export function makeEventRoute(cfg: EventRouteConfig) {
  /** Every team's road, in the order it was played. */
  const ROUTES: Record<string, RouteStage[]> = Object.fromEntries(cfg.teams.map((t) => [
    t.tag,
    cfg.series.filter((s) => s.a === t.tag || s.b === t.tag)
      .slice().sort((x, y) => cfg.roundOf(x.stage) - cfg.roundOf(y.stage))
      .map((s): RouteStage => {
        const home = s.a === t.tag
        const maps = s.maps.map(([map, x, y]) => ({
          map: String(map), mine: Number(home ? x : y), theirs: Number(home ? y : x),
        }))
        const won = maps.filter((m) => m.mine > m.theirs).length
        const lost = maps.length - won
        return { series: s.id, stage: cfg.stageName(s.stage), opp: home ? s.b : s.a, bo: Math.max(won, lost) === 3 ? 5 : 3, won, lost, maps }
      }),
  ]))

  /** The maps every series of the event was played on. */
  const POOL: string[] = [...new Set(cfg.series.flatMap((s) => s.maps.map((m) => String(m[0]))))].sort()

  const hasRoute = (team: unknown): team is string =>
    typeof team === 'string' && Object.prototype.hasOwnProperty.call(ROUTES, team)

  // The team's five most-played (T1 fielded six at Bangkok), every seat to the
  // player whose roles fit it; the ratings are the same five whichever way they
  // sit, so only a misfit decides between orders.
  function seatFive(tag: string): Squad {
    // the most-played five, kept in the cards' own order so a team of exactly five seats as it always did
    const all = cfg.cards.filter((c) => c.clubTag === tag)
    const top = new Set(all.slice().sort((a, b) => cfg.mapsOf(b) - cfg.mapsOf(a)).slice(0, SQUAD_SLOTS.length))
    const pool = all.filter((c) => top.has(c))
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
  const FIVES: Record<string, Squad> = Object.fromEntries(cfg.teams.map((t) => [t.tag, seatFive(t.tag)]))

  /**
   * The account's route state in a shape the rules can trust. Pure, so a screen
   * can read it; a run pointing at a team or a match that does not exist is
   * dropped rather than played.
   */
  function cleanRoute(raw: unknown): EventRouteState {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof EventRouteState, unknown>>
    const held = (r.records && typeof r.records === 'object' ? r.records : {}) as Record<string, unknown>
    const records: Record<string, RouteRecord> = {}
    for (const t of cfg.teams) {
      const x = held[t.tag] as Partial<RouteRecord> | undefined
      if (!x || typeof x !== 'object') continue
      const road = ROUTES[t.tag]
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
        && Number.isInteger(stage) && stage >= 0 && stage < ROUTES[run.team].length
        ? { team: run.team, stage, losses: count(run.losses), startedAt: count(run.startedAt) }
        : null,
      records,
      firstWin: r.firstWin === true,
      firstClear: r.firstClear === true,
    }
  }

  /** The same, written back onto the account for an action to change. */
  function routeState(g: GachaState): EventRouteState {
    const s = cleanRoute(g[cfg.key])
    g[cfg.key] = s
    return s
  }

  const recordOf = (s: EventRouteState, team: string): RouteRecord =>
    (s.records[team] ??= { runs: 0, clears: 0, best: null, legs: [] })

  /** Set out on a team's road. Starting another team gives up the road in progress. */
  function startRoute(g: GachaState, team: unknown, now: number): { ok: true } | { ok: false; why: string } {
    if (!hasRoute(team)) return { ok: false, why: '没有这支队' }
    const s = routeState(g)
    // a second tap on 出发 before the first reply lands starts nothing new
    if (s.run?.team === team && s.run.stage === 0 && s.run.losses === 0) return { ok: true }
    s.run = { team, stage: 0, losses: 0, startedAt: now }
    recordOf(s, team).runs++
    return { ok: true }
  }

  function quitRoute(g: GachaState): void {
    routeState(g).run = null
  }

  /** Put a played match on the road: advance on a win, count a loss, pay the firsts. */
  function recordRoute(
    g: GachaState, leg: { won: number; lost: number; maps: string[] }, now: number,
  ): RouteOutcome | null {
    const s = routeState(g)
    const run = s.run
    if (!run) return null
    const road = ROUTES[run.team]
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
        note(g, `${cfg.label}：第一次赢下比赛，${cfg.packLabel} +1`)
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
        note(g, `${cfg.label}：第一次打通（${run.team}），${cfg.packLabel} +1`)
      }
      s.run = null
    }
    if (packs) g.packs[cfg.pack] = (g.packs[cfg.pack] ?? 0) + packs
    return { win, rewrote: win && played.won < played.lost, losses: run.losses, cleared, bestBefore, packs }
  }

  return { ROUTES, POOL, FIVES, cleanRoute, routeState, startRoute, quitRoute, recordRoute }
}
export type EventRoute = ReturnType<typeof makeEventRoute>
