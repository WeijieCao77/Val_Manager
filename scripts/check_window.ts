/**
 * How many transfer turns does the preseason window actually give you?
 *
 * The dashboard says the stage has 20 days left while the agenda says the
 * window has 21 — two counts of the same span — and a turn in preseason moves
 * a week. If the last turn falls outside the window, or an offer made on the
 * last turn answers after it shuts, the manager silently loses a third of the
 * only real squad-building window in the season.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason, STAGES } from '../src/engine/season'
import {
  windowOpen, TRANSFER_WINDOWS, makeOffer, enquireAbout, askingPrice,
  incomingOffers, answerIncoming, bidForOurPlayers,
} from '../src/engine/transfer'
import { windowDaysLeft } from '../src/engine/agenda'
import { cycleDays } from '../src/engine/actions'
import { Rng } from '../src/engine/rng'

const wbg = WORLD_TEAMS.find(t => t.tag === 'WBG')!
const g = createNewGame(wbg.id, '审计经理', 20260824)
setupSeason(g)
const rng = new Rng(3)

console.log(`季前 ${STAGES[0].start}~${STAGES[0].end} 天 · 转会窗口 ${TRANSFER_WINDOWS[0][0]}~${TRANSFER_WINDOWS[0][1]} 天\n`)

let turn = 0
while (g.day <= 30) {
  const stage = STAGES.find(s => s.key === g.stage)!
  const span = cycleDays(g)
  const open = windowOpen(g.day)
  turn++
  console.log(
    `回合 ${String(turn).padStart(2)} · 第 ${String(g.day).padStart(2)} 天 · ${stage.name}` +
    ` · 本回合走 ${span} 天 · 窗口${open ? `开（面板写还剩 ${windowDaysLeft(g)} 天）` : '关'}` +
    ` · 赛段面板写还剩 ${stage.end - g.day + 1} 天`,
  )
  if (!open && g.day > TRANSFER_WINDOWS[0][1]) break
  for (let i = 0; i < span; i++) advanceDay(g, rng)
}

// an offer placed on the last in-window turn: does it ever come back?
const g2 = createNewGame(wbg.id, '审计经理', 20260824)
setupSeason(g2)
const rng2 = new Rng(4)
while (g2.day < 14) advanceDay(g2, rng2)
const mark = Object.values(g2.players).find(p => p.teamId && p.teamId !== g2.myTeam && p.overall >= 70)!
const off = makeOffer(g2, mark.id, g2.myTeam, 200000, { salary: 60000, years: 2 } as never)!
console.log(`\n第 14 天（窗口内最后一个回合）报价 ${mark.ign}，对方第 ${off.respondOn} 天答复` +
  ` — 那天窗口${windowOpen(off.respondOn) ? '还开着' : '已经关了'}`)
while (g2.day <= 30 && off.status === 'pending') advanceDay(g2, rng2)
console.log(`推进到第 ${g2.day} 天，报价状态：${off.status}` +
  `（窗口关了也照常结算，不会被作废）`)

// force one through: an overwhelming bid on a listed player, placed on the
// last in-window turn, must still complete after the window shuts
const g4 = createNewGame(wbg.id, '审计经理', 20260824)
setupSeason(g4)
const rng4 = new Rng(9)
while (g4.day < 14) advanceDay(g4, rng4)
const cheap = Object.values(g4.players)
  .filter(x => x.teamId && x.teamId !== g4.myTeam && x.overall <= 60)
  .sort((a, b) => a.value - b.value)[0]
const was = cheap.teamId
const fee = Math.round(askingPrice(cheap) * 1.4)
const big = makeOffer(g4, cheap.id, g4.myTeam, fee,
  { salary: Math.round(cheap.salary * 1.6), years: 3, signingBonus: 0, bonusShare: 0,
    releaseClause: 0, promisedRole: 'starter' } as never)!
while (g4.day <= 40 && big.status === 'pending') advanceDay(g4, rng4)
console.log(`\n第 14 天报价 ${cheap.ign}（${g4.teams[was ?? ''].tag}，出价 ${fee}，余额 ${Math.round(g4.finances.balance)}）`
  + ` — 第 ${big.respondOn} 天答复，窗口${windowOpen(big.respondOn ?? 0) ? '开' : '关'}`
  + `\n结果：${big.status}，现效力 ${g4.teams[cheap.teamId ?? '']?.tag ?? '自由人'}（我们是 ${g4.teams[g4.myTeam].tag}）`)

// and an enquiry, which is the cheaper first step
const g3 = createNewGame(wbg.id, '审计经理', 20260824)
setupSeason(g3)
const rng3 = new Rng(5)
while (g3.day < 14) advanceDay(g3, rng3)
enquireAbout(g3, mark.id)
const e = (g3.enquiries ?? []).find(x => x.playerId === mark.id)
console.log(`\n第 14 天问价 ${mark.ign}，第 ${e?.replyOn} 天回复` +
  ` — 那天窗口${e ? (windowOpen(e.replyOn) ? '还开着' : '已经关了') : '?'}`)

// the rule the window enforces: once shut you may answer, not open
const g5 = createNewGame(wbg.id, '审计经理', 20260824)
setupSeason(g5)
const rng5 = new Rng(12)
while (g5.day <= 21) advanceDay(g5, rng5)
const mark2 = Object.values(g5.players).find(p => p.teamId && p.teamId !== g5.myTeam)!
console.log(`\n窗口关闭后（第 ${g5.day} 天）：`)
console.log(`  新报价 → ${makeOffer(g5, mark2.id, g5.myTeam, 50000, { salary: 40000, years: 2 } as never)
  ? 'FAIL 居然成功了' : 'ok 被拒绝'}`)
console.log(`  新问价 → ${enquireAbout(g5, mark2.id)}`)
// A rival's bid that landed on the last day of the window must still be
// answerable the day after it shuts, or "closed" would mean "frozen". The bid
// is placed by hand rather than waited for: whether the AI happens to want one
// of our players on day 20 is not what this is checking.
const g6 = createNewGame(WORLD_TEAMS.find(t => t.tag === 'TYL')!.id, '审计经理', 20260824)
setupSeason(g6)
const rng6 = new Rng(21)
while (g6.day < 20) advanceDay(g6, rng6)
const ours = Object.values(g6.players).find(q => q.teamId === g6.myTeam)!
const buyer = Object.values(g6.teams).find(t => t.id !== g6.myTeam)!
g6.offers.push({
  id: 'IN_test', playerId: ours.id, fromTeam: g6.myTeam, toTeam: buyer.id,
  fee: 1_000_000, salary: ours.salary, years: 2, day: g6.day,
  respondOn: g6.day, status: 'pending',
} as never)
advanceDay(g6, rng6)   // day 21: the window has shut
const inbound = incomingOffers(g6)
console.log(`  别队对我们球员的报价（第 ${g6.day} 天，窗口${windowOpen(g6.day) ? '开' : '关'}）` +
  ` → ${inbound.length} 份待答复` +
  (inbound.length ? `，答复：${answerIncoming(g6, inbound[0].id, false)}` : ' — FAIL 报价没挂住'))
