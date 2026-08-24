/**
 * How many transfer turns does the preseason window actually give you?
 *
 * The dashboard says the stage has 20 days left while the agenda says the
 * window has 21 — two counts of the same span — and a turn in preseason moves
 * a week. If the last turn falls outside the window, or an offer made on the
 * last turn answers after it shuts, the manager silently loses a third of the
 * only real squad-building window in the season.
 */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { advanceDay, setupSeason, STAGES } from '../src/engine/season'
import { windowOpen, TRANSFER_WINDOWS, makeOffer, enquireAbout, askingPrice } from '../src/engine/transfer'
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
const off = makeOffer(g2, mark.id, g2.myTeam, 200000, { salary: 60000, years: 2 } as never)
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
    releaseClause: 0, promisedRole: 'starter' } as never)
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
