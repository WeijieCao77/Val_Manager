/**
 * 读点 — a 3–5 minute match your five plays round by round, with you calling it.
 *
 * Every other match in the card mode is handed in and simulated whole. Here the
 * two sides decide every round, at the same time and blind, the three things a
 * VALORANT team decides: what to buy, where to go (or where to stand), and who
 * takes the first fight. VALORANT's 极速模式 format — first to five, sides swap
 * after round four, a pistol round at the start of each half.
 *
 * The money is VALORANT's own: 800 a head at each pistol round, 3000 for a
 * round won, 1900 / 2400 / 2900 for one, two, three-or-more lost in a row, 300
 * to every attacker when the spike goes down, 200 a kill, 9000 at most. A man
 * who lives keeps his gun; a dead man's gun is gone. So the pistol round's
 * winners can buy the next round and its losers save, and the round after that
 * the losers buy in full off the loss bonus while the winners, if they spent it,
 * are back to light guns — that swing is what the buy decision is about.
 *
 * Plans meet in a cyclic table (PLAN_EDGE): every plan beats something and
 * loses to something, so no plan is right every round — check_swift.ts solves
 * the table and holds that every plan of both sides is in the equilibrium.
 * Each position's ultimate is a different kind of edge over that table:
 *   先锋 侦察 — see the other side's plan before your own is final
 *   控场 封烟 — your read, when it is right, counts half again; it blinds a 侦察
 *   哨卫 锁点 — when you are read, it costs you half
 *   决斗者 强突 — he takes the first fight, and takes it hard
 * The caller's 战术暂停 (one a half, one more with a coach) shows the other
 * side's money before you buy.
 *
 * Everything here is a pure function of the match state; the server holds the
 * state (swift-api.js) and the client only ever sees view().
 */
import { Rng } from './rng'
import { hashStr } from './rng'
import { cardById, isPlayerCard, ratingAt, PLAYER_CARDS, MAX_LEVEL } from './cards'
import type { PlayerCard } from './cards'
import { WORLD_TEAMS } from './teams'
import type { Role } from './types'

// ------------------------------------------------------------ the format

/** first to this many rounds (the quick format; see SWIFT_FORMATS) */
export const SWIFT_WIN = 5
/** rounds in a half; sides swap after it */
export const SWIFT_HALF = 4

/**
 * Two formats, two queues. 快速 is VALORANT's 极速模式, first to five. 完整 is
 * 竞技模式: first to thirteen, sides swap after twelve, and at 12:12 overtime —
 * every OT round each man has OT_CREDITS, sides swap every round, a two-round
 * lead wins, and after OT_LIMIT rounds without one the next round decides.
 */
export type SwiftFormat = 'quick' | 'full'
export const SWIFT_FORMATS: Record<SwiftFormat, { win: number; half: number; ot: boolean; name: string; minutes: string }> = {
  quick: { win: 5, half: 4, ot: false, name: '快速', minutes: '约 2–3 分钟' },
  full: { win: 13, half: 12, ot: true, name: '完整', minutes: '约 5–8 分钟' },
}
export const OT_CREDITS = 5000
export const OT_LIMIT = 5
export const isFormat = (v: unknown): v is SwiftFormat => v === 'quick' || v === 'full'
export const formatOf = (m: { format?: SwiftFormat }) => SWIFT_FORMATS[m.format ?? 'quick']
/** seconds after a reveal before the next call can be made: the round plays out on screen */
export const SWIFT_REPLAY_SEC = 4
/** seconds to call a round, and to change a plan after a 侦察 */
export const SWIFT_CHOOSE_SEC = 20
export const SWIFT_RECON_SEC = 10

// ------------------------------------------------------------ VALORANT's money

export const PISTOL_CREDITS = 800
export const WIN_CREDITS = 3000
/** one, two, three-or-more rounds lost in a row */
export const LOSS_CREDITS = [1900, 2400, 2900] as const
export const PLANT_CREDITS = 300
export const KILL_CREDITS = 200
export const MAX_CREDITS = 9000

/** guns, from the classic every man spawns with up */
export const WEAPONS = [
  { name: '经典', cost: 0, power: 0.30 },
  { name: '鬼魅', cost: 500, power: 0.42 },
  { name: '骇灵', cost: 1600, power: 0.70 },
  { name: '暴徒', cost: 2900, power: 1.0 },
] as const
export const SHIELDS = [
  { name: '无甲', cost: 0, guard: 0 },
  { name: '轻甲', cost: 400, guard: 0.10 },
  { name: '重甲', cost: 1000, guard: 0.18 },
] as const
/** what a man spends on abilities, by how much the team buys */
const UTILITY = { eco: 0, force: 200, full: 400 } as const
/** a pistol round: light shield and abilities, the classic kept */
const PISTOL_SPEND = 700

export type Buy = 'eco' | 'force' | 'full'
export const BUY_CN: Record<Buy, string> = { eco: '存钱', force: '强起', full: '全起' }

// ------------------------------------------------------------ plans

