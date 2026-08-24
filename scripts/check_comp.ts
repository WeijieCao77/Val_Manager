/**
 * What a five actually has to cover.
 *
 * The requirement is four roles — duelist, initiator, controller, sentinel.
 * 自由人 is not a fifth one: in the data it means vlr recorded no role, and
 * the one hand-verified genuine floater carries his real roles alongside it.
 *
 * Three things used to go wrong, and a player found all three from the outside:
 * carrying a floater scored better than any other fifth man, so the game
 * quietly asked for one; a player who covered two roles was charged for each
 * extra, making the most versatile squad in the game the worst-rated; and the
 * auto-lineup filled slots by main role only, benching the one man who could
 * hold a site because sentinel was his second job.
 */
import { createNewGame, WORLD_TEAMS, autoStarters } from '../src/engine/world'
import { setupSeason } from '../src/engine/season'
import { buildLineup, selectLineup } from '../src/engine/match'
import type { Role } from '../src/engine/types'

const g = createNewGame(WORLD_TEAMS.find(t => t.tag === 'TYL')!.id, '审计经理', 1)
setupSeason(g)
const map = Object.keys(g.teams[g.myTeam].mapPrefs)[0]
const squad = g.teams[g.myTeam].roster.map(id => g.players[id])
const D = '决斗者' as Role, I = '先锋' as Role, C = '控场' as Role
const S = '哨卫' as Role, F = '自由人' as Role

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

function comp(roles: Role[][]) {
  const five = squad.slice(0, 5)
  five.forEach((p, i) => {
    p.roles = roles[i]; p.role = roles[i][0]
    p.flex = roles[i].length > 1; p.injuredUntil = 0
  })
  g.teams[g.myTeam].starters = five.map(p => p.id)
  return buildLineup(g, g.myTeam, map).edge.comp
}

const second = comp([[D], [I], [C], [S], [D]])
const floater = comp([[D], [I], [C], [S], [F]])
const versatile = comp([[D], [I], [C], [S], [D, I]])
check('a floater is not required — any fifth man scores the same',
  Math.abs(second - floater) < 1e-9, `第二个决斗者 ${second.toFixed(2)} / 自由人 ${floater.toFixed(2)}`)
check('four covered roles cost nothing at all', second === 0, `${second.toFixed(2)}`)
check('covering two roles is an asset, not a liability',
  versatile > second, `兼位 ${versatile.toFixed(2)} > 单位置 ${second.toFixed(2)}`)
check('a real gap still hurts', comp([[D], [I], [S], [D], [D]]) <= -7,
  `缺控场 ${comp([[D], [I], [S], [D], [D]]).toFixed(2)}`)
check('a floater plugging a gap softens it but does not erase it',
  comp([[D], [I], [S], [F], [D]]) < 0 && comp([[D], [I], [S], [F], [D]]) > -7,
  `缺控场但有自由人 ${comp([[D], [I], [S], [F], [D]]).toFixed(2)}`)

// the auto-lineup must use a second role to close a gap rather than leave it
const g2 = createNewGame(WORLD_TEAMS.find(t => t.tag === 'WBG')!.id, '审计经理', 1)
setupSeason(g2)
const CORE: Role[] = [D, I, C, S]
const uncovered: string[] = []
for (const t of Object.values(g2.teams)) {
  t.starters = autoStarters(g2, t.id)
  const have = new Set(selectLineup(g2, t.id).flatMap(p => p.roles ?? [p.role]))
  const gaps = CORE.filter(r => !have.has(r))
  // a gap is only fair if nobody on the roster covers that role at all
  const fixable = gaps.filter(r =>
    t.roster.map(id => g2.players[id]).some(p => (p.roles ?? [p.role]).includes(r)))
  if (fixable.length) uncovered.push(`${t.tag}(${fixable.join('/')})`)
}
check('the auto-lineup never benches the only man who covers a role',
  uncovered.length === 0, uncovered.slice(0, 6).join(' '))
process.exit(bad ? 1 : 0)
