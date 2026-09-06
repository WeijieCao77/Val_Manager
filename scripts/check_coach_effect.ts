/**
 * What is a coach card worth on the server, and what is one point of anything? (2026-09-06)
 *
 *   npx tsx scripts/check_coach_effect.ts [series]
 *
 * From the group: 「教练对队伍表现的影响现在好像不大」. The same five plays
 * itself — one side with a coach, one without; one side a level up, one
 * not — so the only thing that differs is the thing being measured.
 */
import { ALL_CARDS, SQUAD_SLOTS, isPlayerCard, isCoachCard, coachRating } from '../src/engine/cards'
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
    const pick = pool.find((c) => !used.has(c.id) && (role === '自由人' || c.roles.includes(role)))
      ?? pool.find((c) => !used.has(c.id))
    if (pick) used.add(pick.id)
    return pick?.id ?? null
  })
}
const rival = (slots: (string | null)[], coach: string | null, level: number): RivalSquad => {
  const levels: Record<string, number> = {}
  for (const id of slots) if (id) levels[id] = level
  return { name: 'B', tag: 'B', slots, coach, levels, div: 1, points: 2000 }
}
function rate(mine: Squad, theirs: RivalSquad): number {
  let w = 0
  for (let s = 1; s <= N; s++) if (playRivalMatch(mine, () => 0, theirs, 3, s * 7919).win) w++
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