export type AttackPlan = 'A' | 'B' | 'split' | 'fake'
export type DefensePlan = 'stackA' | 'stackB' | 'even' | 'push'
export type Plan = AttackPlan | DefensePlan
export const ATTACK_PLANS: readonly AttackPlan[] = ['A', 'B', 'split', 'fake']
export const DEFENSE_PLANS: readonly DefensePlan[] = ['stackA', 'stackB', 'even', 'push']
export const PLAN_CN: Record<Plan, string> = {
  A: 'Rush A', B: 'Rush B', split: '中路拆分', fake: '假打转点',
  stackA: '堆 A', stackB: '堆 B', even: '均分', push: '前压',
}
/**
 * The attackers' edge, in duel log-odds, for every plan against every setup.
 * A rush runs over the side left light and over a defence pushed out of its
 * sites, and dies into a stack. A split splits an even setup and is cut off by
 * a push. A fake pulls a stack the wrong way, and is wasted time against an
 * even setup or a push. Solved in check_swift.ts: every plan is played.
 */
export const PLAN_EDGE: Record<AttackPlan, Record<DefensePlan, number>> = {
  A: { stackA: -0.75, stackB: 0.55, even: 0.15, push: 0.35 },
  B: { stackA: 0.55, stackB: -0.75, even: 0.15, push: 0.35 },
  split: { stackA: 0.2, stackB: 0.2, even: 0.45, push: -0.55 },
  fake: { stackA: 0.4, stackB: 0.4, even: -0.4, push: -0.35 },
}

// ------------------------------------------------------------ ultimates

export type Ult = 'recon' | 'smoke' | 'lock' | 'entry'
export const ULT_OF: Partial<Record<Role, Ult>> = { 先锋: 'recon', 控场: 'smoke', 哨卫: 'lock', 决斗者: 'entry' }
export const ULT_CN: Record<Ult, string> = { recon: '侦察', smoke: '封烟', lock: '锁点', entry: '强突' }
export const ULT_HINT: Record<Ult, string> = {
  recon: '先看到对方的打法，再改自己的',
  smoke: '读对了收益多一半，还能挡住对方的侦察',
  lock: '被读到时损失减半',
  entry: '他打首杀，而且更容易赢',
}
/** the team's ult points to fire one: a point for every kill made and every man lost, two for the spike */
export const ULT_COST = 16

// ------------------------------------------------------------ the match

export interface SwiftSeat {
  cardId: string
  ign: string
  role: Role
  /** card rating at the level brought */
  skill: number
}
export interface SwiftSide {
  name: string
  tag: string
  seats: SwiftSeat[]
  coach: string | null
  /** the five holds a caller (an IGL card) */
  igl: boolean
}
export interface TeamEcon {
  credits: number[]
  weapon: number[]
  shield: number[]
  /** the team's ult points (ULT_COST fires one, whose is the team's call) */
  ult: number
  /** rounds lost in a row */
  streak: number
  /** 战术暂停 left this half */
  pauses: number
  /** coach's extra pause, once a match */
  coachPause: number
}
export interface Choice {
  buy: Buy
  plan: Plan
  /** seat who takes the first fight */
  lead: number
  /** seat whose ultimate is used this round, if any */
  ult: number | null
}
export interface Kill { side: 0 | 1; killer: number; victim: number }
export interface RoundLog {
  round: number
  /** which team attacked */
  attacker: 0 | 1
  choices: [Choice, Choice]
  /** a 侦察 that changed a plan: the plan first locked */
  firstPlan?: [Plan | null, Plan | null]
  ults: [Ult | null, Ult | null]
  loadout: [number[], number[]]
  spent: [number, number]
  edge: number
  kills: Kill[]
  planted: boolean
  winner: 0 | 1
  credits: [number[], number[]]
  pistol: boolean
}
export interface SwiftMatch {
  v: 1
  seed: number
  sides: [SwiftSide, SwiftSide]
  /** team attacking in the first half */
  firstAttack: 0 | 1
  round: number
  score: [number, number]
  econ: [TeamEcon, TeamEcon]
  log: RoundLog[]
  pending: [Choice | null, Choice | null]
  phase: 'choose' | 'recon' | 'done'
  /** the side(s) that may change their plan after a 侦察 */
  recon: [boolean, boolean]
  /** pauses taken this round: that side sees the other's credits */
  paused: [boolean, boolean]
  winner: 0 | 1 | null
  /** this round's plans as first locked, where a 侦察 changed one */
  firstPlan?: [Plan | null, Plan | null]
  /** the side that gave the match up (swift-api.js) */
  resigned?: 0 | 1
  /** absent on matches made before formats: quick */
  format?: SwiftFormat
  /** rounds each side called itself, not by the clock (swift-api.js: a side that sat it out is not paid) */
  calls?: [number, number]
  /** both plans as they stood when a 侦察 stopped the round: what a scout is shown, whoever answers first */
  reconSeen?: [Plan, Plan]
}

// ------------------------------------------------------------ building a side

const ROLES: readonly Role[] = ['决斗者', '先锋', '控场', '哨卫']

