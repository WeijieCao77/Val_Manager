/**
 * The shapes a competition takes once the table is done: double elimination,
 * the Swiss round, and the GSL group.
 *
 * The circuit's real 2026 formats, as played:
 *
 *   Masters (12 teams)     the four regional winners wait in the playoffs;
 *                          the eight 2nd/3rd seeds play a three-round Swiss
 *                          (BO3, two wins through, two losses out) for the
 *                          other four places; then an eight-team double
 *                          elimination, lower final and grand final BO5
 *   Champions (16 teams)   four GSL groups of four, two through from each,
 *                          then the same eight-team double elimination
 *   Stage 1 / Stage 2      an eight-team double elimination from the table
 *   Kickoff                a four-team double elimination from the table
 *
 * A double elimination is written here as a template: waves of named rounds,
 * each slot saying where its two teams come from — a seed, or the winner or
 * loser of an earlier slot. The engine builds the next wave when every match
 * so far is played, and reads the placings off the template at the end. The
 * same machinery, with a shorter template, is a GSL group.
 *
 * Fixture labels stay `KO:<wave>:<name>` so everything that already reads a
 * bracket — the standings' 「止步…」 column, the bracket view, the match modal
 * — keeps working; `SW:<round>:<name>` marks a Swiss match, which the table
 * counts like a league game.
 */
import { makeFixture, sortStandings } from './league'
import type { Competition, Fixture, GameState, StageKey } from './types'

type Src = { seed: number } | { w: [string, number] } | { l: [string, number] }
interface Slot { a: Src; b: Src; bo?: 1 | 3 | 5 }
interface Round { name: string; slots: Slot[] }
export type Wave = Round[]

const W = (name: string, i: number): Src => ({ w: [name, i] })
const L = (name: string, i: number): Src => ({ l: [name, i] })
const S = (n: number): Src => ({ seed: n })

export const UB1 = '胜者组第一轮'
export const UB2 = '胜者组第二轮'
export const UBF = '胜者组决赛'
export const LB1 = '败者组第一轮'
export const LB2 = '败者组第二轮'
export const LBSF = '败者组半决赛'
export const LBF = '败者组决赛'
export const GF = '总决赛'

/** Eight seeds, 1v8 / 4v5 / 2v7 / 3v6 so the second round pairs neighbours. */
export const DOUBLE_8: Wave[] = [
  [{ name: UB1, slots: [
    { a: S(1), b: S(8) }, { a: S(4), b: S(5) }, { a: S(2), b: S(7) }, { a: S(3), b: S(6) },
  ] }],
  [
    { name: UB2, slots: [{ a: W(UB1, 0), b: W(UB1, 1) }, { a: W(UB1, 2), b: W(UB1, 3) }] },
    { name: LB1, slots: [{ a: L(UB1, 0), b: L(UB1, 1) }, { a: L(UB1, 2), b: L(UB1, 3) }] },
  ],
  [
    { name: UBF, slots: [{ a: W(UB2, 0), b: W(UB2, 1) }] },
    // crossed, so a side beaten in the upper bracket does not meet the same
    // opponent again straight away
    { name: LB2, slots: [{ a: L(UB2, 0), b: W(LB1, 1) }, { a: L(UB2, 1), b: W(LB1, 0) }] },
  ],
  [{ name: LBSF, slots: [{ a: W(LB2, 0), b: W(LB2, 1) }] }],
  [{ name: LBF, slots: [{ a: L(UBF, 0), b: W(LBSF, 0), bo: 5 }] }],
  [{ name: GF, slots: [{ a: W(UBF, 0), b: W(LBF, 0), bo: 5 }] }],
]

/** Four seeds: Kickoff's playoff. */
export const DOUBLE_4: Wave[] = [
  [{ name: UB1, slots: [{ a: S(1), b: S(4) }, { a: S(2), b: S(3) }] }],
  [
    { name: UBF, slots: [{ a: W(UB1, 0), b: W(UB1, 1) }] },
    { name: LB1, slots: [{ a: L(UB1, 0), b: L(UB1, 1) }] },
  ],
  [{ name: LBF, slots: [{ a: L(UBF, 0), b: W(LB1, 0), bo: 5 }] }],
  [{ name: GF, slots: [{ a: W(UBF, 0), b: W(LBF, 0), bo: 5 }] }],
]

/** Where a template's teams finish, best first: the winner of the last named
 *  slot, then its loser, then the losers of each earlier lower-bracket round
 *  from the latest back. */
const DOUBLE_8_PLACES: Src[] = [
  W(GF, 0), L(GF, 0), L(LBF, 0), L(LBSF, 0), L(LB2, 0), L(LB2, 1), L(LB1, 0), L(LB1, 1),
]
const DOUBLE_4_PLACES: Src[] = [W(GF, 0), L(GF, 0), L(LBF, 0), L(LB1, 0)]

