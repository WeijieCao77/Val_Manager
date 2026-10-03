/**
 * 挖回老部下: an analyst hired at A, left behind when the manager moves to B,
 * can be approached at A — compensation to A, A's answer, then his terms.
 *
 * Reported 2026-10-03: 「在 A 队签了一个分析师，签了 3 年，跳槽去 B 后想挖回
 * 来，分析师列表里没有别的队伍的人」.
 *
 *   npx tsx scripts/check_staff_poach.ts
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { moveToClub, setupSeason } from '../src/engine/season'
import {
  analystMarket, approachForStaff, clearedCoaches, employedStaff, offerToStaff, resolveApproaches, resolveStaffOffers,
  staffReleaseFee, askingSalary,
} from '../src/engine/staff'
import { Rng } from '../src/engine/rng'
import { packState, unpackState } from '../src/engine/save'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const id = (tag: string) => WORLD_TEAMS.find((t) => t.tag === tag)!.id
let granted = 0, signed = 0
for (let seed = 1; seed <= 12; seed++) {
  const g = createNewGame(id('FUR'), '审计', seed)
  setupSeason(g)
  g.finances.balance = 5_000_000
  const A = g.myTeam
  // hire an analyst at A, three years, at what he asks plus a margin
  const pick = analystMarket(g)[0]
  offerToStaff(g, pick.name, 'analyst', Math.round(askingSalary(pick, 'analyst') * 1.6), 3)
  g.day += 8
  resolveStaffOffers(g, new Rng(seed))
  const hired = g.staff?.find((m) => m.name === pick.name)
  if (!hired) continue
  // take the job at B: he stays on A's books
  moveToClub(g, id('LOUD'))
  if (seed === 1) {
    check('跳槽后分析师留在原俱乐部的名单上', !g.staff?.some((m) => m.name === pick.name)
      && !!g.teams[A].supportStaff?.some((m) => m.name === pick.name))
    check('自由分析师列表里没有他（他有合同）', !analystMarket(g).some((c) => c.name === pick.name))
    const row = employedStaff(g).find((x) => x.member.name === pick.name)
    check('「挖别队教练」里能看到他，标着原俱乐部和补偿', !!row && row.team.id === A && row.ask === staffReleaseFee(g.teams[A], hired) && row.ask > 0,
      `${row?.team.tag} ${row?.ask}`)
    check('补偿金不够时拒绝', approachForStaff({ ...g, finances: { ...g.finances, balance: 0 } }, A, pick.name, row!.ask).includes('资金不足'))
    check('不存在的人不能接触', approachForStaff(g, A, '没这个人', 1000).includes('不在'))
  }
  const ask = employedStaff(g).find((x) => x.member.name === pick.name)!.ask
  approachForStaff(g, A, pick.name, Math.round(ask * 1.3))
  if (seed === 1) check('同一个人不能重复接触', approachForStaff(g, A, pick.name, ask).includes('已经在等'))
  g.day += 7
  resolveApproaches(g, new Rng(seed * 7))
  const ap = g.staffApproaches?.find((a) => a.name === pick.name)
  if (ap?.answer !== 'granted') continue
  granted++
  const cand = clearedCoaches(g).find((c) => c.name === pick.name)
  if (granted === 1) check('获准后能谈合同，要价比他现在的年薪高一点', !!cand && askingSalary(cand, 'analyst') > hired.salary,
    `${cand && askingSalary(cand, 'analyst')} vs ${hired.salary}`)
  const bal = g.finances.balance
  offerToStaff(g, pick.name, 'analyst', Math.round(askingSalary(cand!, 'analyst') * 1.2), 2)
  g.day += 8
  resolveStaffOffers(g, new Rng(seed * 13))
  const back = g.staff?.find((m) => m.name === pick.name)
  if (!back) continue
  signed++
  if (signed === 1) {
    check('挖回来了：在新俱乐部的教练组里，原俱乐部名单上没了', !g.teams[A].supportStaff?.some((m) => m.name === pick.name))
    check('专精跟着他走', back.spec === hired.spec, `${back.spec} vs ${hired.spec}`)
    const fee = g.finances.log.find((l) => l.label === `补偿 ${g.teams[A].name}`)
    check('补偿金付给了原俱乐部', !!fee && fee.amount === -ap.fee && bal - g.finances.balance >= ap.fee, `${fee?.amount}`)
    check('存档往返后都还在', unpackState(packState(g)).staff?.some((m) => m.name === pick.name) === true)
  }
}
check('十二次里俱乐部大多放人（补偿给到 1.3 倍）', granted >= 8, `${granted}/12`)
check('获准后大多谈成（老部下更愿意回来）', signed >= Math.ceil(granted * 0.6), `${signed}/${granted}`)

console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