/** A five as it walks in: card ids and levels. Null when a seat is empty or not a player card. */
export function swiftSide(name: string, tag: string, slots: readonly (string | null)[], coach: string | null, level: (id: string) => number): SwiftSide | null {
  if (slots.length < 5) return null
  const seats: SwiftSeat[] = []
  let igl = false
  for (let i = 0; i < 5; i++) {
    const id = slots[i]
    const card = id ? cardById(id) : undefined
    if (!id || !isPlayerCard(card)) return null
    seats.push({ cardId: id, ign: card.ign, role: card.role, skill: Math.round(ratingAt(card.rating, level(id)) * 10) / 10 })
    if (card.isIgl) igl = true
  }
  const c = coach ? cardById(coach) : undefined
  return { name, tag, seats, coach: c && c.kind === 'coach' ? coach : null, igl }
}

const freshEcon = (side: SwiftSide): TeamEcon => ({
  credits: [0, 0, 0, 0, 0].map(() => PISTOL_CREDITS),
  weapon: [0, 0, 0, 0, 0], shield: [0, 0, 0, 0, 0], ult: 0, streak: 0,
  pauses: side.igl ? 1 : 0, coachPause: side.coach ? 1 : 0,
})

export function newSwiftMatch(seed: number, a: SwiftSide, b: SwiftSide, format: SwiftFormat = 'quick'): SwiftMatch {
  return {
    v: 1, seed: seed >>> 0, sides: [a, b], firstAttack: (hashStr(`swift:side:${seed >>> 0}`) & 1) as 0 | 1,
    round: 1, score: [0, 0], econ: [freshEcon(a), freshEcon(b)], log: [],
    pending: [null, null], phase: 'choose', recon: [false, false], paused: [false, false], winner: null,
    format, calls: [0, 0],
  }
}

// ------------------------------------------------------------ reading the state

export const isPistol = (m: SwiftMatch, round = m.round): boolean => round === 1 || round === formatOf(m).half + 1
/** 0 first half, 1 second, 2 overtime */
export const periodOf = (m: SwiftMatch, round = m.round): 0 | 1 | 2 => {
  const h = formatOf(m).half
  return round <= h ? 0 : round <= 2 * h ? 1 : 2
}
export const isOvertime = (m: SwiftMatch, round = m.round): boolean => periodOf(m, round) === 2
/** the team attacking this round: first half, then swapped, then overtime swapping every round */
export const attackerOf = (m: SwiftMatch, round = m.round): 0 | 1 => {
  const p = periodOf(m, round)
  if (p === 0) return m.firstAttack
  if (p === 1) return (1 - m.firstAttack) as 0 | 1
  return ((round - 2 * formatOf(m).half - 1) % 2 === 0 ? m.firstAttack : 1 - m.firstAttack) as 0 | 1
}
/** whether this score ends the match */
export function matchOver(m: SwiftMatch, score: readonly [number, number]): boolean {
  const f = formatOf(m)
  const [a, b] = score
  if (f.ot && a + b >= 2 * f.half) return Math.abs(a - b) >= 2 || (a + b - 2 * f.half >= OT_LIMIT && a !== b)
  return a >= f.win || b >= f.win
}
export const plansFor = (m: SwiftMatch, team: 0 | 1): readonly Plan[] =>
  attackerOf(m) === team ? ATTACK_PLANS : DEFENSE_PLANS
/** the ultimate a seat holds, and whether it is charged */
export const ultOf = (m: SwiftMatch, team: 0 | 1, seat: number): Ult | null => ULT_OF[m.sides[team].seats[seat]?.role] ?? null
export const ultReady = (m: SwiftMatch, team: 0 | 1, seat: number): boolean =>
  !!ultOf(m, team, seat) && m.econ[team].ult >= ULT_COST

