/**
 * What is a coach card worth on the server, and what is one point of anything? (2026-09-06)
 *
 *   npx tsx scripts/check_coach_effect.ts [series]
 *
 * From the group: 「教练对队伍表现的影响现在好像不大」. The same five plays
 * itself — one side with a coach, one without; one side a level up, one
 * not — so the only thing that differs is the thing being measured.
 */
import { ALL_CARDS, SQUAD_SLOTS, isPlayerCard, isCoachCard, coachRating, personOf } from '../src/engine/cards'
import type { CoachCard, PlayerCard, Squad } from '../src/engine/cards'
import { playRivalMatch } from '../src/engine/arena'
import type { RivalSquad } from '../src/engine/arena'

const N = Number(process.argv[2] ?? 300)
const players = ALL_CARDS.filter((c): c is PlayerCard => isPlayerCard(c) && c.rarity !== 'mythic')
const coaches = ALL_CARDS.filter((c): c is CoachCard => isCoachCard(c) && !c.spec)
  .sort((a, b) => coachRating(b) - coachRating(a))

function clubFive(tag: string): (string | null)[] {
  const pool = players.filter((c) => c.clubTag === tag).sort((a, b) => b.rating - a.rating)
  const used = new Set<string>()
  return SQUAD_SLOTS.map((role) => {
    const pick = pool.find((c) => !used.has(personOf(c)) && (role === '自由人' || c.roles.includes(role)))
      ?? pool.find((c) => !used.has(personOf(c)))
    if (pick) used.add(personOf(pick))
    return pick?.id ?? null
  })
}
const rival = (slots: (string | null)[], coach: string | null, level: number, coachLevel = 0): RivalSquad => {
  const levels: Record<string, number> = {}
  for (const id of slots) if (id) levels[id] = level
  if (coach) levels[coach] = coachLevel
  return { name: 'B', tag: 'B', slots, coach, levels, div: 1, points: 2000 }
}
function rate(mine: Squad, theirs: RivalSquad, myCoachLevel = 0): number {
  let w = 0
  const level = (id: string) => (id === mine.coach ? myCoachLevel : 0)
  for (let s = 1; s <= N; s++) if (playRivalMatch(mine, level, theirs, 3, s * 7919).win) w++
  return w / N
}

const tag = 'EDG'
const five = clubFive(tag)
const own = coaches.find((c) => c.clubTag === tag)!
const best = coaches[0]
const worst = coaches[coaches.length - 1]
const median = coaches[Math.floor(coaches.length / 2)]
const otherSameGrade = coaches.filter((c) => c.clubTag !== tag)
  .sort((a, b) => Math.abs(coachRating(a) - coachRating(own)) - Math.abs(coachRating(b) - coachRating(own)))[0]
const show = (c: CoachCard) => `${c.name}(${c.clubTag ?? '-'} 战${c.tactics}/培${c.development}/激${c.motivation} 评${coachRating(c)})`
console.log(`${tag} 最强五人镜像对战，${N} 场 bo3；教练池 ${coaches.length} 人`)
console.log(`本队教练 ${show(own)}\n最强 ${show(best)}\n最弱 ${show(worst)}\n中位 ${show(median)}\n同分他队 ${show(otherSameGrade)}\n`)
const rows: [string, Squad, RivalSquad][] = [
  ['无教练 对 无教练（基线）', { slots: five, coach: null }, rival(five, null, 0)],
  ['本队教练 对 无教练', { slots: five, coach: own.id }, rival(five, null, 0)],
  ['同分他队教练 对 无教练', { slots: five, coach: otherSameGrade.id }, rival(five, null, 0)],
  ['最强教练 对 无教练', { slots: five, coach: best.id }, rival(five, null, 0)],
  ['最强教练 对 最弱教练', { slots: five, coach: best.id }, rival(five, worst.id, 0)],
  ['最强教练 对 中位教练', { slots: five, coach: best.id }, rival(five, median.id, 0)],
  ['无教练 对 全队 +1 级', { slots: five, coach: null }, rival(five, null, 1)],
  ['无教练 对 全队 +3 级', { slots: five, coach: null }, rival(five, null, 3)],
  ['无教练 对 全队 +5 级', { slots: five, coach: null }, rival(five, null, 5)],
  ['本队教练 对 全队 +1 级', { slots: five, coach: own.id }, rival(five, null, 1)],
]
console.log('场景                              我方胜率')
for (const [label, mine, theirs] of rows) {
  console.log(`${label.padEnd(30)} ${(rate(mine, theirs) * 100).toFixed(1).padStart(7)}%`)
}

// ---- the coach's own levels (2026-09-13): five levels on the coach against the
// same coach at +0, across the spread of coaches, so the number is not one
// man's. The design target was 2–5 points of BO3 win rate for +5.
console.log('\n教练 +5 对 同一教练 +0（同一套五人）')
let bad = 0
for (const c of [own, best, median, worst]) {
  const r = rate({ slots: five, coach: c.id }, rival(five, c.id, 0, 0), 5)
  const gain = (r - 0.5) * 100
  const ok = gain > 0.5 && gain < 10
  if (!ok) bad++
  console.log(`${show(c).padEnd(44)} ${(r * 100).toFixed(1).padStart(6)}%  ${ok ? 'ok' : 'FAIL'}`)
}
const lvlRow = rate({ slots: five, coach: own.id }, rival(five, own.id, 0, 5), 0)
console.log(`本队教练 +0 对 本队教练 +5              ${(lvlRow * 100).toFixed(1).padStart(6)}%`)
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