/** A GSL group named `g`: opening pair, winners' and losers' matches, decider.
 *  First place is the winners' match, second the decider. */
export const gslGroup = (g: string, base = 0): Wave[] => [
  [{ name: `${g}组 开局赛`, slots: [{ a: S(base + 1), b: S(base + 4) }, { a: S(base + 2), b: S(base + 3) }] }],
  [
    { name: `${g}组 胜者赛`, slots: [{ a: W(`${g}组 开局赛`, 0), b: W(`${g}组 开局赛`, 1) }] },
    { name: `${g}组 败者赛`, slots: [{ a: L(`${g}组 开局赛`, 0), b: L(`${g}组 开局赛`, 1) }] },
  ],
  [{ name: `${g}组 决胜赛`, slots: [{ a: L(`${g}组 胜者赛`, 0), b: W(`${g}组 败者赛`, 0) }] }],
]
export const GROUPS = ['A', 'B', 'C', 'D'] as const
export const isGroupLabel = (name: string): boolean => /^[A-D]组 /.test(name)
export const isLowerLabel = (name: string): boolean => name.startsWith('败者')

/** Run several templates side by side — the four groups share their waves. */
export const sideBySide = (...templates: Wave[][]): Wave[] => {
  const depth = Math.max(...templates.map((t) => t.length))
  return Array.from({ length: depth }, (_, i) => templates.flatMap((t) => t[i] ?? []))
}

const koOf = (state: GameState, comp: Competition): Fixture[] =>
  state.fixtures.filter((f) => f.comp === comp.key && f.label.startsWith('KO:'))

const waveOf = (f: Fixture): number => Number(f.label.split(':')[1] || 0)
const nameOf = (f: Fixture): string => f.label.split(':')[2] ?? ''
const winnerOf = (f: Fixture): string | null =>
  f.result ? (f.result.mapsWonA > f.result.mapsWonB ? f.teamA : f.teamB) : null
const loserOf = (f: Fixture): string | null =>
  f.result ? (f.result.mapsWonA > f.result.mapsWonB ? f.teamB : f.teamA) : null

/**
 * Resolve where a slot's team comes from. Seeds are one-based into `seeds`;
 * winners and losers are read off the played fixture with that round name
 * and index, in creation order.
 */
function resolve(src: Src, seeds: string[], ko: Fixture[]): string | null {
  if ('seed' in src) return seeds[src.seed - 1] ?? null
  const [name, idx] = 'w' in src ? src.w : src.l
  const f = ko.filter((x) => nameOf(x) === name)[idx]
  if (!f) return null
  return 'w' in src ? winnerOf(f) : loserOf(f)
}

/**
 * Build the next wave of a templated bracket, or decide it.
 *
 * `offset` numbers the waves after whatever came before — Champions' playoff
 * waves follow its three group waves. Returns the new fixtures; sets
 * `comp.champion` and prepends the template's placings to `comp.finished`
 * when the last wave is played.
 */
export function advanceTemplate(
  state: GameState, comp: Competition, template: Wave[], places: Src[] | null,
  seeds: string[], day: number, bo: 1 | 3 | 5, offset = 0, stage?: StageKey,
): Fixture[] {
  const ko = koOf(state, comp)
  const mine = ko.filter((f) => waveOf(f) > offset)
  if (mine.some((f) => !f.played)) return []
  const done = mine.length ? Math.max(...mine.map(waveOf)) - offset : 0
  if (done >= template.length) {
    if (places && !comp.champion) {
      const order = places.map((p) => resolve(p, seeds, ko)).filter((x): x is string => !!x)
      comp.champion = order[0]
      comp.finished = [...order, ...comp.finished.filter((t) => !order.includes(t))]
    }
    return []
  }
  const wave = template[done]
  const out: Fixture[] = []
  for (const round of wave) {
    for (const slot of round.slots) {
      const a = resolve(slot.a, seeds, ko)
      const b = resolve(slot.b, seeds, ko)
      if (!a || !b) continue
      out.push(makeFixture(day, stage ?? comp.stage, comp.key, a, b, slot.bo ?? bo, `KO:${offset + done + 1}:${round.name}`))
    }
  }
  return out
}

/** Has every wave of a template been played? */
export function templateDone(state: GameState, comp: Competition, template: Wave[], offset = 0): boolean {
  const mine = koOf(state, comp).filter((f) => waveOf(f) > offset)
  if (!mine.length || mine.some((f) => !f.played)) return false
  return Math.max(...mine.map(waveOf)) - offset >= template.length
}

/** The winner and loser of a named slot, once it is played. */
export function decided(state: GameState, comp: Competition, name: string, idx = 0): { w: string; l: string } | null {
  const f = koOf(state, comp).filter((x) => nameOf(x) === name)[idx]
  const w = f ? winnerOf(f) : null
  const l = f ? loserOf(f) : null
  return w && l ? { w, l } : null
}

