import { Rng, clamp } from './rng'
import { MAPS, HIGHLIGHT_TEMPLATES as HL, mapCn } from './content'
import { agentMod, autoAgents, normalizeAgents } from './agents'
import { callBoost, compStyle, famBonus, familiarity, tacticEdge } from './comp'
import type { CompStyle } from './comp'
import { coachOr } from './roster'
import { NEUTRAL, squadHarmony } from './bonds'
import { analystEdge } from './staff'
import { skillMod } from './manager'
import type {
  EdgeBreakdown, GameState, MapLine, MapScore, MatchResult, Player, Role, RoundLog, StageKey, Team,
} from './types'

/**
 * How differently a side can turn up from one map to the next.
 *
 * Rounds were independent draws around a fixed strength, and twenty-four
 * independent draws hide nothing: the higher-rated side won 77% of series
 * against a club 3-5 rating points below it, 86% against one 6-9 below,
 * and a club that assembled a strong five never lost again — 「一旦组成一个
 * 强队就根本没有输的可能性」. Two dials moved. Each side's strength on a map
 * carries a draw of this spread for the whole map, so a weaker side's good
 * day is a whole map rather than a round; and the round curve (ROUND_SENS
 * below) is flatter, so a strength gap decides a map less completely. Just
 * widening the swing made maps lopsided — 46% of them 13-5 or worse — which
 * is why most of the change is in the curve: 3-5 below now wins 30% of
 * series, 6-9 below 20%, and one map in four is a 13-5, as in the real
 * thing. Measured with scratch scripts over three seasons; the smoke test
 * still holds the K/D calibration.
 */
const MAP_SWING = 6
/** the strength gap, in rating points, that moves a round from 50% to 73% */
const ROUND_SENS = 30

/** How much each role tends to take kills / take deaths. */
// 决斗者 was 1.15 while every real duelist in a fifth slot sat on a default
// initiator with the off-role penalty; with real agent pools he plays his own
// agent at full strength, and 1.15 put the season's top K/D at 1.62 against
// a real ceiling near 1.5. 1.08 lands it back there — see scripts/smoke.ts.
const KILL_WEIGHT: Record<Role, number> = {
  决斗者: 1.08, 自由人: 1.03, 先锋: 0.98, 哨卫: 0.96, 控场: 0.93,
}
// and an entry player dies for it: 1.28, from 1.25, for the same reason
const DEATH_WEIGHT: Record<Role, number> = {
  决斗者: 1.28, 先锋: 1.08, 自由人: 1.0, 控场: 0.9, 哨卫: 0.88,
}
const ENTRY_WEIGHT: Record<Role, number> = {
  决斗者: 2.0, 先锋: 1.3, 自由人: 1.0, 哨卫: 0.6, 控场: 0.5,
}

export interface Lineup {
  team: Team
  players: Player[]
  /** who played which agent on this map, keyed by player id */
  agents: Record<string, string>
  /** the shape those agents make — see engine/comp.ts */
  style: CompStyle
  atk: number
  def: number
  chem: number
  /** mid-round adaptation, drives comeback / clutch behaviour */
  midRound: number
  /** why this side is as strong as it is, kept for the post-match report */
  edge: EdgeBreakdown
}

/**
 * A player's effective rating right now (form / morale / fatigue applied).
 *
 * `day` is optional so callers that only rank fit players can omit it. Pass it
 * and a man playing through an injury is priced accordingly: selectLineup will
 * field an injured player when a club has nobody else, and 52 of the world's
 * 78 clubs carry exactly five, so without this an injury cost two thirds of
 * the league absolutely nothing. At -0.22 a club with no bench loses more to
 * an injury (-3.45 rating) than a club that can bring a substitute on
 * (-2.98) — which is the whole point of carrying one.
 */
export function effectiveRating(p: Player, day?: number): number {
  const form = (p.form - 70) * 0.0028
  const morale = (p.morale - 70) * 0.0016
  const fatigue = -p.fatigue * 0.0016
  const hurt = day != null && p.injuredUntil > day ? -0.22 : 0
  return p.overall * (1 + form + morale + fatigue + hurt)
}

/** Pick the 5 who actually play: honour the chosen starters, fill gaps with the best fit. */
export function selectLineup(state: GameState, teamId: string): Player[] {
  const team = state.teams[teamId]
  const all = team.roster
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p && p.injuredUntil <= state.day)

  const chosen: Player[] = []
  for (const id of team.starters) {
    const p = all.find((x) => x.id === id)
    if (p && chosen.length < 5) chosen.push(p)
  }
  if (chosen.length < 5) {
    // Fill on merit, and let an injured man compete for the place. His rating
    // already carries the injury (−22%), so a star who can barely walk beats a
    // reserve who is 30 points worse, and a real backup beats him — which is
    // what carrying a bench is supposed to buy. Excluding the injured outright
    // forced a weak substitute on and made depth cost MORE than an injury.
    const pool = team.roster
      .map((id) => state.players[id])
      .filter((p): p is Player => !!p && !chosen.includes(p))
    // Filled one at a time, and a man who plugs a job the five is missing is
    // worth more than his rating says — the same judgement compositionScore
    // makes about the finished lineup. Ranking on rating alone benched an
    // injured specialist for a fitter reserve of the wrong job and left the
    // side worse off, which made carrying a bench a liability.
    // Judged on the same scale the lineup itself is scored on. A composition
    // gap costs `atk` directly, while one man's rating reaches it through a
    // weighted mean — roughly a sixth of his number — so comparing the two raw
    // numbers made a 20-point rating gap look six times more important than a
    // missing role. It is not: the engine's own compositionScore says what the
    // hole is worth, so use it.
    const SLOT = 0.15
    while (chosen.length < 5 && pool.length) {
      const value = (p: Player) =>
        effectiveRating(p, state.day) * SLOT + compositionScore([...chosen, p])
      const best = pool.reduce((x, y) => (value(y) > value(x) ? y : x))
      chosen.push(best)
      pool.splice(pool.indexOf(best), 1)
    }
  }
  // a club with fewer than 5 fit players fields whoever is left, injured included
  if (chosen.length < 5) {
    const emergency = team.roster
      .map((id) => state.players[id])
      .filter((p): p is Player => !!p && !chosen.includes(p))
      .sort((a, b) => b.overall - a.overall)
    for (const p of emergency) {
      if (chosen.length >= 5) break
      chosen.push(p)
    }
  }
  return chosen
}