/** What each man would carry if the team bought this way — the shop preview, and the buy itself. */
export function loadoutFor(e: TeamEcon, buy: Buy, pistol: boolean): { weapon: number[]; shield: number[]; spend: number[] } {
  const weapon = e.weapon.slice(), shield = e.shield.slice(), spend = [0, 0, 0, 0, 0]
  const left = e.credits.slice()
  const pay = (i: number, n: number) => { left[i] -= n; spend[i] += n }
  if (pistol) {
    for (let i = 0; i < 5; i++) {
      if (buy === 'eco') continue
      // light shield and abilities; 强起 trades the shield for a 鬼魅
      if (buy === 'force' && left[i] >= WEAPONS[1].cost) { weapon[i] = Math.max(weapon[i], 1); pay(i, WEAPONS[1].cost) }
      else if (left[i] >= SHIELDS[1].cost) { shield[i] = Math.max(shield[i], 1); pay(i, Math.min(left[i], PISTOL_SPEND)) }
    }
    return { weapon, shield, spend }
  }
  if (buy === 'eco') return { weapon, shield, spend }
  const util = UTILITY[buy]
  const best = (i: number) => {
    // the best kit this man can afford on his own
    // 全起 is a rifle; 强起 is a half buy — an SMG and armour, the rifle money kept
    if (buy === 'full' && weapon[i] < 3 && left[i] >= WEAPONS[3].cost + SHIELDS[1].cost) { weapon[i] = 3; pay(i, WEAPONS[3].cost) }
    else if (weapon[i] < 2 && left[i] >= WEAPONS[2].cost + SHIELDS[1].cost) { weapon[i] = 2; pay(i, WEAPONS[2].cost) }
    else if (weapon[i] < 2 && buy === 'force' && left[i] >= WEAPONS[2].cost) { weapon[i] = 2; pay(i, WEAPONS[2].cost) }
    else if (weapon[i] < 1 && left[i] >= WEAPONS[1].cost + SHIELDS[1].cost) { weapon[i] = 1; pay(i, WEAPONS[1].cost) }
    const want = left[i] >= SHIELDS[2].cost && weapon[i] >= 2 ? 2 : left[i] >= SHIELDS[1].cost ? 1 : 0
    if (want > shield[i]) { pay(i, SHIELDS[want].cost); shield[i] = want }
    if (left[i] >= util) pay(i, util)
  }
  for (let i = 0; i < 5; i++) best(i)
  if (buy === 'full') {
    // 发枪: whoever has a rifle's worth left buys one for a teammate without
    for (let i = 0; i < 5; i++) {
      if (weapon[i] >= 3) continue
      let giver = -1
      for (let j = 0; j < 5; j++) if (left[j] >= WEAPONS[3].cost && (giver < 0 || left[j] > left[giver])) giver = j
      if (giver < 0) break
      // his own smaller gun's cost back is not modelled: the drop is a rifle on top
      pay(giver, WEAPONS[3].cost)
      weapon[i] = 3
    }
  }
  return { weapon, shield, spend }
}

const loadValue = (w: number, s: number) => WEAPONS[w].cost + SHIELDS[s].cost

// ------------------------------------------------------------ choices

/** A choice as a player sent it, made legal: unknown plans, seats and ults fall back. */
export function cleanChoice(m: SwiftMatch, team: 0 | 1, raw: unknown): Choice {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const plans = plansFor(m, team)
  const plan = plans.includes(r.plan as Plan) ? (r.plan as Plan) : plans[0]
  const buy: Buy = r.buy === 'eco' || r.buy === 'force' || r.buy === 'full' ? r.buy : 'full'
  const seat = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 5 ? (v as number) : null)
  let lead = seat(r.lead) ?? bestLead(m, team)
  const ult = seat(r.ult)
  const usable = ult !== null && ultReady(m, team, ult) ? ult : null
  // a duelist's 强突 is his own first fight
  if (usable !== null && ultOf(m, team, usable) === 'entry') lead = usable
  return { buy, plan, lead, ult: usable }
}

/** the obvious first fight: attackers send a duelist, defenders an anchor, the better shot first */
export function bestLead(m: SwiftMatch, team: 0 | 1): number {
  const seats = m.sides[team].seats
  const want: Role = attackerOf(m) === team ? '决斗者' : '哨卫'
  let best = 0
  for (let i = 1; i < 5; i++) {
    const s = seats[i].skill + (seats[i].role === want ? 4 : 0)
    if (s > seats[best].skill + (seats[best].role === want ? 4 : 0)) best = i
  }
  return best
}

/**
 * One side calls the round. When both have, the round is played — or, if a
 * 侦察 is up and not blinded, the match waits for the scout's second look.
 */
export function submitChoice(m: SwiftMatch, team: 0 | 1, raw: unknown): SwiftMatch {
  if (m.phase !== 'choose' || m.winner !== null) return m
  const next: SwiftMatch = { ...m, pending: m.pending.slice() as [Choice | null, Choice | null] }
  next.pending[team] = cleanChoice(m, team, raw)
  const [a, b] = next.pending
  if (!a || !b) return next
  const ultA = a.ult !== null ? ultOf(m, 0, a.ult) : null
  const ultB = b.ult !== null ? ultOf(m, 1, b.ult) : null
  const recon: [boolean, boolean] = [ultA === 'recon' && ultB !== 'smoke', ultB === 'recon' && ultA !== 'smoke']
  if (recon[0] || recon[1]) return { ...next, phase: 'recon', recon, reconSeen: [a.plan, b.plan] }
  return playRound(next)
}

/** After a 侦察: the scout's new plan (or the old one, sent again), and the round is played. */
export function submitRecon(m: SwiftMatch, team: 0 | 1, plan: unknown): SwiftMatch {
  if (m.phase !== 'recon' || !m.recon[team]) return m
  const pending = m.pending.slice() as [Choice | null, Choice | null]
  const cur = pending[team]!
  const plans = plansFor(m, team)
  const fp = (m.firstPlan ?? [null, null]).slice() as [Plan | null, Plan | null]
  if (plans.includes(plan as Plan) && plan !== cur.plan) { fp[team] = cur.plan; pending[team] = { ...cur, plan: plan as Plan } }
  const recon = m.recon.slice() as [boolean, boolean]
  recon[team] = false
  const next: SwiftMatch = { ...m, pending, recon, firstPlan: fp }
  return recon[0] || recon[1] ? next : playRound(next)
}

