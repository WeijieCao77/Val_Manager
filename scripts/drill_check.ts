/** Team drills must move several things, and teach a genuinely new role. */
import { createNewGame, WORLD_TEAMS, squadOf } from '../src/engine/world'
import { advanceDay, setupSeason } from '../src/engine/season'
import { activePool } from '../src/engine/match'

const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!

function run(label: string, setup: (g: ReturnType<typeof createNewGame>) => void) {
  const g = createNewGame(me.id, 'T', 17); setupSeason(g)
  const squad = squadOf(g, g.myTeam)
  for (const p of squad) g.training[p.id] = 'rest'   // isolate the drill
  setup(g)
  const before = {
    tw: squad.reduce((s, p) => s + p.attrs.teamwork, 0),
    aw: squad.reduce((s, p) => s + p.attrs.awareness, 0),
    map: g.teams[g.myTeam].mapPrefs[activePool(g.seed + g.year)[0]] ?? 50,
    roles: squad.reduce((s, p) => s + (p.roles?.length ?? 1), 0),
  }
  for (let i = 0; i < 84; i++) advanceDay(g)
  const after = {
    tw: squad.reduce((s, p) => s + p.attrs.teamwork, 0),
    aw: squad.reduce((s, p) => s + p.attrs.awareness, 0),
    map: g.teams[g.myTeam].mapPrefs[activePool(g.seed + g.year)[0]] ?? 50,
    roles: squad.reduce((s, p) => s + (p.roles?.length ?? 1), 0),
  }
  console.log(`${label.padEnd(12)} 协同 +${after.tw - before.tw}  意识 +${after.aw - before.aw}  ` +
    `图熟练 ${before.map}→${after.map}  覆盖位置 +${after.roles - before.roles}`)
}

run('无团队训练', () => {})
run('跑图', (g) => { g.drill = { kind: 'map', map: activePool(g.seed + g.year)[0] } })
run('教练复盘', (g) => { g.drill = { kind: 'review' } })
run('双排练', (g) => {
  const s = squadOf(g, g.myTeam)
  g.drill = { kind: 'duo', a: s[0].id, b: s[1].id }
})
run('练新英雄', (g) => {
  const p = squadOf(g, g.myTeam)[0]
  const missing = (['决斗者','先锋','控场','哨卫'] as const).find((r) => !(p.roles ?? [p.role]).includes(r))!
  g.drill = { kind: 'agent', playerId: p.id, role: missing, progress: 0 }
})