const CORE_ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫']
const GAP_COST: Record<string, number> = { 控场: 7, 哨卫: 5, 先锋: 4, 决斗者: 4 }

/**
 * How well a five covers the map between them.
 *
 * The requirement is four roles — duelist, initiator, controller, sentinel —
 * and nothing else. 自由人 is not a fifth one: in the data it means vlr never
 * recorded a role for the player, and for the single hand-verified genuine
 * floater it sits alongside the real roles he plays. Counting it as covered
 * ground made a lineup score 1.2 better for carrying a floater than for any
 * other fifth man, so the game quietly asked for one that it never required.
 *
 * The old redundancy term charged a player for every role he could play, so a
 * duelist who also initiates scored worse than a second plain duelist —
 * versatility priced as a liability. With five players and four roles one
 * doubling is unavoidable anyway, so there is nothing there to charge for.
 */
function compositionScore(players: Player[]): number {
  const coreOf = (p: Player) => (p.roles ?? [p.role]).filter((r) => CORE_ROLES.includes(r))
  const have = new Set(players.flatMap(coreOf))
  const floaters = players.filter((p) => coreOf(p).length === 0).length

  let score = 0
  // a player with no fixed role plugs a hole: worse than a specialist there,
  // far better than leaving it open
  let spare = floaters
  for (const r of CORE_ROLES) {
    if (have.has(r)) continue
    if (spare > 0) {
      spare -= 1
      score -= GAP_COST[r] * 0.5
    } else {
      score -= GAP_COST[r]
    }
  }
  // covering a second role is option value across a veto, not a cost
  score += Math.min(players.filter((p) => coreOf(p).length > 1).length, 3) * 0.6
  // but a five where nobody has a defined job is a coordination problem
  if (floaters > 2) score -= (floaters - 2) * 1.5
  return score
}

/**
 * The agents a side takes onto a map, and the shape they make.
 *
 * Split out of buildLineup because the OTHER side's shape is an input to
 * ours: what your dials run into depends on whether they brought two
 * sentinels or two duelists. Cheap, and deterministic in the state.
 */
export function sheetFor(
  state: GameState, teamId: string, map: string, players = selectLineup(state, teamId),
): { agents: Record<string, string>; style: CompStyle } {
  const agents = normalizeAgents(
    state, teamId, players, map,
    // this match's sheet, then the club's remembered default for this map,
    // then the composition the map is usually played with
    (teamId === state.myTeam ? state.agentPicks?.[map] ?? state.mapAgents?.[map] : undefined)
    ?? autoAgents(state, teamId, players, map))
  return { agents, style: compStyle(Object.values(agents)) }
}

/** The dials a club plays a map on: its own for that map if set, else the general ones. */
export const tacticsFor = (state: GameState, teamId: string, map: string) =>
  (teamId === state.myTeam ? state.mapTactics?.[map] : undefined) ?? state.teams[teamId].tactics

