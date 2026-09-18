/** Deterministic regression for coach values: node --import tsx scripts/check_coach_values.ts */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  ALL_CARDS, MAX_LEVEL, POWER_PER_SQUAD_POINT, SQUAD_SLOTS, cardById, chemistry,
  isCoachCard, isPlayerCard, personOf, squadPaper, squadPower, squadPowerPoints, squadRating,
} from '../src/engine/cards'
import type { CoachCard, PlayerCard, Squad } from '../src/engine/cards'
import { ARENA_TEAM, buildArena } from '../src/engine/arena'
import { buildLineup } from '../src/engine/match'
import { autoSquad, collection, levelOf, migrateGacha, newGacha } from '../src/engine/gacha'

// No browser persistence or network is needed by this regression.
const storage = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key), clear: () => storage.clear(),
    key: () => null, get length() { return storage.size },
  },
  fetch: undefined,
})

const near = (actual: number, expected: number, context: string) =>
  assert(Math.abs(actual - expected) < 1e-8, `${context}: ${actual} != ${expected}`)
const coaches = ALL_CARDS.filter(isCoachCard)
const players = ALL_CARDS.filter(isPlayerCard)
const pristineCards = JSON.stringify(ALL_CARDS)
const keys = ['tactics', 'development', 'motivation'] as const

function five(pool: PlayerCard[]): string[] {
  const used = new Set<string>()
  return SQUAD_SLOTS.map(role => {
    const card = pool.find(c => !used.has(personOf(c)) && (role === '自由人' || c.roles.includes(role)))
    assert(card, `Need five distinct people covering ${role}`)
    used.add(personOf(card))
    return card.id
  })
}
const tiers = [
  { name: '普通低分', slots: five(players.filter(c => c.rarity !== 'mythic' && !c.event).sort((a, b) => a.rating - b.rating)) },
  { name: '普通高分', slots: five(players.filter(c => c.rarity !== 'mythic' && !c.event).sort((a, b) => b.rating - a.rating)) },
  { name: '高分彩卡', slots: five(players.filter(c => c.rarity === 'mythic').sort((a, b) => b.rating - a.rating)) },
]
function snapshot(squad: Squad, coachLevel = 0, playerLevel = 0) {
  const level = (id: string) => id === squad.coach ? coachLevel : playerLevel
  const { state } = buildArena(squad, level, 99)
  const lineup = buildLineup(state, ARENA_TEAM, 'Ascent')
  assert.equal(lineup.players.length, 5, 'Every fixture must seat five actual players')
  const ps = state.teams[ARENA_TEAM].roster.map(id => state.players[id])
  const paper = squadPaper(squad, level)
  assert.equal(squadPower(squad, level),
    squadPowerPoints(paper.mean) + squadPowerPoints(paper.lift) + squadPowerPoints(paper.chem)
      - squadPowerPoints(paper.short) - squadPowerPoints(paper.uncalled),
    'Displayed five-player power components must add up to the total')
  return {
    paper, power: squadPower(squad, level), chem: chemistry(squad).score,
    overall: ps.map(p => p.overall), attrs: ps.map(p => ({ ...p.attrs })),
    tactics: lineup.edge.coach, atk: lineup.atk, def: lineup.def, midRound: lineup.midRound,
  }
}

let pointChecks = 0, upgradeChecks = 0
for (const tier of tiers) {
  const noCoach = snapshot({ slots: tier.slots, coach: null })
  for (const coach of coaches) {
    const squad = { slots: tier.slots, coach: coach.id }
    const base = snapshot(squad)
    const original = { tactics: coach.tactics, development: coach.development, motivation: coach.motivation }
    // Same identity and five: zero weighted ability advantage without changing chemistry.
    try {
      Object.assign(coach, { tactics: 50, development: 50, motivation: 50 })
      const neutral = snapshot(squad)
      assert.equal(neutral.chem, base.chem)
      near(neutral.paper.lift, 0, 'Neutral coach has no overall lift')
      base.overall.forEach((v, i) => near(v - neutral.overall[i], base.paper.lift * 0.5, `${tier.name}/${coach.id}: paper lift reaches seat ${i}`))
    } finally { Object.assign(coach, original) }

    for (const key of keys) {
      try {
        coach[key] += 1
        const next = snapshot(squad)
        const label = `${tier.name}/${coach.id}/${key}+1`
        assert.equal(next.chem, base.chem, label)
        assert(next.power > base.power, `${label}: power must increase`)
        assert(next.paper.lift > base.paper.lift, `${label}: unrounded paper lift must increase`)
        assert(next.atk > base.atk && next.def > base.def, `${label}: actual attack/defence must increase`)
        next.overall.forEach((v, i) => {
          assert(v > base.overall[i], `${label}: seat ${i} overall must increase`)
          near(v - base.overall[i], (next.paper.lift - base.paper.lift) * 0.5, `${label}: paper/match delta`)
        })
        if (key === 'tactics') assert(next.tactics > base.tactics, `${label}: tactics specialization`)
        if (key === 'motivation') assert(next.midRound > base.midRound, `${label}: late-round specialization`)
        pointChecks++
      } finally { coach[key] = original[key] }
    }
    let previous = base
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const next = snapshot(squad, level)
      const label = `${tier.name}/${coach.id}+${level}`
      assert.equal(next.power - previous.power, 100, `${label}: existing upgrade contract`)
      next.overall.forEach((v, i) => near(v - previous.overall[i], 0.1, `${label}: no lost or duplicated level`))
      assert(next.atk > previous.atk && next.def > previous.def && next.tactics > previous.tactics, `${label}: level reaches match`)
      previous = next
      upgradeChecks++
    }
    const maxPlayers = snapshot(squad, 0, MAX_LEVEL)
    const allMax = snapshot(squad, MAX_LEVEL, MAX_LEVEL)
    allMax.overall.forEach((v, i) => near(v - maxPlayers.overall[i], 0.5, `${tier.name}/${coach.id}: max player cards keep coach upgrades`))
  }
  assert.deepEqual(snapshot({ slots: tier.slots, coach: null }), noCoach, 'Coach mutations must not leak into an uncoached match')
  console.log(`ok ${tier.name}: five distinct people, ${coaches.length} coaches, all attribute points and upgrades`)
}

