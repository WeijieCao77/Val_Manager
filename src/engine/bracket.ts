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

/**
 * The 2026 Kickoff: twelve sides, three lives each.
 *
 * Eight drawn into the opening round, four (last year's Champions sides)
 * drawn into the second round's byes. A first loss drops a side into the
 * middle bracket, a second into the lower, a third sends it home. There is
 * no grand final: the upper, middle and lower brackets each end in a final
 * of their own, and their winners are the region's three Masters seeds in
 * that order. Thirty ties over nine waves; the three finals are BO5.
 *
 * Seeds: the eight opening-round sides in slot order, then the four byes.
 * Sides that wait a wave — the upper semi-final losers, the upper final's
 * loser — wait; a real bracket has such gaps too.
 */
export const KU1 = '胜者组第一轮'
export const KU2 = '胜者组第二轮'
export const KUSF = '胜者组半决赛'
export const KUF = '胜者组决赛'
export const KM1 = '中段组第一轮'
export const KM2 = '中段组第二轮'
export const KM3 = '中段组第三轮'
export const KM4 = '中段组第四轮'
export const KMSF = '中段组半决赛'
export const KMF = '中段组决赛'
export const KL1 = '败者组第一轮'
export const KL2 = '败者组第二轮'
export const KL3 = '败者组第三轮'
export const KL4 = '败者组第四轮'
export const KL5 = '败者组第五轮'
export const KLSF = '败者组半决赛'
export const KLF = '败者组决赛'

export const TRIPLE_12: Wave[] = [
  [{ name: KU1, slots: [{ a: S(1), b: S(2) }, { a: S(3), b: S(4) }, { a: S(5), b: S(6) }, { a: S(7), b: S(8) }] }],
  [
    { name: KU2, slots: [{ a: W(KU1, 0), b: S(9) }, { a: W(KU1, 1), b: S(10) }, { a: W(KU1, 2), b: S(11) }, { a: W(KU1, 3), b: S(12) }] },
    { name: KM1, slots: [{ a: L(KU1, 0), b: L(KU1, 1) }, { a: L(KU1, 2), b: L(KU1, 3) }] },
  ],
  [
    { name: KUSF, slots: [{ a: W(KU2, 0), b: W(KU2, 1) }, { a: W(KU2, 2), b: W(KU2, 3) }] },
    { name: KM2, slots: [{ a: L(KU2, 0), b: L(KU2, 1) }, { a: L(KU2, 2), b: L(KU2, 3) }] },
    { name: KL1, slots: [{ a: L(KM1, 0), b: L(KM1, 1) }] },
  ],
  [
    { name: KUF, slots: [{ a: W(KUSF, 0), b: W(KUSF, 1), bo: 5 }] },
    { name: KM3, slots: [{ a: W(KM1, 0), b: W(KM2, 1) }, { a: W(KM1, 1), b: W(KM2, 0) }] },
    { name: KL2, slots: [{ a: L(KM2, 0), b: L(KM2, 1) }] },
  ],
  [
    { name: KM4, slots: [{ a: W(KM3, 0), b: L(KUSF, 1) }, { a: W(KM3, 1), b: L(KUSF, 0) }] },
    { name: KL3, slots: [{ a: W(KL1, 0), b: W(KL2, 0) }, { a: L(KM3, 0), b: L(KM3, 1) }] },
  ],
  [
    { name: KMSF, slots: [{ a: W(KM4, 0), b: W(KM4, 1) }] },
    { name: KL4, slots: [{ a: W(KL3, 0), b: W(KL3, 1) }, { a: L(KM4, 0), b: L(KM4, 1) }] },
  ],
  [
    { name: KMF, slots: [{ a: L(KUF, 0), b: W(KMSF, 0), bo: 5 }] },
    { name: KL5, slots: [{ a: W(KL4, 0), b: W(KL4, 1) }] },
  ],
  [{ name: KLSF, slots: [{ a: W(KL5, 0), b: L(KMSF, 0) }] }],
  [{ name: KLF, slots: [{ a: W(KLSF, 0), b: L(KMF, 0), bo: 5 }] }],
]
/** Placings: the three finals' winners, then the lower bracket's fallen from the last out. */
export const TRIPLE_12_PLACES: Src[] = [
  W(KUF, 0), W(KMF, 0), W(KLF, 0), L(KLF, 0), L(KLSF, 0), L(KL5, 0),
  L(KL4, 0), L(KL4, 1), L(KL3, 0), L(KL3, 1), L(KL2, 0), L(KL1, 0),
]
/** The rounds that end a Kickoff bracket lane — the winners qualify. */
export const isMiddleLabel = (name: string): boolean => name.startsWith('中段组')

/**
 * A 2026 stage's playoff: eight from the two groups. Seeds in the order
 * [Alpha 1st, Omega 1st, Alpha 2nd, Omega 2nd, Alpha 3rd, Omega 3rd,
 * Alpha 4th, Omega 4th]. The group winners sit out the opening round; the
 * seconds and thirds cross groups in it; the fourths start in the lower
 * bracket against the opening round's losers. From there the shape is the
 * eight-team double elimination. Lower final and final are BO5.
 */