export function buildLineup(
  state: GameState, teamId: string, map: string,
  /** who we are up against on this map, for the matchup term; absent = a neutral five */
  oppId?: string,
): Lineup {
  const team = state.teams[teamId]
  const players = selectLineup(state, teamId)
  // Who is on which agent. The manager's own picks for this map if he made
  // any; otherwise the map's usual composition, handed to whoever can play it.
  // Agents used to be decoration — this is where a pick starts to cost or pay.
  const { agents: picks, style } = sheetFor(state, teamId, map, players)
  const oppStyle: CompStyle = oppId && state.teams[oppId] ? sheetFor(state, oppId, map).style : 'standard'
  const effs = players.map((x) => effectiveRating(x, state.day) * agentMod(x, picks[x.id]))

  // the top performers carry slightly more than a flat mean
  const sorted = effs.slice().sort((a, b) => b - a)
  const weights = [1.24, 1.1, 1.0, 0.9, 0.76]
  let base = 0
  let wsum = 0
  sorted.forEach((v, i) => {
    const w = weights[i] ?? 0.8
    base += v * w
    wsum += w
  })
  base = wsum > 0 ? base / wsum : 55

  const avg = (k: keyof Player['attrs']) =>
    players.length ? players.reduce((s, p) => s + p.attrs[k], 0) / players.length : 55

  // A squad can carry several players who are IGLs by trade — buy another
  // club's caller and his flag comes with him. One voice calls the game: the
  // best of them, deterministically, not whoever sits first in the roster
  // array. The others neither stack nor clash; an ex-caller is support.
  const igl = players.filter((p) => p.isIgl).sort((a, b) => b.attrs.igl - a.attrs.igl)[0]
  const iglBonus = igl ? (igl.attrs.igl - 60) * 0.09 : -4
  // attributes say how well they can play together; bonds say whether they are
  const rapport = squadHarmony(state, team.id)
  const chem = clamp((avg('teamwork') + avg('communication')) / 2 + (rapport - NEUTRAL) * 0.18, 20, 99)
  const chemBonus = (chem - 65) * 0.07
  // 战术: the manager's own read of the game, on top of the coach's
  const mine = team.id === state.myTeam
  const coachBonus = (coachOr(team, 'tactics') - 60) * 0.05 +
    (mine ? (skillMod(state.manager, 'tactics', 0.06) - 1) : 0) +
    // 对手研究: knowing what they run is worth about half a head coach
    (mine ? analystEdge(state, 'opponent') * 2.4 : 0)
  const comp = compositionScore(players)
  const mapPref = ((team.mapPrefs[map] ?? 50) - 50) * 0.07

  // The dials, read through the shape of the five and the shape of theirs —
  // see engine/comp.ts for why the same slider is worth different things to
  // a double-duelist five and a double-sentinel one.
  const t = tacticsFor(state, teamId, map)
  const te = tacticEdge(t, style, oppStyle, avg('utility'))
  // 经济分析: better buys and better utility timing, all game
  const utilBonus = te.utility + (avg('utility') - 65) * 0.05 +
    (mine ? analystEdge(state, 'economy') * 1.8 : 0)
  // how well the club knows these five agents on this map — a drilled sheet
  // plays above neutral, a sheet built last night plays below it
  const fam = familiarity(state, teamId, map, picks)
  const famEdge = famBonus(fam)
  const styleAtk = te.styleAtk + te.matchupAtk
  const styleDef = te.styleDef + te.matchupDef

  // Playing short-handed had no cost at all. Strength is a weighted mean of who
  // is on the server, so losing your weakest man RAISED it: a two-man side
  // rated 92.56 against its own full five's 93.74, and three rated above four.
  // A club that had been stripped to four kept winning, which is what a player
  // meant by "四个人也能打，而且还打赢了对面".
  //
  // Round odds run through 1/(1+e^(-diff/30)), so ~18 a head puts a four-man
  // side near 35% a round and a two-man side near 23% — losing 13-3, which
  // is what being two men down actually looks like.
  const missing = Math.max(0, 5 - players.length)
  const shortHanded = -missing * 18

  const common = base + iglBonus + chemBonus + coachBonus + comp + mapPref + utilBonus + shortHanded +
    famEdge
  const atk = common + te.tacticsAtk + styleAtk + (avg('aim') - 65) * 0.05
  const def = common + te.tacticsDef + styleDef + (avg('awareness') - 65) * 0.05 + 1.6

  const midRound =
    (t.adaptability - 50) * 0.05 + (igl ? (igl.attrs.igl - 60) * 0.06 : -3) + (avg('clutch') - 65) * 0.05 +
    te.styleMid + te.matchupMid

  const edge: EdgeBreakdown = {
    base, igl: iglBonus, chem: chemBonus, coach: coachBonus, comp, shortHanded,
    map: mapPref, utility: utilBonus,
    tacticsAtk: te.tacticsAtk, tacticsDef: te.tacticsDef,
    // the shape is one number across both sides for the report, which is how
    // a manager reads it: "double duelist was worth +0.2 here"
    style: (te.styleAtk + te.styleDef) / 2,
    matchup: (te.matchupAtk + te.matchupDef) / 2,
    familiarity: famEdge,
    atk, def,
  }
  return { team, players, agents: picks, style, atk, def, chem, midRound, edge }
}

// ---------------------------------------------------------------- map veto

/**
 * The year has three pool windows, the way Riot actually runs it: the pool
 * that opens the season, a rotation when Stage 1 begins, and another when
 * Stage 2 begins. Challengers events follow the same calendar days, so one
 * phase covers everybody.
 */
export type PoolPhase = 0 | 1 | 2

export const poolPhaseOf = (stage: StageKey): PoolPhase =>
  stage === 'stage1' || stage === 'masters2' ? 1
    : stage === 'stage2' || stage === 'champions' || stage === 'offseason' ? 2
    : 0

/**
 * The 7 maps in the active competitive pool, for a given window of the year.
 *
 * Phase 0 deals seven of the thirteen; each later phase swaps one or two of
 * them for benched maps, cumulatively — the Stage 2 pool is the Stage 1 pool
 * with its own swap on top, not a fresh deal. Deterministic in (seed, phase),
 * so every screen and both veto paths agree on what is legal today.
 */
export function activePool(seed: number, phase: PoolPhase = 0): string[] {
  const rng = new Rng(seed ^ 0x5eed)
  const order = rng.shuffle(MAPS.slice() as string[])
  const pool = order.slice(0, 7)
  const bench = order.slice(7)
  for (let ph = 1; ph <= phase; ph++) {
    const swaps = 1 + rng.int(0, 1)
    for (let i = 0; i < swaps; i++) {
      const out = rng.int(0, pool.length - 1)
      const inn = rng.int(0, bench.length - 1)
      const dropped = pool[out]
      pool[out] = bench[inn]
      bench[inn] = dropped
    }
  }
  return pool.sort()
}

/** Today's pool for this save — the one every veto and every screen must use. */
export const poolFor = (state: Pick<GameState, 'seed' | 'year' | 'stage'>): string[] =>
  activePool(state.seed + state.year, poolPhaseOf(state.stage))

export function vetoOrder(bo: 1 | 3 | 5): ('ban' | 'pick')[] {
  // 7-map pool
  if (bo === 1) return ['ban', 'ban', 'ban', 'ban', 'ban', 'ban']
  if (bo === 3) return ['ban', 'ban', 'pick', 'pick', 'ban', 'ban']
  return ['ban', 'ban', 'pick', 'pick', 'pick', 'pick']
}

/**
 * What the AI would do with this board, right now.
 *
 * The same judgement runVeto makes, exposed one step at a time so the
 * interactive veto on the pre-match screen can hand the board back and forth
 * instead of running the whole thing in one go.
 */
export function vetoChoice(
  state: GameState, actorId: string, otherId: string,
  action: 'ban' | 'pick', remaining: string[], rng: Rng,
): string {
  const actor = state.teams[actorId]
  const other = state.teams[otherId]
  const prefOf = (t: Team, m: string) => (t.mapPrefs[m] ?? 50) + rng.range(-6, 6)
  if (action === 'ban') {
    return remaining.reduce((best, m) =>
      prefOf(other, m) - prefOf(actor, m) > prefOf(other, best) - prefOf(actor, best) ? m : best)
  }
  return remaining.reduce((best, m) => (prefOf(actor, m) > prefOf(actor, best) ? m : best))
}

