/**
 * The screen has said "让别人接过指挥" since it learned to warn about a
 * missing caller — with no way to do it. appointIgl is that way. Checks:
 * the flag moves and stays unique, a healthy incumbent minds, an injured one
 * does not, other clubs' callers are out of reach — and the case the warning
 * never caught: an IGL named in the five but injured plays as no IGL at all
 * on match day, so the screen's warning condition must treat him as absent.
 */
import { createNewGame, WORLD_TEAMS, appointIgl, squadOf } from '../src/engine/world'
import { setupSeason } from '../src/engine/season'
import { selectLineup } from '../src/engine/match'

const me = WORLD_TEAMS.find(t => t.tag === 'TYL')!
const g = createNewGame(me.id, '审计经理', 20260824)
setupSeason(g)
let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const squad = squadOf(g, g.myTeam)
const prev = squad.find(p => p.isIgl)!
const next = squad.find(p => !p.isIgl && g.teams[g.myTeam].starters.includes(p.id))!
const m0 = prev.morale

console.log(appointIgl(g, next.id))
check('the flag moved', next.isIgl && !prev.isIgl)
check('exactly one IGL in the squad', squad.filter(p => p.isIgl).length === 1)
check('a healthy starting incumbent minds', prev.morale < m0 && (prev.grievance ?? 0) > 0,
  `morale ${m0}->${prev.morale}, grievance ${prev.grievance}`)
check('re-appointing him answers in a sentence', appointIgl(g, next.id).includes('已经是指挥'))

// injured incumbent: relieved, not aggrieved
next.injuredUntil = g.day + 14
const m1 = next.morale
const back = appointIgl(g, prev.id)
console.log(back)
check('an injured incumbent is not punished', next.morale === m1, `morale ${m1}->${next.morale}`)
check('the reply says the handover was sensible', back.includes('养伤'))

// the warning's blind spot: injured IGL still in the five plays as no IGL
prev.injuredUntil = g.day + 14
const five = selectLineup(g, g.myTeam)
check('match day fields no caller when the IGL is hurt', !five.some(p => p.isIgl),
  five.map(p => p.ign).join('/'))
const uiWarn = !g.teams[g.myTeam].starters.some(id => {
  const x = g.players[id]
  return x?.isIgl && x.injuredUntil <= g.day
})
check('the squad screen now warns for that case', uiWarn)

// boundaries
const rival = Object.values(g.players).find(p => p.teamId && p.teamId !== g.myTeam)!
check('cannot appoint another club\'s player', appointIgl(g, rival.id).includes('自己队里'))
check('nonsense id answers politely', appointIgl(g, 'nope').includes('找不到'))
process.exit(bad ? 1 : 0)
