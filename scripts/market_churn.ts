/** A transfer list must reach an equilibrium, not grow without bound. */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { createManager } from '../src/engine/manager'
import { advanceDay, setupSeason } from '../src/engine/season'
import { windowOpen } from '../src/engine/transfer'

const g = createNewGame(WORLD_TEAMS[0].id, 'x', 4, createManager('t', 24, 'grassroots'))
setupSeason(g)
const listed = () => Object.values(g.players).filter((p) => p.listed && p.teamId && p.teamId !== g.myTeam)

let peak = 0
const spells: number[] = []
const since = new Map<string, number>()
for (let d = 0; d < 336; d++) {
  advanceDay(g, {})
  const now = new Set(listed().map((p) => p.id))
  for (const id of now) if (!since.has(id)) since.set(id, d)
  for (const [id, start] of since) if (!now.has(id)) { spells.push(d - start); since.delete(id) }
  peak = Math.max(peak, now.size)
  if (g.day % 14 === 0) {
    console.log(`第 ${String(g.day).padStart(3)} 天  窗口${windowOpen(g.day) ? '开' : '关'}  挂牌 ${now.size} 人`)
  }
}
const avg = spells.length ? spells.reduce((a, b) => a + b, 0) / spells.length : 0
const sorted = [...spells].sort((a, b) => a - b)
console.log(`\n峰值 ${peak} 人，全年共 ${spells.length} 次下架`)
console.log(`在架天数：平均 ${avg.toFixed(0)}，中位 ${sorted[Math.floor(sorted.length / 2)] ?? 0}，最长 ${sorted.at(-1) ?? 0}`)
console.log(`仍在架 ${since.size} 人`)
