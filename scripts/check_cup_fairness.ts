/** Shared card scale, truthful cup ratings, and meaningful 95-vs-85 advantage. */
import assert from 'node:assert/strict'
import { ARENA_TEAM, buildCupArena, playCupMatch, playRivalMatch } from '../src/engine/arena'
import { ALL_CARDS, cardById, isCoachCard, isPlayerCard, personOf, squadRating } from '../src/engine/cards'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import { WORLD_TEAMS } from '../src/engine/teams'
import { hashStr } from '../src/engine/rng'

assert.equal(CUP_TEAMS.length, WORLD_TEAMS.length)
for (const club of CUP_TEAMS) {
  const raw = WORLD_TEAMS.find(t => t.id === club.id)!
  assert.equal(squadRating(club.squad), club.rating)
  assert.equal(new Set(club.squad.slots.map(id => personOf(cardById(id!)!))).size, 5)
  for (const id of club.squad.slots) {
    const card = cardById(id!)
    assert(isPlayerCard(card) && !card.event && card.rarity !== 'mythic')
    assert(raw.roster.includes(card.playerId) && card.clubId === club.id)
  }
  const coach = club.squad.coach ? cardById(club.squad.coach) : null
  if (raw.coach) assert(isCoachCard(coach ?? undefined) && coach.name === raw.coach.name && coach.clubId === club.id)
  else assert.equal(coach, null)
  const { state } = buildCupArena(club.squad, () => 0, club.id, 451)
  const a = state.teams[ARENA_TEAM], b = state.teams[club.id]
  for (let i = 0; i < 5; i++) {
    const x = state.players[a.roster[i]], y = state.players[b.roster[i]]
    for (const key of ['attrs', 'overall', 'form', 'morale', 'fatigue', 'injuredUntil', 'isIgl', 'roles', 'traits'] as const) {
      assert.deepEqual(x[key], y[key], `${club.tag} mirror ${key}`)
    }
  }
  assert.deepEqual(a.coach, b.coach)
  assert.deepEqual(a.mapPrefs, b.mapPrefs)
  assert.deepEqual(a.tactics, b.tactics)
}
console.log(`ok ${CUP_TEAMS.length} clubs: current five, true head coach, displayed score, and mirror player/coach/map/state parity`)

for (const tag of ['EDG', 'NOVA', 'AT']) {
  const a = CUP_TEAMS.find(t => t.tag === tag)!, b = CUP_TEAMS.find(t => t.tag === 'KRX')!
  const seed = hashStr(`cup-pvp-parity:${tag}`)
  const cup = playCupMatch(a.squad, () => 0, b.id, 3, seed)
  const pvp = playRivalMatch(a.squad, () => 0, { ...b.squad, name: b.name, tag: b.tag, levels: {}, div: 4, points: 1000 }, 3, seed, undefined, true)
  assert.deepEqual(cup.result.maps, pvp.result.maps)
}
console.log('ok cup and ranked PvP produce identical maps for the same squads and seeds')

const coaches = ALL_CARDS.filter(isCoachCard)
const fives = CUP_TEAMS.flatMap(club => {
  const coach = coaches.find(c => squadRating({ ...club.squad, coach: c.id }) === 95)
  return coach ? [{ ...club.squad, coach: coach.id }] : []
}).slice(0, 4)
assert(fives.length >= 3, 'multiple distinct 95-point squads')
const opponents = CUP_TEAMS.filter(t => t.rating === 85)
assert(opponents.length >= 2)
for (const bo of [3, 5] as const) {
  let wins = 0
  const N = 600
  for (let i = 0; i < N; i++) {
    const squad = fives[i % fives.length], opponent = opponents[Math.floor(i / fives.length) % opponents.length]
    assert.equal(squadRating(squad), 95)
    if (playCupMatch(squad, () => 0, opponent.id, bo, hashStr(`fairness95:${bo}:${i}`)).win) wins++
  }
  const rate = wins / N
  assert(rate >= .70 && rate < 1, `95 vs 85 BO${bo}: ${rate}`)
  console.log(`ok 95 vs 85 BO${bo}: ${wins}/${N} (${(rate * 100).toFixed(1)}%), stronger favoured with upsets retained`)
}
// Equal cards must still be a contest; this also catches one-sided buffs.
let mirrorWins = 0
const N = 240
for (let i = 0; i < N; i++) {
  const club = CUP_TEAMS[i % CUP_TEAMS.length]
  if (playCupMatch(club.squad, () => 0, club.id, 3, hashStr(`fairness-mirror:${i}`)).win) mirrorWins++
}
assert(mirrorWins / N > .35 && mirrorWins / N < .65)
console.log(`ok equal-card mirror: ${mirrorWins}/${N}; both sides can win`)
