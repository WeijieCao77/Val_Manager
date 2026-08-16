import { Rng, clamp } from './rng'
import { MAPS, HIGHLIGHT_TEMPLATES as HL } from './content'
import { coachOr } from './world'
import { NEUTRAL, squadHarmony } from './bonds'
import { skillMod } from './manager'
import type {
  EdgeBreakdown, GameState, MapLine, MapScore, MatchResult, Player, Role, RoundLog, Team,
} from './types'

/** How much each role tends to take kills / take deaths. */
const KILL_WEIGHT: Record<Role, number> = {
  决斗者: 1.18, 自由人: 1.03, 先锋: 0.98, 哨卫: 0.95, 控场: 0.90,
}
const DEATH_WEIGHT: Record<Role, number> = {
  决斗者: 1.25, 先锋: 1.08, 自由人: 1.0, 控场: 0.9, 哨卫: 0.88,
}
const ENTRY_WEIGHT: Record<Role, number> = {
  决斗者: 2.0, 先锋: 1.3, 自由人: 1.0, 哨卫: 0.6, 控场: 0.5,
}

export interface Lineup {
  team: Team
  players: Player[]
  atk: number
  def: number
  chem: number
  /** mid-round adaptation, drives comeback / clutch behaviour */
  midRound: number
  /** why this side is as strong as it is, kept for the post-match report */
  edge: EdgeBreakdown
}

