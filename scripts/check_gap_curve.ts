/**
 * Does the better five actually win? (2026-09-12)
 *
 *   npx tsx scripts/check_gap_curve.ts [pairs]
 *
 * The complaint: 「综合分比对面高，默契也比对面高，但也打不过」. Random
 * legal fives — half built round one club, half scattered, levels 0..5 —
 * play each other over bo3, and the win rate of the higher-rated side is
 * binned by the 综合分 gap the ladder screen shows. What the owner asked for:
 * three or four points apart is near even, a wide gap is at least 7:3.
 */
import { ALL_CARDS, SQUAD_SLOTS, isPlayerCard, isCoachCard, squadRating, MAX_LEVEL } from '../src/engine/cards'
import type { PlayerCard, Squad } from '../src/engine/cards'
import { playRivalMatch } from '../src/engine/arena'
import type { RivalSquad } from '../src/engine/arena'
import { Rng } from '../src/engine/rng'

const PAIRS = Number(process.argv[2] ?? 1500)
const players = ALL_CARDS.filter((c): c is PlayerCard => isPlayerCard(c) && !c.event)
const coaches = ALL_CARDS.filter(isCoachCard)
const clubs = [...new Set(players.map((c) => c.clubTag).filter(Boolean))] as string[]

function squad(rng: Rng): { squad: Squad; levels: Record<string, number> } {
  const used = new Set<string>()
  const people = new Set<string>()
  const clubby = rng.next() < 0.5
  const tag = rng.pick(clubs)
  const pool = clubby ? players.filter((c) => c.clubTag === tag) : players
  // ordinary cards mostly; a legend now and then
  const pick = (role: string) => {
    const legal = pool.filter((c) => !used.has(c.id) && !people.has(c.playerId)
      && (role === '自由人' || c.roles.includes(role)) && (c.rarity !== 'mythic' || rng.next() < 0.15))
    const list = legal.length ? legal : players.filter((c) => !used.has(c.id) && !people.has(c.playerId) && c.rarity !== 'mythic')
    return rng.pick(list)
  }
  const slots = SQUAD_SLOTS.map((role) => {
    const c = pick(role)
    used.add(c.id); people.add(c.playerId)
    return c.id
  })
  const coach = rng.next() < 0.7 ? (clubby && rng.next() < 0.6
    ? coaches.find((c) => c.clubTag === tag)?.id ?? rng.pick(coaches).id
    : rng.pick(coaches).id) : null
  const levels: Record<string, number> = {}
  const lv = Math.floor(rng.next() * (MAX_LEVEL + 1))
  for (const id of slots) levels[id] = Math.max(0, Math.min(MAX_LEVEL, lv + Math.floor(rng.next() * 3) - 1))
  return { squad: { slots, coach }, levels }
}

const pure: Record<number, number> = {}
// First the clean measurement: the same five against itself, one side a
// few levels up and nothing else different, so the paper gap is exactly the
// level gap. This is what a point of 综合分 is worth on its own.
{
  const prng = new Rng(4242)
  const N = Math.max(100, Math.round(PAIRS / 5))
  const plain = players.filter((c) => c.rarity !== 'mythic')
  const fives: Squad[] = []
  while (fives.length < N) {
    const s = squad(prng).squad
    if (s.slots.every((id) => id && plain.some((c) => c.id === id))) fives.push(s)
  }
  console.log('pure level gap (same five both sides, one side levelled)')
  for (const k of [1, 2, 3, 4, 5]) {
    let w = 0
    fives.forEach((s, i) => {
      const levels: Record<string, number> = {}
      for (const id of s.slots) if (id) levels[id] = 5 - k
      const rival: RivalSquad = { name: 'B', tag: 'B', slots: s.slots, coach: s.coach, levels, div: 4, points: 1000 }
      if (playRivalMatch(s, () => 5, rival, 3, i * 7919 + k, undefined, true).win) w++
    })
    console.log(`  +${k}  ${(100 * w / N).toFixed(0)}%`)
    pure[k] = w / N
  }
}

const rng = new Rng(20260912)
const bins = new Map<number, { n: number; w: number }>()
const rows: { gap: number; win: boolean }[] = []
for (let i = 0; i < PAIRS; i++) {
  const A = squad(rng)
  const B = squad(rng)
  const ra = squadRating(A.squad, (id) => A.levels[id] ?? 0)
  const rb = squadRating(B.squad, (id) => B.levels[id] ?? 0)
  const rival: RivalSquad = { name: 'B', tag: 'B', slots: B.squad.slots, coach: B.squad.coach, levels: B.levels, div: 4, points: 1000 }
  const seed = Math.floor(rng.next() * 1e9)
  const r = playRivalMatch(A.squad, (id) => A.levels[id] ?? 0, rival, 3, seed, undefined, true)
  const gap = ra - rb
  // orient on the stronger side
  const higherWon = gap >= 0 ? r.win : !r.win
  const g = Math.abs(gap)
  rows.push({ gap, win: r.win })
  const b = bins.get(g) ?? { n: 0, w: 0 }
  b.n++; if (higherWon) b.w++
  bins.set(g, b)
}
const band = (lo: number, hi: number) => {
  let n = 0, w = 0
  for (const [g, b] of bins) if (g >= lo && g <= hi) { n += b.n; w += b.w }
  return { n, p: n ? w / n : NaN }
}
console.log('gap   n     higher side wins')
for (const g of [...bins.keys()].sort((a, b) => a - b)) {
  const b = bins.get(g)!
  if (b.n >= 15) console.log(`${String(g).padStart(3)}  ${String(b.n).padStart(4)}   ${(100 * b.w / b.n).toFixed(0)}%`)
}
// The owner's words, as numbers (2026-09-12): 「差三四分这样是五五开」 —
// either side can win — 「差得多的话至少要是七三开，强的概率肯定要更高」.
// Measured the day it shipped, at GAP_FREE 1.5 / GAP_WIDEN 0.5 and 默契
// worth 0.1 on paper: 55 / 59 / 67 / 79 / 95, and the same five a full
// five levels up wins 66%. Before: 52 / 58 / 69 / 73 / 88 and 64%.
const bands: [string, number, number, number, number][] = [
  ['0-1', 0, 1, 0.40, 0.62], ['2-4', 2, 4, 0.52, 0.64], ['5-7', 5, 7, 0.62, 0.78], ['8-11', 8, 11, 0.72, 0.90], ['12+', 12, 99, 0.85, 1],
]
let bad = 0
console.log('\nband   n     P(higher wins)')
for (const [name, lo, hi, min, max] of bands) {
  const { n, p } = band(lo, hi)
  const ok = n < 30 || (p >= min && p <= max)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(5)} ${String(n).padStart(5)}   ${(p * 100).toFixed(0)}%   (want ${min * 100}–${max * 100})`)
  if (!ok) bad++
}
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  — ${detail}`)
  if (!ok) bad++
}
check('同一套卡全员高五级，赢六成以上', pure[5] >= 0.6, `${(pure[5] * 100).toFixed(0)}%`)
check('同一套卡全员高一级，还是五五开', pure[1] >= 0.4 && pure[1] <= 0.62, `${(pure[1] * 100).toFixed(0)}%`)
console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
