/**
 * 抢人大战 — a room of friends drafts five each from one shared pool, then the
 * fives play every other five once.
 *
 * Nobody brings their collection: every room is dealt from the whole card
 * pool, 彩卡 included, so it is knowing the players that wins, not owning
 * them. Six rounds: one a position (决斗者, 先锋, 控场, 哨卫), then anyone,
 * then a coach.
 * Each round lays out one card more than there are players, spread from a
 * star to a long shot, and everybody bids blind on one of them from a budget
 * of 100 for the whole draft. Highest bid first: you get the card you bid on
 * if it is still there and pay your bid; if a higher bid took it, you take the
 * best card left for nothing. Then a round robin of BO3s on the arena engine,
 * shown one match at a time, and a BO5 final between the top two, map by map.
 *
 * Pure functions of the room's seed and the bids; draft-api.js holds the room.
 */
import { Rng, hashStr } from './rng'
import { COACH_CARDS, PLAYER_CARDS, personOf } from './cards'
import type { CoachCard, PlayerCard } from './cards'
import type { Role } from './types'

export const DRAFT_MIN = 2
export const DRAFT_MAX = 6
export const DRAFT_BUDGET = 100
export const DRAFT_BID_SEC = 30
export const DRAFT_POSITIONS: readonly (Role | '教练')[] = ['决斗者', '先锋', '控场', '哨卫', '自由人', '教练']
export const DRAFT_ROUNDS = DRAFT_POSITIONS.length
/** the broadcast: seconds a round-robin match is on screen before the next, and a final map */
export const DRAFT_GAME_SEC = 10
export const DRAFT_MAP_SEC = 8
/** what a finished room pays by place, in rooms of at least DRAFT_PAID_MIN; the first DRAFT_PAID_ROOMS a day */
export const DRAFT_PRIZE: Record<number, number> = { 1: 150, 2: 100 }
export const DRAFT_PRIZE_REST = 50
export const DRAFT_PAID_MIN = 3
export const DRAFT_PAID_ROOMS = 2
/** bids a member must place themselves (of six) to be paid: a seat left to the clock earns nothing */
export const DRAFT_OWN_BIDS = 4
export const draftPrize = (place: number): number => DRAFT_PRIZE[place] ?? DRAFT_PRIZE_REST

// today's cards and the 彩卡; not retired players (their own series) or a 彩蛋卡
const POOL: readonly PlayerCard[] = PLAYER_CARDS.filter((c) => !c.former && !c.retired && c.event !== 'egg' && c.event !== 'retired')
const COACH_POOL: readonly CoachCard[] = COACH_CARDS.filter((c) => !c.former)

/**
 * One round's lot: `size` cards of the round's position, one from each band
 * of the pool from best to worst, nobody already dealt in this room.
 */
export function dealLot(seed: number, round: number, size: number, taken: ReadonlySet<string>): string[] {
  const rng = new Rng(hashStr(`draft:lot:${seed >>> 0}:${round}`) >>> 0)
  const role = DRAFT_POSITIONS[round]
  const people = new Set(taken)
  const xs = (role === '教练' ? COACH_POOL : POOL.filter((c) => role === '自由人' || c.role === role))
    .filter((c) => !people.has(personOf(c))).slice().sort((a, b) => b.rating - a.rating) as (PlayerCard | CoachCard)[]
  const out: string[] = []
  // the top band is the stars (a 彩卡 more often than not); the rest share what is left evenly
  const top = Math.max(1, Math.round(xs.length * 0.06))
  const bands = [xs.slice(0, top)]
  const rest = xs.slice(top)
  for (let b = 0; b < size - 1; b++) bands.push(rest.slice(Math.floor(rest.length * b / (size - 1)), Math.floor(rest.length * (b + 1) / (size - 1))))
  for (const band of bands) {
    const free = band.filter((c) => !people.has(personOf(c)))
    if (!free.length) continue
    const c = rng.pick(free)
    people.add(personOf(c))
    out.push(c.id)
  }
  return out
}

export interface DraftBid { card: number; amount: number }

/** A bid as a client sent it, made legal for this player: a card in the lot, no more than the budget. */
export function cleanBid(raw: unknown, lotSize: number, budget: number): DraftBid {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const card = Number.isInteger(r.card) && (r.card as number) >= 0 && (r.card as number) < lotSize ? (r.card as number) : 0
  const amount = Math.max(0, Math.min(budget, Math.floor(Number(r.amount) || 0)))
  return { card, amount }
}

export interface DraftAward { seat: number; card: number; paid: number; won: boolean }

/**
 * The round settled. Highest bids first (a tie goes to a seeded coin); each
 * gets the card bid on if still free. Whoever was outbid then takes the best
 * card left, in the order of their bids, and pays nothing.
 */