/** 战术暂停: the caller (or the coach, once) shows the other side's money this round. */
export function takePause(m: SwiftMatch, team: 0 | 1): SwiftMatch | null {
  if (m.phase !== 'choose' || m.paused[team] || m.pending[team]) return null
  const e = m.econ[team]
  if (e.pauses <= 0 && e.coachPause <= 0) return null
  const econ = m.econ.slice() as [TeamEcon, TeamEcon]
  econ[team] = e.pauses > 0 ? { ...e, pauses: e.pauses - 1 } : { ...e, coachPause: e.coachPause - 1 }
  const paused = m.paused.slice() as [boolean, boolean]
  paused[team] = true
  return { ...m, econ, paused }
}

// ------------------------------------------------------------ the round

/** a duel's log-odds per ten points of rating between the two men */
const SKILL_PER_10 = 0.45
/** a duel's log-odds per e-fold of gun-and-shield between them */
const GEAR = 1.25
/** the numbers: trading is easier for the side with more men up */
const NUMBERS = 0.18
const POST_PLANT = 0.2
/** holding an angle beats walking into one: every duel leans this far to the defenders */
const DEFENDER_EDGE = 0.25
const ENTRY_ULT = 0.9
const LEAD_ROLE = 0.25

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
const power = (w: number, s: number) => WEAPONS[w].power * (1 + SHIELDS[s].guard)

export function roundSeed(m: SwiftMatch, round = m.round): number {
  return hashStr(`swift:${m.seed}:${round}`) >>> 0
}