export function runVeto(
  state: GameState,
  aId: string,
  bId: string,
  bo: 1 | 3 | 5,
  pool: string[],
  rng: Rng,
): { maps: string[]; log: string[] } {
  const a = state.teams[aId]
  const b = state.teams[bId]
  let remaining = pool.slice()
  const picked: string[] = []
  const log: string[] = []
  const order = vetoOrder(bo)

  const prefOf = (t: Team, m: string) => (t.mapPrefs[m] ?? 50) + rng.range(-6, 6)

  for (let i = 0; i < order.length && remaining.length > 1; i++) {
    const actor = i % 2 === 0 ? a : b
    const other = i % 2 === 0 ? b : a
    const action = order[i]
    let target: string
    if (action === 'ban') {
      // ban whatever the opponent likes most and we like least
      target = remaining.reduce((best, m) =>
        prefOf(other, m) - prefOf(actor, m) > prefOf(other, best) - prefOf(actor, best) ? m : best,
      )
      log.push(`${actor.name} ban 掉 ${target}`)
    } else {
      target = remaining.reduce((best, m) => (prefOf(actor, m) > prefOf(actor, best) ? m : best))
      picked.push(target)
      log.push(`${actor.name} 选下 ${target}`)
    }
    remaining = remaining.filter((m) => m !== target)
  }

  const need = bo
  while (picked.length < need && remaining.length) {
    const decider = remaining[rng.int(0, remaining.length - 1)]
    picked.push(decider)
    remaining = remaining.filter((m) => m !== decider)
    log.push(`决胜图：${decider}`)
  }
  return { maps: picked.slice(0, bo), log }
}

// ---------------------------------------------------------------- economy

type Buy = 'eco' | 'force' | 'full'

class Economy {
  money = 800
  lossStreak = 0

  decide(rng: Rng): Buy {
    if (this.money >= 3900) return 'full'
    if (this.money >= 2200) return rng.chance(0.55) ? 'force' : 'eco'
    return 'eco'
  }

  spend(buy: Buy) {
    if (buy === 'full') this.money -= 3900
    else if (buy === 'force') this.money -= 2300
    else this.money -= 500
    this.money = Math.max(0, this.money)
  }

  onWin(kills: number) {
    this.money += 3000 + kills * 200
    this.lossStreak = 0
    this.money = Math.min(this.money, 9000)
  }

  onLoss(kills: number) {
    this.money += 1900 + Math.min(this.lossStreak, 2) * 500 + kills * 200
    this.lossStreak++
    this.money = Math.min(this.money, 9000)
  }

  reset() {
    this.money = 800
    this.lossStreak = 0
  }
}

const BUY_MOD: Record<Buy, number> = { full: 0, force: -6.5, eco: -15 }

// ---------------------------------------------------------------- round + map sim

interface MapCtx {
  lines: Record<string, MapLine>
  highlights: string[]
  rounds: RoundLog[]
}

function blankLine(): MapLine {
  return {
    kills: 0, deaths: 0, assists: 0, damage: 0,
    firstKills: 0, firstDeaths: 0, clutches: 0, rounds: 0, acs: 0,
  }
}

function allocateRound(
  winners: Player[],
  losers: Player[],
  winnersLost: number,
  losersLost: number,
  ctx: MapCtx,
  rng: Rng,
  mapName: string,
  /** when the round is being played around one player, they see more of it */
  focusId?: string,
): void {
  const roundKills: Record<string, number> = {}
  const kill = (killers: Player[], victims: Player[], count: number, firstOf: boolean) => {
    // a club fielding fewer than five still has to play; never divide by nobody
    if (!killers.length) return
    const vPool = victims.slice()
    for (let i = 0; i < count && vPool.length; i++) {
      // The flat term keeps role players on the scoreboard — even a star only
      // out-frags a support by roughly 1.5x over a season — but it used to be
      // most of the weight: a 96-aim controller fragged like a 67-aim
      // initiator, because the role factor outweighed thirty points of aim.
      // Real scoreboards do not look like that (happywei 221 ACS to stax's
      // 176), so the gun carries more of it now and the role a little less.
      const kw = killers.map(
        (p) => (42 + (p.attrs.aim * 0.55 + p.attrs.reaction * 0.3 + p.attrs.clutch * 0.15) * 0.78) *
          KILL_WEIGHT[p.role] * (0.9 + p.form / 500) * (p.id === focusId ? 1.55 : 1),
      )
      const dw = vPool.map(
        (p) => (120 - p.attrs.awareness * 0.35 - p.attrs.clutch * 0.2) * DEATH_WEIGHT[p.role],
      )
      const killer = rng.weighted(killers, kw)
      const victim = rng.weighted(vPool, dw)
      const kl = ctx.lines[killer.id]
      const vl = ctx.lines[victim.id]
      kl.kills++
      roundKills[killer.id] = (roundKills[killer.id] ?? 0) + 1
      // a kill is often the finish on someone a teammate already damaged
      kl.damage += 120 + rng.range(0, 55)
      vl.deaths++
      if (firstOf && i === 0) {
        const entryK = rng.weighted(killers, killers.map((p) => ENTRY_WEIGHT[p.role] * (p.attrs.aim / 60)))
        const entryV = rng.weighted(vPool, vPool.map((p) => ENTRY_WEIGHT[p.role]))
        ctx.lines[entryK.id].firstKills++
        ctx.lines[entryV.id].firstDeaths++
      }
      // assist from a utility-heavy teammate
      if (rng.chance(0.42)) {
        const mates = killers.filter((p) => p.id !== killer.id)
        if (mates.length) {
          const aw = mates.map((p) => p.attrs.utility * 0.7 + p.attrs.communication * 0.3)
          ctx.lines[rng.weighted(mates, aw).id].assists++
        }
      }
      vPool.splice(vPool.indexOf(victim), 1)
    }
  }

  kill(winners, losers, losersLost, true)
  kill(losers, winners, winnersLost, false)

  // Chip damage is a large, fairly flat share of every player's output. Keeping
  // it independent of kills is what stops a star's ADR running away with their
  // frag share, and lands the league near the real VCT average of ~135.
  for (const p of [...winners, ...losers]) {
    ctx.lines[p.id].damage += rng.range(20, 60) * (0.75 + p.attrs.utility / 260)
    ctx.lines[p.id].rounds++
  }

  const room = () => ctx.highlights.length < 9

  // a big individual round stands on its own, whether or not it was a clutch
  for (const p of winners) {
    const k = roundKills[p.id] ?? 0
    if (k >= 5 && room()) ctx.highlights.push(HL.ace(p.ign, mapName))
    else if (k === 4 && room() && rng.chance(0.5)) ctx.highlights.push(HL.quad(p.ign))
  }

  // a 1vX hold when the winning side was down to its last player. The survivor
  // is whoever was most likely to still be standing, and the X is how many they
  // actually took down — not the whole enemy side, which was the old bug.
  if (winnersLost === 4) {
    const hero = rng.weighted(
      winners,
      winners.map((p) => p.attrs.clutch * 0.6 + p.attrs.awareness * 0.4),
    )
    ctx.lines[hero.id].clutches++
    const took = Math.max(1, Math.min(roundKills[hero.id] ?? 1, losersLost))
    if (room() && (took >= 3 || rng.chance(0.4))) ctx.highlights.push(HL.clutch(hero.ign, took))
  }

}

