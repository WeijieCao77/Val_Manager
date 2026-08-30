/**
 * The three things the group chat reported, asked of the engine directly:
 * mid-career money (league share), AI clubs benching their own signings,
 * and retirements that arrive with no warning and leave no trace.
 */
import { createNewGame, WORLD_TEAMS, squadOf } from '../src/engine/world'
import { createManager } from '../src/engine/manager'
import { advanceDay, persuadeStay, SEASON_DAYS, setupSeason } from '../src/engine/season'
import { weeklyFinance } from '../src/engine/finance'
import {
  answerBundle, BUNDLE_BUYOUT, leagueDealOf, negotiateShare, setDealMode, weeklyStipend,
} from '../src/engine/leagueShare'
import { doTransfer, refreshListings, aiTransferTick, TRANSFER_WINDOWS } from '../src/engine/transfer'
import { defaultContract } from '../src/engine/types'
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'

const fail = (msg: string): never => { throw new Error(msg) }

const mk = (): GameState => {
  const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
  const g = createNewGame(me.id, '测试', 7, createManager('测试', 30, 'expro'))
  setupSeason(g)
  return g
}

// ---------------------------------------------------------------- 联盟分成
{
  const g = mk()
  const me = g.teams[g.myTeam]!
  const ai = Object.values(g.teams).find((t) => t.id !== g.myTeam && t.tier === 1)!
  const myBudget = g.finances.balance
  const aiBudget = ai.budget
  weeklyFinance(g)
  const stipendLine = g.finances.log.find((e) => e.label === '联盟津贴')
  if (!stipendLine) fail('每周结算里应有「联盟津贴」一行')
  if (stipendLine!.amount !== weeklyStipend(1)) fail(`津贴金额不对：${stipendLine!.amount}`)
  if (g.finances.balance <= myBudget - 200_000) fail('津贴应缓解每周净支出')
  void aiBudget
  if (weeklyStipend(1) <= weeklyStipend(2)) fail('VCT 津贴应高于次级')
  console.log(`✅ 联盟津贴：VCT $${(weeklyStipend(1) * 48).toLocaleString()}/年，次级 $${(weeklyStipend(2) * 48).toLocaleString()}/年，AI 俱乐部同样领取`)

  // 谈判一年一次
  const deal = leagueDealOf(g)
  const before = deal.share
  const msg1 = negotiateShare(g)
  if (deal.talkedYear !== g.year) fail('谈判后应记录年份')
  if (deal.share !== before && deal.share !== before + 5) fail('分成只能 +5 一档')
  const msg2 = negotiateShare(g)
  if (!msg2.includes('已经')) fail('同年二谈应被拒绝')
  console.log(`✅ 联盟谈判：${msg1.slice(0, 30)}… → 再谈被拒`)

  // 结算方式赛季初可改、开赛后锁定
  g.day = 10
  const m1 = setDealMode(g, 'sales')
  if (!m1.includes('销量')) fail('赛季初应能改为销量')
  g.day = 100
  const m2 = setDealMode(g, 'fixed')
  if (!m2.includes('改不了')) fail('开赛后不应能改')
  console.log('✅ 结算方式：赛季初可选，开赛后锁定')

  // 特别企划:买断入账,对赌记账
  const g2 = mk()
  g2.leagueOffer = { year: g2.year, expires: g2.day + 10 }
  const bal = g2.finances.balance
  answerBundle(g2, 'cash')
  if (g2.finances.balance !== bal + BUNDLE_BUYOUT) fail('买断金额未入账')
  const g3 = mk()
  g3.leagueOffer = { year: g3.year, expires: g3.day + 10 }
  answerBundle(g3, 'bet')
  if (!leagueDealOf(g3).bundleBet) fail('对赌应记入 deal')
  console.log(`✅ 特别企划：买断 $${BUNDLE_BUYOUT.toLocaleString()} 即时入账，对赌延至赛季结算`)

  // 年度结算:固定模式在赛季结束时入账
  const g4 = mk()
  g4.day = SEASON_DAYS - 1
  const balBefore = g4.finances.balance
  advanceDay(g4)
  const bundleLine = g4.finances.log.find((e) => e.label.startsWith('联盟分成 · 年度捆绑包'))
  if (!bundleLine) fail('赛季结束应有年度捆绑包结算')
  if (g4.finances.balance <= balBefore - 5_000_000) fail('结算后资金异常')
  console.log(`✅ 年度捆绑包：${bundleLine!.label} $${bundleLine!.amount.toLocaleString()}`)
}

