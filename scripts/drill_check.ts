/** Team drills must move several things, and teach a genuinely new role. */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason } from '../src/engine/season'
import { pickAgentToLearn } from '../src/engine/training'
import { activePool } from '../src/engine/match'

const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!

function run(label: string, setup: (g: ReturnType<typeof createNewGame>) => void) {
  const g = createNewGame(me.id, 'T', 17); setupSeason(g)
  for (const p of squadOf(g, g.myTeam)) g.training[p.id] = 'rest'   // isolate the drill
  setup(g)
  const snap = () => squadOf(g, g.myTeam)
  const before = {
    tw: snap().reduce((s, p) => s + p.attrs.teamwork, 0),
    aw: snap().reduce((s, p) => s + p.attrs.awareness, 0),
    map: Math.round(g.teams[g.myTeam].mapPrefs[activePool(g.seed + g.year)[0]] ?? 50),
    roles: snap().reduce((s, p) => s + (p.roles?.length ?? 1), 0),
    // 常用英雄开局就是 100，取最大值永远不动；要看的是「新练出来的那些」
    pro: snap().reduce((s, p) => s + Object.values(p.agentPro ?? {}).reduce((x, y) => x + y, 0), 0),
  }
  for (let i = 0; i < 84; i++) advanceDay(g)
  const after = {
    tw: snap().reduce((s, p) => s + p.attrs.teamwork, 0),
    aw: snap().reduce((s, p) => s + p.attrs.awareness, 0),
    map: Math.round(g.teams[g.myTeam].mapPrefs[activePool(g.seed + g.year)[0]] ?? 50),
    roles: snap().reduce((s, p) => s + (p.roles?.length ?? 1), 0),
    pro: snap().reduce((s, p) => s + Object.values(p.agentPro ?? {}).reduce((x, y) => x + y, 0), 0),
  }
  console.log(`${label.padEnd(12)} 协同 +${after.tw - before.tw}  意识 +${after.aw - before.aw}  ` +
    `图熟练 ${before.map}→${after.map}  覆盖位置 +${after.roles - before.roles}  英雄熟练 +${Math.round(after.pro - before.pro)}%`)
}

run('无团队训练', () => {})
run('跑图', (g) => { g.drill = { kind: 'map', map: activePool(g.seed + g.year)[0] } })
run('教练复盘', (g) => { g.drill = { kind: 'review' } })
run('双排练', (g) => {
  const s = squadOf(g, g.myTeam)
  g.duo = { a: s[0].id, b: s[1].id }
})
run('跑图＋双排（并行）', (g) => {
  g.drill = { kind: 'map', map: activePool(g.seed + g.year)[0] }
  const s = squadOf(g, g.myTeam)
  g.duo = { a: s[0].id, b: s[1].id }
})
run('练英雄', (g) => {
  const p = squadOf(g, g.myTeam)[0]
  const missing = (['决斗者','先锋','控场','哨卫'] as const).find((r) => !(p.roles ?? [p.role]).includes(r))!
  // 练的是一个具体角色，不是整个位置
  g.drill = { kind: 'agent', playerId: p.id, agent: pickAgentToLearn(p, missing)! }
})
