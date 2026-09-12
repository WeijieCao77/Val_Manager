import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { ALL_CARDS, BASE_PLAYER_CARDS, SEOUL_CARDS, cardById, personOf } from '../src/engine/cards'
import { SEOUL_TEAMS } from '../src/engine/seoul2024'
import { PACKS, MYTHIC_FLOOR, HARD_PITY, newGacha, openPack, migrateGacha, setSlot, personTaken, seriesProgress } from '../src/engine/gacha'
import { buildArena, playRivalMatch, ARENA_TEAM } from '../src/engine/arena'
import { clubSets } from '../src/engine/clubSets'
const g = newGacha('SEOUL-AUDIT', '首尔测试', '2026-09-08')
assert.equal(SEOUL_CARDS.length, 80)
assert.equal(new Set(SEOUL_CARDS.map(personOf)).size, 80)
assert.equal(new Set(SEOUL_CARDS.map(c => c.seoul!.number)).size, 80)
for (const t of SEOUL_TEAMS) assert.equal(SEOUL_CARDS.filter(c => c.clubTag === t.tag).length, 5, t.tag)
for (const c of SEOUL_CARDS) {
  assert.equal(cardById(c.id), c)
  assert(c.face && existsSync(`public${c.face}`), c.ign)
  assert(c.seoul!.maps > 0)
  assert(c.roles.length > 0)
}
assert(SEOUL_CARDS.some(c => c.ign === 'hiro' && c.clubTag === 'FNC'))
assert(!SEOUL_CARDS.some(c => c.ign === 'Leo'))
assert.equal(SEOUL_CARDS.find(c => c.ign === 'TenZ')?.clubTag, 'SEN')
assert.equal(SEOUL_CARDS.find(c => c.ign === 'icy')?.role, '决斗者', 'Primary role sums usage across agents')
assert.equal(SEOUL_CARDS.find(c => c.ign === 'Sacy')?.clubTag, 'SEN')
assert.equal(SEOUL_CARDS.find(c => c.ign === 'MaKo')?.clubTag, 'DRX')
assert.equal(SEOUL_CARDS.filter(c => c.rarity === 'mythic').length, 0)
const regionalBefore = seriesProgress(g).map(s => [s.region, s.total])
const clubsBefore = clubSets(g).map(s => [s.clubId, s.total]).sort((a,b) => String(a[0]).localeCompare(String(b[0])))
g.coins = 1e8
const seen = new Set<string>()
for (let i = 0; i < 4000; i++) {
  const before = g.coins
  const pulls = openPack(g, 'seoul2024', 'coins', '2026-09-08')
  assert.equal(before - g.coins, PACKS.seoul2024.cost)
  assert.equal(pulls.length, 3)
  assert(pulls.some(p => p.card.rarity === 'silver' || p.card.rarity === 'gold'))
  for (const p of pulls) { assert(p.card.kind === 'player' && p.card.event === 'seoul-2024'); seen.add(p.card.id) }
}
assert.equal(seen.size, 80, 'Every historical player is reachable')
g.pity = HARD_PITY; g.mythicDry = MYTHIC_FLOOR
assert(openPack(g, 'seoul2024', 'coins').some(p => p.card.rarity === 'gold'))
assert.equal(g.mythicDry, MYTHIC_FLOOR, 'Event packs do not consume or progress mythic pity')
for (const kind of ['scout', 'cn', 'pac', 'ame', 'emea', 'coach'] as const) {
  for (let i = 0; i < 30; i++) assert(openPack(g, kind, 'coins').every(p => !(p.card.kind === 'player' && p.card.event)))
}
const saved = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
assert(SEOUL_CARDS.every(c => saved.cards[c.id]))
assert.deepEqual(seriesProgress(g).map(s => [s.region, s.total]), regionalBefore)
assert.deepEqual(clubSets(g).map(s => [s.clubId, s.total]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))), clubsBefore)
const kk = SEOUL_CARDS.find(c => c.ign === 'ZmjjKK')!
const base = BASE_PLAYER_CARDS.find(c => c.ign === 'ZmjjKK')!
g.cards[base.id] = { id: base.id, level: 0, dupes: 0, seen: 1, got: '2026-09-08' }
setSlot(g, 0, kk.id)
assert(personTaken(g, base.id), 'Base and event versions share an identity')
const historical = SEOUL_CARDS.filter(c => c.playerId.startsWith('historic:')).slice(0, 5)
assert.equal(historical.length, 5)
const squad = { slots: historical.map(c => c.id), coach: null }
const arena = buildArena(squad, () => 0, 123)
assert.equal(arena.state.teams[ARENA_TEAM].roster.length, 5, 'Retired players occupy real arena seats')
for (let i = 0; i < 5; i++) assert.equal(arena.state.players[`A${i}`].ign, historical[i].ign)
const result = playRivalMatch(squad, () => 0, { ...squad, name: '首尔镜像', tag: 'S24', levels: {}, div: 5, points: 0 }, 1, 777)
assert.equal(result.lines.length, 5)
assert.equal(result.opp?.lines.length, 5)
assert(ALL_CARDS.length > SEOUL_CARDS.length)
console.log('PASS: 16 teams / 80 real players; 12,000 event draws reach all cards; dedicated pool, silver/gold guarantees, shared identity, save roundtrip, retired-player match, region and club totals.')
