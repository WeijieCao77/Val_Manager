/** A career must be able to end: warn first, then sack. */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { createManager } from '../src/engine/manager'
import { advanceDay, setupSeason } from '../src/engine/season'

// take the weakest club we can and never intervene, so the board turns on us
const worst = [...WORLD_TEAMS].filter((t) => t.tier === 1).sort((a, b) => a.rating - b.rating)[0]
const m = createManager('测试', 24, 'grassroots')
const g = createNewGame(worst.id, m.name, 4, m)
setupSeason(g)
console.log(`执教 ${worst.name}（实力 ${worst.rating}，联赛垫底）`)

// sabotage the squad so the board has something to be unhappy about
import { releasePlayer } from '../src/engine/transfer'
const squad = worst.roster.map((id) => g.players[id]).filter(Boolean).sort((a, b) => b.overall - a.overall)
for (const p of squad.slice(0, 2)) releasePlayer(g, p)
console.log(`（已放走两名主力，剩余 ${g.teams[g.myTeam].roster.length} 人）`)

let warned = false
for (let s = 0; s < 4 && !g.gameOver; s++) {
  const y = g.year
  while (g.year === y && !g.gameOver) {
    const r = advanceDay(g)
    for (const n of r.notes) {
      if (n.includes('警告') && !warned) { warned = true; console.log('  ⚠', n.trim()) }
      if (n.includes('解除你的职务')) console.log('  🚪', n.trim())
      if (n.startsWith('❌') || n.startsWith('✅')) console.log('   ', n.trim())
    }
  }
}
console.log(`\n结果: ${g.gameOver ? '已被解约' : '仍在任'}，信任度 ${Math.round(g.boardConfidence)}，连续失利 ${g.missedStreak ?? 0}`)
console.log(`先警告后解约: ${g.gameOver ? (warned ? '✅ 是' : '❌ 无预兆') : '（未触发）'}`)
