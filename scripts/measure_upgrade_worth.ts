/**
 * 「升级了到底值几分、几成胜率」 — what an upgrade buys, measured (2026-09-21).
 *
 *   npx tsx scripts/measure_upgrade_worth.ts [series]
 *
 * The owner, after the cups: 「不要让玩家觉得好不容易抽的、攒的卡、升级了，
 * 结果经常在杯赛里一点用也没有」. Three things have to be true before any
 * curve is touched, and each is measured here rather than read off the source:
 *
 *   1 the paper number moves — a card level, a coach level and 默契 each add
 *     what the screen says they add, and the number the MATCH is played on is
 *     that same number;
 *   2 the series follows the curve — the higher five wins a BO3/BO5 as often
 *     as balance.ts says it should;
 *   3 a map is a map — each map of a series is played out, so the series is
 *     more reliable than one map. If maps were perfectly correlated a BO5
 *     would be no safer than a BO1, and the money spent on levels would buy
 *     nothing the player can feel.
 */
import { ALL_CARDS, SQUAD_SLOTS, isPlayerCard, isCoachCard, squadPaper, squadRating, squadPower, MAX_LEVEL, COINS_FOR, DUPES_FOR } from '../src/engine/cards'
import type { PlayerCard, Squad } from '../src/engine/cards'
import { playRivalMatch } from '../src/engine/arena'
import { cardStrengths, BALANCE_VERSION } from '../src/engine/balance'
import { Rng } from '../src/engine/rng'

const SERIES = Number(process.argv[2] ?? 1200)
const players = ALL_CARDS.filter((c): c is PlayerCard => isPlayerCard(c) && !c.event)
const coaches = ALL_CARDS.filter(isCoachCard)

/** a plain, legal five of ordinary cards — what somebody actually fields */
function fieldedFive(rng: Rng): Squad {
  const used = new Set<string>(), people = new Set<string>()
  const slots = SQUAD_SLOTS.map((role) => {
    const legal = players.filter((c) => !used.has(c.id) && !people.has(c.playerId)
      && (role === '自由人' || c.roles.includes(role)) && c.rarity !== 'mythic')
    const c = rng.pick(legal)
    used.add(c.id); people.add(c.playerId)
    return c.id
  })
  return { slots, coach: rng.pick(coaches).id }
}

const lv = (squad: Squad, cards: number, coach: number): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const id of squad.slots) if (id) out[id] = cards
  if (squad.coach) out[squad.coach] = coach
  return out
}
const at = (m: Record<string, number>) => (id: string) => m[id] ?? 0

/** one series; returns [series won, maps won, maps lost] */
function play(a: Squad, la: Record<string, number>, b: Squad, lb: Record<string, number>, bo: 3 | 5, seed: number) {
  const r = playRivalMatch(
    { slots: a.slots, coach: a.coach, name: 'A', tag: 'A' }, at(la),
    { name: 'B', tag: 'B', slots: b.slots, coach: b.coach, levels: lb, div: 0, points: 0 },
    bo, seed >>> 0, undefined, BALANCE_VERSION,
  )
  return { won: r.win, mapsA: r.mapsWon, mapsB: r.mapsLost }
}

const pct = (w: number, n: number) => (n ? `${(w / n * 100).toFixed(1)}%` : '   —')
const rng = new Rng(20260921)
const FIVES = Array.from({ length: 24 }, () => fieldedFive(rng))

// ---------------------------------------------------------------- 1. 纸面
console.log('=== 1. 升级加了多少分（同一套五人，只改等级）')
console.log('    改动                    阵容分      战力     比 +0')
const base = FIVES[0]
const rows: [string, number, number][] = []
for (const [label, cards, coach] of [
  ['全 +0', 0, 0], ['一张卡 +1', -1, 0], ['一张卡 +5', -5, 0],
  ['五张卡 +1', 1, 0], ['五张卡 +3', 3, 0], ['五张卡 +5', 5, 0],
  ['教练 +5', 0, 5], ['五张 +5、教练 +5', 5, 5],
] as [string, number, number][]) {
  let levels: Record<string, number>
  if (cards < 0) { levels = lv(base, 0, coach); levels[base.slots[0]!] = -cards }
  else levels = lv(base, cards, coach)
  const p = squadPaper(base, at(levels))
  rows.push([label, p.score, squadPower(base, at(levels))])
}
const zero = rows[0][1]
for (const [label, score, power] of rows) {
  console.log(`    ${label.padEnd(20)} ${score.toFixed(2).padStart(8)} ${String(power).padStart(8)}   ${(score - zero >= 0 ? '+' : '') + (score - zero).toFixed(2)}`)
}
console.log(`    （一张卡从 +0 练到 +5 要 ${DUPES_FOR.reduce((s, n) => s + n, 0)} 张重复卡和 ${COINS_FOR.reduce((s, n) => s + n, 0)} 金币）`)

// the number the match is played on must be the number on the screen
{
  const levels = lv(base, 4, 3)
  const paper = squadPaper(base, at(levels)).score
  const shown = squadRating(base, at(levels))
  const [sa, sb] = cardStrengths(paper, paper - 3)
  console.log(`\n    纸面 ${paper.toFixed(2)} / 显示 ${shown} / 落到回合强度 ${sa.toFixed(2)} vs ${sb.toFixed(2)}（差 3 分 → ${(sa - sb).toFixed(2)}）`)
}