function playRound(m: SwiftMatch): SwiftMatch {
  const [ca, cb] = m.pending as [Choice, Choice]
  const choices: [Choice, Choice] = [ca, cb]
  const atk = attackerOf(m)
  const def = (1 - atk) as 0 | 1
  const pistol = isPistol(m)
  const rng = new Rng(roundSeed(m))
  const ults: [Ult | null, Ult | null] = [
    ca.ult !== null ? ultOf(m, 0, ca.ult) : null,
    cb.ult !== null ? ultOf(m, 1, cb.ult) : null,
  ]

  // the shop
  const kits = ([0, 1] as const).map((t) => loadoutFor(m.econ[t], choices[t].buy, pistol))
  const credits = ([0, 1] as const).map((t) => m.econ[t].credits.map((c, i) => c - kits[t].spend[i]))
  const weapon = kits.map((k) => k.weapon.slice())
  const shield = kits.map((k) => k.shield.slice())

  // the plans
  let edge = PLAN_EDGE[choices[atk].plan as AttackPlan][choices[def].plan as DefensePlan]
  // 封烟 makes a right read count more; 锁点 makes a wrong one cost less
  if (edge > 0 && ults[atk] === 'smoke') edge *= 1.5
  if (edge < 0 && ults[def] === 'smoke') edge *= 1.5
  if (edge < 0 && ults[atk] === 'lock') edge *= 0.5
  if (edge > 0 && ults[def] === 'lock') edge *= 0.5

  // the fight: duels until one side is down
  const alive = [[true, true, true, true, true], [true, true, true, true, true]]
  const kills: Kill[] = []
  let planted = false
  const up = (t: number) => alive[t].reduce((n, x) => n + (x ? 1 : 0), 0)
  const pickAlive = (t: number) => {
    const xs: number[] = []
    for (let i = 0; i < 5; i++) if (alive[t][i]) xs.push(i)
    return rng.pick(xs)
  }
  let duel = 0
  while (up(0) > 0 && up(1) > 0) {
    const first = duel === 0
    const a = first && alive[atk][choices[atk].lead] ? choices[atk].lead : pickAlive(atk)
    const d = first && alive[def][choices[def].lead] ? choices[def].lead : pickAlive(def)
    const sa = m.sides[atk].seats[a], sd = m.sides[def].seats[d]
    let x = SKILL_PER_10 * (sa.skill - sd.skill) / 10
      + GEAR * Math.log(power(weapon[atk][a], shield[atk][a]) / power(weapon[def][d], shield[def][d]))
      + edge * (first ? 1 : 0.7)
      + NUMBERS * (up(atk) - up(def))
      + (planted ? POST_PLANT : 0)
      - DEFENDER_EDGE
    if (first) {
      if (sa.role === '决斗者') x += LEAD_ROLE
      const anchor = choices[def].plan === 'push' ? sd.role === '决斗者' || sd.role === '先锋' : sd.role === '哨卫'
      if (anchor) x -= LEAD_ROLE
      if (ults[atk] === 'entry') x += ENTRY_ULT
      if (ults[def] === 'entry') x -= ENTRY_ULT
    }
    const atkWins = rng.next() < sigmoid(x)
    const [ks, k, v] = atkWins ? [atk, a, d] : [def, d, a]
    alive[1 - ks][v] = false
    kills.push({ side: ks, killer: k, victim: v })
    duel++
    // the spike goes down once the attackers have held their own through the opening fights
    if (!planted && duel >= 2 && up(atk) > 0 && up(atk) >= up(def)) planted = true
  }
  const winner = (up(atk) > 0 ? atk : def) as 0 | 1

  // the money and the guns
  const econ = ([0, 1] as const).map((t): TeamEcon => {
    const e = m.econ[t]
    const won = t === winner
    const streak = won ? 0 : e.streak + 1
    const bonus = won ? WIN_CREDITS : LOSS_CREDITS[Math.min(streak, LOSS_CREDITS.length) - 1]
    const c = credits[t].map((v, i) => {
      const k = kills.filter((x) => x.side === t && x.killer === i).length
      return Math.min(MAX_CREDITS, v + bonus + k * KILL_CREDITS + (t === atk && planted ? PLANT_CREDITS : 0))
    })
    const made = kills.filter((x) => x.side === t).length
    const lost = kills.filter((x) => x.side !== t).length
    const ult = Math.min(ULT_COST, (choices[t].ult !== null ? 0 : e.ult) + made + lost + (t === atk && planted ? 2 : 0))
    return {
      ...e, credits: c, streak, ult,
      weapon: weapon[t].map((w, i) => (alive[t][i] ? w : 0)),
      shield: shield[t].map((s, i) => (alive[t][i] ? s : 0)),
    }
  }) as [TeamEcon, TeamEcon]

  const fp = m.firstPlan
  const log: RoundLog = {
    round: m.round, attacker: atk, choices, ults,
    ...(fp && (fp[0] || fp[1]) ? { firstPlan: fp } : {}),
    loadout: [kits[0].weapon.map((w, i) => loadValue(w, kits[0].shield[i])), kits[1].weapon.map((w, i) => loadValue(w, kits[1].shield[i]))],
    spent: [kits[0].spend.reduce((s, x) => s + x, 0), kits[1].spend.reduce((s, x) => s + x, 0)],
    edge: Math.round(edge * 100) / 100, kills, planted, winner,
    credits: [econ[0].credits.slice(), econ[1].credits.slice()], pistol,
  }
  const score: [number, number] = [m.score[0] + (winner === 0 ? 1 : 0), m.score[1] + (winner === 1 ? 1 : 0)]
  const done = matchOver(m, score)
  const round = m.round + 1
  const f = formatOf(m)
  // the swap: everybody back to 800 and a classic; ult points stay, as they do in the game
  if (!done && round === f.half + 1) {
    for (const t of [0, 1] as const) {
      econ[t] = {
        ...econ[t], credits: [0, 0, 0, 0, 0].map(() => PISTOL_CREDITS), weapon: [0, 0, 0, 0, 0], shield: [0, 0, 0, 0, 0], streak: 0,
        pauses: m.sides[t].igl ? 1 : 0,
      }
    }
  }
  // overtime: every round starts on the same money; the caller gets a pause for it
  if (!done && isOvertime(m, round)) {
    for (const t of [0, 1] as const) {
      econ[t] = {
        ...econ[t], credits: [0, 0, 0, 0, 0].map(() => OT_CREDITS), streak: 0,
        pauses: round === 2 * f.half + 1 ? (m.sides[t].igl ? 1 : 0) : econ[t].pauses,
      }
    }
  }
  const out: SwiftMatch = {
    ...m, firstPlan: undefined,
    round: done ? m.round : round, score, econ, log: [...m.log, log],
    pending: [null, null], phase: done ? 'done' : 'choose', recon: [false, false], paused: [false, false],
    winner: done ? (score[0] > score[1] ? 0 : 1) : null,
  }
  delete out.firstPlan
  delete out.reconSeen
  return out
}

/** A side that let the clock run: the round is called for it the way the AI would. */
export function autoChoice(m: SwiftMatch, team: 0 | 1): Choice {
  return aiChoice(m, team, new Rng(hashStr(`swift:auto:${m.seed}:${m.round}:${team}`) >>> 0))
}

// ------------------------------------------------------------ the AI and the ghosts

/** How a side tends to call rounds: plan weights by side, and how readily it forces. */
export interface Habit {
  attack: Record<AttackPlan, number>
  defense: Record<DefensePlan, number>
  /** 0–1: buying with too little money */
  force: number
}
/** close to the table's equilibrium (check_swift.ts prints the exact one) */
export const EVEN_HABIT: Habit = {
  attack: { A: 0.25, B: 0.25, split: 0.27, fake: 0.23 },
  defense: { stackA: 0.24, stackB: 0.24, even: 0.25, push: 0.27 },
  force: 0.35,
}

