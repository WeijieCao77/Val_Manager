/**
 * Do a club's contracts stay staggered?
 *
 * The world file deals lengths out across a squad so no more than two deals
 * end in the same window (deal_contract_years in scripts/build_world.py). That
 * only matters if it survives play: every club re-signs players every winter,
 * and rolling those renewals blind puts the cliff straight back — measured
 * before the fix, four seasons in, 40 of 78 clubs had four or more deals
 * ending together and 269 players were on one-year terms.
 *
 * Contract lengths drift with squad churn, so this asks for a league that
 * stays roughly flat rather than a guarantee no club ever stacks four.
 */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { advanceDay, setupSeason } from '../src/engine/season'
import { Rng } from '../src/engine/rng'

const top = WORLD_TEAMS.find(t => t.tag === 'TYL')!   // a club that will not be sacked
const g = createNewGame(top.id, '审计经理', 20260824)
setupSeason(g)
const rng = new Rng(11)

function snapshot(label: string) {
  const per: number[] = []
  const dist = [0, 0, 0, 0, 0]
  for (const t of Object.values(g.teams)) {
    const squad = t.roster.map(id => g.players[id]).filter(Boolean)
    if (squad.length < 5) continue
    const c: Record<number, number> = {}
    for (const p of squad) {
      const y = Math.max(0, Math.min(4, p.contractYears))
      c[y] = (c[y] ?? 0) + 1
      dist[y]++
    }
    // year 0 is "expired, waiting on the manager"; a cliff is deals ending together
    per.push(Math.max(...Object.entries(c).filter(([y]) => +y > 0).map(([, n]) => n), 0))
  }
  const avg = per.reduce((a, b) => a + b, 0) / per.length
  const cliffs = per.filter(n => n >= 4).length
  console.log(
    `${label.padEnd(10)} 同年到期 平均 ${avg.toFixed(2)} 最多 ${Math.max(...per)} · ` +
    `>=4 人的队 ${cliffs}/${per.length} · 年限分布 ${dist.slice(1).join('/')}（0年 ${dist[0]}）`,
  )
  return { avg, cliffs, dist }
}

let bad = 0
snapshot('开局')
for (let season = 1; season <= 4; season++) {
  const startYear = g.year
  let guard = 0
  while (!g.gameOver && guard++ < 400 && g.year === startYear) advanceDay(g, rng)
  if (g.gameOver) { console.log(`(第 ${season} 季被下课，停在这里)`); break }
  const s = snapshot(`第 ${season} 季后`)
  // the league should stay near two deals a club a year, and a cliff should be
  // the exception rather than a tenth of the league
  if (s.avg > 2.8) { console.log('     FAIL 平均同年到期爬到了 2.8 以上'); bad++ }
  if (s.cliffs > 8) { console.log('     FAIL 超过 8 支队伍出现合同悬崖'); bad++ }
  const longDeals = s.dist[3] + s.dist[4]
  if (longDeals < s.dist[1] * 0.5) { console.log('     FAIL 长约几乎消失，全联盟都在签一年'); bad++ }
}
console.log(bad ? '\nFAIL 错开没撑住' : '\nok  错开撑住了')
process.exit(bad ? 1 : 0)
