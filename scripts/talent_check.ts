/** Every talent point must show up in the simulation, not just on the sheet. */
import { createNewGame, WORLD_TEAMS, squadOf } from '../src/engine/world'
import { createManager, SKILL_CN, scoutedPotential, spendPoint } from '../src/engine/manager'
import type { ManagerSkill } from '../src/engine/manager'
import { advanceDay, setupSeason } from '../src/engine/season'

function run(label: string, build: ManagerSkill[]) {
  const m = createManager('测试', 24, 'grassroots')
  // spend every point on the named skills, evenly
  for (let i = 0; i < 8; i++) spendPoint(m, build[i % build.length], 1)
  const g = createNewGame(WORLD_TEAMS[6].id, m.name, 7, m)
  setupSeason(g)
  for (const p of squadOf(g, g.myTeam)) g.training[p.id] = 'aim'
  g.drill = { kind: 'review' }

  const cash0 = g.finances.balance
  const aim0 = squadOf(g, g.myTeam).reduce((s, p) => s + p.attrs.aim + (p.xp.aim ?? 0) / 100, 0)
  let injuries = 0
  for (let d = 0; d < 168; d++) {
    const r = advanceDay(g, {})
    injuries += r.notes.filter((n) => n.includes('缺阵')).length
  }
  const squad = squadOf(g, g.myTeam)
  const aim1 = squad.reduce((s, p) => s + p.attrs.aim + (p.xp.aim ?? 0) / 100, 0)
  const won = g.fixtures.filter((f) => f.result && f.comp !== 'scrim' &&
    (f.teamA === g.myTeam || f.teamB === g.myTeam) &&
    ((f.teamA === g.myTeam) === (f.result.mapsWonA > f.result.mapsWonB))).length
  const played = g.fixtures.filter((f) => f.result && f.comp !== 'scrim' &&
    (f.teamA === g.myTeam || f.teamB === g.myTeam)).length

  console.log(
    `${label.padEnd(14)} 枪法+${(aim1 - aim0).toFixed(1).padStart(5)}  ` +
    `资金 ${((g.finances.balance - cash0) / 1e6).toFixed(2).padStart(6)}M  ` +
    `伤病 ${String(injuries).padStart(2)}  战绩 ${won}/${played}  ` +
    `体能 ${Math.round(100 - squad.reduce((s, p) => s + p.fatigue, 0) / squad.length)}`,
  )
}

console.log('半个赛季，同一支队、同一个种子，只有天赋加点不同：\n')
run('平均分配', ['training', 'negotiation', 'tactics', 'scouting', 'medical', 'business', 'locker', 'youth'])
run('全点训练', ['training'])
run('全点商务', ['business'])
run('全点体能', ['medical'])
run('全点战术', ['tactics'])

console.log('\n球探对潜力的可见度（同一名选手，潜力真值 85）：')
for (const sc of [20, 35, 50, 65, 80, 90]) {
  const m = createManager('x', 24, 'grassroots')
  m.skills.scouting = sc
  const s = scoutedPotential(m, 'P123', 85)
  console.log(`  ${SKILL_CN.scouting} ${String(sc).padStart(2)} → 显示 ${s.text}${s.exact ? '（准确）' : ''}`)
}

// isolate training: identical squads, low fatigue, one weekly settlement
import { weeklyTick } from '../src/engine/training'
import { Rng } from '../src/engine/rng'

function xpFor(skill: ManagerSkill, points: number, youngOnly = false): number {
  const m = createManager('x', 24, 'grassroots')
  for (let i = 0; i < points; i++) spendPoint(m, skill, 1)
  const g = createNewGame(WORLD_TEAMS[6].id, m.name, 7, m)
  setupSeason(g)
  for (const p of squadOf(g, g.myTeam)) {
    g.training[p.id] = 'aim'
    p.fatigue = 15
    p.potential = 99          // remove the ceiling so gain is what is measured
    if (youngOnly) p.age = 20
  }
  weeklyTick(g, new Rng(7))
  return Math.round(squadOf(g, g.myTeam).reduce((s, p) => s + (p.xp.aim ?? 0), 0))
}

console.log('\n一周训练收益（体能 15、潜力上限解除，只改天赋）：')
for (const pts of [0, 4, 8]) {
  console.log(`  训练天赋 +${pts} 点 → ${xpFor('training', pts)} xp`)
}
console.log('\n青训只对年轻选手生效：')
console.log(`  青训 +8，全队 20 岁 → ${xpFor('youth', 8, true)} xp`)
console.log(`  不点青训，全队 20 岁 → ${xpFor('training', 0, true)} xp`)
