import { Rng, clamp } from './rng'
import { MAPS, HIGHLIGHT_TEMPLATES as HL } from './content'
import { coachOr } from './world'
import type {
  GameState, MapLine, MapScore, MatchResult, Player, Role, RoundLog, Team,
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
  const have = new Set(players.map((p) => p.role))
  const flex = players.filter((p) => p.role === '自由人').length
  let score = 0
  // a functioning comp wants smokes and a lockdown presence above all
  if (!have.has('控场') && flex === 0) score -= 7
  if (!have.has('哨卫') && flex === 0) score -= 5
  if (!have.has('先锋') && flex === 0) score -= 4
  if (!have.has('决斗者') && flex === 0) score -= 4
  const dupes = players.length - have.size - flex
  score -= Math.max(0, dupes) * 1.5
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
  const chem = (avg('teamwork') + avg('communication')) / 2
  const chemBonus = (chem - 65) * 0.07
  const coachBonus = (coachOr(team, 'tactics') - 60) * 0.05
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

  return { team, players, atk, def, chem, midRound }
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
): void {
  const kill = (killers: Player[], victims: Player[], count: number, firstOf: boolean) => {
    const vPool = victims.slice()
    for (let i = 0; i < count && vPool.length; i++) {
      // the flat term keeps role players on the scoreboard: even a star only
      // out-fragS a support by roughly 2x over a season, as in real VCT data
      // the flat term keeps role players on the scoreboard: even a star only
      // out-frags a support by roughly 1.5x over a season, as in real VCT data
      const kw = killers.map(
        (p) => (70 + (p.attrs.aim * 0.55 + p.attrs.reaction * 0.3 + p.attrs.clutch * 0.15) * 0.45) *
          KILL_WEIGHT[p.role] * (0.9 + p.form / 500),
      )
      const dw = vPool.map(
        (p) => (120 - p.attrs.awareness * 0.35 - p.attrs.clutch * 0.2) * DEATH_WEIGHT[p.role],
      )
      const killer = rng.weighted(killers, kw)
      const victim = rng.weighted(vPool, dw)
      const kl = ctx.lines[killer.id]
      const vl = ctx.lines[victim.id]
      kl.kills++
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

  // a 1vX hold when the winning side was down to its last player — the survivor
  // is whoever was most likely to still be standing
  if (winnersLost === 4) {
    const hero = rng.weighted(
      winners,
      winners.map((p) => p.attrs.clutch * 0.6 + p.attrs.awareness * 0.4),
    )
    ctx.lines[hero.id].clutches++
    if (losersLost === 5 && ctx.highlights.length < 8) {
      if (ctx.lines[hero.id].kills >= 4 && rng.chance(0.25)) {
        ctx.highlights.push(HL.ace(hero.ign, mapName))
      } else {
        ctx.highlights.push(HL.clutch(hero.ign, losersLost))
      }
    }
  }
}

function simulateMap(
  mapName: string,
  A: Lineup,
  B: Lineup,
  rng: Rng,
): { score: MapScore; highlights: string[] } {
  const ctx: MapCtx = { lines: {}, highlights: [], rounds: [] }
  for (const p of [...A.players, ...B.players]) ctx.lines[p.id] = blankLine()

  const ecoA = new Economy()
  const ecoB = new Economy()
  let a = 0
  let b = 0
  // A attacks the first half by convention
  let aAttacking = true
  let round = 0

  const playRound = (isPistol: boolean) => {
    round++
    const buyA = isPistol ? 'eco' : ecoA.decide(rng)
    const buyB = isPistol ? 'eco' : ecoB.decide(rng)
    if (!isPistol) {
      ecoA.spend(buyA)
      ecoB.spend(buyB)
    }

    const strA = (aAttacking ? A.atk : A.def) + (isPistol ? 0 : BUY_MOD[buyA])
    const strB = (aAttacking ? B.def : B.atk) + (isPistol ? 0 : BUY_MOD[buyB])

    // trailing side leans on mid-round calling to steady the ship
    const swingA = a < b ? A.midRound * 0.35 : 0
    const swingB = b < a ? B.midRound * 0.35 : 0

    // sensitivity is deliberately shallow: in real VCT even the strongest side
    // only takes ~60% of rounds off the field over a season
    const diff = strA + swingA - (strB + swingB)
    const sens = isPistol ? 22 : 17
    const p = 1 / (1 + Math.exp(-diff / sens))
    const aWins = rng.chance(p)

    // how many fell on each side — tuned so total kills land near the real
    // ~7 per round (KPR ≈ 0.7 across ten players)
    const elim = rng.chance(0.75)
    const losersLost = elim ? 5 : rng.int(2, 4)
    const closeness = Math.abs(p - 0.5)
    const winnersLost = rng.weighted([0, 1, 2, 3, 4], [
      1.2 - closeness, 2.6, 3.4, 2.8, 1.6 + closeness * 1.5,
    ])

    const winners = aWins ? A.players : B.players
    const losers = aWins ? B.players : A.players
    allocateRound(winners, losers, winnersLost, losersLost, ctx, rng, mapName)

    if (aWins) {
      a++
      ecoA.onWin(losersLost)
      ecoB.onLoss(winnersLost)
    } else {
      b++
      ecoB.onWin(losersLost)
      ecoA.onLoss(winnersLost)
    }

    // record how the round resolved for the broadcast round ribbon
    const attackersWon = aWins === aAttacking
    const end: RoundLog['end'] = elim
      ? 'elim'
      : attackersWon
        ? 'spike'
        : rng.chance(0.55) ? 'defuse' : 'time'
    ctx.rounds.push({
      n: round, winner: aWins ? 'A' : 'B', aAttack: aAttacking, end,
      buyA: buyA as 'eco' | 'force' | 'full', buyB: buyB as 'eco' | 'force' | 'full',
    })

    if (isPistol && ctx.highlights.length < 8 && rng.chance(0.3)) {
      ctx.highlights.push(HL.eco(aWins ? A.team.name : B.team.name))
    }
  }

  // first half
  ecoA.reset()
  ecoB.reset()
  for (let i = 0; i < 12 && a < 13 && b < 13; i++) playRound(i === 0)

  const halfA = a
  const halfB = b

  // second half — sides switch, economies reset
  aAttacking = !aAttacking
  ecoA.reset()
  ecoB.reset()
  for (let i = 0; i < 12 && a < 13 && b < 13; i++) playRound(i === 0)

  // overtime: alternate sides, win by two
  if (a === 12 && b === 12) {
    ctx.highlights.push(HL.overtime())
    let guard = 0
    while (Math.abs(a - b) < 2 && guard < 30) {
      ecoA.reset()
      ecoB.reset()
      playRound(false)
      aAttacking = !aAttacking
      playRound(false)
      aAttacking = !aAttacking
      guard++
    }
  }

  if ((halfA <= 3 && a > b) || (halfB <= 3 && b > a)) {
    const t = a > b ? A.team.name : B.team.name
    const from = a > b ? halfA : halfB
    if (ctx.highlights.length < 8) ctx.highlights.push(HL.comeback(t, from))
  }

  const totalRounds = a + b
  for (const id of Object.keys(ctx.lines)) {
    const l = ctx.lines[id]
    l.damage = Math.round(l.damage)
    l.rounds = totalRounds
    l.acs = totalRounds ? Math.round((l.damage / totalRounds) * 1.45) : 0
  }

  return {
    score: { map: mapName, scoreA: a, scoreB: b, lines: ctx.lines, rounds: ctx.rounds },
    highlights: ctx.highlights,
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
): MatchResult {
  const pool = activePool(state.seed + state.year)
  const { maps, log } = runVeto(state, aId, bId, bo, pool, rng)

  const need = Math.ceil(bo / 2)
  const played: MapScore[] = []
  const highlights: string[] = []
  let wonA = 0
  let wonB = 0

  for (const m of maps) {
    if (wonA >= need || wonB >= need) break
    const A = buildLineup(state, aId, m)
    const B = buildLineup(state, bId, m)
    const { score, highlights: mapHl } = simulateMap(m, A, B, rng)
    played.push(score)
    for (const h of mapHl) if (highlights.length < 10) highlights.push(`[${m}] ${h}`)
    if (score.scoreA > score.scoreB) wonA++
    else wonB++
  }

  // aggregate ACS over the match to crown an MVP
  const totals: Record<string, { acs: number; maps: number; kills: number }> = {}
  for (const ms of played) {
    for (const [pid, l] of Object.entries(ms.lines)) {
      const t = (totals[pid] ??= { acs: 0, maps: 0, kills: 0 })
      t.acs += l.acs
      t.maps++
      t.kills += l.kills
    }
  }
  let mvp: string | null = null
  let bestScore = -1
  const winnerIds = new Set(
    (wonA > wonB ? state.teams[aId] : state.teams[bId]).roster,
  )
  for (const [pid, t] of Object.entries(totals)) {
    if (!t.maps) continue
    // winners get the nod on a tie, as in real MVP voting
    const s = t.acs / t.maps + (winnerIds.has(pid) ? 18 : 0)
    if (s > bestScore) {
      bestScore = s
      mvp = pid
    }
  }

  return { mapsWonA: wonA, mapsWonB: wonB, maps: played, vetoLog: log, mvp, highlights }
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

/** VLR-style composite rating, calibrated so an average starter sits at ~1.00. */
export const ratingOf = (s: { kills: number; deaths: number; assists: number; rounds: number }) => {
  if (!s.rounds) return 0
  const kpr = s.kills / s.rounds
  const dpr = s.deaths / s.rounds
  const apr = s.assists / s.rounds
  return clamp(0.52 + kpr * 1.15 + apr * 0.28 - dpr * 0.55, 0, 3)
}
