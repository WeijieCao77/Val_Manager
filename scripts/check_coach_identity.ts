/** Current coach identities and compatibility after correcting NOVA's stale head coach. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COACH_CARDS, cardById, chemistry, emptySquad, isCoachCard, isPlayerCard, PLAYER_CARDS } from '../src/engine/cards'
import { collection, levelOf, migrateGacha, newGacha } from '../src/engine/gacha'
import { WORLD_TEAMS } from '../src/engine/teams'

const owners = new Map<string, string>()
for (const team of WORLD_TEAMS) {
  if (!team.coach?.name) continue
  const identity = team.coach.name.trim().toLowerCase()
  assert(!owners.has(identity), `${team.coach.name} is head coach of both ${owners.get(identity)} and ${team.tag}`)
  owners.set(identity, team.tag)
  const card = cardById(`c:${team.coach.name}`)
  assert(card && isCoachCard(card), `${team.tag}: every named current coach must have a card`)
  assert.equal(card.clubId, team.id)
}

const wolves = WORLD_TEAMS.find(t => t.id === 'T39')!
const nova = WORLD_TEAMS.find(t => t.id === 'T41')!
assert.equal(wolves.tag, 'WOL')
assert.equal(nova.tag, 'NOVA')
assert.deepEqual(wolves.coach, { name: 'alexRr', assistants: [], tactics: 71, development: 66, motivation: 75 })
assert.deepEqual(nova.coach, { name: '24K', assistants: ['OnbusH'], tactics: 77, development: 81, motivation: 90 },
  'Identity correction must retain NOVA game ability estimates and other staff data')
const overrides = JSON.parse(readFileSync(new URL('../data-raw/overrides.json', import.meta.url), 'utf8'))
const vlr = JSON.parse(readFileSync(new URL('../data-raw/vlrapi_teams.json', import.meta.url), 'utf8'))
assert.equal(overrides.coaches.NOVA.name, '24K', 'Rebuilding must not restore stale Liquipedia identity')
assert.equal(vlr.NOVA.coach, nova.coach?.name, 'NOVA correction agrees with cached VLR roster')
assert.equal(vlr.WOL.coach, wolves.coach?.name)

const alex = cardById('c:alexRr')!
const coach24 = cardById('c:24K')!
assert(isCoachCard(alex) && isCoachCard(coach24))
assert.equal(alex.clubTag, 'WOL')
assert.equal(alex.realName, 'Alexander Frisch', 'Existing alexRr dossier identity is retained')
assert.equal(coach24.clubTag, 'NOVA')
assert.notEqual(alex.id, coach24.id)
assert.equal(COACH_CARDS.filter(c => c.id === coach24.id).length, 1, 'New coach is present exactly once in the draw pool')
assert.equal(COACH_CARDS.filter(c => c.id === alex.id).length, 1)

// Existing inventory keys are people, not club positions. Correcting NOVA must
// neither rename a held alexRr card nor give owners a second coach for free.
const save = newGacha('VM-COACH-IDENTITY', 'identity regression', '2026-09-14')
save.cards = { 'c:alexRr': { id: 'c:alexRr', level: 3, dupes: 2, seen: 4, spares: [1, 2] } }
save.squad = { slots: [null, null, null, null, null], coach: 'c:alexRr' }
const before = JSON.parse(JSON.stringify(save))
const migrated = migrateGacha(JSON.parse(JSON.stringify(save)), save.id)
assert.deepEqual(migrated.cards, before.cards)
assert.deepEqual(migrated.squad, before.squad)
assert.equal(levelOf(migrated, alex.id), 3)
assert(!migrated.cards[coach24.id])
assert.equal(collection(migrated)[0].card.id, alex.id)
assert.equal(collection(migrated)[0].owned.level, 3)

// Club chemistry follows the corrected identities too, without rewriting any
// historical coached-player record or granting 24K somebody else's biography.
for (const [team, coach] of [[wolves, alex], [nova, coach24]] as const) {
  const player = PLAYER_CARDS.find(c => isPlayerCard(c) && !c.event && c.clubId === team.id)!
  assert(player)
  const squad = emptySquad()
  squad.slots[0] = player.id
  squad.coach = coach.id
  assert.equal(chemistry(squad).coachBonus, 3, `${team.tag}: current club player receives full coach chemistry`)
}
console.log(`ok ${owners.size} unique current head coaches; ${COACH_CARDS.length} coach cards; WOL alexRr / NOVA 24K; owned alexRr preserved`)