/** A player's effective rating right now (form / morale / fatigue applied). */
export function effectiveRating(p: Player): number {
  const form = (p.form - 70) * 0.0028
  const morale = (p.morale - 70) * 0.0016
  const fatigue = -p.fatigue * 0.0016
  return p.overall * (1 + form + morale + fatigue)
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
    const rest = all
      .filter((p) => !chosen.includes(p))
      .sort((a, b) => effectiveRating(b) - effectiveRating(a))
    for (const p of rest) {
      if (chosen.length >= 5) break
      chosen.push(p)
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

function compositionScore(players: Player[]): number {
  // a player covers every role they actually play, not just their primary
  const have = new Set(players.flatMap((p) => p.roles ?? [p.role]))
  const flex = players.filter((p) => p.flex || p.role === '自由人').length
  let score = 0
  // a functioning comp wants smokes and a lockdown presence above all
  if (!have.has('控场')) score -= 7
  if (!have.has('哨卫')) score -= 5
  if (!have.has('先锋')) score -= 4
  if (!have.has('决斗者')) score -= 4
  // doubling up is workable but costs a little cohesion
  const covered = players.reduce((n, p) => n + (p.roles?.length ?? 1), 0)
  score -= Math.max(0, covered - have.size) * 1.2
  if (flex > 2) score -= (flex - 2) * 1.5
  return score
}

export function buildLineup(state: GameState, teamId: string, map: string): Lineup {
  const team = state.teams[teamId]
  const players = selectLineup(state, teamId)
  const effs = players.map(effectiveRating)

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

  const igl = players.find((p) => p.isIgl)
  const iglBonus = igl ? (igl.attrs.igl - 60) * 0.09 : -4
  // attributes say how well they can play together; bonds say whether they are
  const rapport = squadHarmony(state, team.id)
  const chem = clamp((avg('teamwork') + avg('communication')) / 2 + (rapport - NEUTRAL) * 0.18, 20, 99)
  const chemBonus = (chem - 65) * 0.07
  // 战术: the manager's own read of the game, on top of the coach's
  const coachBonus = (coachOr(team, 'tactics') - 60) * 0.05 +
    (team.id === state.myTeam ? (skillMod(state.manager, 'tactics', 0.06) - 1) : 0)
  const comp = compositionScore(players)
  const mapPref = ((team.mapPrefs[map] ?? 50) - 50) * 0.07

  const t = team.tactics
  // pace helps attack, hurts defence discipline; utility discipline helps both sides
  const paceAtk = (t.pace - 50) * 0.035
  const paceDef = -(t.pace - 50) * 0.022
  const utilBonus = (t.utility - 50) * 0.02 + (avg('utility') - 65) * 0.05
  const aggroAtk = (t.aggression - 50) * 0.028
  const aggroDef = -(t.aggression - 50) * 0.015

  const common = base + iglBonus + chemBonus + coachBonus + comp + mapPref + utilBonus
  const atk = common + paceAtk + aggroAtk + (avg('aim') - 65) * 0.05
  const def = common + paceDef + aggroDef + (avg('awareness') - 65) * 0.05 + 1.6

  const midRound =
    (t.adaptability - 50) * 0.05 + (igl ? (igl.attrs.igl - 60) * 0.06 : -3) + (avg('clutch') - 65) * 0.05

  const edge: EdgeBreakdown = {
    base, igl: iglBonus, chem: chemBonus, coach: coachBonus, comp,
    map: mapPref, utility: utilBonus,
    tacticsAtk: paceAtk + aggroAtk, tacticsDef: paceDef + aggroDef,
    atk, def,
  }
  return { team, players, atk, def, chem, midRound, edge }
}

// ---------------------------------------------------------------- map veto

/** The 7 maps in the active competitive pool this season. */
export function activePool(seed: number): string[] {
  const rng = new Rng(seed ^ 0x5eed)
  return rng.shuffle(MAPS.slice() as string[]).slice(0, 7).sort()
}

function vetoOrder(bo: 1 | 3 | 5): ('ban' | 'pick')[] {
  // 7-map pool
  if (bo === 1) return ['ban', 'ban', 'ban', 'ban', 'ban', 'ban']
  if (bo === 3) return ['ban', 'ban', 'pick', 'pick', 'ban', 'ban']
  return ['ban', 'ban', 'pick', 'pick', 'pick', 'pick']
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
      // the flat term keeps role players on the scoreboard: even a star only
      // out-fragS a support by roughly 2x over a season, as in real VCT data
      // the flat term keeps role players on the scoreboard: even a star only
      // out-frags a support by roughly 1.5x over a season, as in real VCT data
      const kw = killers.map(
        (p) => (70 + (p.attrs.aim * 0.55 + p.attrs.reaction * 0.3 + p.attrs.clutch * 0.15) * 0.45) *
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

  constructor(map: string, A: Lineup, B: Lineup, rng: Rng, format: 'first13' | 'full24' = 'first13') {
    this.format = format
    this.map = map
    this.A = A
    this.B = B
    this.rng = rng
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

  /** Strength adjustment from an active tactical call. */
  private callMod(call: TacticalCall | null, attacking: boolean): number {
    if (!call) return 0
    if (call.kind === 'rush') return attacking ? 2.4 : -1.6
    if (call.kind === 'steady') return attacking ? -1.2 : 2.0
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
      this.callMod(this.calls.a, aAttack)
    const strB = (aAttack ? this.B.def : this.B.atk) + (pistol ? 0 : BUY_MOD[buyB]) +
      this.callMod(this.calls.b, !aAttack)

    // trailing side leans on mid-round calling to steady the ship
    const swingA = this.a < this.b ? this.A.midRound * 0.35 : 0
    const swingB = this.b < this.a ? this.B.midRound * 0.35 : 0

    // sensitivity is deliberately shallow: in real VCT even the strongest side
    // only takes ~60% of rounds off the field over a season
    const diff = strA + swingA - (strB + swingB)
    const sens = pistol ? 22 : 17
    const p = 1 / (1 + Math.exp(-diff / sens))
    const aWins = rng.chance(p)

    // how many fell on each side — tuned so total kills land near the real
    // ~7 per round (KPR ≈ 0.7 across ten players)
    const rushing = (aWins ? this.calls.a : this.calls.b)?.kind === 'rush'
    const steady = (aWins ? this.calls.a : this.calls.b)?.kind === 'steady'
    const elim = rng.chance(rushing ? 0.82 : 0.75)
    const losersLost = elim ? 5 : rng.int(2, 4)
    const closeness = Math.abs(p - 0.5)
    const winnersLost = rng.weighted([0, 1, 2, 3, 4], [
      (1.2 - closeness) * (steady ? 1.6 : 1),
      2.6, 3.4, 2.8,
      (1.6 + closeness * 1.5) * (rushing ? 1.4 : steady ? 0.7 : 1),
    ])

    const winners = aWins ? this.A.players : this.B.players
    const losers = aWins ? this.B.players : this.A.players
    const focus = (aWins ? this.calls.a : this.calls.b)
    allocateRound(
      winners, losers, winnersLost, losersLost, this.ctx, rng, this.map,
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
    } else {
      const pool = activePool(state.seed + state.year)
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
    const A = buildLineup(this.state, this.aId, m)
    const B = buildLineup(this.state, this.bId, m)
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
      if (this.highlights.length < 10) this.highlights.push(`[${score.map}] ${h}`)
    }
    if (score.scoreA > score.scoreB) this.wonA++
    else this.wonB++
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

/** Round logs are only worth keeping for matches the manager actually watches. */
export function stripRoundLogs(result: MatchResult): void {
  for (const m of result.maps) delete m.rounds
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
