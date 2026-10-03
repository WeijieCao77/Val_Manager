/**
 * 历史档的真实新人: a 2023–2025 career meets the players who really arrived in
 * the later years, at their real clubs, at the start of that season.
 *
 *   npx tsx scripts/check_arrivals.ts
 */
import { readFileSync } from 'node:fs'
import arrivals from '../src/data/arrivals.json'
import { createNewGame } from '../src/engine/world'
import { advanceDay, continuePastFive, setupSeason } from '../src/engine/season'
import { applyArrivals, registerArrivals, RESERVE_DAYS, type ArrivalsFile } from '../src/engine/arrivals'
import { squadOf } from '../src/engine/roster'
import { careerDayOf } from '../src/engine/clock'
import { packState, unpackState } from '../src/engine/save'
import { createManager } from '../src/engine/manager'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const data = arrivals as unknown as ArrivalsFile
registerArrivals(data)
const world = (y: number) => JSON.parse(readFileSync(`src/data/world_${y}.json`, 'utf8'))
const pin = (g: GameState) => { g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0; if (g.midReview) continuePastFive(g) }
const career = (year: number, tag: string, seed = 3) => {
  const w = world(year)
  const club = w.teams.find((t: { tag: string }) => t.tag === tag)
  const g = createNewGame(club.id, '审计', seed, createManager('审计', 30, 'expro'), { world: w, year })
  setupSeason(g)
  return g
}
const runTo = (g: GameState, year: number, day = 1) => {
  let guard = 0
  while ((g.year < year || g.day < day) && guard++ < 2000) { pin(g); advanceDay(g, { autoResolveDrawDecisions: true }) }
}

// ---- the data
for (const [y, rows] of Object.entries(data.years)) {
  const prev = Number(y) === 2026 ? null : world(Number(y) - 1)
  const before = new Set((Number(y) - 1 === 2025 ? world(2025) : prev ?? world(2025)).players.map((p: { id: string }) => p.id))
  check(`${y} 年的新人都不在前一年的世界里`, rows.every((r) => !before.has(r.id)), `${rows.length} 人`)
}

// ---- a 2024 career at NRG: 2025's real NRG newcomers are the manager's call
{
  const g = career(2024, 'NRG')
  const nrg = g.myTeam
  const mineRows = data.years['2025'].filter((r) => r.teamId === nrg && r.clubTag === 'NRG' && !g.players[r.id])
  runTo(g, 2024, 30)
  check('2024 年内不会提前来', !mineRows.some((r) => g.players[r.id]))
  runTo(g, 2025, 1)
  check('2025 赛季第一天到', (g.arrivalsDone ?? []).includes(2025))
  const waiting = mineRows.map((r) => g.players[r.id])
  check(`NRG 的真实新人（${mineRows.map((r) => r.ign).join('、')}）是自由人，只等你`, waiting.length > 0
    && waiting.every((p) => p && p.teamId === null && p.reservedFor?.team === nrg && p.reservedFor.until === careerDayOf({ year: 2025, day: 1 }) + RESERVE_DAYS),
    waiting.map((p) => `${p?.ign}:${p?.teamId}:${p?.reservedFor?.until}`).join(' '))
  check('新闻里告诉经理', g.news.some((n) => n.important && n.text.includes('现实中') && n.text.includes('只等你的报价')))
  // AI clubs got theirs
  const aiRows = data.years['2025'].filter((r) => r.teamId !== nrg && g.teams[r.teamId!]?.tag === r.clubTag)
  const joined = aiRows.filter((r) => g.players[r.id]?.teamId === r.teamId)
  check('AI 俱乐部按现实签下各自的新人', joined.length >= aiRows.length * 0.9, `${joined.length}/${aiRows.length}`)
  check('名单不超过 7 人，AI 俱乐部都凑得齐五人', Object.values(g.teams).every((t) => t.roster.length <= 7)
    && Object.values(g.teams).filter((t) => t.id !== nrg).every((t) => squadOf(g, t.id).length >= 5))
  const ids = Object.values(g.teams).flatMap((t) => t.roster)
  check('没有一个人在两支队', new Set(ids).size === ids.length)
  const before = Object.keys(g.players).length
  applyArrivals(g, [])
  check('同一年只来一次', Object.keys(g.players).length === before)
  const back = unpackState(packState(g))
  check('存档往返：预留和进度都在', JSON.stringify(back.arrivalsDone) === JSON.stringify(g.arrivalsDone)
    && waiting.every((p) => back.players[p!.id].reservedFor?.team === nrg))
  // the reservation holds, then lapses
  runTo(g, 2025, RESERVE_DAYS - 2)
  check('预留期内 AI 不签', waiting.every((p) => p!.teamId === null), waiting.map((p) => `${p!.ign}:${p!.teamId}`).join(' '))
  runTo(g, 2026, 2)
  check('2026 年的新人也来了', (g.arrivalsDone ?? []).includes(2026))
  const s1 = data.years['2026'].filter((r) => g.teams[r.teamId!]?.tag === r.clubTag && r.teamId !== nrg)
  check('2026 年 AI 俱乐部的新人到队', s1.filter((r) => g.players[r.id]?.teamId === r.teamId).length >= s1.length * 0.85,
    `${s1.filter((r) => g.players[r.id]?.teamId === r.teamId).length}/${s1.length}`)
}

// ---- a 2023 career meets 2024's newcomers; a 2026 career meets nobody
{
  const g = career(2023, 'FNC', 7)
  runTo(g, 2024, 1)
  const rows = data.years['2024'].filter((r) => g.teams[r.teamId!]?.tag === r.clubTag && r.teamId !== g.myTeam)
  const g2 = rows.filter((r) => r.clubTag === 'G2').map((r) => `${r.ign}:${g.players[r.id]?.teamId === r.teamId ? '到队' : '没到'}`)
  check('2023 档进入 2024：G2 的新人按现实到队', rows.filter((r) => g.players[r.id]?.teamId === r.teamId).length >= rows.length * 0.9, g2.join(' '))
  const now = createNewGame('T1', '审计', 3)
  setupSeason(now)
  applyArrivals(now, [])
  check('2026 档不受影响', now.arrivalsDone === undefined)
}

console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
