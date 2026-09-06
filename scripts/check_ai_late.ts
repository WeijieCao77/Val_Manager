/**
 * Does the world hold up over a long career? (2026-09-06)
 *
 *   npx tsx scripts/check_ai_late.ts [seasons] [seed]
 *
 * The group: 「到后期别的队伍就跟人机一样，随便打」. Several seasons headless,
 * the managed club left to the engine like everyone else, the sack and the
 * 五年之约 bypassed; at each season's end, the AI VCT clubs' starting fives —
 * overall, age, morale, form — so a later season can be read against the
 * first. Run it once from a worktree of the previous commit for the before.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, continuePastFive, setupSeason, SEASON_DAYS } from '../src/engine/season'
import type { GameState } from '../src/engine/types'

const SEASONS = Number(process.argv[2] ?? 6)
const SEED = Number(process.argv[3] ?? 20260906)
const g: GameState = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'EDG')!.id, '审计', SEED)
setupSeason(g)

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
const q = (xs: number[], p: number) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) }

function snapshot(label: string): void {
  const clubs = Object.values(g.teams).filter((t) => t.tier === 1 && t.id !== g.myTeam)
  const ovr: number[] = [], age: number[] = [], morale: number[] = [], form: number[] = []
  for (const t of clubs) {
    const five = squadOf(g, t.id).filter((p) => t.starters.includes(p.id))
    if (!five.length) continue
    ovr.push(mean(five.map((p) => p.overall)))
    age.push(mean(five.map((p) => p.age)))
    morale.push(mean(five.map((p) => p.morale)))
    form.push(mean(five.map((p) => p.form)))
  }
  const top12 = ovr.slice().sort((a, b) => b - a).slice(0, 12)
  console.log(
    `${label}  AI一级 ${clubs.length} 队 · 首发均分 ${mean(ovr).toFixed(1)}（前12 ${mean(top12).toFixed(1)}，最低 ${Math.min(...ovr).toFixed(1)}）` +
    ` · 年龄 ${mean(age).toFixed(1)} · 士气 均 ${mean(morale).toFixed(0)} p10 ${q(morale, 0.1).toFixed(0)} 标准差 ${sd(morale).toFixed(0)} 低于55的队 ${morale.filter((m) => m < 55).length}` +
    ` · 状态 均 ${mean(form).toFixed(0)} 标准差 ${sd(form).toFixed(1)}`,
  )
}

snapshot(`${g.year} 开局 `)
for (let s = 0; s < SEASONS; s++) {
  const year = g.year
  let last = ''
  while (g.year === year) {
    g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
    if (g.midReview) continuePastFive(g)
    advanceDay(g)
    if (g.day % 7 === 0) last = `${year} 第${g.day}天`
    if (g.day > SEASON_DAYS + 5) throw new Error('season did not roll over')
    if (g.day === SEASON_DAYS - 3) snapshot(`${year} 季末 `)
  }
  void last
}
