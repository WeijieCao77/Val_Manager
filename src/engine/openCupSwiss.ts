/**
 * 全服杯, format 2 (2026-09-18): a Swiss stage, then a knockout.
 *
 *   瑞士轮   BO3. Everybody starts 0–0. Two wins and you are through; two
 *            losses and you are out; one loss is not the end. Three rounds at
 *            most, because after three everybody has two of one or the other.
 *   playoff  BO5, the final included. Everyone who got through, single
 *            elimination. A field that is not a power of two plays an 入围轮
 *            first, and the byes of that round go to the best Swiss records.
 *
 * Format 1 (openCup.ts: one knockout, BO3, final BO5) is untouched, and a cup
 * that started on it finishes on it — `open_cups.format_version` says which.
 *
 * Pure, like openCup.ts: seats in, pairings out, everything a function of the
 * cup's seed. opencup-api.js is storage, a clock and a queue.
 *
 * What the pairing promises, in the order it gives things up when it must:
 *   1. everybody still in the stage has exactly one tie or the bye, never
 *      two, never himself;
 *   2. nobody has a second bye while somebody eligible has had none;
 *   3. no rematch;
 *   4. same record plays same record; when a group is odd one man floats to
 *      the next group down, and it is the man who has floated least;
 *   5. the cup's seed breaks every tie.
 * It is NOT a search over all pairings of 4,096 people. Each record group is
 * paired greedily in seeded order (O(n) with a bounded look-ahead), a dead end
 * is repaired by re-pairing one earlier tie (bounded), and only a group of
 * eight or fewer is solved exactly — 105 matchings at most. When a rematch
 * cannot be avoided (it takes a field of five or so) the pairing says so in
 * `notes` rather than looping or handing anyone a walkover.
 */
import { Rng, hashStr } from './rng'

export const OPEN_CUP_FORMAT = 2
export const SWISS_ROUNDS = 3
export const SWISS_WINS_THROUGH = 2
export const SWISS_LOSSES_OUT = 2
export const SWISS_BO = 3 as const
export const PLAYOFF_BO = 5 as const
/** A Swiss win that was played pays this; a playoff win pays OPEN_CUP_WIN_COINS (40). A bye pays nothing. */
export const SWISS_WIN_COINS = 20

export interface SwissSeat {
  id: string
  /** wins that count toward going through — a bye is one */
  wins: number
  losses: number
  byes: number
  /** times already paired out of his record group */
  floats: number
  /** everybody he has played in this cup */
  met: string[]
}

export interface SwissPairing {
  pairs: [string, string][]
  bye: string | null
  /** who was paired out of his record group this round */
  floated: string[]
  /** ties between two who have already met — 0 unless `notes` says why */
  rematches: number
  notes: string[]
}

const LOOKAHEAD = 24
const REPAIR_SCAN = 64
const EXACT_MAX = 8

const stillIn = (s: SwissSeat) => s.wins < SWISS_WINS_THROUGH && s.losses < SWISS_LOSSES_OUT

/** Every perfect matching of a small even group, the one with the fewest rematches (first found wins ties). */
function exactGroup(ids: string[], met: (a: string, b: string) => boolean): { pairs: [string, string][]; rematches: number } {
  let best: { pairs: [string, string][]; rematches: number } | null = null
  const walk = (left: string[], acc: [string, string][], bad: number) => {
    if (best && bad >= best.rematches) return
    if (!left.length) { best = { pairs: acc.slice(), rematches: bad }; return }
    const [a, ...rest] = left
    for (let i = 0; i < rest.length; i++) {
      const b = rest[i]
      acc.push([a, b])
      walk(rest.filter((_, k) => k !== i), acc, bad + (met(a, b) ? 1 : 0))
      acc.pop()
      if (best && (best as { rematches: number }).rematches === 0) return
    }
  }
  walk(ids, [], 0)
  return best ?? { pairs: [], rematches: 0 }
}