/** what a team should buy — the way pros do it, with a habit's lean */
export function aiBuy(m: SwiftMatch, team: 0 | 1, rng: Rng, force = EVEN_HABIT.force): Buy {
  if (isPistol(m)) return rng.chance(0.25) ? 'force' : 'full'
  const e = m.econ[team]
  const avg = e.credits.reduce((s, c) => s + c, 0) / 5
  const rifles = e.weapon.filter((w) => w >= 3).length
  if (avg >= 3900 || (avg >= 3000 && rifles >= 2)) return 'full'
  const theirs = m.score[1 - team]
  const f = formatOf(m)
  // one round from losing the match, the last round of a half, or overtime: no point saving
  const lastChance = theirs === f.win - 1 || m.round === f.half || m.round === 2 * f.half || isOvertime(m)
  if (lastChance) return 'force'
  // the round after the pistol, lost: save for a full buy next round
  const nextLoss = LOSS_CREDITS[Math.min(e.streak + 1, LOSS_CREDITS.length) - 1]
  if (avg + nextLoss >= 3900 && avg < 2400) return rng.chance(force * 0.5) ? 'force' : 'eco'
  return rng.chance(force) ? 'force' : avg >= 2400 ? 'force' : 'eco'
}

function weighted<T extends string>(rng: Rng, w: Record<T, number>): T {
  const keys = Object.keys(w) as T[]
  return rng.weighted(keys, keys.map((k) => w[k]))
}

/** the AI: an even habit, bent toward whatever beats what the other side has been doing */
export function aiChoice(m: SwiftMatch, team: 0 | 1, rng: Rng, habit: Habit = EVEN_HABIT, adapt = 0.5): Choice {
  const attacking = attackerOf(m) === team
  let plan: Plan
  // what the other side did on this side of the map this half
  const half = m.log.filter((r) => periodOf(m, r.round) === periodOf(m, m.round) && r.attacker === attackerOf(m))
  const seen = half.map((r) => r.choices[1 - team].plan)
  if (attacking) {
    const w = { ...habit.attack }
    if (seen.length && adapt > 0) {
      for (const p of ATTACK_PLANS) {
        const vs = seen.reduce((s, d) => s + PLAN_EDGE[p][d as DefensePlan], 0) / seen.length
        w[p] = Math.max(0.02, w[p] * Math.exp(adapt * vs * 4))
      }
    }
    plan = weighted(rng, w)
  } else {
    const w = { ...habit.defense }
    if (seen.length && adapt > 0) {
      for (const d of DEFENSE_PLANS) {
        const vs = seen.reduce((s, p) => s + PLAN_EDGE[p as AttackPlan][d], 0) / seen.length
        w[d] = Math.max(0.02, w[d] * Math.exp(-adapt * vs * 4))
      }
    }
    plan = weighted(rng, w)
  }
  // a charged bar is spent at once, on whichever of its positions comes up
  const ready: number[] = []
  for (let i = 0; i < 5; i++) if (ultReady(m, team, i)) ready.push(i)
  const ult = ready.length ? rng.pick(ready) : null
  const lead = ult !== null && ultOf(m, team, ult) === 'entry' ? ult : bestLead(m, team)
  return { buy: aiBuy(m, team, rng, habit.force), plan, lead, ult }
}

/** the AI's second look after its 侦察: the plan that does best against what it saw */
export function aiRecon(m: SwiftMatch, team: 0 | 1): Plan {
  const other = m.pending[1 - team]!.plan
  if (attackerOf(m) === team) {
    let best: AttackPlan = 'A'
    for (const p of ATTACK_PLANS) if (PLAN_EDGE[p][other as DefensePlan] > PLAN_EDGE[best][other as DefensePlan]) best = p
    return best
  }
  let best: DefensePlan = 'stackA'
  for (const d of DEFENSE_PLANS) if (PLAN_EDGE[other as AttackPlan][d] < PLAN_EDGE[other as AttackPlan][best]) best = d
  return best
}

/** A habit learned from the rounds a player has called, mixed with the even habit while there are few. */
export function habitFrom(counts: { attack?: Partial<Record<AttackPlan, number>>; defense?: Partial<Record<DefensePlan, number>>; force?: number; buys?: number } | null | undefined): Habit {
  const PRIOR = 6
  const mix = <T extends string>(keys: readonly T[], seen: Partial<Record<T, number>> | undefined, even: Record<T, number>) => {
    const n = keys.reduce((s, k) => s + Math.max(0, Number(seen?.[k]) || 0), 0)
    return Object.fromEntries(keys.map((k) => [k, (Math.max(0, Number(seen?.[k]) || 0) + PRIOR * even[k]) / (n + PRIOR)])) as Record<T, number>
  }
  const buys = Math.max(0, Number(counts?.buys) || 0)
  return {
    attack: mix(ATTACK_PLANS, counts?.attack, EVEN_HABIT.attack),
    defense: mix(DEFENSE_PLANS, counts?.defense, EVEN_HABIT.defense),
    force: (Math.max(0, Number(counts?.force) || 0) + PRIOR * EVEN_HABIT.force) / (buys + PRIOR),
  }
}

