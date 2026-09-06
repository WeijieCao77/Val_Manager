/**
 * How much do 状态 (form) and 士气 (morale) actually decide a match? (2026-09-06)
 *
 *   npx tsx scripts/check_form_morale.ts [series] [seasons]
 *
 * Reported from the group: 「目前选手的士气/状态和比赛表现相关性不大」. Two
 * questions, measured apart. First, holding everything else equal, what does
 * a hot or cold five win against a neutral one — that is the engine's dial.
 * Second, after a real season, how far apart do clubs actually sit in form
 * and morale — that is how often the dial is ever turned. A big dial that is
 * never turned and a small dial both read as "does not matter".
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { simulateMatch } from '../src/engine/match'
import { advanceDay, setupSeason, SEASON_DAYS } from '../src/engine/season'
import { squadOf } from '../src/engine/roster'
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'

const N = Number(process.argv[2] ?? 300)
const SEASONS = Number(process.argv[3] ?? 1)

// ---- part one: the dial
const state = createNewGame(WORLD_TEAMS[0].id, '测试', 777)
const tier1 = Object.values(state.teams).filter((t) => t.tier === 1).sort((a, b) => b.rating - a.rating)
let A = tier1[0], B = tier1[1]
for (let i = 1; i < tier1.length; i++) {
  if (Math.abs(tier1[i].rating - tier1[i - 1].rating) < Math.abs(A.rating - B.rating)) { A = tier1[i - 1]; B = tier1[i] }
}
const avgOvr = (id: string) => squadOf(state, id).reduce((s, p) => s + p.overall, 0) / squadOf(state, id).length
console.log(`${A.name} (rating ${A.rating}, avg ovr ${avgOvr(A.id).toFixed(1)}) vs ${B.name} (rating ${B.rating}, avg ovr ${avgOvr(B.id).toFixed(1)}), ${N} bo3 each`)

function setAll(teamId: string, form: number, morale: number): void {
  for (const p of squadOf(state, teamId)) { p.form = form; p.morale = morale; p.fatigue = 0; p.injuredUntil = 0 }
}
function winRate(): number {
  let w = 0
  for (let i = 0; i < N; i++) {
    const r = simulateMatch(state, A.id, B.id, 3, new Rng(1000 + i * 7919))
    if (r.mapsWonA > r.mapsWonB) w++
  }
  return w / N
}
const cases: [string, number, number, number, number][] = [
  ['两边都中性 70/70', 70, 70, 70, 70],
  ['A 状态 80，其余 70', 80, 70, 70, 70],
  ['A 状态 90，其余 70', 90, 70, 70, 70],
  ['A 状态 55，其余 70', 55, 70, 70, 70],
  ['A 士气 90，其余 70', 70, 90, 70, 70],
  ['A 士气 40，其余 70', 70, 40, 70, 70],
  ['A 火热 88/92 对 B 低迷 55/45', 88, 92, 55, 45],
  ['A 疲劳 0 对 B 疲劳 60（状态士气 70）', 70, 70, 70, 70],
]
console.log('\n场景                                   A 胜率')
for (const [label, fa, ma, fb, mb] of cases) {
  setAll(A.id, fa, ma); setAll(B.id, fb, mb)
  if (label.startsWith('A 疲劳')) for (const p of squadOf(state, B.id)) p.fatigue = 60
  console.log(`${label.padEnd(36)} ${(winRate() * 100).toFixed(1).padStart(6)}%`)
}

// ---- part two: how far apart clubs actually get
const s2: GameState = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'EDG')!.id, '测试', 4242)
setupSeason(s2)
const samples: { day: number; form: number[]; morale: number[]; teamForm: number[]; teamMorale: number[] }[] = []
const sample = () => {
  const form: number[] = [], morale: number[] = [], teamForm: number[] = [], teamMorale: number[] = []
  for (const t of Object.values(s2.teams)) {
    const sq = squadOf(s2, t.id)
    if (!sq.length) continue
    let tf = 0, tm = 0
    for (const p of sq) { form.push(p.form); morale.push(p.morale); tf += p.form; tm += p.morale }
    teamForm.push(tf / sq.length); teamMorale.push(tm / sq.length)
  }
  samples.push({ day: s2.day, form, morale, teamForm, teamMorale })
}
const stats = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length)
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return `均值 ${mean.toFixed(1)} 标准差 ${sd.toFixed(1)} · p10 ${q(0.1).toFixed(0)} p50 ${q(0.5).toFixed(0)} p90 ${q(0.9).toFixed(0)} · 最低 ${s[0].toFixed(0)} 最高 ${s[s.length - 1].toFixed(0)}`
}
sample()
for (let season = 0; season < SEASONS; season++) {
  const year = s2.year
  while (s2.year === year) {
    advanceDay(s2)
    if (s2.day % 45 === 0) sample()
    if (s2.day > SEASON_DAYS + 5) throw new Error('season did not roll over')
  }
}
console.log(`\n一个赛季里所有选手的分布（${SEASONS} 季，每 45 天取样一次）`)
for (const smp of samples) {
  console.log(`第 ${String(smp.day).padStart(3)} 天 状态 ${stats(smp.form)}`)
  console.log(`         士气 ${stats(smp.morale)}`)
  console.log(`         按队平均：状态 ${stats(smp.teamForm)}`)
  console.log(`         按队平均：士气 ${stats(smp.teamMorale)}`)
}