/** One record group, an even number of them, already in seeded order. */
function pairGroup(ids: string[], met: (a: string, b: string) => boolean, notes: string[]): { pairs: [string, string][]; rematches: number } {
  if (ids.length <= EXACT_MAX) {
    const r = exactGroup(ids, met)
    if (r.rematches) notes.push(`${ids.length} 人同战绩组无法完全避免重赛，重赛 ${r.rematches} 场`)
    return r
  }
  const free = ids.slice()
  const pairs: [string, string][] = []
  let rematches = 0
  while (free.length) {
    const a = free.shift()!
    let at = -1
    for (let i = 0; i < free.length && i < LOOKAHEAD; i++) if (!met(a, free[i])) { at = i; break }
    if (at < 0) for (let i = LOOKAHEAD; i < free.length; i++) if (!met(a, free[i])) { at = i; break }
    if (at >= 0) { pairs.push([a, free.splice(at, 1)[0]]); continue }
    // Everybody left has met `a` (he has met three people at most, so this is
    // the very end of the list). Re-pair one tie already made: (x, y) becomes
    // (a, x) and (y, z) for some free z — bounded, newest ties first.
    let fixed = false
    for (let k = pairs.length - 1; k >= 0 && k >= pairs.length - REPAIR_SCAN && !fixed; k--) {
      const [x, y] = pairs[k]
      for (const [p, q] of [[x, y], [y, x]] as const) {
        if (met(a, p)) continue
        const zi = free.findIndex((z) => !met(q, z))
        if (zi < 0) continue
        pairs[k] = [a, p]
        pairs.push([q, free.splice(zi, 1)[0]])
        fixed = true
        break
      }
    }
    if (fixed) continue
    rematches++
    notes.push(`无法避免 ${a} 的重赛`)
    pairs.push([a, free.shift()!])
  }
  return { pairs, rematches }
}

/** Small fields are solved together, including the bye, so choosing a floater
 * cannot force a rematch that another legal pairing would have avoided.
 * At most nine seats: 9 × 105 matchings, a hard bound independent of field cap. */
function exactSmallSwiss(order: SwissSeat[], met: (a: string, b: string) => boolean): SwissPairing {
  const minimumByes = Math.min(...order.map((s) => s.byes))
  const candidates: (SwissSeat | null)[] = order.length % 2 ? order.filter((s) => s.byes === minimumByes) : [null]
  let best: { cost: number[]; plan: SwissPairing } | null = null
  const better = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
    return false
  }
  for (const bye of candidates) {
    const walk = (remaining: SwissSeat[], pairs: [SwissSeat, SwissSeat][]) => {
      if (remaining.length) {
        const [a, ...rest] = remaining
        for (let i = 0; i < rest.length; i++) walk(rest.filter((_, j) => i !== j), [...pairs, [a, rest[i]]])
        return
      }
      const rematches = pairs.filter(([a, b]) => met(a.id, b.id)).length
      const cross = pairs.filter(([a, b]) => a.wins !== b.wins || a.losses !== b.losses)
      const distance = cross.reduce((n, [a, b]) => n + Math.abs(a.wins - b.wins) + Math.abs(a.losses - b.losses), 0)
      const cost = [rematches, bye?.wins ?? 0, -(bye?.losses ?? 0), distance,
        cross.reduce((n, [a, b]) => n + a.floats + b.floats, 0), bye ? order.indexOf(bye) : 0]
      if (best && !better(cost, best.cost)) return
      const notes: string[] = []
      if (rematches) notes.push(`${order.length} 人活跃组穷举后仍无法避免 ${rematches} 场重赛`)
      if (bye && bye.byes) notes.push(`${bye.id} 再次轮空：所有活跃选手均已轮空`)
      best = { cost, plan: { pairs: pairs.map(([a, b]) => [a.id, b.id]), bye: bye?.id ?? null,
        floated: cross.flatMap(([a, b]) => [a.id, b.id]), rematches, notes } }
    }
    walk(order.filter((s) => s !== bye), [])
  }
  return (best as { plan: SwissPairing } | null)?.plan ?? { pairs: [], bye: null, floated: [], rematches: 0, notes: [] }
}

/**
 * Round `round` (0-based) of the Swiss stage.
 *
 * The order it is handed the seats in does not matter: they are sorted by id
 * and shuffled from the seed, so two processes that read the table in
 * different orders draw the same round.
 */