/** One match's rounds folded into a player's habit counts. */
export function addHabit(counts: Record<string, unknown> | null | undefined, m: SwiftMatch, team: 0 | 1): Record<string, unknown> {
  const c = (counts && typeof counts === 'object' ? JSON.parse(JSON.stringify(counts)) : {}) as {
    attack?: Record<string, number>; defense?: Record<string, number>; force?: number; buys?: number
  }
  c.attack ??= {}; c.defense ??= {}
  for (const r of m.log) {
    const ch = r.choices[team]
    const plan = r.firstPlan?.[team] ?? ch.plan
    if (r.attacker === team) c.attack[plan] = (c.attack[plan] ?? 0) + 1
    else c.defense[plan] = (c.defense[plan] ?? 0) + 1
    if (!r.pistol) {
      c.buys = (c.buys ?? 0) + 1
      if (ch.buy === 'force') c.force = (c.force ?? 0) + 1
    }
  }
  return c
}

// ------------------------------------------------------------ what a player sees

export interface SwiftView {
  me: 0 | 1
  sides: [SwiftSide, SwiftSide]
  round: number
  score: [number, number]
  attacking: boolean
  pistol: boolean
  format: SwiftFormat
  overtime: boolean
  /** the last round before the sides swap */
  lastOfHalf: boolean
  phase: SwiftMatch['phase']
  winner: 0 | 1 | null
  mine: TeamEcon
  /** the other side's money only after a pause; their guns and ult points always (the scoreboard shows them) */
  theirs: { credits: number[] | null; weapon: number[]; shield: number[]; ult: number; streak: number }
  plans: readonly Plan[]
  locked: boolean
  /** the other side has called the round */
  theyLocked: boolean
  /** 侦察: their plan, while you may change yours */
  scouted: Plan | null
  waitingRecon: boolean
  paused: boolean
  log: RoundLog[]
  resigned: 0 | 1 | null
}

export function swiftView(m: SwiftMatch, me: 0 | 1): SwiftView {
  const them = (1 - me) as 0 | 1
  const o = m.econ[them]
  return {
    me, sides: m.sides, round: m.round, score: m.score, attacking: attackerOf(m) === me, pistol: isPistol(m),
    format: m.format ?? 'quick', overtime: isOvertime(m), lastOfHalf: m.round === formatOf(m).half || m.round === 2 * formatOf(m).half,
    phase: m.phase, winner: m.winner, mine: m.econ[me],
    theirs: { credits: m.paused[me] ? o.credits : null, weapon: o.weapon, shield: o.shield, ult: o.ult, streak: o.streak },
    plans: plansFor(m, me), locked: !!m.pending[me], theyLocked: !!m.pending[them],
    scouted: m.phase === 'recon' && m.recon[me] ? (m.reconSeen?.[them] ?? m.pending[them]!.plan) : null,
    waitingRecon: m.phase === 'recon' && !m.recon[me],
    // the other side's money is shown only through a pause — never through the round log
    paused: m.paused[me], log: m.log.map((r) => ({ ...r, credits: (me === 0 ? [r.credits[0], []] : [[], r.credits[1]]) as [number[], number[]] })),
    resigned: m.resigned ?? null,
  }
}

export const swiftRoles: readonly Role[] = ROLES

// ------------------------------------------------------------ a real club when nobody else is about

const CLUB_FIVES: { id: string; name: string; tag: string; slots: string[] }[] = (() => {
  const byClub = new Map<string, PlayerCard[]>()
  for (const c of PLAYER_CARDS) {
    if (c.legend || c.former || c.retired || c.event || !c.clubId) continue
    const xs = byClub.get(c.clubId) ?? []
    xs.push(c)
    byClub.set(c.clubId, xs)
  }
  const out: { id: string; name: string; tag: string; slots: string[] }[] = []
  for (const t of WORLD_TEAMS) {
    const xs = (byClub.get(t.id) ?? []).slice().sort((a, b) => b.rating - a.rating)
    if (xs.length < 5) continue
    // one of each position first, then the best left
    const slots: string[] = []
    for (const r of ROLES) { const c = xs.find((x) => x.role === r && !slots.includes(x.id)); if (c) slots.push(c.id) }
    for (const c of xs) if (slots.length < 5 && !slots.includes(c.id)) slots.push(c.id)
    out.push({ id: t.id, name: t.name, tag: t.tag, slots })
  }
  return out
})()

/** A real club's five, its levels set so the match is close to a five of this strength. */
export function aiSide(seed: number, near: number): SwiftSide {
  const rng = new Rng(hashStr(`swift:ai:${seed >>> 0}`) >>> 0)
  const at = (f: { slots: string[] }, lv: number) => f.slots.reduce((s, id) => s + ratingAt((cardById(id) as PlayerCard).rating, lv), 0) / 5
  const pool = CLUB_FIVES.filter((f) => at(f, 0) <= near + 2 && at(f, MAX_LEVEL) >= near - 2)
  const f = rng.pick(pool.length ? pool : CLUB_FIVES)
  let lv = 0
  for (let l = 0; l <= MAX_LEVEL; l++) if (Math.abs(at(f, l) - near) < Math.abs(at(f, lv) - near)) lv = l
  return swiftSide(f.name, f.tag, f.slots, null, () => lv)!
}

/** the mean of a five's seats — what matching and the AI's level aim at */
export const sideStrength = (s: SwiftSide): number => Math.round(s.seats.reduce((x, y) => x + y.skill, 0) / 5 * 10) / 10
