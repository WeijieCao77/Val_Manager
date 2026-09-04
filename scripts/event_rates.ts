/**
 * How often anything actually happens to a squad.
 *
 *   npx tsx scripts/event_rates.ts
 *
 * A manager game lives on its between-match texture, and that texture is easy
 * to get wrong in a direction nobody notices: a probability that reads fine in
 * the source can fire twice a decade because the state it keys off never
 * reaches its threshold. Measured before any of this was tuned, a squad saw 0.9
 * injuries a season, no retirements and no dressing-room incidents — the
 * systems existed and never ran.
 *
 * Six independent careers, five seasons each, counted. Re-run after touching
 * any of it, so a rate can be argued about with a number rather than a feeling.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason, SEASON_DAYS } from '../src/engine/season'

const SEASONS = 5
const RUNS = 6
const tally: Record<string, number[]> = {}
const bump = (k: string, run: number, n = 1) => {
  tally[k] ??= Array(RUNS).fill(0)
  tally[k][run] += n
}

for (let run = 0; run < RUNS; run++) {
  const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
  const g = createNewGame(me.id, '测试', 1000 + run * 7)
  setupSeason(g)
  let days = 0
  for (let s = 0; s < SEASONS; s++) {
    const y = g.year
    while (g.year === y) {
      const before = new Set(squadOf(g, g.myTeam).filter((p) => p.injuredUntil > g.day).map((p) => p.id))
      const r = advanceDay(g, { autoScrims: true })
      days++
      for (const p of squadOf(g, g.myTeam)) {
        if (p.injuredUntil > g.day && !before.has(p.id)) bump('伤病（我的队，人次）', run)
      }
      for (const n of r.notes) {
        if (/宣布退役/.test(n)) bump('退役（我的队）', run)
        if (/^📈/.test(n)) bump('休赛期明显进步', run)
        if (/^📉/.test(n)) bump('休赛期明显下滑', run)
        if (/^💢|^🚨|^💔/.test(n)) bump('更衣室事件', run)
        if (/挂牌/.test(n)) bump('市场挂牌播报', run)
        if (/报价/.test(n)) bump('转会报价相关', run)
        if (/赞助|商务|活动|直播/.test(n)) bump('商务事件', run)
        if (/^🎂/.test(n)) bump('生日', run)
        if (/^🎖/.test(n)) bump('生涯里程碑', run)
        if (/^💰/.test(n)) bump('要求加薪', run)
        if (/^📰/.test(n)) bump('转会传闻', run)
        if (/^🔥/.test(n)) bump('状态爆发', run)
        if (/^🥶/.test(n)) bump('状态低迷', run)
        if (/董事会|目标/.test(n)) bump('董事会事件', run)
      }
      bump('总提示条数', run, r.notes.length)
      if (g.gameOver) break
    }
    if (g.gameOver) { bump('__sacked', run); break }
  }
  bump('天数', run, days)
}

const per = (k: string) => {
  const v = tally[k] ?? []
  const total = v.reduce((a, b) => a + b, 0)
  const days = (tally['天数'] ?? []).reduce((a, b) => a + b, 0)
  return { total, perSeason: total / (days / SEASON_DAYS), lo: Math.min(...v), hi: Math.max(...v) }
}
const sacked = (tally['__sacked'] ?? []).filter((n) => n > 0).length
console.log(`${RUNS} runs x ${SEASONS} seasons`)
// a sacked career stops early, which is why the per-save totals spread so far
console.log(`${sacked}/${RUNS} 个存档中途下课（所以下面的合计区间差距大）\n`)
console.log(`${'事件'.padEnd(22)}  每赛季   ${RUNS}次存档区间(5赛季合计)`)
for (const k of Object.keys(tally)) {
  if (k === '天数' || k === '__sacked') continue
  const s = per(k)
  console.log(`  ${k.padEnd(20)} ${s.perSeason.toFixed(1).padStart(6)}   ${s.lo}–${s.hi}`)
}
