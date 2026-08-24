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

// ---- three IGLs by trade in one squad: the best calls, deterministically.
// buildLineup reports the caller bonus in its edge breakdown, so read it there.
const { buildLineup } = await import('../src/engine/match')
const g7 = createNewGame(WORLD_TEAMS.find(t => t.tag === 'TYL')!.id, '审计经理', 20260824)
setupSeason(g7)
const sq = squadOf(g7, g7.myTeam)
const starters = g7.teams[g7.myTeam].starters.map(id => g7.players[id])
for (const p of sq) p.isIgl = false
starters[0].isIgl = true; starters[0].attrs.igl = 55
starters[1].isIgl = true; starters[1].attrs.igl = 88
starters[2].isIgl = true; starters[2].attrs.igl = 70
const map = Object.keys(g7.teams[g7.myTeam].mapPrefs)[0]
const withBest = buildLineup(g7, g7.myTeam, map).edge.igl
starters[1].attrs.igl = 40   // the loudest voice goes quiet
const withNext = buildLineup(g7, g7.myTeam, map).edge.igl
check('with three IGLs the best one calls',
  Math.abs(withBest - (88 - 60) * 0.09) < 1e-9 && Math.abs(withNext - (70 - 60) * 0.09) < 1e-9,
  `88 时加成 ${withBest.toFixed(2)}，他跌到 40 后由 70 接手：${withNext.toFixed(2)}`)

// ---- an AI club that sells its caller appoints a new one
const g8 = createNewGame(WORLD_TEAMS.find(t => t.tag === 'WBG')!.id, '审计经理', 20260824)
setupSeason(g8)
const seller = Object.values(g8.teams).find(t => t.id !== g8.myTeam &&
  squadOf(g8, t.id).some(p => p.isIgl) && squadOf(g8, t.id).length >= 6)!
const soldIgl = squadOf(g8, seller.id).find(p => p.isIgl)!
const { doTransfer } = await import('../src/engine/transfer')
const buyer = Object.values(g8.teams).find(t => t.id !== g8.myTeam && t.id !== seller.id)!
doTransfer(g8, soldIgl, buyer.id, 100000, { salary: soldIgl.salary, years: 2 } as never)
const successor = squadOf(g8, seller.id).find(p => p.isIgl)
check('the selling club promotes a new caller', !!successor,
  successor ? `${seller.tag} 由 ${successor.ign} 接任（指挥 ${successor.attrs.igl}）` : `${seller.tag} 没人喊话了`)
check('and it picked its best voice',
  !!successor && successor.attrs.igl === Math.max(...squadOf(g8, seller.id).map(p => p.attrs.igl)))


// ---- appointing while three are flagged: the appointment is absolute
const g9 = createNewGame(WORLD_TEAMS.find(t => t.tag === 'TYL')!.id, '审计经理', 20260824)
setupSeason(g9)
const sq9 = squadOf(g9, g9.myTeam)
for (const p of sq9) p.isIgl = false
sq9[0].isIgl = true; sq9[0].attrs.igl = 88
sq9[1].isIgl = true; sq9[1].attrs.igl = 70
appointIgl(g9, sq9[2].id)
check('appointment strips every other flag',
  sq9[2].isIgl && !sq9[0].isIgl && !sq9[1].isIgl,
  squadOf(g9, g9.myTeam).filter(p => p.isIgl).map(p => p.ign).join('/'))

process.exit(bad ? 1 : 0)