/** A tactical instruction called during a timeout; decays over a few rounds. */
export interface TacticalCall {
  kind: 'focus' | 'rush' | 'steady'
  /** for 'focus': who the round is played around */
  playerId?: string
  roundsLeft: number
}

export type Side = 'a' | 'b'

/**
 * One map, played a round at a time.
 *
 * Watch mode drives this from the UI so it can stop for timeouts; skip mode
 * runs it straight to the end. Both share this exact code path, so a match you
 * watched and one you skipped are generated the same way.
 */
export class MapSim {
  readonly map: string
  readonly A: Lineup
  readonly B: Lineup
  a = 0
  b = 0
  /** rounds completed */
  round = 0
  timeouts: Record<Side, number> = { a: 2, b: 2 }
  calls: Record<Side, TacticalCall | null> = { a: null, b: null }

  private rng: Rng
  private ctx: MapCtx
  private ecoA = new Economy()
  private ecoB = new Economy()
  private halfA = 0
  private halfB = 0
  private otAnnounced = false
  private streak = 0
  private streakSide: 'A' | 'B' | null = null
  private mapPointSaid = false

  /** 'first13' is a real map; 'full24' plays both halves out, as scrims do */
  readonly format: 'first13' | 'full24'
  /** how each side turned up for THIS map — see MAP_SWING */
  private readonly swingA: number
  private readonly swingB: number

  constructor(map: string, A: Lineup, B: Lineup, rng: Rng, format: 'first13' | 'full24' = 'first13') {
    this.format = format
    this.map = map
    this.A = A
    this.B = B
    this.rng = rng
    this.swingA = rng.norm(0, MAP_SWING)
    this.swingB = rng.norm(0, MAP_SWING)
    this.ctx = { lines: {}, highlights: [], rounds: [] }
    for (const p of [...A.players, ...B.players]) this.ctx.lines[p.id] = blankLine()
  }

  /** Side, pistol status and half for the round about to be played. */
  private phase() {
    const r = this.round + 1
    if (r <= 12) return { aAttack: true, pistol: r === 1, half: 1 }
    if (r <= 24) return { aAttack: false, pistol: r === 13, half: 2 }
    const ot = r - 25
    return { aAttack: ot % 2 === 0, pistol: false, half: 3 }
  }

  get over(): boolean {
    // a scrim plays all 24 rounds so both sides get a full half on each side,
    // which is the point of the session
    if (this.format === 'full24') return this.round >= 24
    return (this.a >= 13 || this.b >= 13) && Math.abs(this.a - this.b) >= 2
  }

  get rounds(): RoundLog[] {
    return this.ctx.rounds
  }

  get highlights(): string[] {
    return this.ctx.highlights
  }

  /** True when this side still has a timeout and the map is live. */
  canTimeout(side: Side): boolean {
    return !this.over && this.timeouts[side] > 0 && this.round > 0
  }

  callTimeout(side: Side, call: Omit<TacticalCall, 'roundsLeft'>): boolean {
    if (!this.canTimeout(side)) return false
    this.timeouts[side]--
    this.calls[side] = { ...call, roundsLeft: 3 }
    return true
  }

  /**
   * Strength adjustment from an active tactical call.
   *
   * Scaled by the shape of the five it is called on: 强攻 with two duelists
   * is the comp doing its job, 强攻 with two sentinels is not.
   */
  private callMod(call: TacticalCall | null, attacking: boolean, style: CompStyle): number {
    if (!call) return 0
    if (call.kind === 'rush') return (attacking ? 2.4 : -1.6) * callBoost('rush', style)
    if (call.kind === 'steady') return (attacking ? -1.2 : 2.0) * callBoost('steady', style)
    return 0.6 // focus: a small lift from playing to a known strength
  }

