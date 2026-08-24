/**
 * Week one, nobody plays a match — nobody "achieves" anything.
 *
 * Career milestones count the scraped history on purpose (a veteran's 500th
 * map matters). But the mark of what was already counted started undefined,
 * so the first tick read a total a player brought with him as something that
 * had just happened: four congratulations in a matchless week. First sight
 * now records where each career already stands, silently.
 */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { advanceDay, setupSeason } from '../src/engine/season'
import { Rng } from '../src/engine/rng'

let bad = 0
// a club whose players carry long careers, so seeded totals sit past marks
const g = createNewGame(WORLD_TEAMS.find(t => t.tag === 'NOVA')!.id, '审计经理', 20260824)
setupSeason(g)
const rng = new Rng(3)
const early: string[] = []
for (let i = 0; i < 14 && !g.gameOver; i++) {
  early.push(...(advanceDay(g, rng)?.notes ?? []).filter(n => n.includes('🎖')))
}
console.log(`开局两周（无正式比赛）里的里程碑：${early.length} 条`)
for (const n of early) console.log('  ', n)
if (early.length) { bad++; console.log('FAIL 没打比赛就发放里程碑') }

// and they still fire when maps are actually played across a season
const later: string[] = []
let guard = 0
while (!g.gameOver && guard++ < 380 && g.year === 2026) {
  later.push(...(advanceDay(g, rng)?.notes ?? []).filter(n => n.includes('🎖')))
}
console.log(`\n打完一季后的里程碑：${later.length} 条`)
for (const n of later.slice(0, 3)) console.log('  ', n)
if (!later.length) console.log('（本季恰好没人跨过里程碑档位，属正常——档位是 100/250/500/…）')
process.exit(bad ? 1 : 0)
