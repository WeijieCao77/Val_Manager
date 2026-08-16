/** Success must open doors: better clubs should come after a winning manager. */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { createManager } from '../src/engine/manager'
import { advanceDay, acceptJob, setupSeason } from '../src/engine/season'

// a mid-table tier-1 club, the kind a new manager can actually get
const mid = [...WORLD_TEAMS].filter((t) => t.tier === 1).sort((a, b) => a.rating - b.rating)[6]
const m = createManager('\u6d4b\u8bd5', 24, 'grassroots')
const g = createNewGame(mid.id, m.name, 4, m)
setupSeason(g)
const start = g.myTeam
console.log(`\u6267\u6559 ${mid.name}\uff08\u58f0\u671b ${g.teams[start].reputation}\uff09\uff0c\u7ecf\u7406\u58f0\u671b ${g.manager!.reputation}`)

const seen = new Set<string>()
let moved = ''
for (let i = 0; i < 336 * 4 && !g.gameOver; i++) {
  advanceDay(g, {})
  for (const o of g.jobOffers ?? []) {
    if (seen.has(o.teamId)) continue
    seen.add(o.teamId)
    const t = g.teams[o.teamId]
    console.log(`  ${g.year}\u5e74 \u9080\u8bf7 ${t.name} \u58f0\u671b${t.reputation} (\u73b0\u4e1c\u5bb6${g.teams[g.myTeam].reputation}, \u7ecf\u7406${Math.round(g.manager!.reputation)}, \u51a0\u519b${g.honours.length})`)
    if (!moved) { console.log('   \u2192 ' + acceptJob(g, o.id)); moved = t.name }
  }
}
console.log(`\n\u8d77\u70b9 ${g.teams[start].name} \u2192 \u73b0\u5728 ${g.teams[g.myTeam].name}`)
console.log(`\u7ecf\u7406\u58f0\u671b ${Math.round(g.manager!.reputation)} \u51a0\u519b ${g.honours.length} \u4efb\u671f ${JSON.stringify(g.tenures)}`)
console.log(`\u65b0\u961f\u9635\u5bb9 ${g.teams[g.myTeam].roster.length} \u4eba\uff0c\u9996\u53d1 ${g.teams[g.myTeam].starters.length} \u4eba`)