export function pairSwissRound(seats: SwissSeat[], seed: number, round: number): SwissPairing {
  const rng = new Rng((seed ^ hashStr(`open-cup-swiss:${round}`)) >>> 0)
  const order = rng.shuffle(seats.filter(stillIn).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
  const rank = new Map(order.map((s, i) => [s.id, i]))
  const notes: string[] = []
  const metSet = new Map(order.map((s) => [s.id, new Set(s.met)]))
  const met = (a: string, b: string) => !!metSet.get(a)?.has(b) || !!metSet.get(b)?.has(a)
  if (order.length <= 9) return exactSmallSwiss(order, met)

  // The bye, when the stage is odd: somebody who has not had one, from the
  // lowest record, the seed deciding among equals. It counts toward going
  // through and toward nothing else — no coins, no score, no win on the board.
  let bye: string | null = null
  let field = order
  if (order.length % 2 === 1) {
    const pick = order.slice().sort((a, b) =>
      (a.byes - b.byes) || (a.wins - b.wins) || (b.losses - a.losses) || (rank.get(a.id)! - rank.get(b.id)!))[0]
    if (pick.byes > 0) notes.push(`${pick.id} 第二次轮空：场上每个人都已经轮空过`)
    bye = pick.id
    field = order.filter((s) => s.id !== pick.id)
  }

  // Record groups, best first. With two wins through and two losses out there
  // are never more than two of them in a round (1–0 and 0–1), but nothing
  // here depends on that.
  const key = (s: SwissSeat) => `${s.wins}-${s.losses}`
  const groups: SwissSeat[][] = []
  for (const s of field.slice().sort((a, b) => (b.wins - a.wins) || (a.losses - b.losses) || (rank.get(a.id)! - rank.get(b.id)!))) {
    const last = groups[groups.length - 1]
    if (last && key(last[0]) === key(s)) last.push(s)
    else groups.push([s])
  }

  const pairs: [string, string][] = []
  const floated: string[] = []
  let rematches = 0
  let carry: SwissSeat | null = null
  for (let gi = 0; gi < groups.length; gi++) {
    let g = groups[gi]
    if (carry) {
      // the floater meets somebody from this group he has not played, the first in seeded order
      const down: SwissSeat = carry
      const at = g.findIndex((s) => !met(down.id, s.id))
      const opp = g[at >= 0 ? at : 0]
      if (at < 0) { rematches++; notes.push(`浮动配对无法避免 ${down.id} 的重赛`) }
      pairs.push([down.id, opp.id])
      floated.push(down.id, opp.id)
      g = g.filter((s) => s.id !== opp.id)
      carry = null
    }
    if (g.length % 2 === 1) {
      // one floats down: whoever has floated least, the LAST such in seeded order so the top of the group stays put
      const least = Math.min(...g.map((s) => s.floats))
      const idx = g.map((s, i) => (s.floats === least ? i : -1)).filter((i) => i >= 0).pop()!
      carry = g[idx]
      g = g.filter((_, i) => i !== idx)
    }
    const r = pairGroup(g.map((s) => s.id), met, notes)
    pairs.push(...r.pairs)
    rematches += r.rematches
  }
  if (carry) {
    // cannot happen with an even field; kept so a caller's mistake is a bye on the record and not a lost entrant
    notes.push(`${carry.id} 落单，记为轮空`)
    if (!bye) bye = carry.id
  }
  // A two-person record group can be a rematch even though a cross-group
  // swap avoids it. Repair globally before accepting the recorded exception.
  const seatOf = new Map(order.map((s) => [s.id, s]))
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i]
    if (!met(a, b)) continue
    for (let j = 0; j < Math.min(pairs.length, REPAIR_SCAN); j++) {
      if (j === i) continue
      const [c, d] = pairs[j]
      if (!met(a, c) && !met(b, d)) { pairs[i] = [a, c]; pairs[j] = [b, d]; break }
      if (!met(a, d) && !met(b, c)) { pairs[i] = [a, d]; pairs[j] = [b, c]; break }
    }
  }
  rematches = pairs.filter(([a, b]) => met(a, b)).length
  const actualFloated = pairs.filter(([a, b]) => {
    const A = seatOf.get(a)!, B = seatOf.get(b)!
    return A.wins !== B.wins || A.losses !== B.losses
  }).flat()
  const finalNotes = notes.filter((n) => !n.includes('重赛'))
  if (rematches) finalNotes.push(`有界跨组修复后仍有 ${rematches} 场重赛`)
  return { pairs, bye, floated: actualFloated, rematches, notes: finalNotes }
}

// ------------------------------------------------------------------ playoff

export interface PlayoffEntrant {
  id: string
  swissWins: number
  swissLosses: number
  /** ties actually played and won — a bye is not one */
  realWins: number
  /** maps won minus maps lost over the ties actually played */
  mapDiff: number
  met: string[]
}

/**
 * Seeds for the knockout, best first: 2–0 over 2–1, then more ties really
 * won (a 2–0 with a bye in it sits behind a 2–0 that played both), then map
 * difference, then the cup's seed. Never the five's rating: what somebody
 * paid for is not what he earned here.
 */
export function seedPlayoff(entrants: PlayoffEntrant[], seed: number): PlayoffEntrant[] {
  const tie = (id: string) => hashStr(`open-cup-seed:${seed}:${id}`) >>> 0
  return entrants.slice().sort((a, b) =>
    (a.swissLosses - b.swissLosses) || (b.realWins - a.realWins) || (b.mapDiff - a.mapDiff)
    || (tie(a.id) - tie(b.id)) || (a.id < b.id ? -1 : 1))
}

/** The order seeds sit in a bracket of `size` so that 1 and 2 can only meet in the final: [1, 8, 4, 5, 2, 7, 3, 6]. */
export function bracketOrder(size: number): number[] {
  let order = [1]
  while (order.length < size) {
    const n = order.length * 2
    order = order.flatMap((s) => [s, n + 1 - s])
  }
  return order
}