// ------------------------------------------------- AI 买人就用人,新援不挂牌
{
  const g = mk()
  g.day = TRANSFER_WINDOWS[0][0]
  const ai = Object.values(g.teams).find((t) =>
    t.id !== g.myTeam && t.tier === 1 && t.starters.length === 5)!
  const star = Object.values(g.players)
    .filter((p) => p.teamId && p.teamId !== ai.id && p.teamId !== g.myTeam)
    .sort((a, b) => b.overall - a.overall)[0]!
  const worst = Math.min(...ai.starters.map((id) => g.players[id]!.overall))
  if (star.overall <= worst) fail('测试前提不成立：转会目标应强于现有首发')
  doTransfer(g, star, ai.id, 1_000_000, defaultContract(500_000, 3))
  if (!ai.starters.includes(star.id)) {
    fail(`AI 签下 ${star.ign}（${star.overall}）却没让他首发——正是群友报的问题`)
  }
  if (star.joinedYear !== g.year) fail('joinedYear 未盖戳')
  console.log(`✅ AI 签下 ${star.ign}（${star.overall}）后立刻进首发`)

  // 同赛季不挂牌:跑二十周挂牌逻辑,他不该被挂出去
  star.grievance = 0
  const rng = new Rng(42)
  for (let i = 0; i < 20; i++) refreshListings(g, rng)
  if (star.listed) fail('刚签的新援不该在同一赛季被挂牌')
  console.log('✅ 新援当季不挂牌（除非他自己想走）')

  // AI 不签将退役的自由人
  const g5 = mk()
  g5.day = TRANSFER_WINDOWS[0][0]
  const fa = Object.values(g5.players).filter((p) => !p.teamId)
    .sort((a, b) => b.overall - a.overall)[0]
  if (fa) {
    fa.retiring = true
    const rng5 = new Rng(7)
    for (let i = 0; i < 30; i++) aiTransferTick(g5, rng5)
    if (fa.teamId) fail('宣布退役的自由人不该被 AI 签下')
    console.log(`✅ AI 不签已宣布退役的 ${fa.ign}`)
  }
}

// ------------------------------------------------------- 退役:预告与告别
{
  const g = mk()
  // a wave of veterans on expiring deals: they should ANNOUNCE, not vanish
  const vets = Object.values(g.players).slice(0, 24)
  for (const p of vets) { p.age = 34; p.contractYears = 1 }
  // and veterans who just signed long: they stay silent
  const committed = Object.values(g.players).slice(24, 40)
  for (const p of committed) { p.age = 34; p.contractYears = 4 }
  const ids = vets.map((p) => p.id)
  g.day = SEASON_DAYS - 1
  advanceDay(g)
  const gone = ids.filter((id) => !g.players[id])
  const announced = ids.filter((id) => g.players[id]?.retiring)
  if (gone.length > 0) fail(`第一年不该有人直接消失（消失 ${gone.length} 人）`)
  if (announced.length === 0) fail('34 岁到期老将该有人宣布退役')
  if (committed.some((p) => g.players[p.id]?.retiring)) fail('刚签长约的老将不该宣布退役')
  console.log(`✅ 预告制：${announced.length}/24 名老将宣布下赛季退役，0 人凭空消失，签长约的都留下`)

  // the announced man on MY team can be talked around exactly once
  const mineId = squadOf(g, g.myTeam)[0]!.id
  const mine = g.players[mineId]!
  mine.retiring = true
  mine.persuaded = false
  const r1 = persuadeStay(g, mineId)
  if (!mine.persuaded) fail('挽留后应记录已谈过')
  const r2 = persuadeStay(g, mineId)
  if (mine.retiring && !r2.includes('劝过')) fail('二次挽留应被拒绝')
  console.log(`✅ 挽留：${r1.slice(0, 24)}…（${mine.retiring ? '未成' : '成功'}），再劝被拒`)

  // and when the season he announced ends, the farewell card exists
  const g6 = mk()
  const hero = squadOf(g6, g6.myTeam)[0]!
  hero.retiring = true
  hero.career.maps = 120
  hero.career.rounds = 2400
  hero.career.kills = 1900
  hero.career.deaths = 1500
  hero.career.mvps = 9
  g6.day = SEASON_DAYS - 1
  advanceDay(g6)
  if (g6.players[hero.id]) fail('宣布过的赛季结束应真正退役')
  const note = (g6.retireFeed ?? []).find((n) => n.id === hero.id)
  if (!note) fail('退役后应留下告别记录')
  // the catch-up day still plays fixtures, so the numbers can only have grown
  if (note!.career.maps < 120 || note!.career.mvps < 9) fail('告别卡数据未快照')
  if (!note!.clubName) fail('告别卡应记住最后一站')
  if (note!.seen) fail('新告别卡应等待展示')
  console.log(`✅ 告别卡：${note!.ign}，${note!.age} 岁，最后一站 ${note!.clubName}，生涯 ${note!.career.maps} 图 ${note!.career.mvps} 次 MVP`)
}

console.log('\n全部通过')
