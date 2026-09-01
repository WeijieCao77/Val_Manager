/** Losses with an uneven scoreboard must create real friction, and pair work must fix it. */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { createManager } from '../src/engine/manager'
import { advanceDay, setupSeason } from '../src/engine/season'
import { notableBonds, squadHarmony, bondBetween } from '../src/engine/bonds'

// take the weakest tier-1 club so we lose plenty and the room actually sours
const worst = [...WORLD_TEAMS].filter((t) => t.tier === 1).sort((a, b) => a.rating - b.rating)[0]
const g = createNewGame(worst.id, 'x', 4, createManager('t', 24, 'grassroots'))
setupSeason(g)
console.log(`执教 ${worst.name}（联赛垫底），初始默契 ${squadHarmony(g, g.myTeam).toFixed(0)}`)

for (let d = 0; d < 336 && !g.gameOver; d++) {
  advanceDay(g, {})
  if (g.day % 84 === 0) console.log(`  第 ${String(g.day).padStart(3)} 天  全队默契 ${squadHarmony(g, g.myTeam).toFixed(0)}`)
}

const pairs = notableBonds(g, g.myTeam)
console.log('\n最差的三对关系：')
for (const { a, b, value } of pairs.slice(0, 3)) console.log(`  ${a.ign} × ${b.ign}  ${value.toFixed(0)}`)
console.log('最好的一对：')
const best = pairs[pairs.length - 1]
console.log(`  ${best.a.ign} × ${best.b.ign}  ${best.value.toFixed(0)}`)

// now try to repair the worst pair with duo drills
const worstPair = pairs[0]
const before = bondBetween(g, worstPair.a.id, worstPair.b.id)
g.duo = { a: worstPair.a.id, b: worstPair.b.id }
for (let d = 0; d < 56; d++) advanceDay(g, {})
console.log(`\n用双排练修复 ${worstPair.a.ign} × ${worstPair.b.ign}：${before.toFixed(0)} → ${bondBetween(g, worstPair.a.id, worstPair.b.id).toFixed(0)}（8 周）`)