export const STAGE_8: Wave[] = [
  [{ name: UB1, slots: [{ a: S(3), b: S(6) }, { a: S(4), b: S(5) }] }],
  [
    { name: UB2, slots: [{ a: S(1), b: W(UB1, 1) }, { a: S(2), b: W(UB1, 0) }] },
    { name: LB1, slots: [{ a: S(8), b: L(UB1, 0) }, { a: S(7), b: L(UB1, 1) }] },
  ],
  [
    { name: UBF, slots: [{ a: W(UB2, 0), b: W(UB2, 1) }] },
    { name: LB2, slots: [{ a: L(UB2, 0), b: W(LB1, 1) }, { a: L(UB2, 1), b: W(LB1, 0) }] },
  ],
  [{ name: LBSF, slots: [{ a: W(LB2, 0), b: W(LB2, 1) }] }],
  [{ name: LBF, slots: [{ a: L(UBF, 0), b: W(LBSF, 0), bo: 5 }] }],
  [{ name: GF, slots: [{ a: W(UBF, 0), b: W(LBF, 0), bo: 5 }] }],
]
export const STAGE_8_PLACES: Src[] = [
  W(GF, 0), L(GF, 0), L(LBF, 0), L(LBSF, 0), L(LB2, 0), L(LB2, 1), L(LB1, 0), L(LB1, 1),
]

/**
 * A Masters' eight after the pick: seeds in pairs, [champion, its pick] ×
 * 4 in the order chosen, so the quarter-finals are the pairs made and ties
 * 1–2 and 3–4 share a half. From the second wave on it is DOUBLE_8.
 */
export const MASTERS_8: Wave[] = [
  [{ name: UB1, slots: [{ a: S(1), b: S(2) }, { a: S(3), b: S(4) }, { a: S(5), b: S(6) }, { a: S(7), b: S(8) }] }],
  ...DOUBLE_8.slice(1),
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
/** A round whose loser goes home: the lower bracket, the grand final, a
 *  group's losers' match or decider. */
const knocksOut = (name: string): boolean =>
  isLowerLabel(name) || name === GF || name.endsWith('败者赛') || name.endsWith('决胜赛')

/**
 * Record who is out so far, best first, as it happens.
 *
 * Placings used to be written only when the champion was known, so between
 * the lower final and the grand final a club beaten into third stood nowhere
 * — the panel said 「季后赛进行中」 to a side that was already booked for
 * Masters. The lower bracket eliminates in rising order (7–8th, then 5–6th,
 * 4th, 3rd, the runner-up), so each wave's losers go in front of the ones
 * already there and the order is right at every moment.
 */
function noteEliminated(comp: Competition, played: Fixture[]): void {
  const waves = [...new Set(played.map(waveOf))].sort((a, b) => b - a)
  const fresh: string[] = []
  for (const w of waves) {
    for (const f of played) {
      if (waveOf(f) !== w || !knocksOut(nameOf(f))) continue
      const l = loserOf(f)
      if (l && !comp.finished.includes(l) && !fresh.includes(l)) fresh.push(l)
    }
  }
  if (fresh.length) comp.finished = [...fresh, ...comp.finished]
}

export function advanceTemplate(
  state: GameState, comp: Competition, template: Wave[], places: Src[] | null,
  seeds: string[], day: number, bo: 1 | 3 | 5, offset = 0, stage?: StageKey,
): Fixture[] {
  const ko = koOf(state, comp)
  const mine = ko.filter((f) => waveOf(f) > offset)
  if (mine.some((f) => !f.played)) return []
  noteEliminated(comp, mine)
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

/**
 * Where a side plays next in a templated bracket, before the tie exists:
 * the wave (1-based, before `offset` is added) and round whose slot is fed
 * by its last result — or by its seed, before it has played. Null when it
 * is out or the template has nothing more for it.
 */
export function projectNext(
  template: Wave[], seeds: string[], ko: Fixture[], me: string,
): { wave: number; name: string } | null {
  const mine = ko.filter((f) => (f.teamA === me || f.teamB === me)).sort((a, b) => waveOf(a) - waveOf(b))
  const last = mine[mine.length - 1]
  if (last && !last.played) return null
  const feeds = (src: Src): boolean => {
    if ('seed' in src) return !last && seeds[src.seed - 1] === me
    const [name, idx] = 'w' in src ? src.w : src.l
    if (!last || nameOf(last) !== name) return false
    const same = ko.filter((x) => nameOf(x) === name)
    if (same.indexOf(last) !== idx) return false
    return 'w' in src ? winnerOf(last) === me : loserOf(last) === me
  }
  for (let w = 0; w < template.length; w++) {
    for (const round of template[w]) {
      for (const slot of round.slots) {
        if (feeds(slot.a) || feeds(slot.b)) return { wave: w + 1, name: round.name }
      }
    }
  }
  return null
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

/** The vct-2026 templates: a triple-elimination Kickoff, a grouped stage's eight, a Masters' picked eight. */
export const tripleTemplate = (): { template: Wave[]; places: Src[] } => ({ template: TRIPLE_12, places: TRIPLE_12_PLACES })
export const stageTemplate = (): { template: Wave[]; places: Src[] } => ({ template: STAGE_8, places: STAGE_8_PLACES })
export const mastersTemplate = (): { template: Wave[]; places: Src[] } => ({ template: MASTERS_8, places: DOUBLE_8_PLACES })

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
