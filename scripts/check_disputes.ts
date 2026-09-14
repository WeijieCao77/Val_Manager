/**
 * An argument is a record the manager can act on, and each answer does what
 * it says once.
 *
 *   npx tsx scripts/check_disputes.ts
 *
 * 2026-09-13. A talk's outcome is drawn from the save's seed and the record,
 * so a reload cannot reroll it; a refusal costs nothing; the cooling-off
 * bench really keeps a man out of 自动首发 and the match-day five, survives
 * the winter rollover and the save, and ends on its own; the record closes
 * when either man leaves; two weeks of nothing has a price, once.
 */
const mem: Record<string, string> = {}
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = v },
  removeItem: (k: string) => { delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
}
import { createNewGame, autoStarters } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, finishDraw, setupSeason, continuePastFive, SEASON_DAYS } from '../src/engine/season'
import { exportSave, importSave } from '../src/engine/save'
import { selectLineup } from '../src/engine/match'
import { bondBetween } from '../src/engine/bonds'
import { trustOf } from '../src/engine/trust'
import { releasePlayer } from '../src/engine/transfer'
import { agendaFor } from '../src/engine/agenda'
import { careerDayOf, isCoolingOff } from '../src/engine/clock'
import {
  DISPUTE, benchBlock, disputeBlock, endCoolOff, handleDispute, openDispute, openDisputes, tickDisputes,
} from '../src/engine/disputes'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (seed = 20260913): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'EDG')!.id, '审计', seed)
  setupSeason(g)
  g.day = 40
  return g
}
const clone = (g: GameState): GameState => JSON.parse(JSON.stringify(g))
const pair = (g: GameState) => {
  const me = g.teams[g.myTeam]
  return [me.starters[0], me.starters[1]] as const
}
const open = (g: GameState) => {
  const [a, b] = pair(g)
  return openDispute(g, { a, b, ratings: { a: 1.3, b: 0.7 }, gap: 0.6, bondAfter: -12, fixtureId: 'f1', opponent: 'Paper Rex', score: '0–2' })
}

check('SEASON_DAYS 和 clock 的一年一致', SEASON_DAYS === 364)

// ---- the record and the todo
{
  const g = mk()
  const d = open(g)
  check('争执成为一条记录，带比赛背景和严重度', d.status === 'open' && d.opponent === 'Paper Rex' && d.score === '0–2' && d.severity === 1)
  const again = open(g)
  check('同一对再吵，还是同一条记录，只记次数', again.id === d.id && openDisputes(g).length === 1 && again.flareUps === 1)
  check('总览待办里有它', agendaFor(g).some((i) => i.key === `dispute:${d.id}`))
  check('没选人就不能谈话，也不扣费', disputeBlock(g, d.id, 'talk') !== null)
}

// ---- a talk: seeded, so twice from the same state is the same answer
{
  const g = mk()
  const d = open(g)
  const [a, b] = pair(g)
  const x = clone(g)
  const y = clone(g)
  const r1 = handleDispute(x, d.id, 'talk', a)
  const r2 = handleDispute(y, d.id, 'talk', a)
  check('同一状态同一选择，结果一样（读档不能换结果）', r1.ok === r2.ok && r1.text === r2.text, r1.text)
  const bondBefore = bondBetween(g, a, b)
  const trustBefore = trustOf(g.players[a])
  const bondAfter = bondBetween(x, a, b)
  const trustAfter = trustOf(x.players[a])
  check('谈话真的改了关系和信任', bondAfter !== bondBefore && trustAfter !== trustBefore, `bond ${bondBefore.toFixed(1)} → ${bondAfter.toFixed(1)}, trust ${trustBefore} → ${trustAfter}`)
  check(r1.ok ? '谈成了，记录关闭' : '谈崩了，记录还开着，7 天内不能再谈', r1.ok ? x.disputes![0].status === 'handled' : x.disputes![0].status === 'open' && disputeBlock(x, d.id, 'talk', a) !== null)
  const r3 = handleDispute(x, d.id, 'talk', a)
  check('处理过的再点一次不生效', !r3.ok)
  // the other outcome exists somewhere: try a few seeds
  let seenWin = false, seenLose = false
  for (let s = 1; s <= 30 && !(seenWin && seenLose); s++) {
    const h = mk(20260913 + s)
    const dd = open(h)
    const r = handleDispute(h, dd.id, 'talk', pair(h)[0])
    if (r.ok) seenWin = true; else seenLose = true
  }
  check('谈话既可能成也可能崩', seenWin && seenLose)
}

// ---- mediation and the paid-attempt limits
{
  const g = mk()
  const d = open(g)
  const [a, b] = pair(g)
  const r = handleDispute(g, d.id, 'mediate')
  if (!r.ok) {
    check('调解失败后要等 7 天', /天后再谈/.test(disputeBlock(g, d.id, 'mediate') ?? ''))
    g.day += DISPUTE.TALK_COOLDOWN
    check('7 天后可以再试', disputeBlock(g, d.id, 'mediate') === null)
    handleDispute(g, d.id, 'mediate')
    if (g.disputes![0].status === 'open') check('两次付费尝试之后不能再谈', disputeBlock(g, d.id, 'talk', a) !== null)
    else console.log('     （第二次调解成了）')
  } else {
    check('调解成功：双方关系拉近、记录关闭', g.disputes![0].status === 'handled' && bondBetween(g, a, b) > -12)
  }
}

