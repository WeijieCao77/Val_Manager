/**
 * A confirmed drill trains for seven days, and the lock means it.
 *
 * The lock used to last one turn — a single day in season — while settlement
 * ran on the calendar week. The panel reopened every morning, six days of
 * confirmed picks were placebo, and only whatever was confirmed last before
 * the boundary counted. A player laid the whole sequence out in screenshots.
 */
import { createNewGame, WORLD_TEAMS, squadOf } from '../src/engine/world'
import { advanceDay, setupSeason } from '../src/engine/season'
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', 20260826)
  setupSeason(g)
  return g
}
const teamworkSum = (g: GameState) =>
  squadOf(g, g.myTeam).reduce((s, p) => s + p.attrs.teamwork + p.attrs.awareness, 0)

// ---- the lock holds for seven days, not one
{
  const g = mk()
  const rng = new Rng(2)
  g.drill = { kind: 'map', map: 'Sunset' }
  g.drillLock = g.day + 7            // what 确定 writes
  advanceDay(g, rng)
  check('one day in, the plan is still locked',
    g.drillLock != null && g.drillLock > g.day, `锁到第 ${g.drillLock} 天，现在第 ${g.day} 天`)
  for (let i = 0; i < 4; i++) advanceDay(g, rng)
  check('five days in, still locked', g.drillLock != null && g.drillLock > g.day)
}

// ---- on day seven it settles, once, and unlocks
{
  const g = mk()
  const rng = new Rng(3)
  g.drill = { kind: 'map', map: 'Sunset' }
  g.drillLock = g.day + 7
  const map0 = g.teams[g.myTeam].mapPrefs['Sunset']
  const grew: string[] = []
  for (let i = 0; i < 8; i++) {
    const r = advanceDay(g, rng)
    grew.push(...(r?.notes ?? []).filter((n) => /跑图|训练/.test(n)))
  }
  check('the drill settles when its seven days are up',
    g.teams[g.myTeam].mapPrefs['Sunset'] > map0,
    `Sunset 熟练 ${map0} → ${g.teams[g.myTeam].mapPrefs['Sunset']}`)
  check('and the panel unlocks for the next plan', g.drillLock == null)
}

// ---- tearing it up forfeits everything
{
  const g = mk()
  const rng = new Rng(4)
  g.drill = { kind: 'map', map: 'Sunset' }
  g.drillLock = g.day + 7
  for (let i = 0; i < 3; i++) advanceDay(g, rng)
  const map0 = g.teams[g.myTeam].mapPrefs['Sunset']
  g.drillLock = undefined            // what 重选（荒废进度） does
  for (let i = 0; i < 10; i++) advanceDay(g, rng)
  check('a torn-up plan produces nothing, ever',
    g.teams[g.myTeam].mapPrefs['Sunset'] === map0,
    `熟练度保持 ${map0}`)

  // and a re-confirmed plan counts its seven from the new day
  g.drill = { kind: 'review' }
  g.drillLock = g.day + 7
  const tw0 = teamworkSum(g)
  for (let i = 0; i < 6; i++) advanceDay(g, rng)
  check('six days into the restart, still locked', g.drillLock != null && g.drillLock > g.day)
  advanceDay(g, rng)
  check('the restarted clock settles on ITS seventh day, not the calendar\'s',
    g.drillLock == null && teamworkSum(g) >= tw0)
}
process.exit(bad ? 1 : 0)
