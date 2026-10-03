/**
 * 潜力突破 (engine/breakthrough.ts), 2026-10-03.
 *
 *   npx tsx scripts/check_breakthrough.ts
 *
 * The rules a player can see on the training screen, held to: the bar fills
 * only at the ceiling and only from official series our men played; a camp
 * needs a full bar, money, and this season's attempt unused; the camp stops
 * normal training; the result is fixed by the seed; success is +2 and three
 * a career, never past 99. Then one season of a top club: its starters at
 * their ceiling fill a bar, its bench and every AI player do not.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, continuePastFive, setupSeason } from '../src/engine/season'
import { aiDrillFor, trainingAdvice } from '../src/engine/training'
import {
  BREAK, breakBlock, breakChance, breakFee, settleBreaks, sparkAfterMatch, sparkFor, sparkOpen, startBreak,
} from '../src/engine/breakthrough'
import type { Fixture, GameState, MatchResult, Player } from '../src/engine/types'

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  — ${detail}` : ''}`)
}

const TOP = WORLD_TEAMS.filter((t) => t.tier === 1).sort((a, b) => b.rating - a.rating)[0]
const mk = (seed = 20261003): GameState => {
  const g = createNewGame(TOP.id, '审计', seed)
  setupSeason(g)
  return g
}
const atCap = (p: Player) => { p.potential = p.overall }
const fakeSeries = (g: GameState, ids: string[], won: boolean, stage: Fixture['stage'] = 'stage1', mvp?: string) => {
  const f = { teamA: g.myTeam, teamB: 'x', stage, label: '常规赛 W1' } as unknown as Fixture
  const r = { mapsWonA: won ? 2 : 0, mapsWonB: won ? 0 : 2, lineups: { a: ids, b: [] }, mvp } as unknown as MatchResult
  return { f, r }
}

// ---------------------------------------------------------------- the bar
{
  const g = mk()
  const [a, b] = squadOf(g, g.myTeam)
  atCap(a)
  b.potential = b.overall + 5
  const { f, r } = fakeSeries(g, [a.id, b.id], true, 'stage1', a.id)
  sparkAfterMatch(g, f, r, false)
  check(a.breakSpark === BREAK.win + BREAK.mvp, '到上限的主力赢一场 + MVP', `${a.breakSpark}`)
  check(!b.breakSpark, '离上限还远的不涨契机', `${b.breakSpark ?? 0}`)
  const ko = sparkFor(true, false, true, false), intl = sparkFor(false, false, true, true)
  check(ko === BREAK.win * BREAK.knockout && intl === BREAK.loss * BREAK.international,
    '淘汰赛和国际赛有倍数，不叠加', `${ko} / ${intl}`)
  a.breakSpark = 99
  sparkAfterMatch(g, f, r, true)
  check(a.breakSpark === BREAK.full, '契机封顶 100', `${a.breakSpark}`)
  // another club's man at his ceiling, in the same lineup slot: nothing
  const other = Object.values(g.players).find((p) => p.teamId && p.teamId !== g.myTeam)!
  atCap(other)
  sparkAfterMatch(g, fakeSeries(g, [other.id], true).f, fakeSeries(g, [other.id], true).r, false)
  check(!other.breakSpark, '别的俱乐部的选手不攒契机')
}

// ---------------------------------------------------------------- the camp
{
  const g = mk()
  const p = squadOf(g, g.myTeam)[0]
  atCap(p)
  check(!!breakBlock(g, p.id), '契机不满不能开特训', breakBlock(g, p.id) ?? '')
  p.breakSpark = BREAK.full
  g.finances.balance = breakFee(p) - 1
  check(breakBlock(g, p.id) === '资金不足。', '钱不够不能开')
  g.finances.balance = 10_000_000
  const odds = breakChance(g, p).pct
  check(odds >= BREAK.minChance && odds <= BREAK.maxChance, '成功率在区间内', `${odds}%`)
  const cash = g.finances.balance, pot = p.potential
  check(!!startBreak(g, p.id), '满了就能开')
  check(g.finances.balance === cash - breakFee(p), '扣了特训费', `${breakFee(p)}`)
  check(p.breakSpark === 0 && p.breakChance === odds && p.breakUntil === g.day + BREAK.campDays, '契机清零，成功率开训时定下')
  check(!!breakBlock(g, p.id), '特训中不能再开')
  check(!sparkOpen(p), '特训中不攒契机')

  // a camp week: no xp, more tired than an ordinary week
  g.training[p.id] = 'aim'
  const xp = { ...p.xp }
  let guard = 0
  while (g.day % 7 !== 6 && guard++ < 10) advanceDay(g, { autoResolveDrawDecisions: true })
  advanceDay(g, { autoResolveDrawDecisions: true })
  check(JSON.stringify(p.xp) === JSON.stringify(xp), '特训这周个人训练不涨经验')

  // the result, twice from the same state: the same
  const twin = structuredClone(g)
  g.day = p.breakUntil!
  twin.day = p.breakUntil!
  settleBreaks(g, [])
  settleBreaks(twin, [])
  const q = twin.players[p.id]
  check(p.potential === q.potential && (p.breakDone ?? 0) === (q.breakDone ?? 0), '同一个存档结果一样，读档不会重摇')
  check(p.breakUntil === undefined, '特训结束')
  if (p.breakDone) check(p.potential === Math.min(99, pot + BREAK.gain), '成功：潜力 +2', `${pot} → ${p.potential}`)
  else check(p.breakSpark === BREAK.keepOnFail && p.potential === pot, '失败：潜力不变，契机留 40')
  p.breakSpark = BREAK.full
  check(breakBlock(g, p.id) === '这个赛季已经试过了，明年再来。', '一个赛季只能试一次')
}

// ---------------------------------------------------------------- the limits
{
  const g = mk()
  const p = squadOf(g, g.myTeam)[0]
  atCap(p)
  let wins = 0
  for (let i = 0; i < 400 && (p.breakDone ?? 0) < BREAK.maxTimes; i++) {
    p.breakSpark = BREAK.full
    p.breakYear = undefined
    p.potential = Math.min(p.potential, 97)
    p.overall = p.potential
    if (startBreak(g, p.id)) {
      g.day = p.breakUntil!
      const before = p.breakDone ?? 0
      settleBreaks(g, [])
      if ((p.breakDone ?? 0) > before) wins++
    }
  }
  check(p.breakDone === BREAK.maxTimes && wins === BREAK.maxTimes, `一生最多成功 ${BREAK.maxTimes} 次`)
  p.breakSpark = BREAK.full
  p.breakYear = undefined
  check(!!breakBlock(g, p.id), '满了就不能再开')
  const odds3 = breakChance(g, p)
  check(odds3.parts.some((x) => x.v === -15 * BREAK.maxTimes), '突破过的次数压成功率', odds3.parts.map((x) => `${x.label}${x.v}`).join(' '))
  const q = squadOf(g, g.myTeam)[1]
  q.potential = 98; q.overall = 98; q.breakSpark = BREAK.full
  g.day = 1; startBreak(g, q.id)
  // force the roll: try seeds until it works, the cap is what is being tested
  for (let i = 0; i < 50 && !q.breakDone; i++) {
    q.breakUntil = g.day + 1 + i; q.breakChance = 100
    g.day = q.breakUntil
    settleBreaks(g, [])
  }
  check(q.potential === 99, '潜力不超过 99', `${q.potential}`)
  // an old save: no fields at all
  const old = squadOf(g, g.myTeam)[2]
  delete old.breakSpark; delete old.breakDone; delete old.breakUntil; delete old.breakYear
  check(breakChance(g, old).pct > 0 && !!breakBlock(g, old.id), '老存档没有这些字段也能读')
}

// ---------------------------------------------------------------- a season
{
  const g = mk(20261004)
  const five = new Set(g.teams[g.myTeam].starters)
  for (const p of squadOf(g, g.myTeam)) atCap(p)
  const ai = Object.values(g.players).filter((p) => p.teamId && p.teamId !== g.myTeam)
  for (const p of ai) atCap(p)
  const year = g.year
  let guard = 0
  while (g.year === year && guard++ < 500) {
    g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
    if (g.midReview) continuePastFive(g)
    if (g.day % 7 === 0) for (const p of squadOf(g, g.myTeam)) {
      g.training[p.id] = trainingAdvice(p, g.day).focus
      // the ceiling stays where it is for the measurement
      p.potential = Math.max(p.potential, p.overall)
    }
    if (g.drillLock == null) { g.drill = aiDrillFor(g, g.teams[g.myTeam]); g.drillLock = g.day + 7 }
    advanceDay(g, { autoResolveDrawDecisions: true })
  }
  const starters = squadOf(g, g.myTeam).filter((p) => five.has(p.id))
  const full = starters.filter((p) => (p.breakSpark ?? 0) >= BREAK.full).length
  check(full >= 4, `${TOP.tag} 打一季，主力能攒满契机`, starters.map((p) => `${p.ign} ${Math.floor(p.breakSpark ?? 0)}`).join(' '))
  check(ai.every((p) => !p.breakSpark && !p.breakDone), 'AI 俱乐部的人一点也不攒')
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
