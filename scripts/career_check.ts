/** Applying for a job must be possible, refusable, and rewarded by results. */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { createManager } from '../src/engine/manager'
import { advanceDay, setupSeason } from '../src/engine/season'
import { applyForJob, managerSalaryFor, openness, renegotiate } from '../src/engine/career'

// a nobody at a mid club
const mid = [...WORLD_TEAMS].filter((t) => t.tier === 1).sort((a, b) => a.rating - b.rating)[5]
const g = createNewGame(mid.id, 'x', 4, createManager('t', 24, 'grassroots'))
setupSeason(g)
console.log(`执教 ${mid.name}，经理声望 ${g.manager!.reputation}，年薪 ${Math.round((g.managerContract?.salary ?? 0) / 1000)}K`)

const rank = Object.values(g.teams)
  .filter((t) => t.id !== g.myTeam)
  .map((t) => ({ t, ...openness(g, t) }))
  .sort((a, b) => b.odds - a.odds)
console.log(`\n愿意考虑我的球队：${rank.filter((x) => x.odds > 0).length} / ${rank.length}`)
console.log('最容易进的三家：')
for (const x of rank.slice(0, 3)) {
  console.log(`  ${x.t.name.padEnd(22)} 声望${String(x.t.reputation).padStart(3)}  ${Math.round(x.odds * 100)}%  ${x.note}`)
}
console.log('够不着的（声望最高的三家）：')
for (const x of [...rank].sort((a, b) => b.t.reputation - a.t.reputation).slice(0, 3)) {
  console.log(`  ${x.t.name.padEnd(22)} 声望${String(x.t.reputation).padStart(3)}  ${Math.round(x.odds * 100)}%  ${x.note}`)
}

// apply somewhere reachable and see what comes back
const target = rank.find((x) => x.odds > 0.2)!
const fair = managerSalaryFor(target.t, g.manager!.reputation)
console.log(`\n向 ${target.t.name} 申请（要价 ${Math.round(fair / 1000)}K，合理价）：`)
console.log('  ', applyForJob(g, target.t.id, fair, 2))
for (let d = 0; d < 12; d++) {
  const r = advanceDay(g, {})
  for (const n of r.notes) if (n.includes('申请')) console.log(`  第${g.day}天 ${n}`)
}

// and try to squeeze the current board
console.log('\n跟现俱乐部谈涨薪：')
const cur = g.managerContract!.salary
console.log('  要求 +20%：', renegotiate(g, Math.round(cur * 1.2), 2))
console.log('  要求 +80%：', renegotiate(g, Math.round(cur * 1.8), 2))