// ---- 双排 goes into the training plan
{
  const g = mk()
  const d = open(g)
  const [a, b] = pair(g)
  const r = handleDispute(g, d.id, 'duo')
  check('安排双排：写进训练页的双排练', r.ok && g.duo?.a === a && g.duo?.b === b && g.disputes![0].status === 'handled')
}

// ---- the cooling-off bench is a real lineup change
{
  const g = mk()
  const d = open(g)
  const [a] = pair(g)
  const r = handleDispute(g, d.id, 'bench', a)
  check('暂时替补：他离开首发，进冷静期', r.ok && !g.teams[g.myTeam].starters.includes(a) && isCoolingOff(g, g.players[a]))
  check('自动首发不会把他放回去', !autoStarters(g, g.myTeam).includes(a))
  check('比赛日五人里没有他', !selectLineup(g, g.myTeam).some((p) => p.id === a))
  check('再点一次暂时替补：已在冷静期，拒绝', disputeBlock(g, d.id, 'bench', a) !== null)
  const back = importSave(exportSave(g))
  check('存档来回后冷静期还在', isCoolingOff(back, back.players[a]))
  // across the winter: careerDay does not need rebasing
  const w = mk()
  w.day = SEASON_DAYS - 3
  w.boardConfidence = 100; w.onNotice = false; w.missedStreak = 0
  const dw = open(w)
  const benched = pair(w)[0]
  handleDispute(w, dw.id, 'bench', benched)
  const until = w.players[benched].coolOffUntil!
  let guard = 0
  while (w.year === 2026 && guard++ < 12) { advanceDay(w, { autoResolveDrawDecisions: true }); if (w.midReview) continuePastFive(w); if (w.pendingDrawId) finishDraw(w, w.pendingDrawId) }
  check('跨赛年后冷静期按真实天数继续，不被年末重置', w.year === 2027 && w.players[benched].coolOffUntil === until && isCoolingOff(w, w.players[benched]) && careerDayOf(w) < until, `year ${w.year} day ${w.day} until ${until} now ${careerDayOf(w)}`)
  // it ends on its own, with one line
  const notes: string[] = []
  g.day += DISPUTE.BENCH_DAYS
  tickDisputes(g, notes)
  check('到期自动结束，提示一次', !isCoolingOff(g, g.players[a]) && notes.some((n) => n.includes('冷静期结束')))
  tickDisputes(g, notes)
  check('不会重复提示', notes.filter((n) => n.includes('冷静期结束')).length === 1)
  // early recovery
  const h = mk()
  const dh = open(h)
  const hb = pair(h)[0]
  handleDispute(h, dh.id, 'bench', hb)
  check('提前恢复', /提前结束/.test(endCoolOff(h, hb)) && !isCoolingOff(h, h.players[hb]))
  // no legal replacement: a five-man roster
  const t = mk()
  const me = t.teams[t.myTeam]
  for (const id of me.roster.slice(5)) { const p = t.players[id]; p.teamId = null }
  me.roster = me.roster.slice(0, 5)
  const dt = open(t)
  const tb = pair(t)[0]
  check('只有五个人时不能让人替补，说明原因', /替补不够/.test(benchBlock(t, tb) ?? '') && !handleDispute(t, dt.id, 'bench', tb).ok)
}

// ---- ignoring, expiry and departures
{
  const g = mk()
  const d = open(g)
  const [a, b] = pair(g)
  const m0 = g.players[a].morale
  const notes: string[] = []
  g.day += DISPUTE.EXPIRE_DAYS
  tickDisputes(g, notes)
  check('两周没人管：过期，双方士气小降，提示一次', g.disputes![0].status === 'expired' && g.players[a].morale < m0 && notes.length === 1)
  tickDisputes(g, notes)
  check('过期不再重复扣', notes.length === 1)
  const h = mk()
  const dh = open(h)
  handleDispute(h, dh.id, 'ignore')
  check('暂不介入：记录标为忽略，不扣费', h.disputes![0].status === 'ignored')
  const k = mk()
  const dk = open(k)
  // a free agent in, so the release is legal
  releasePlayer(k, k.players[pair(k)[1]])
  tickDisputes(k, [])
  check('当事人离队后记录关闭', k.disputes![0].status === 'closed' && disputeBlock(k, dk.id, 'talk', pair(k)[0]) !== null)
}

// ---- and the real thing: a season's arguments come through the match loop
{
  const g = mk(20260901)
  g.day = 0
  let guard = 0
  while (g.year === 2026 && guard++ < 420) {
    advanceDay(g, { autoResolveDrawDecisions: true })
    if (g.midReview) continuePastFive(g)
    if (g.pendingDrawId) finishDraw(g, g.pendingDrawId)
  }
  const all = g.disputes ?? []
  console.log(`     一整季：${all.length} 条争执记录，${all.filter((d) => d.status === 'expired').length} 条过期`)
  check('整季推进不报错，记录带比赛背景', all.every((d) => d.fixtureId && d.opponent && d.score))
  const dup = all.filter((d) => d.status === 'open').length <= new Set(all.filter((d) => d.status === 'open').map((d) => [d.a, d.b].sort().join('|'))).size
  check('同一对没有两条同时开着', dup)
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