  playRound(): void {
    if (this.over) return
    const { aAttack, pistol } = this.phase()
    this.round++

    // economies reset at each half and at the start of every overtime pair
    if (this.round === 1 || this.round === 13 ||
        (this.round >= 25 && (this.round - 25) % 2 === 0)) {
      this.ecoA.reset()
      this.ecoB.reset()
    }
    if (this.round === 13) {
      this.halfA = this.a
      this.halfB = this.b
    }
    if (this.round === 25 && this.format !== 'full24' && !this.otAnnounced) {
      this.otAnnounced = true
      this.ctx.highlights.push(HL.overtime())
      // each side gets one extra timeout for overtime, as in the real rules
      this.timeouts.a++
      this.timeouts.b++
    }

    const rng = this.rng
    const buyA = pistol ? 'eco' : this.ecoA.decide(rng)
    const buyB = pistol ? 'eco' : this.ecoB.decide(rng)
    if (!pistol) {
      this.ecoA.spend(buyA)
      this.ecoB.spend(buyB)
    }

    const strA = (aAttack ? this.A.atk : this.A.def) + (pistol ? 0 : BUY_MOD[buyA]) +
      this.callMod(this.calls.a, aAttack, this.A.style) + this.swingA
    const strB = (aAttack ? this.B.def : this.B.atk) + (pistol ? 0 : BUY_MOD[buyB]) +
      this.callMod(this.calls.b, !aAttack, this.B.style) + this.swingB

    // trailing side leans on mid-round calling to steady the ship
    const swingA = this.a < this.b ? this.A.midRound * 0.35 : 0
    const swingB = this.b < this.a ? this.B.midRound * 0.35 : 0

    // sensitivity is deliberately shallow: in real VCT even the strongest side
    // only takes ~60% of rounds off the field over a season
    const diff = strA + swingA - (strB + swingB)
    const sens = pistol ? ROUND_SENS + 5 : ROUND_SENS
    const p = 1 / (1 + Math.exp(-diff / sens))
    const aWins = rng.chance(p)

    // how many fell on each side — tuned so total kills land near the real
    // ~7 per round (KPR ≈ 0.7 across ten players)
    const rushing = (aWins ? this.calls.a : this.calls.b)?.kind === 'rush'
    const steady = (aWins ? this.calls.a : this.calls.b)?.kind === 'steady'
    const elim = rng.chance(rushing ? 0.82 : 0.75)
    const closeness = Math.abs(p - 0.5)

    const winners = aWins ? this.A.players : this.B.players
    const losers = aWins ? this.B.players : this.A.players
    // Casualties are bounded at both ends, and both bounds are needed.
    //
    // Capping by the victim's headcount alone — nobody can fall who is not
    // there — left the other half untouched: a two-man side still dealt out a
    // full five-victim quota, split between two players. It won 3.9% of its
    // rounds and posted a 1.22 K/D on 324 ACS against a 200 baseline, taking
    // MVP of a 0-13 loss. That is the two-row scoreboard a player sent in.
    //
    // So what a side can inflict scales with how many of them are alive to
    // shoot. At five the scale is exactly 1, which leaves ordinary matches
    // bit-for-bit unchanged.
    const power = (side: Player[]) => Math.min(1, side.length / 5)
    const losersLost = Math.min(
      losers.length,
      Math.round((elim ? 5 : rng.int(2, 4)) * power(winners)),
    )
    const winnersLost = Math.min(
      winners.length,
      Math.round(rng.weighted([0, 1, 2, 3, 4], [
        (1.2 - closeness) * (steady ? 1.6 : 1),
        2.6, 3.4, 2.8,
        (1.6 + closeness * 1.5) * (rushing ? 1.4 : steady ? 0.7 : 1),
      ]) * power(losers)),
    )
    const focus = (aWins ? this.calls.a : this.calls.b)
    allocateRound(
      winners, losers, winnersLost, losersLost, this.ctx, rng, mapCn(this.map),
      focus?.kind === 'focus' ? focus.playerId : undefined,
    )

    if (aWins) {
      this.a++
      this.ecoA.onWin(losersLost)
      this.ecoB.onLoss(winnersLost)
    } else {
      this.b++
      this.ecoB.onWin(losersLost)
      this.ecoA.onLoss(winnersLost)
    }

    // record how the round resolved for the broadcast round ribbon
    const attackersWon = aWins === aAttack
    const end: RoundLog['end'] = elim
      ? 'elim'
      : attackersWon
        ? 'spike'
        : rng.chance(0.55) ? 'defuse' : 'time'
    this.ctx.rounds.push({
      n: this.round, winner: aWins ? 'A' : 'B', aAttack, end,
      buyA: buyA as 'eco' | 'force' | 'full', buyB: buyB as 'eco' | 'force' | 'full',
    })

    const winnerName = aWins ? this.A.team.name : this.B.team.name
    const loserName = aWins ? this.B.team.name : this.A.team.name
    const room = () => this.ctx.highlights.length < 9

    if (pistol && room() && rng.chance(0.3)) {
      this.ctx.highlights.push(HL.eco(winnerName))
    }
    // a short buy beating a full one is the swing that decides halves
    const winnerBuy = aWins ? buyA : buyB
    const loserBuy = aWins ? buyB : buyA
    if (!pistol && winnerBuy === 'eco' && loserBuy === 'full' && room() && rng.chance(0.14)) {
      this.ctx.highlights.push(HL.antiEco(winnerName, loserName))
    }
    if (winnersLost === 0 && losersLost === 5 && room() && rng.chance(0.22)) {
      this.ctx.highlights.push(HL.flawless(winnerName))
    }
    // a run of rounds is worth a line once it is genuinely a run
    this.streak = this.streakSide === (aWins ? 'A' : 'B') ? this.streak + 1 : 1
    this.streakSide = aWins ? 'A' : 'B'
    if (this.streak === 5 && room()) this.ctx.highlights.push(HL.streak(winnerName, this.streak))
    // saved on the brink — worth saying once, not every round spent there
    if (!this.mapPointSaid) {
      if (!aWins && this.a === 12 && this.b < 12) {
        this.mapPointSaid = true
        if (room()) this.ctx.highlights.push(HL.mapPoint(this.B.team.name))
      } else if (aWins && this.b === 12 && this.a < 12) {
        this.mapPointSaid = true
        if (room()) this.ctx.highlights.push(HL.mapPoint(this.A.team.name))
      }
    }

    for (const side of ['a', 'b'] as Side[]) {
      const c = this.calls[side]
      if (c && --c.roundsLeft <= 0) this.calls[side] = null
    }
  }

