/**
 * 全服杯: every two hours, everybody who signed up, one champion.
 *
 * The club cup is a road against real clubs that only you walk. This is the
 * other kind — the people who play this game against each other, in one
 * bracket, on a clock: sign up any time before the hour, the server takes the
 * five each account is fielding at the moment it starts, and a round is played
 * every quarter of an hour until one account is left. Nobody has to be online
 * for any of it; a match is the same simulation of two saved fives the ladder
 * has always run (arena.ts playRivalMatch, with the displayed-score curve).
 *
 * Everything here is pure — the schedule, the pairing, the purse — so the
 * server (opencup-api.js) is left with storage and a clock, and
 * scripts/check_open_cup.ts can run ten thousand brackets without a database.
 *
 * Deterministic on purpose. A round's pairing and every match in it are
 * functions of the cup's seed, so two server processes resolving the same
 * round (a deploy overlaps containers) compute the same thing, and the one
 * that loses the write changes nothing.
 */
import { Rng, hashStr } from './rng'
import { playRivalMatch } from './arena'
import { BALANCE_VERSION } from './balance'
import type { ArenaLine, RivalSquad } from './arena'
import type { PackKind } from './gacha'

/** A cup starts on every even hour of the Shanghai clock — which is every even hour UTC. */
export const OPEN_CUP_EVERY_MS = 2 * 60 * 60 * 1000
/** A round every quarter of an hour, unless the field is too deep for that to fit. */
export const OPEN_CUP_STEP_SEC = 15 * 60
/**
 * The last round must be over well before the next cup starts: the clock
 * budget for all the rounds after the first, which is played at the start.
 */
const OPEN_CUP_SPAN_SEC = 105 * 60
/** Fewer than this and there is no cup: a bracket of three is not a title. */
export const OPEN_CUP_MIN = 4
/** Room for everybody who plays this game, and a bound on what one round can cost the process. */
export const OPEN_CUP_MAX = 4096
/** Titles won in a field smaller than this are not counted on the 冠军榜. */
export const OPEN_CUP_RANKED_MIN = 8

/** The start of the cup that is open for sign-up at `now`. */
export const openCupSlot = (now: number, everyMs = OPEN_CUP_EVERY_MS): number =>
  (Math.floor(now / everyMs) + 1) * everyMs

export interface OpenCupPlan {
  rounds: number
  /** seconds between two rounds */
  stepSec: number
}

/**
 * How deep the bracket is and how fast it is played.
 *
 * ⌈log₂ n⌉ rounds whatever n is: the first round cuts the field to a power
 * of two (see pairOpenCupRound), and every round after it halves. Up to 256
 * entrants that is a round every fifteen minutes; past that the rounds come
 * a little faster so the final is still played before the next cup's first
 * round.
 */
export function planOpenCup(entrants: number): OpenCupPlan {
  const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, entrants))))
  const stepSec = rounds <= 1 ? OPEN_CUP_STEP_SEC
    : Math.min(OPEN_CUP_STEP_SEC, Math.floor(OPEN_CUP_SPAN_SEC / (rounds - 1) / 60) * 60)
  return { rounds, stepSec }
}

/**
 * The same plan on a faster clock — a local server only (server.js hands
 * this to the module when the database is the in-process one), so a whole
 * cup can be watched in a browser in a few minutes.
 */
export function planOpenCupFast(entrants: number, stepSec: number): OpenCupPlan {
  return { rounds: planOpenCup(entrants).rounds, stepSec }
}

/** When round `round` (0-based) of a cup that started at `starts` is played. */
export const openCupRoundAt = (starts: number, stepSec: number, round: number): number =>
  starts + round * stepSec * 1000

/** 「决赛」「半决赛」「8 强」「第 1 轮」 — by how many are left when it is played. */
export function openCupRoundName(rounds: number, round: number): string {
  const left = rounds - round
  if (left <= 1) return '决赛'
  if (left === 2) return '半决赛'
  if (left === 3) return '8 强'
  if (left === 4) return '16 强'
  return `第 ${round + 1} 轮`
}

export interface OpenCupSeat {
  id: string
  /** byes already had — the odd one out is whoever has had the fewest */
  byes: number
}

export interface OpenCupPairing {
  pairs: [string, string][]
  /** through without playing — only ever in a round whose field is not a power of two */
  byes: string[]
}

/**
 * Who meets whom this round.
 *
 * Every bye is in the first round. A field of 20 plays four ties and sends
 * twelve straight through, which leaves sixteen — and from sixteen on every
 * round is a clean halving, so nobody ever walks into a final. (Halving with
 * one bye a round, which is what this did first, put a 20-entrant field's
 * bye in the semi-final: measured on a local cup the day it was written.)
 * In general: with p the largest power of two not above the field, n − p
 * ties are played and the rest go through.
 *
 * Drawn fresh every round from the cup's seed rather than fixed as a tree: a
 * draw nobody can read ahead is a draw nobody can arrange. The input order
 * does not matter (it is sorted first), so two processes that read the
 * survivors in different orders still pair them identically. Who gets a
 * first-round bye is the shuffle's business — and whoever has had one is
 * last in line for another, which only matters if a side ever goes missing.
 */
