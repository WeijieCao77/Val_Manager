import assert from 'node:assert/strict'
import { autoStarters, createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { careerDayOf } from '../src/engine/clock'
import type { Player, Role } from '../src/engine/types'

const g = createNewGame(WORLD_TEAMS[0].id, '自动首发', 42)
const t = g.teams[g.myTeam]
const template = g.players[t.roster[0]]
const roles: Role[] = ['决斗者', '先锋', '控场', '自由人', '自由人', '哨卫', '自由人']
const roster = roles.map((role, i): Player => ({ ...structuredClone(template), id: `availability-${i}`, teamId: t.id,
  role, roles: [role], overall: 90 - i, rounds: 10000, injuredUntil: 0, isIgl: false }))
for (const p of roster) g.players[p.id] = p
t.roster = roster.map(p => p.id)
// The only primary sentinel is hurt. Five healthy players must take priority.
roster[5].injuredUntil = 10
roster[6].injuredUntil = 10
let five = autoStarters(g, t.id)
assert.equal(five.filter(id => g.players[id].injuredUntil > g.day).length, 0, 'do not force an injured specialist over a healthy player')
// Likewise for the sole (otherwise top-rated) caller on a disciplinary bench.
roster[5].injuredUntil = 0
roster[5].isIgl = true
roster[5].attrs.igl = 100
roster[5].coolOffUntil = careerDayOf(g) + 7
five = autoStarters(g, t.id)
assert.ok(!five.includes(roster[5].id), 'automatic selection must respect the cooling-off bench')
// With only four healthy players, use exactly one injured player, no discipline bench.
roster[4].injuredUntil = 10
five = autoStarters(g, t.id)
assert.equal(five.length, 5)
assert.equal(new Set(five).size, 5)
assert.equal(five.filter(id => g.players[id].injuredUntil > g.day).length, 1)
assert.ok(!five.includes(roster[5].id))
// Fitness must outrank caller skill when choosing between available callers.
roster[4].isIgl = true
roster[4].attrs.igl = 80
roster[3].isIgl = true
roster[3].attrs.igl = 60
assert.ok(autoStarters(g, t.id).includes(roster[3].id))
console.log('ok auto starters prioritize availability while still fielding five when substitutes run out')