  /** Finalise per-player lines and hand back the map result. */
  result(): { score: MapScore; highlights: string[] } {
    if ((this.halfA <= 3 && this.a > this.b) || (this.halfB <= 3 && this.b > this.a)) {
      const t = this.a > this.b ? this.A.team.name : this.B.team.name
      const from = this.a > this.b ? this.halfA : this.halfB
      if (this.ctx.highlights.length < 8) this.ctx.highlights.push(HL.comeback(t, from))
    }
    const total = this.a + this.b
    for (const id of Object.keys(this.ctx.lines)) {
      const l = this.ctx.lines[id]
      l.damage = Math.round(l.damage)
      l.rounds = total
      l.acs = total ? Math.round((l.damage / total) * 1.45) : 0
    }
    return {
      score: {
        map: this.map, scoreA: this.a, scoreB: this.b,
        edge: { a: this.A.edge, b: this.B.edge },
        lines: this.ctx.lines, rounds: this.ctx.rounds,
        agents: { ...this.A.agents, ...this.B.agents },
      },
      highlights: this.ctx.highlights,
    }
  }

  /** Run the remaining rounds without stopping. */
  runOut(): void {
    let guard = 0
    while (!this.over && guard++ < 80) this.playRound()
  }
}

/**
 * A whole match, map by map. The veto runs up front; each map is then a MapSim
 * the caller can step through or run out. `simulateMatch` below is just this
 * class driven to completion, so watched and skipped matches agree.
 */
export class MatchSim {
  readonly maps: string[]
  readonly vetoLog: string[]
  readonly need: number
  readonly aId: string
  readonly bId: string
  wonA = 0
  wonB = 0
  played: MapScore[] = []
  highlights: string[] = []
  current: MapSim | null = null
  mapIndex = -1

  private state: GameState
  private rng: Rng
  private seenA = new Set<string>()
  private seenB = new Set<string>()

  readonly format: 'first13' | 'full24'

  constructor(
    state: GameState, aId: string, bId: string, bo: 1 | 3 | 5, rng: Rng,
    agreed?: { map: string; format: 'first13' | 'full24' },
  ) {
    this.state = state
    this.aId = aId
    this.bId = bId
    this.rng = rng
    this.need = Math.ceil(bo / 2)
    this.format = agreed?.format ?? 'first13'
    if (agreed) {
      // a scrim has no veto — both sides agreed the map when booking it
      this.maps = [agreed.map]
      this.vetoLog = []
    } else if (state.vetoPlan && state.vetoPlan.maps.length === bo) {
      // the manager ran the veto himself on the pre-match screen
      this.maps = state.vetoPlan.maps.slice()
      this.vetoLog = state.vetoPlan.log.slice()
    } else {
      const pool = poolFor(state)
      const { maps, log } = runVeto(state, aId, bId, bo, pool, rng)
      this.maps = maps
      this.vetoLog = log
    }
  }

  get decided(): boolean {
    return this.wonA >= this.need || this.wonB >= this.need
  }

  /** Which side the managed club is on, for timeout routing. */
  sideOf(teamId: string): 'a' | 'b' | null {
    return teamId === this.aId ? 'a' : teamId === this.bId ? 'b' : null
  }

  /** Begin the next map. Returns false when the match is already decided. */
  nextMap(): boolean {
    if (this.decided || this.mapIndex + 1 >= this.maps.length) return false
    this.mapIndex++
    const m = this.maps[this.mapIndex]
    const A = buildLineup(this.state, this.aId, m, this.bId)
    const B = buildLineup(this.state, this.bId, m, this.aId)
    for (const p of A.players) this.seenA.add(p.id)
    for (const p of B.players) this.seenB.add(p.id)
    this.current = new MapSim(m, A, B, this.rng, this.format)
    return true
  }

  /** Fold the finished map into the match tally. */
  closeMap(): void {
    if (!this.current) return
    const { score, highlights } = this.current.result()
    this.played.push(score)
    for (const h of highlights) {
      if (this.highlights.length < 10) this.highlights.push(`[${mapCn(score.map)}] ${h}`)
    }
    // A 24-round scrim can finish 12-12. The else branch used to hand that to
    // side B: the news read "0-1", the whole squad lost form and morale for a
    // defeat, and the scoreboard right above it said 12–12.
    if (score.scoreA > score.scoreB) this.wonA++
    else if (score.scoreB > score.scoreA) this.wonB++
    this.current = null
  }

  finish(): MatchResult {
    const totals: Record<string, { acs: number; maps: number }> = {}
    for (const ms of this.played) {
      for (const [pid, l] of Object.entries(ms.lines)) {
        const t = (totals[pid] ??= { acs: 0, maps: 0 })
        t.acs += l.acs
        t.maps++
      }
    }
    const winnerIds = new Set(
      (this.wonA > this.wonB ? this.state.teams[this.aId] : this.state.teams[this.bId])?.roster ?? [],
    )
    let mvp: string | null = null
    let best = -1
    for (const [pid, t] of Object.entries(totals)) {
      if (!t.maps) continue
      const s = t.acs / t.maps + (winnerIds.has(pid) ? 18 : 0)
      if (s > best) {
        best = s
        mvp = pid
      }
    }
    return {
      mapsWonA: this.wonA, mapsWonB: this.wonB, maps: this.played,
      vetoLog: this.vetoLog, mvp, highlights: this.highlights,
      lineups: { a: [...this.seenA], b: [...this.seenB] },
    }
  }

  /** Play everything that is left without stopping. */
  runOut(): MatchResult {
    while (!this.decided && this.nextMap()) {
      this.current!.runOut()
      this.closeMap()
    }
    return this.finish()
  }
}

/**
 * Paperwork only the manager's own matches will ever show.
 *
 * The round log is one: nothing draws a ribbon for a match you did not play.
 * So is the edge breakdown — MatchModal renders 「为什么是这个结果」 behind an
 * `involved` check, so for every other club in the world those numbers were
 * written, saved and never once looked at. Three maps of them is 1.4kB a
 * match, and the league plays about seven hundred of them a season.
 */
export function stripRoundLogs(result: MatchResult): void {
  for (const m of result.maps) {
    delete m.rounds
    delete m.edge
  }
}

