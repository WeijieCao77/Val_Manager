/** Verify stage objectives are set, judged, and move board confidence. */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { createManager } from '../src/engine/manager'
import { advanceDay, setupSeason, stageName, SEASON_DAYS } from '../src/engine/season'
import { agendaFor, screenLocked } from '../src/engine/agenda'

const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
const m = createManager('测试', 40, 'expro')
const g = createNewGame(me.id, m.name, 7, m)
setupSeason(g)

let objectives = 0, judged = 0
let prevStage = g.stage
for (let i = 0; i < SEASON_DAYS; i++) {
  const r = advanceDay(g)
  if (r.stageChanged) {
    const lock = screenLocked('transfers', g)
    console.log(`day ${String(g.day).padStart(3)} → ${stageName(g.stage).padEnd(12)} ` +
      `信任 ${String(Math.round(g.boardConfidence)).padStart(3)}  转会${lock ? '🔒' : '开放'}`)
    prevStage = g.stage
  }
  for (const n of r.notes) {
    if (n.startsWith('董事会')) { objectives++; console.log('   目标:', n) }
    if (n.startsWith('✅') || n.startsWith('❌')) { judged++; console.log('   结算:', n) }
  }
}
void prevStage
console.log(`\n设定目标 ${objectives} 次，结算 ${judged} 次；最终信任度 ${Math.round(g.boardConfidence)}`)
console.log('当前待办:', agendaFor(g).map((a) => a.text.slice(0, 28)))
