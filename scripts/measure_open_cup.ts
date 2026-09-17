/**
 * Who wins a 全服杯, and what a round costs the process.
 *
 *   npx tsx scripts/measure_open_cup.ts [entrants] [cups]
 *
 * The field is the 79 cup clubs' fives at random levels 0–5, which spans 62
 * to about 105 on paper — wider than the live ladder pool sampled 2026-09-17.
 */
import { CUP_TEAMS } from '../src/engine/cupTeams'
import { squadRating } from '../src/engine/cards'
import { Rng } from '../src/engine/rng'
import { openCupMatchSeed, pairOpenCupRound, planOpenCup, playOpenCupMatch } from '../src/engine/openCup'
import type { RivalSquad } from '../src/engine/arena'

const N = Number(process.argv[2] ?? 200)
const CUPS = Number(process.argv[3] ?? 10)
const rng = new Rng(917)
const champs: number[] = []
const ranks: number[] = []
let worstRound = 0
for (let c = 0; c < CUPS; c++) {
  const field = new Map<string, { five: RivalSquad; score: number; byes: number }>()
  for (let i = 0; i < N; i++) {
    const t = CUP_TEAMS[Math.floor(rng.next() * CUP_TEAMS.length)]
    const lv = Math.floor(rng.next() * 6)
    const levels = Object.fromEntries([...t.squad.slots, t.squad.coach].filter(Boolean).map((id) => [id as string, lv]))
    field.set(`p${i}`, {
      five: { name: t.name, tag: t.tag, slots: t.squad.slots, coach: t.squad.coach, levels, div: 0, points: 0 },
      score: squadRating(t.squad, () => lv), byes: 0,
    })
  }
  const order = [...field.values()].map((f) => f.score).sort((a, b) => b - a)
  const plan = planOpenCup(N)
  let alive = [...field.keys()]
  for (let round = 0; alive.length > 1; round++) {
    const t0 = performance.now()
    const { pairs, byes } = pairOpenCupRound(alive.map((id) => ({ id, byes: field.get(id)!.byes })), 1234 + c, round)
    const next: string[] = []
    pairs.forEach(([a, b], slot) => {
      const r = playOpenCupMatch(field.get(a)!.five, field.get(b)!.five, round === plan.rounds - 1, openCupMatchSeed(1234 + c, round, slot))
      next.push(r.aWon ? a : b)
    })
    for (const bye of byes) { field.get(bye)!.byes++; next.push(bye) }
    alive = next
    worstRound = Math.max(worstRound, performance.now() - t0)
  }
  const s = field.get(alive[0])!.score
  champs.push(s)
  ranks.push(order.indexOf(s) + 1)
}
console.log(`${N} 人 × ${CUPS} 场：${planOpenCup(N).rounds} 轮，间隔 ${planOpenCup(N).stepSec / 60} 分钟`)
console.log(`冠军综合分：${champs.join(' ')}`)
console.log(`冠军在本场的纸面排名：${ranks.join(' ')}（共 ${N} 人）`)
console.log(`最慢的一轮：${(worstRound / 1000).toFixed(2)} 秒 CPU（服务端每场之间让出事件循环）`)
