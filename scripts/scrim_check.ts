/** Verify scrims fill gaps without polluting standings or season stats. */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason, makeScrim, scrimReply, commitFixture, fixtureRng, nextFixtureFor } from '../src/engine/season'
import { activePool } from '../src/engine/match'
import { simulateMatch } from '../src/engine/match'
import { sortStandings } from '../src/engine/league'

const me = WORLD_TEAMS.find((t) => t.tag === 'PRX')!
const g = createNewGame(me.id, 'T', 99)
setupSeason(g)

// walk to a real gap
let gap = 0
for (let i = 0; i < 200; i++) {
  advanceDay(g)
  const nx = nextFixtureFor(g, g.myTeam)
  gap = nx ? nx.day - g.day : 0
  if (gap >= 5) break
}
console.log(`day ${g.day}, gap to next fixture: ${gap} days`)

const opp = Object.values(g.teams).find((t) => t.id !== g.myTeam && t.region === me.region)!
const before = {
  maps: Object.values(g.players).filter(p => p.teamId === g.myTeam).reduce((s, p) => s + p.season.maps, 0),
  form: Math.round(g.teams[g.myTeam].starters.reduce((s, id) => s + g.players[id].form, 0) / 5),
  fatigue: Math.round(g.teams[g.myTeam].starters.reduce((s, id) => s + g.players[id].fatigue, 0) / 5),
}

const reply = scrimReply(g, opp.id)
console.log('约战答复:', reply.ok ? '接受' : '拒绝 — ' + reply.reason)
const map = activePool(g.seed + g.year)[0]
const f = makeScrim(g, opp.id, g.day + 1, map, 'full24')
const res = simulateMatch(g, f.teamA, f.teamB, f.bo, fixtureRng(g, f), f.scrim)
commitFixture(g, f, res)

const after = {
  maps: Object.values(g.players).filter(p => p.teamId === g.myTeam).reduce((s, p) => s + p.season.maps, 0),
  form: Math.round(g.teams[g.myTeam].starters.reduce((s, id) => s + g.players[id].form, 0) / 5),
  fatigue: Math.round(g.teams[g.myTeam].starters.reduce((s, id) => s + g.players[id].fatigue, 0) / 5),
}

const comp = Object.values(g.comps).find(c => c.teams.includes(g.myTeam) && c.stage.startsWith('stage'))
const row = comp?.standings[g.myTeam]

const m0 = res.maps[0]
console.log(`训练赛 vs ${opp.name} @ ${m0.map}: ${m0.scoreA}-${m0.scoreB}  共 ${m0.scoreA + m0.scoreB} 回合  BP记录 ${res.vetoLog.length} 条`)
console.log(`  season maps   ${before.maps} -> ${after.maps}  ${before.maps === after.maps ? '✅ not counted' : '❌ leaked into stats'}`)
console.log(`  avg form      ${before.form} -> ${after.form}   ${after.form !== before.form ? '✅ moved' : '⚠ unchanged'}`)
console.log(`  avg fatigue   ${before.fatigue} -> ${after.fatigue}  ${after.fatigue > before.fatigue ? '✅ cost paid' : '⚠ unchanged'}`)
console.log(`  standings W/L ${row?.w}-${row?.l} ${(row?.w ?? 0) + (row?.l ?? 0) === 0 ? '✅ untouched' : '(has league games, check manually)'}`)
void sortStandings
