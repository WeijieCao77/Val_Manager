/**
 * Challengers China went from six clubs to seven when Weibo Gaming was added.
 * An odd league has to schedule through a bye, so this checks that every club
 * still plays the same number of games and nobody sits out a whole stage.
 */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { setupSeason } from '../src/engine/season'

const wbg = WORLD_TEAMS.find(t => t.tag === 'WBG')!
const g = createNewGame(wbg.id, '审计经理', 20260823)
setupSeason(g)

const counts: Record<string, Record<string, number>> = {}
for (const f of g.fixtures) {
  counts[f.comp] ??= {}
  for (const t of [f.teamA, f.teamB]) counts[f.comp][t] = (counts[f.comp][t] ?? 0) + 1
}
let bad = 0
for (const [comp, per] of Object.entries(counts)) {
  const v = [...new Set(Object.values(per))].sort((a, b) => a - b)
  const ok = v.length === 1
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${comp.padEnd(18)} ${String(Object.keys(per).length).padStart(2)} 队, 每队 ${v.join('/')} 场`)
}
// a fair schedule is no good if it spills past the stage it belongs to
const byStage: Record<string, { comp: string; day: number; label: string }[]> = {}
for (const f of g.fixtures) (byStage[f.stage] ??= []).push({ comp: f.comp, day: f.day, label: f.label })
for (const [stage, fx] of Object.entries(byStage)) {
  const reg = fx.filter(f => !/季后|决赛|附加|晋级/.test(f.label))
  const po = fx.filter(f => /季后|决赛|附加|晋级/.test(f.label))
  if (!reg.length || !po.length) continue
  const lastReg = Math.max(...reg.map(f => f.day))
  const firstPo = Math.min(...po.map(f => f.day))
  if (firstPo < lastReg) {
    console.log(`FAIL ${stage}: 常规赛排到第 ${lastReg} 天，季后赛第 ${firstPo} 天就开打`)
    bad++
  }
}
const mine = g.fixtures.filter(f => f.teamA === wbg.id || f.teamB === wbg.id)
console.log(`\n执教 ${wbg.name} (${wbg.tag}) · ${wbg.league} · 阵容 ${wbg.roster.length} 人 · 本赛段 ${mine.length} 场`)
// Play a season out and check the seven-club leagues finish level. Mid-season
// they will not be — a bye means one club is idle each round — so the only
// meaningful moment to compare is after the last round has been played.
import { advanceDay } from '../src/engine/season'
import { Rng } from '../src/engine/rng'
const top = WORLD_TEAMS.find(t => t.tag === 'TYL')!   // a club that will not be sacked
const s2 = createNewGame(top.id, '审计经理', 20260823)
setupSeason(s2)
const rng = new Rng(7)
const lastDay = Math.max(...s2.fixtures.map(f => f.day))
let guard = 0
while (s2.day <= lastDay && !s2.gameOver && guard++ < 500) advanceDay(s2, rng)
console.log(`
跑到第 ${s2.day} 天（最后一轮在第 ${lastDay} 天）${s2.gameOver ? ' — 已下课' : ''}`)
for (const c of Object.values(s2.comps) as any[]) {
  if (!String(c.key).startsWith('challengers')) continue
  const rows = Object.values(c.standings) as any[]
  const games = [...new Set(rows.map(r => r.w + r.l))].sort((a, b) => a - b)
  const ok2 = games.length === 1
  if (!ok2) bad++
  console.log(`${ok2 ? 'ok  ' : 'FAIL'} ${String(c.key).padEnd(20)} ${rows.length} 队, 赛季结束各队已赛 ${games.join('/')}`)
}
process.exit(bad ? 1 : 0)
