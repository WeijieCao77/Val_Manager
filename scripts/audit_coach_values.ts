/** Read-only coach audit: node --import tsx scripts/audit_coach_values.ts [series=1000] [club=EDG] */
import assert from 'node:assert/strict'
import { ALL_CARDS, SQUAD_SLOTS, cardById, chemistry, coachLift, isCoachCard, isPlayerCard, personOf, squadPower } from '../src/engine/cards'
import { ARENA_TEAM, buildArena, playRivalMatch } from '../src/engine/arena'
import { buildLineup } from '../src/engine/match'

const club = process.argv[3] ?? 'EDG'
const pool = ALL_CARDS.filter(isPlayerCard).filter(c => c.clubTag === club && c.rarity !== 'mythic').sort((a, b) => b.rating - a.rating)
const used = new Set<string>()
const slots = SQUAD_SLOTS.map(role => {
  const c = pool.find(c => !used.has(personOf(c)) && (role === '自由人' || c.roles.includes(role))) ?? pool.find(c => !used.has(personOf(c)))
  assert(c)
  used.add(personOf(c))
  return c.id
})
const coaches = ALL_CARDS.filter(isCoachCard)
function snapshot(coach: string | null, level = 0) {
  const sq = { slots, coach }
  const { state } = buildArena(sq, id => id === coach ? level : 0, 99)
  const lineup = buildLineup(state, ARENA_TEAM, 'Ascent')
  assert.equal(lineup.players.length, 5, 'Five distinct people must enter the match')
  return {
    power: squadPower(sq, id => id === coach ? level : 0), chemistry: chemistry(sq).score,
    overall: lineup.players.map(p => p.overall), clutch: lineup.players.map(p => p.attrs.clutch),
    tacticsEdge: lineup.edge.coach, atk: lineup.atk, def: lineup.def, midRound: lineup.midRound,
  }
}
console.log(JSON.stringify({ club, slots, coachCount: coaches.length, zeroCoachLift: coaches.filter(c => coachLift(c) === 0).length }))
const low = 'c:Cody', high = 'c:bonkar'
const lowState = snapshot(low), highState = snapshot(high)
assert.equal(lowState.chemistry, highState.chemistry)
assert(highState.power > lowState.power)
assert(highState.atk > lowState.atk && highState.midRound > lowState.midRound)
console.log(JSON.stringify({ coachComparison: [low, high].map(coach => ({ coach, rating: cardById(coach)!.rating, ...snapshot(coach) })) }))

// One-point changes on the same card isolate each attribute from chemistry.
const c = cardById(low)
assert(isCoachCard(c))
for (const key of ['tactics', 'development', 'motivation'] as const) {
  const old = c[key]
  try {
    c[key]++
    const next = snapshot(low)
    assert(next.power > lowState.power, `${key} must increase squad power`)
    assert(next.overall.every((v, i) => v > lowState.overall[i]), `${key} must reach the whole five`)
    console.log(JSON.stringify({ onePoint: key, from: old, to: old + 1, powerChanged: next.power !== lowState.power, lineupChanged: JSON.stringify(next) !== JSON.stringify(lowState) }))
  } finally { c[key] = old }
}

let upgrades = 0
for (const coach of coaches) {
  let prev = snapshot(coach.id)
  for (let level = 1; level <= 5; level++) {
    const next = snapshot(coach.id, level)
    assert.equal(next.power - prev.power, 100, `${coach.id} +${level} power`)
    assert(next.overall.every((v, i) => v > prev.overall[i]), `${coach.id} +${level} overall`)
    assert(next.tacticsEdge > prev.tacticsEdge, `${coach.id} +${level} tactics`)
    prev = next
    upgrades++
  }
}
console.log(JSON.stringify({ coachUpgradesChecked: upgrades, passed: true }))

const n = Number(process.argv[2] ?? 1000)
assert(Number.isInteger(n) && n >= 0 && n % 2 === 0)
let strongWins = 0
for (let i = 0; i < n; i++) {
  const flip = i % 2 === 1
  const result = playRivalMatch({ slots, coach: flip ? low : high }, () => 0,
    { slots, coach: flip ? high : low, levels: {}, name: '对照', tag: 'TEST' },
    3, (Math.floor(i / 2) + 1) * 7919)
  if (result.win !== flip) strongWins++
}
console.log(JSON.stringify({ comparison: `${high} vs ${low}`, series: n, pairedSeeds: n / 2, swappedSides: true, strongWins, winRate: n ? strongWins / n : null }))