export interface PlayoffPlan {
  /** everybody who came through, in seed order (index 0 is seed 1) */
  seeds: string[]
  /** the main bracket's size: the largest power of two not above the field */
  size: number
  /** the 入围轮: the winner of [hi, lo] takes `line` in the main bracket */
  playIn: { line: number; hi: string; lo: string }[]
  /** line (1-based) → who holds it before the 入围轮 is played; a line being played for is null */
  lines: (string | null)[]
  /** rounds of the main bracket */
  rounds: number
  notes: string[]
}

/**
 * The whole knockout, fixed the moment the Swiss stage ends.
 *
 * Q through, P the largest power of two ≤ Q. If Q is P there is no 入围轮.
 * Otherwise the bottom 2(Q − P) seeds play Q − P ties for the last Q − P
 * lines and the top 2P − Q seeds wait for them: ten through is two ties and
 * six byes into an eight. Highest of the bottom block against lowest; when
 * that pair already met in the Swiss stage the low seeds are swapped with a
 * neighbour's if that cures it, which moves nobody's bye.
 */
export function planPlayoff(entrants: PlayoffEntrant[], seed: number): PlayoffPlan {
  const ranked = seedPlayoff(entrants, seed)
  const seeds = ranked.map((e) => e.id)
  const Q = seeds.length
  const notes: string[] = []
  let size = 1
  while (size * 2 <= Q) size *= 2
  const k = Q - size
  const lines: (string | null)[] = []
  for (let i = 0; i < size; i++) lines.push(i < size - k ? seeds[i] : null)
  const metOf = new Map(ranked.map((e) => [e.id, new Set(e.met)]))
  const met = (a: string, b: string) => !!metOf.get(a)?.has(b) || !!metOf.get(b)?.has(a)
  const his = seeds.slice(size - k, size)
  const los = seeds.slice(size).reverse()
  for (let i = 0; i < k; i++) {
    if (!met(his[i], los[i])) continue
    const j = [i + 1, i - 1].find((x) => x >= 0 && x < k && !met(his[i], los[x]) && !met(his[x], los[i]))
    if (j === undefined) { notes.push(`入围轮 ${his[i]} 对 ${los[i]} 是重赛，换不开`); continue }
    [los[i], los[j]] = [los[j], los[i]]
  }
  const playIn = his.map((hi, i) => ({ line: size - k + i + 1, hi, lo: los[i] }))
  return { seeds, size, playIn, lines, rounds: Math.max(0, Math.round(Math.log2(size))), notes }
}

/** Round one of the main bracket, as pairs of lines: [[1, 8], [4, 5], [2, 7], [3, 6]]. */
export function firstRoundLines(size: number): [number, number][] {
  const order = bracketOrder(size)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < order.length; i += 2) out.push([order[i], order[i + 1]])
  return out
}

// ------------------------------------------------------------------ the clock

export interface SwissCupPlan {
  /** rounds kept free on the clock: three Swiss, an 入围轮, a full knockout of everybody */
  reserved: number
  /** seconds between two rounds */
  stepSec: number
}

const SPAN_SEC = 105 * 60
const STEP_SEC = 15 * 60

/**
 * The timetable, fixed at the start and on the safe side: 3 + ⌈log₂ n⌉ rounds
 * are reserved although only about half the field reaches the knockout, and
 * the step is whatever fits them inside 105 minutes, a quarter of an hour at
 * most. A round nobody needs is dropped; a time that has been shown to a
 * player is never moved earlier.
 */
export function planSwissCup(entrants: number): SwissCupPlan {
  const reserved = SWISS_ROUNDS + Math.max(1, Math.ceil(Math.log2(Math.max(2, entrants))))
  const stepSec = Math.min(STEP_SEC, Math.floor(SPAN_SEC / (reserved - 1) / 60) * 60)
  return { reserved, stepSec }
}

/** What the rounds are called. `playoffRounds` counts the 入围轮 when there is one. */
export function swissRoundName(stage: 'swiss' | 'playin' | 'playoff', stageRound: number, playoffRounds = 0): string {
  if (stage === 'swiss') return `瑞士轮第 ${stageRound + 1} 轮`
  if (stage === 'playin') return '入围轮'
  const left = playoffRounds - stageRound
  if (left <= 1) return '决赛'
  if (left === 2) return '半决赛'
  if (left === 3) return '8 强'
  if (left === 4) return '16 强'
  return `${2 ** left} 强`
}

/** The coins one entrant is owed for ties actually won: 20 a Swiss tie, 40 a knockout tie. Byes are in neither count. */
export const swissWinCoins = (swissRealWins: number, playoffWins: number, playoffCoins: number): number =>
  swissRealWins * SWISS_WIN_COINS + playoffWins * playoffCoins
