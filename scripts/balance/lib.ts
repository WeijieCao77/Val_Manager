/**
 * Shared pieces of the card-mode balance measurement (2026-09-18, balance v2).
 *
 * Everything here plays the REAL entry point — playRivalMatch with the score
 * curve on — over legal fives. Nothing draws a winner and writes a score after.
 */
import {
  ALL_CARDS, SQUAD_SLOTS, MAX_LEVEL, chemistry, isCoachCard, isPlayerCard, personOf, squadPaper,
} from '../../src/engine/cards'
import type { CoachCard, PlayerCard, Squad } from '../../src/engine/cards'
import { CUP_TEAMS } from '../../src/engine/cupTeams'
import { playRivalMatch } from '../../src/engine/arena'
import type { RivalSquad } from '../../src/engine/arena'
import { Rng, hashStr } from '../../src/engine/rng'

export type Kind = 'club' | 'nation' | 'region' | 'cross' | 'mythic'
export interface Five {
  key: string
  kind: Kind
  squad: Squad
  levels: Record<string, number>
  score: number
  chem: number
  mean: number
}

export const PLAYERS = ALL_CARDS.filter((c): c is PlayerCard => isPlayerCard(c))
export const ORDINARY = PLAYERS.filter((c) => c.rarity !== 'mythic' && !c.event && !c.seoul)
export const MYTHICS = PLAYERS.filter((c) => c.rarity === 'mythic')
export const COACHES = ALL_CARDS.filter(isCoachCard) as CoachCard[]

export const levelOf = (f: Five) => (id: string) => f.levels[id] ?? 0

export function five(key: string, kind: Kind, squad: Squad, levels: Record<string, number>): Five {
  const p = squadPaper(squad, (id) => levels[id] ?? 0)
  return { key, kind, squad, levels, score: p.score, chem: chemistry(squad).score, mean: p.mean }
}

/** A legal five from a pool: one man per seat in a role he covers, nobody twice. */
function seat(rng: Rng, pool: PlayerCard[], must: PlayerCard[] = []): string[] | null {
  const people = new Set<string>()
  const slots: string[] = []
  const queue = must.slice()
  for (const role of SQUAD_SLOTS) {
    const fits = (c: PlayerCard) => !people.has(personOf(c)) && (role === '自由人' || c.roles.includes(role))
    const forced = queue.findIndex(fits)
    const c = forced >= 0 ? queue.splice(forced, 1)[0] : (() => {
      const legal = pool.filter(fits)
      return legal.length ? rng.pick(legal) : undefined
    })()
    if (!c) return null
    people.add(personOf(c)); slots.push(c.id)
  }
  if (queue.length) return null
  // somebody calls, so the no-IGL term is controlled rather than sampled
  return slots.some((id) => (PLAYERS.find((c) => c.id === id)!).isIgl) ? slots : null
}

const uniform = (slots: string[], coach: string | null, lv: number, coachLv: number) => {
  const levels: Record<string, number> = {}
  for (const id of slots) levels[id] = lv
  if (coach) levels[coach] = coachLv
  return levels
}

/**
 * The sample of fives: every club's best five at +0/+3/+5, and mixed fives of
 * four kinds. Role-legal, distinct people, a caller on every one — so what
 * differs between two of them is ability, levels, coach and 默契.
 */
