/** Hiring a coach must be a negotiation, not a purchase. */
import { createNewGame, WORLD_TEAMS, wageBill } from '../src/engine/world'
import { createManager } from '../src/engine/manager'
import { advanceDay, setupSeason } from '../src/engine/season'
import { askingSalary, offerToStaff, staffMarket, ROLE_CN } from '../src/engine/staff'

const g = createNewGame(WORLD_TEAMS[0].id, 'x', 4, createManager('t', 24, 'grassroots'))
setupSeason(g)
const before = g.teams[g.myTeam].coach?.name
console.log(`现主教练 ${before}，薪资总额 ${Math.round(wageBill(g, g.myTeam) / 1000)}K`)

const market = staffMarket(g)
// lowball the first, pay the asking price for the next two
const bids: [string, number, string][] = [
  [market[0].name, Math.round(askingSalary(market[0], 'head') * 0.6), 'head'],
  [market[1].name, askingSalary(market[1], 'head'), 'head'],
  [market[2].name, askingSalary(market[2], 'assistant'), 'assistant'],
  [market[3].name, askingSalary(market[3], 'analyst'), 'analyst'],
]
for (const [name, pay, role] of bids) {
  console.log(' →', offerToStaff(g, name, role as never, pay, 2), `(${ROLE_CN[role as never]} ${Math.round(pay / 1000)}K)`)
}
console.log('\n等待答复…')
for (let d = 0; d < 9; d++) {
  const r = advanceDay(g, {})
  for (const n of r.notes) if (n.includes('邀请') || n.includes('主教练') || n.includes('接受') || n.includes('拒绝')) {
    console.log(`  第${g.day}天 ${n}`)
  }
}
console.log('\n现主教练', g.teams[g.myTeam].coach?.name)
console.log('教练组:', (g.staff ?? []).map((s) => `${s.name}(${ROLE_CN[s.role]})`).join('、') || '无')
console.log('薪资总额', Math.round(wageBill(g, g.myTeam) / 1000) + 'K')