/** The four groups' templates, sharing waves, seeds laid end to end. */
export const championsGroups = (): Wave[] =>
  sideBySide(...GROUPS.map((g, i) => gslGroup(g, i * 4)))

/** The template a competition's playoff runs on, by its field. */
export const doubleFor = (n: number): { template: Wave[]; places: Src[] } =>
  n >= 8 ? { template: DOUBLE_8, places: DOUBLE_8_PLACES } : { template: DOUBLE_4, places: DOUBLE_4_PLACES }

// ---------------------------------------------------------------- Swiss

export const SWISS_ROUNDS = 3
const swissLabel = (round: number) => `SW:${round}:瑞士轮 第${round}轮`
const swissOf = (state: GameState, comp: Competition): Fixture[] =>
  state.fixtures.filter((f) => f.comp === comp.key && f.label.startsWith('SW:'))
export const swissRoundOf = (f: Fixture): number => Number(f.label.split(':')[1] || 0)

/** W-L of a Swiss team, off the table the SW: fixtures feed. */
export const swissRecord = (comp: Competition, id: string): { w: number; l: number } => {
  const r = comp.standings[id]
  return { w: r?.w ?? 0, l: r?.l ?? 0 }
}

/** Pair a pool of teams top against bottom, avoiding a rematch when a swap does. */
function pairPool(pool: string[], played: Set<string>): [string, string][] {
  const out: [string, string][] = []
  const rest = pool.slice()
  while (rest.length >= 2) {
    const a = rest.shift()!
    let j = rest.length - 1
    while (j > 0 && played.has(`${a}|${rest[j]}`)) j--
    const b = rest.splice(j, 1)[0]
    out.push([a, b])
  }
  return out
}

/**
 * The next Swiss round, or nothing if one is still being played or all three
 * are done. `seeds` orders the eight: the four second seeds, then the four
 * third seeds, so the opening round crosses them.
 */
export function swissNext(state: GameState, comp: Competition, seeds: string[], day: number): Fixture[] {
  const sw = swissOf(state, comp)
  if (sw.some((f) => !f.played)) return []
  const round = sw.length ? Math.max(...sw.map(swissRoundOf)) : 0
  if (round >= SWISS_ROUNDS) return []
  const played = new Set<string>()
  for (const f of sw) { played.add(`${f.teamA}|${f.teamB}`); played.add(`${f.teamB}|${f.teamA}`) }
  let pairs: [string, string][]
  if (round === 0) {
    const n = seeds.length
    pairs = seeds.slice(0, n / 2).map((a, i) => [a, seeds[n - 1 - i]] as [string, string])
  } else {
    // still alive: fewer than two wins and fewer than two losses
    const alive = seeds.filter((id) => {
      const r = swissRecord(comp, id)
      return r.w < 2 && r.l < 2
    })
    const byRecord = new Map<string, string[]>()
    for (const id of alive) {
      const r = swissRecord(comp, id)
      const k = `${r.w}-${r.l}`
      byRecord.set(k, [...(byRecord.get(k) ?? []), id])
    }
    pairs = [...byRecord.values()].flatMap((pool) => pairPool(pool, played))
  }
  return pairs.map(([a, b]) => makeFixture(day, comp.stage, comp.key, a, b, 3, swissLabel(round + 1)))
}

/** Who came through the Swiss and who went home, each best first. */
export function swissOutcome(comp: Competition, seeds: string[]): { through: string[]; out: string[] } {
  const rec = (id: string) => swissRecord(comp, id)
  const order = seeds.slice().sort((a, b) => rec(b).w - rec(a).w || rec(a).l - rec(b).l)
  return {
    through: order.filter((id) => rec(id).w >= 2),
    out: order.filter((id) => rec(id).w < 2),
  }
}

/** Is the Swiss stage over — three rounds played, or every team decided? */
export function swissDone(state: GameState, comp: Competition, seeds: string[]): boolean {
  const sw = swissOf(state, comp)
  if (!sw.length || sw.some((f) => !f.played)) return false
  const round = Math.max(...sw.map(swissRoundOf))
  if (round >= SWISS_ROUNDS) return true
  return seeds.every((id) => { const r = swissRecord(comp, id); return r.w >= 2 || r.l >= 2 })
}

/** The eight-team playoff order for a Masters: the four byes, then the Swiss
 *  qualifiers best record first, so 1v8 is a regional winner against the
 *  last team through. */
export const mastersSeeds = (byes: string[], through: string[]): string[] => [...byes, ...through]

/** The eight-team playoff order for Champions: group winners, then runners-up
 *  rotated so nobody meets their own group in the opening round. */
export const championsSeeds = (firsts: string[], seconds: string[]): string[] => [
  firsts[0], firsts[1], firsts[2], firsts[3],
  seconds[1], seconds[0], seconds[3], seconds[2],
]

/** The regional playoff seeds — the table, top down. */
export const tableSeeds = (comp: Competition, cut: number): string[] => sortStandings(comp).slice(0, cut)