// Independently retained no-coach state from the shipped pre-fix engine.
const noCoachPins: Record<string, string> = {
  'p:P260,p:P65,p:P360,p:P266,p:P536': 'a0240f257957',
  'p:P227,p:P382,p:P95,p:P300,p:P48': '595896154188',
  // re-pinned 2026-09-18: QiuYe (P527) got his real birthdate from 号角 (18 → 23) and age is part of a bond
  'p:P117,s24:15559,p:P489,p:P527,p:P114': 'e27e63094203',
}
for (const [ids, expected] of Object.entries(noCoachPins)) {
  const { state } = buildArena({ slots: ids.split(','), coach: null }, () => 0, 99)
  const team = state.teams[ARENA_TEAM]
  const ps = team.roster.map(id => { const p = state.players[id]; return { overall: p.overall, attrs: p.attrs, isIgl: p.isIgl } })
  const hash = createHash('sha1').update(JSON.stringify({ ps, bonds: state.bonds, coach: team.coach })).digest('hex').slice(0, 12)
  assert.equal(hash, expected, `Uncoached baseline ${ids}`)
}

// Both coaches have identical chemistry and rounded squad rating. The stronger
// fractional choice comes second in collection order, so integer tie-breaking fails.
const lower = cardById('c:bonkar') as CoachCard
const higher = cardById('c:Cody') as CoachCard
assert(isCoachCard(lower) && isCoachCard(higher))
const beforeLower = { ...lower }, beforeHigher = { ...higher }
try {
  const common = { name: 'coach-values-fixture', clubId: null, clubTag: null, region: null, tactics: 70, development: 70, motivation: 70 }
  Object.assign(lower, common)
  Object.assign(higher, common)
  const g = newGacha('VM-COACH-VALUES', '教练验证', '2026-09-14')
  g.cards = Object.fromEntries([...tiers[1].slots, lower.id, higher.id].map(id => [id, { id, level: 0, dupes: 0, seen: 1 }]))
  const slots = autoSquad(g).slots
  let found = false
  for (let motivation = 70; motivation < 90; motivation++) {
    lower.motivation = motivation
    higher.motivation = motivation + 1
    const a = { slots, coach: lower.id }, b = { slots, coach: higher.id }
    if (squadRating(a) !== squadRating(b)) continue
    assert.equal(chemistry(a).score, chemistry(b).score)
    assert(squadPower(b) > squadPower(a))
    assert.equal(collection(g).filter(c => isCoachCard(c.card))[0].card.id, lower.id)
    const saved = JSON.stringify(g)
    assert.equal(autoSquad(g).coach, higher.id, 'Auto squad must select the stronger fractional coach')
    assert.equal(JSON.stringify(g), saved, 'Auto squad calculation must not mutate the save')
    found = true
    break
  }
  assert(found, 'Need an integer-rating tie to test fractional selection')
} finally { Object.assign(lower, beforeLower); Object.assign(higher, beforeHigher) }

const empty: Squad = { slots: [null, null, null, null, null], coach: coaches[0].id }
assert.equal(squadPower(empty, () => MAX_LEVEL), 0)
assert.equal(squadRating(empty, () => MAX_LEVEL), 0)
const oldSave = newGacha('VM-COACH-OLD-SAVE', '旧存档', '2026-09-01')
oldSave.cards = Object.fromEntries([...tiers[1].slots, coaches[0].id].map(id => [id, { id, level: id === coaches[0].id ? 3 : 0, dupes: 2, seen: 4 }]))
oldSave.squad = { slots: [...tiers[1].slots], coach: coaches[0].id }
const migrated = migrateGacha(JSON.parse(JSON.stringify(oldSave)), oldSave.id)
assert.deepEqual(migrated.cards, oldSave.cards, 'Existing coach/player inventory and levels remain valid')
assert.equal(levelOf(migrated, coaches[0].id), 3)
near(squadPower(migrated.squad, id => levelOf(migrated, id)) - squadPower(migrated.squad), 300, 'Saved coach level reaches displayed power')
assert.equal(JSON.stringify(ALL_CARDS), pristineCards, 'Card faces, abilities, identities and catalog unchanged after verification')
assert.equal(POWER_PER_SQUAD_POINT, 500)
console.log(`ok ${pointChecks} attribute-point checks; ${upgradeChecks} upgrades; 3 uncoached baselines; fractional auto squad; empty squad; old save; unchanged cards`)