export function buildPool(seed: number, mixedPerKind = 60): Five[] {
  const rng = new Rng(seed)
  const out: Five[] = []
  for (const t of CUP_TEAMS) {
    for (const lv of [0, 3, 5]) {
      out.push(five(`club:${t.tag}:+${lv}`, 'club', t.squad, uniform(t.squad.slots as string[], t.squad.coach, lv, 0)))
    }
  }
  const nats = [...new Set(ORDINARY.map((c) => c.nat).filter(Boolean))] as string[]
  const regions = [...new Set(ORDINARY.map((c) => c.region).filter(Boolean))] as string[]
  const make = (kind: Kind, i: number): Five | null => {
    let slots: string[] | null = null
    if (kind === 'nation') {
      const nat = rng.pick(nats)
      const home = ORDINARY.filter((c) => c.nat === nat)
      if (home.length < 8) return null
      slots = seat(rng, home)
      // not a club five in disguise
      if (slots && new Set(slots.map((id) => PLAYERS.find((c) => c.id === id)!.clubId)).size < 3) return null
    } else if (kind === 'region') {
      const region = rng.pick(regions)
      slots = seat(rng, ORDINARY.filter((c) => c.region === region))
      if (slots && new Set(slots.map((id) => PLAYERS.find((c) => c.id === id)!.clubId)).size < 4) return null
    } else if (kind === 'cross') {
      slots = seat(rng, ORDINARY)
      if (slots && new Set(slots.map((id) => PLAYERS.find((c) => c.id === id)!.region)).size < 3) return null
    } else {
      const n = 1 + Math.floor(rng.next() * 3)
      const legends = rng.shuffle(MYTHICS.slice()).slice(0, n)
      slots = seat(rng, ORDINARY, legends)
    }
    if (!slots) return null
    const coach = rng.next() < 0.7 ? rng.pick(COACHES).id : null
    const lv = Math.floor(rng.next() * (MAX_LEVEL + 1))
    const levels: Record<string, number> = {}
    for (const id of slots) levels[id] = Math.max(0, Math.min(MAX_LEVEL, lv + Math.floor(rng.next() * 3) - 1))
    if (coach) levels[coach] = Math.floor(rng.next() * (MAX_LEVEL + 1))
    return five(`${kind}:${i}`, kind, { slots, coach }, levels)
  }
  for (const kind of ['nation', 'region', 'cross', 'mythic'] as Kind[]) {
    let made = 0, tries = 0
    while (made < mixedPerKind && tries++ < mixedPerKind * 200) {
      const f = make(kind, made)
      if (f) { out.push(f); made++ }
    }
    if (made < mixedPerKind) throw new Error(`只凑出 ${made} 套 ${kind} 阵容`)
  }
  return out
}

export interface Pair { hi: Five; lo: Five; gap: number }

/** Up to `want` pairs whose unrounded gap is within `tol` of `target`, drawn without favouring anyone. */
export function pairsAt(pool: Five[], target: number, tol: number, want: number, seed: number): Pair[] {
  const all: Pair[] = []
  for (let i = 0; i < pool.length; i++) {
    for (let j = 0; j < pool.length; j++) {
      if (i === j) continue
      const gap = pool[i].score - pool[j].score
      if (gap < 0 || (gap === 0 && i > j)) continue
      if (Math.abs(gap - target) <= tol && pool[i].squad !== pool[j].squad) all.push({ hi: pool[i], lo: pool[j], gap })
    }
  }
  return new Rng(seed).shuffle(all).slice(0, want)
}

const asRival = (f: Five): RivalSquad => ({
  name: f.key, tag: 'B', slots: f.squad.slots, coach: f.squad.coach, levels: f.levels, div: 4, points: 1000,
})

/** One series; returns whether `hi` won. `swap` puts `hi` in the rival's seat. */
export function series(p: Pair, bo: 3 | 5, seed: number, swap: boolean, version: number): { hiWon: boolean; aWon: boolean; maps: number } {
  const [a, b] = swap ? [p.lo, p.hi] : [p.hi, p.lo]
  const r = playRivalMatch(a.squad, levelOf(a), asRival(b), bo, seed, undefined, version)
  return { hiWon: swap ? !r.win : r.win, aWon: r.win, maps: r.mapsWon + r.mapsLost }
}

export interface Tally { n: number; w: number; maps: number; /** series the first seat won, whoever sat there */ seatA: number }
export function run(pairs: Pair[], bo: 3 | 5, n: number, label: string, version: number): Tally {
  let w = 0, maps = 0, seatA = 0
  for (let i = 0; i < n; i++) {
    const p = pairs[i % pairs.length]
    // the seed does not depend on the version: every rule plays the same dice
    const s = series(p, bo, hashStr(`${label}:${bo}:${i}`) >>> 0, i % 2 === 1, version)
    if (s.hiWon) w++
    if (s.aWon) seatA++
    maps += s.maps
  }
  return { n, w, maps, seatA }
}

/** Wilson 95% interval. */
export function wilson(w: number, n: number): [number, number] {
  if (!n) return [0, 1]
  const z = 1.959964, p = w / n
  const d = 1 + z * z / n
  const c = p + z * z / (2 * n)
  const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
  return [(c - h) / d, (c + h) / d]
}
export const pct = (x: number, dp = 1) => `${(x * 100).toFixed(dp)}%`
export const row = (t: Tally) => {
  const [lo, hi] = wilson(t.w, t.n)
  return { n: t.n, wins: t.w, rate: t.w / t.n, lo, hi, mapsPerSeries: t.maps / t.n }
}
