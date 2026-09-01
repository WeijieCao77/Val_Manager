/** Trust must move for things the manager did, and gate re-signing. */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { createManager } from '../src/engine/manager'
import { advanceDay, setupSeason } from '../src/engine/season'
import { bookGig, openGigs } from '../src/engine/commercial'
import { departureImpact, trustLabel, trustOf } from '../src/engine/trust'
import { bondBetween } from '../src/engine/bonds'

function run(label: string, tweak: (g: ReturnType<typeof createNewGame>) => void) {
  const g = createNewGame(WORLD_TEAMS[6].id, 'x', 5, createManager('t', 24, 'grassroots'))
  setupSeason(g)
  for (const p of squadOf(g, g.myTeam)) g.training[p.id] = 'rest'
  for (let d = 0; d < 168; d++) {
    tweak(g)
    advanceDay(g, {})
  }
  const sq = squadOf(g, g.myTeam)
  const avg = sq.reduce((s, p) => s + trustOf(p), 0) / sq.length
  console.log(`${label.padEnd(20)} 平均信任 ${avg.toFixed(0).padStart(3)}  (${trustLabel(avg)})  ` +
    `最低 ${Math.min(...sq.map((p) => Math.round(trustOf(p))))}`)
}

console.log('半个赛季，同一支队，只有经理的行为不同：\n')
run('正常经营', () => {})
run('来者不拒接商务', (g) => {
  for (const gig of openGigs(g)) {
    if (gig.accepted) continue
    bookGig(g, gig.id, squadOf(g, g.myTeam).slice(0, gig.heads).map((p) => p.id))
  }
})
run('往死里练（不休息）', (g) => {
  for (const p of squadOf(g, g.myTeam)) g.training[p.id] = 'aim'
})

// selling a well-liked veteran
const g = createNewGame(WORLD_TEAMS[6].id, 'x', 5, createManager('t', 24, 'grassroots'))
setupSeason(g)
const sq = squadOf(g, g.myTeam)
const star = sq[0]
console.log(`\n如果卖掉 ${star.ign}：`)
for (const h of departureImpact(g, star)) {
  console.log(`  ${h.p.ign.padEnd(11)} 关系 ${Math.round(h.bond).toString().padStart(3)} → 信任 −${h.hit.toFixed(1)}`)
}
console.log(`（关系 ≤15 的队友不受影响；bondBetween 样例 ${Math.round(bondBetween(g, sq[0].id, sq[1].id))}）`)