export function settleRound(seed: number, round: number, lot: readonly string[], bids: readonly (DraftBid | null)[], rating: (id: string) => number): DraftAward[] {
  const rng = new Rng(hashStr(`draft:tie:${seed >>> 0}:${round}`) >>> 0)
  const order = bids.map((b, seat) => ({ seat, b: b ?? { card: 0, amount: 0 }, coin: rng.next() }))
    .sort((x, y) => y.b.amount - x.b.amount || x.coin - y.coin)
  const free = new Set(lot.map((_, i) => i))
  const out: DraftAward[] = []
  const missed: typeof order = []
  for (const o of order) {
    if (free.has(o.b.card)) { free.delete(o.b.card); out.push({ seat: o.seat, card: o.b.card, paid: o.b.amount, won: true }) }
    else missed.push(o)
  }
  for (const o of missed) {
    const best = [...free].sort((a, b) => rating(lot[b]) - rating(lot[a]))[0]
    free.delete(best)
    out.push({ seat: o.seat, card: best, paid: 0, won: false })
  }
  return out.sort((a, b) => a.seat - b.seat)
}

/** every pairing of a room's seats, once */
export function roundRobin(n: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j])
  return out
}
export const draftMatchSeed = (seed: number, a: number, b: number): number => hashStr(`draft:match:${seed >>> 0}:${a}:${b}`) >>> 0

export interface DraftGame { a: number; b: number; aWon: boolean; mapsA: number; mapsB: number }
export interface DraftStanding { seat: number; wins: number; losses: number; maps: number; place: number }

/**
 * The table: wins, then map difference; two seats still level go by the match between them; anything
 * left level (a three-way cycle) is drawn by the room's seed — never by seat order, which would hand
 * the host the final. Places are distinct: the top two play the final.
 */
export function draftTable(n: number, games: readonly DraftGame[], seed = 0): DraftStanding[] {
  const rows = Array.from({ length: n }, (_, seat) => ({ seat, wins: 0, losses: 0, maps: 0, place: 0 }))
  for (const g of games) {
    rows[g.a].maps += g.mapsA - g.mapsB; rows[g.b].maps += g.mapsB - g.mapsA
    if (g.aWon) { rows[g.a].wins++; rows[g.b].losses++ } else { rows[g.b].wins++; rows[g.a].losses++ }
  }
  const beat = (x: number, y: number) => games.some((g) => (g.a === x && g.b === y && g.aWon) || (g.a === y && g.b === x && !g.aWon))
  const level = (x: DraftStanding, y: DraftStanding) => x.wins === y.wins && x.maps === y.maps
  const coin = (seat: number) => hashStr(`draft:table:${seed >>> 0}:${seat}`) >>> 0
  const cmp = (x: DraftStanding, y: DraftStanding) => {
    if (!level(x, y)) return y.wins - x.wins || y.maps - x.maps
    // head-to-head only when exactly these two are level
    if (rows.filter((r) => level(r, x)).length === 2) {
      if (beat(x.seat, y.seat)) return -1
      if (beat(y.seat, x.seat)) return 1
    }
    return coin(x.seat) - coin(y.seat)
  }
  rows.sort(cmp)
  rows.forEach((r, i) => { r.place = i + 1 })
  return rows
}

/** A room code: five letters and digits nobody misreads. */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function roomCode(rnd: () => number): string {
  let s = ''
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(rnd() * CODE_CHARS.length)]
  return s
}
export const cleanCode = (v: unknown): string | null => {
  const s = String(v ?? '').trim().toUpperCase()
  return /^[A-HJ-NP-Z2-9]{5}$/.test(s) ? s : null
}

/** the room's final places: the final decides first and second, the table the rest */
export function draftPlaces(table: readonly DraftStanding[], final: DraftGame | null): Map<number, number> {
  const out = new Map<number, number>()
  if (final) {
    out.set(final.aWon ? final.a : final.b, 1)
    out.set(final.aWon ? final.b : final.a, 2)
  }
  for (const r of table) if (!out.has(r.seat)) out.set(r.seat, final ? Math.max(3, r.place) : r.place)
  return out
}

/** When each part of the broadcast is on screen, from its start: one time per round-robin match, one per final map. */
export function draftSchedule(games: number, finalMaps: number): { games: number[]; final: number[]; end: number } {
  const g = Array.from({ length: games }, (_, i) => (i + 1) * DRAFT_GAME_SEC * 1000)
  const base = games * DRAFT_GAME_SEC * 1000
  const f = Array.from({ length: finalMaps }, (_, i) => base + (i + 1) * DRAFT_MAP_SEC * 1000)
  return { games: g, final: f, end: (f.length ? f[f.length - 1] : base) + 2000 }
}