export function pairOpenCupRound(seats: OpenCupSeat[], seed: number, round: number): OpenCupPairing {
  const rng = new Rng((seed ^ hashStr(`open-cup-round:${round}`)) >>> 0)
  const order = rng.shuffle(seats.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
  const n = order.length
  let p = 1
  while (p * 2 <= n) p *= 2
  const ties = n - p
  // the ones who play are taken from the front; a stable sort keeps the shuffle's order within equal byes
  const byeCount = n === p ? 0 : n - 2 * ties
  const ranked = order.slice().sort((a, b) => b.byes - a.byes)
  const playing = byeCount ? ranked.slice(0, 2 * ties) : order
  const byes = byeCount ? ranked.slice(2 * ties).map((s) => s.id) : []
  const pairs: [string, string][] = []
  for (let i = 0; i + 1 < playing.length; i += 2) pairs.push([playing[i].id, playing[i + 1].id])
  return { pairs, byes }
}

export interface OpenCupSide {
  lines: ArenaLine[]
  mvpCard: string | null
}

export interface OpenCupMatchResult {
  /** true when `a` won */
  aWon: boolean
  mapsA: number
  mapsB: number
  /** what the match page shows: the maps and both scoreboards, not the round log */
  detail: {
    bo: 3 | 5
    maps: { map: string; a: number; b: number }[]
    a: OpenCupSide
    b: OpenCupSide
  }
}

/**
 * One tie. `a` sits in the home seat, which is worth nothing: both sides get
 * the same defence bonus and the veto is seeded, and which of the pair is `a`
 * came out of the shuffle.
 */
export function playOpenCupMatch(
  a: RivalSquad, b: RivalSquad, final: boolean, seed: number,
  /** the score curve the cup started on — open_cups.balance_version */
  balance: number = BALANCE_VERSION,
  frozenScores?: readonly [number, number],
): OpenCupMatchResult {
  const bo = final ? 5 : 3
  const res = playRivalMatch(
    { slots: a.slots, coach: a.coach, name: a.name, tag: a.tag },
    (id) => a.levels[id] ?? 0, b, bo, seed >>> 0, undefined, balance, frozenScores,
  )
  return {
    aWon: res.win,
    mapsA: res.mapsWon,
    mapsB: res.mapsLost,
    detail: {
      bo,
      maps: res.result.maps.map((m) => ({ map: m.map, a: m.scoreA, b: m.scoreB })),
      a: { lines: res.lines, mvpCard: res.mvpCard },
      b: { lines: res.opp?.lines ?? [], mvpCard: res.opp?.mvpCard ?? null },
    },
  }
}

/** The seed of match `slot` of round `round`: the cup's, the round and the slot, nothing else. */
export const openCupMatchSeed = (seed: number, round: number, slot: number): number =>
  hashStr(`open-cup-match:${seed}:${round}:${slot}`) >>> 0

export interface OpenCupPrize {
  coins: number
  pack?: PackKind
}

/** Every match won pays this, whoever you are; a bye pays nothing. */
export const OPEN_CUP_WIN_COINS = 40

/**
 * What a place is worth, by the size of the field.
 *
 * The purse grows with the field because the title does: beating thirty-one
 * other people is not the same thing as beating three, and a purse that did
 * not know the difference would be collected at four in the morning by one
 * person and three spare accounts. Entry is free, so everything here is paid
 * for winning — an account that turns up and loses takes nothing away.
 *
 * `place` is 1 for the champion, 2 the finalist, 4 a losing semi-finalist.
 */
export function openCupPlacePrize(entrants: number, place: 1 | 2 | 4): OpenCupPrize {
  if (place === 1) {
    if (entrants >= 32) return { coins: 1000, pack: 'ten' }
    if (entrants >= 16) return { coins: 600, pack: 'elite' }
    if (entrants >= 8) return { coins: 400, pack: 'scout' }
    return { coins: 300 }
  }
  if (place === 2) {
    if (entrants >= 32) return { coins: 400, pack: 'elite' }
    if (entrants >= 16) return { coins: 300, pack: 'scout' }
    if (entrants >= 8) return { coins: 200 }
    return { coins: 100 }
  }
  if (entrants >= 32) return { coins: 150, pack: 'scout' }
  if (entrants >= 16) return { coins: 100 }
  return { coins: 0 }
}

/** Everything one entrant is owed when the cup is over. */
export function openCupPurse(
  entrants: number, wins: number, place: 1 | 2 | 4 | null,
): OpenCupPrize {
  const base = place ? openCupPlacePrize(entrants, place) : { coins: 0 }
  return { coins: base.coins + wins * OPEN_CUP_WIN_COINS, ...(base.pack ? { pack: base.pack } : {}) }
}
