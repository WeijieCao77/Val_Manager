/**
 * An assistant can be made head coach and a head coach an assistant. (2026-09-06)
 *
 *   npx tsx scripts/check_promotion.ts
 */
import { createNewGame } from '../src/engine/world'
import { wageBill } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { createManager } from '../src/engine/manager'
import { setupSeason } from '../src/engine/season'
import { demoteHead, promoteToHead, staffMarket, employedCoaches, staffBonus } from '../src/engine/staff'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails++
}

const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'EDG')!.id, 'x', 4, createManager('t', 24, 'grassroots'))
setupSeason(g)
const team = g.teams[g.myTeam]
const founding = team.coach!.name
// put an assistant and an analyst on the books directly — the hiring path has its own check
const a = staffMarket(g)[0]
g.staff = [
  { name: a.name, role: 'assistant', tactics: a.tactics, development: a.development, motivation: a.motivation, salary: 50_000, years: 2 },
  { name: 'Analyst X', role: 'analyst', spec: 'maps', tactics: 70, development: 60, motivation: 60, salary: 40_000, years: 1 },
]
const wage0 = wageBill(g, g.myTeam)
const dev0 = staffBonus(g, 'development')

console.log(promoteToHead(g, 'Analyst X'))
check('分析师不能升任主教练', team.coach?.name === founding)
console.log(promoteToHead(g, a.name))
check('助教成了主教练', team.coach?.name === a.name, team.coach?.name)
check('原主教练转为助教', g.staff.some((s) => s.name === founding && s.role === 'assistant'))
check('升任者不再在教练组名单里', !g.staff.some((s) => s.name === a.name))
check('主教练薪资不低于原薪', (team.coach?.salary ?? 0) >= 50_000, `${team.coach?.salary}`)
check('原主教练（建队时不占薪资）作为助教开始领薪', g.staff.find((s) => s.name === founding)!.salary > 0)
const wage1 = wageBill(g, g.myTeam)
check('薪资总额随之变化且为正', wage1 > 0 && wage1 !== wage0, `${Math.round(wage0 / 1000)}K → ${Math.round(wage1 / 1000)}K`)
check('培养加成重新按新的教练组算', staffBonus(g, 'development') !== dev0 || g.staff.length === 2)
check('挖角名单里没有自己的教练', !employedCoaches(g).some((x) => x.coach.name === a.name))

console.log(demoteHead(g))
check('降级后没有主教练', team.coach === null)
check('降级者进了教练组当助教', g.staff.some((s) => s.name === a.name && s.role === 'assistant'))
check('降级不减薪', g.staff.find((s) => s.name === a.name)!.salary >= 50_000)
console.log(demoteHead(g))
check('没有主教练时再降级只是提示', team.coach === null)
console.log(promoteToHead(g, founding))
check('空位时升任不需要有人让位', team.coach?.name === founding && !g.staff.some((s) => s.name === founding))
check('教练组人数守恒', g.staff.length === 2, `${g.staff.map((s) => s.name).join('、')}`)
check('市场里没有本队的人', !staffMarket(g).some((c) => c.name === a.name || c.name === founding))

console.log(fails ? `\n${fails} 项失败` : '\n全部通过')
process.exit(fails ? 1 : 0)