// ---------------------------------------------------------------- 2. 胜率
console.log('\n=== 2. 这些升级换来多少胜率（对手是同一套五人的 +0 版本）')
console.log('    改动                  BO3 系列   BO3 单图   BO5 系列   BO5 单图   分差')
for (const [label, cards, coach] of [
  ['一张卡 +5', -5, 0], ['五张卡 +1', 1, 0], ['五张卡 +3', 3, 0],
  ['五张卡 +5', 5, 0], ['教练 +5', 0, 5], ['五张 +5、教练 +5', 5, 5],
] as [string, number, number][]) {
  const tally = { s3: 0, n3: 0, m3w: 0, m3n: 0, s5: 0, n5: 0, m5w: 0, m5n: 0, gap: 0 }
  for (let f = 0; f < FIVES.length; f++) {
    const five = FIVES[f]
    let levels: Record<string, number>
    if (cards < 0) { levels = lv(five, 0, coach); levels[five.slots[0]!] = -cards }
    else levels = lv(five, cards, coach)
    const flat = lv(five, 0, 0)
    tally.gap += squadPaper(five, at(levels)).score - squadPaper(five, at(flat)).score
    const per = Math.ceil(SERIES / FIVES.length)
    for (let i = 0; i < per; i++) {
      const r3 = play(five, levels, five, flat, 3, (f * 7919 + i) * 2654435761)
      tally.n3++; if (r3.won) tally.s3++
      tally.m3w += r3.mapsA; tally.m3n += r3.mapsA + r3.mapsB
      const r5 = play(five, levels, five, flat, 5, (f * 104729 + i) * 40503 + 17)
      tally.n5++; if (r5.won) tally.s5++
      tally.m5w += r5.mapsA; tally.m5n += r5.mapsA + r5.mapsB
    }
  }
  console.log(`    ${label.padEnd(18)} ${pct(tally.s3, tally.n3).padStart(8)}   ${pct(tally.m3w, tally.m3n).padStart(8)}   ${pct(tally.s5, tally.n5).padStart(8)}   ${pct(tally.m5w, tally.m5n).padStart(8)}   +${(tally.gap / FIVES.length).toFixed(2)}`)
}

// ------------------------------------------------- 3. 一图一图打，还是一锤定音
console.log('\n=== 3. 一个系列里的每张图是不是各打各的（分差来自不同的两套五人，不是等级）')
console.log('    分差    单图胜率   BO3 实测   BO3 按单图独立推算   BO5 实测   BO5 推算')
const binom3 = (p: number) => p * p * (3 - 2 * p)
const binom5 = (p: number) => p ** 3 * (10 - 15 * p + 6 * p * p)
// every ordered pair of the sample fives, binned by the paper gap between them
const paperOf = FIVES.map((f) => squadPaper(f, () => 0).score)
const bins: Record<string, [number, number][]> = { '1': [], '2': [], '3': [], '5': [], '8': [], '12+': [] }
const binOf = (d: number) => (d < 1.5 ? '1' : d < 2.5 ? '2' : d < 4 ? '3' : d < 6.5 ? '5' : d < 10 ? '8' : '12+')
for (let i2 = 0; i2 < FIVES.length; i2++) for (let j = 0; j < FIVES.length; j++) {
  if (i2 === j) continue
  const d = paperOf[i2] - paperOf[j]
  if (d <= 0.5) continue
  bins[binOf(d)].push([i2, j])
}
for (const band of Object.keys(bins)) {
  const pairs = bins[band]
  if (!pairs.length) { console.log(`    ${band.padStart(4)}    （没有这样的一对）`); continue }
  const t = { m: 0, mn: 0, s3: 0, n3: 0, s5: 0, n5: 0, gap: 0 }
  const per = Math.max(1, Math.ceil(SERIES / pairs.length))
  for (const [x, y] of pairs) {
    t.gap += paperOf[x] - paperOf[y]
    const flat = {}
    for (let i3 = 0; i3 < per; i3++) {
      const r3 = play(FIVES[x], flat, FIVES[y], flat, 3, (x * 7919 + y * 104729 + i3 * 31) * 2654435761)
      t.n3++; if (r3.won) t.s3++
      t.m += r3.mapsA; t.mn += r3.mapsA + r3.mapsB
      const r5 = play(FIVES[x], flat, FIVES[y], flat, 5, (x * 15485863 + y * 32452843 + i3 * 97) * 3266489917)
      t.n5++; if (r5.won) t.s5++
    }
  }
  const p = t.m / t.mn
  console.log(`    ${band.padStart(4)}    ${pct(t.m, t.mn).padStart(8)}   ${pct(t.s3, t.n3).padStart(8)}   ${(binom3(p) * 100).toFixed(1).padStart(18)}%   ${pct(t.s5, t.n5).padStart(8)}   ${(binom5(p) * 100).toFixed(1).padStart(6)}%   （平均差 ${(t.gap / pairs.length).toFixed(1)}）`)
}