/**
 * Old matches keep their score and lose their paperwork.
 *
 * Every played match in the league kept its per-player lines, veto log and
 * highlights for the whole season — a thousand matches deep, the save grew to
 * 5.7MB of JSON (11MB as UTF-16 in storage) and localStorage refused every
 * autosave from about day 200 onward. Sixty thousand QuotaExceededErrors on
 * the dashboard were this.
 *
 * That first pass was not enough, and the dashboard said so: 134,000 more of
 * them the week this was written. Measured rather than guessed, a career at
 * day 224 was still writing 2.07MB of JSON — 4.1MB as UTF-16, against a 5MB
 * origin budget that also has to hold a manual save, the tutorial snapshot and
 * the card mode. Two things were still being kept that nothing reads:
 *
 *   Other clubs' matches kept `agents` and `lineups` after the prune, which is
 *   most of what was left of them — 780 bytes each where 140 will do, times
 *   seven hundred matches. Their scoreboard is already emptied here, so the
 *   agent each of those players picked has nowhere to be shown.
 *
 *   Our own matches kept everything for the whole season, 9kB apiece. The
 *   round-by-round ribbon and the edge breakdown are two thirds of that and
 *   both belong to the post-match screen, which is a thing you read the day it
 *   happens. After six weeks they go and the scoreboard stays, so the match
 *   still opens and still shows who did what.
 */
export function pruneMatchDetail(state: GameState): void {
  // ten days, which is exactly how far back the schedule screen looks by
  // default — so every other club's match you can still see in the list still
  // opens with its scoreboard, and the ones that lose it are the ones you
  // would have to go looking for
  const foreignCutoff = state.day - 10
  // six weeks: long enough that the ribbon is still there for anything you
  // might plausibly go back and re-read, short enough to bound the season
  const mineCutoff = state.day - 45
  for (const f of state.fixtures) {
    if (!f.played || !f.result) continue

    if (f.teamA === state.myTeam || f.teamB === state.myTeam) {
      if (f.day >= mineCutoff) continue
      for (const m of f.result.maps) {
        delete m.rounds
        delete m.edge
      }
      continue
    }

    if (f.day >= foreignCutoff) continue
    // already stripped: leave it alone rather than reallocating every day
    if (!f.result.vetoLog.length && !f.result.highlights.length && !f.result.lineups
      && !f.result.maps.some((m) => m.agents || m.edge || m.rounds || Object.keys(m.lines).length)) {
      continue
    }
    f.result.vetoLog = []
    f.result.highlights = []
    delete f.result.lineups
    for (const m of f.result.maps) {
      m.lines = {}
      delete m.edge
      delete m.rounds
      delete m.agents
    }
  }
}

/**
 * Everything the save can lose and still be the same career.
 *
 * The last resort, run in place when the browser has refused a write: every
 * match in the world comes down to its scoreline and its MVP, ours included,
 * and the feed and the ledger keep their most recent hundred lines. What
 * survives is what the game asks questions of — honours, squads, contracts,
 * the record — so nothing that decides an ending or an achievement is touched.
 * A career missing last month's scoreboards is not a career lost, which is the
 * only other option at this point.
 */
export function stripToTheBone(state: GameState): void {
  for (const f of state.fixtures) {
    if (!f.result) continue
    f.result.vetoLog = []
    f.result.highlights = []
    delete f.result.lineups
    // Other clubs' games come down to the series score. The table is built
    // from mapsWon, so the standings are untouched; what goes is the list of
    // map scores in a modal for a match you did not play. Ours keep their map
    // scores, because the achievements are still asking them questions.
    if (f.teamA !== state.myTeam && f.teamB !== state.myTeam) {
      f.result.maps = []
      continue
    }
    for (const m of f.result.maps) {
      m.lines = {}
      delete m.edge
      delete m.rounds
      delete m.agents
    }
  }
  if (state.news.length > 100) state.news.splice(0, state.news.length - 100)
  if (state.finances.log.length > 100) {
    state.finances.log.splice(0, state.finances.log.length - 100)
  }
}

// ---------------------------------------------------------------- match

export function simulateMatch(
  state: GameState,
  aId: string,
  bId: string,
  bo: 1 | 3 | 5,
  rng: Rng,
  agreed?: { map: string; format: 'first13' | 'full24' },
): MatchResult {
  return new MatchSim(state, aId, bId, bo, rng, agreed).runOut()
}

/** Roll the match's per-map lines into a player's season + career totals. */
export function applyMatchStats(state: GameState, result: MatchResult): void {
  for (const ms of result.maps) {
    for (const [pid, l] of Object.entries(ms.lines)) {
      const p = state.players[pid]
      if (!p) continue
      for (const bucket of [p.season, p.career]) {
        bucket.maps++
        bucket.rounds += l.rounds
        bucket.kills += l.kills
        bucket.deaths += l.deaths
        bucket.assists += l.assists
        bucket.firstKills += l.firstKills
        bucket.firstDeaths += l.firstDeaths
        bucket.damage += l.damage
        bucket.clutches += l.clutches
      }
    }
  }
  if (result.mvp) {
    const p = state.players[result.mvp]
    if (p) {
      p.season.mvps++
      p.career.mvps++
    }
  }
}

export { ratingOf } from './player'

/**
 * The best performance on ONE map — the same scoring the match MVP uses (ACS
 * plus a winner's nod), judged against that map's own winner. The match MVP
 * tag used to sit on every per-map sheet, where a 1.56 on the map lost the
 * label to whoever had averaged best across the series.
 */
export function mapMvp(
  map: MapScore, lineups?: { a: string[]; b: string[] },
): string | null {
  const winners = new Set(map.scoreA > map.scoreB ? lineups?.a ?? [] : lineups?.b ?? [])
  let best = -1
  let mvp: string | null = null
  for (const [pid, l] of Object.entries(map.lines)) {
    const s = l.acs + (winners.has(pid) ? 18 : 0)
    if (s > best) {
      best = s
      mvp = pid
    }
  }
  return mvp
}
