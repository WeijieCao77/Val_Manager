/** Paired real-action cup measurements. Same entries and per-round seeds across builds. */
import { writeFileSync, readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { ALL_CARDS, isPlayerCard, squadRating } from '../src/engine/cards'
import { autoSquad, newGacha, openPack, levelOf } from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import { hashStr } from '../src/engine/rng'
import { CUP_TEAMS } from '../src/engine/cupTeams'
const N = Number(process.argv[2] ?? 200)
const output = process.argv[3] ?? '/tmp/cup-easing.json'
const comparison = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], 'utf8')) : null
const now = Date.parse('2026-09-15T12:00:00Z'), today = '2026-09-15'
const ratings = new Map(CUP_TEAMS.map(t => [t.id, t.rating]))
function own(g: GachaState, ids: string[], level = 0) {
  for (const id of ids) g.cards[id] = { id, level, dupes: 0, seen: 1, got: today }
  g.squad = autoSquad(g)
  return g
}
const fixtures: { name: string; g: GachaState }[] = []
const starter = newGacha('VM-CUPE-START', '杯赛', today)
starter.packs.scout = 12
for (let i = 0; i < 12; i++) openPack(starter, 'scout', 'pack')
starter.squad = autoSquad(starter)
fixtures.push({ name: '12个试训包', g: starter })
for (const [club, level] of [['AT', 0], ['NOVA', 0], ['EDG', 0], ['EDG', 5]] as const) {
 const g = newGacha(`VM-CUPE-${club}-${level}`, '杯赛', today)
 const ids = ALL_CARDS.filter(c => c.clubTag === club && (!isPlayerCard(c) || !c.event) && c.rarity !== 'mythic').map(c => c.id)
 fixtures.push({ name: `${club}+${level}`, g: own(g, ids, level) })
}
for (const level of [0, 5]) {
 const g = newGacha(`VM-CUPE-MYTHIC-${level}`, '杯赛', today)
 fixtures.push({ name: `彩卡+${level}`, g: own(g, ALL_CARDS.filter(c => c.rarity === 'mythic').map(c => c.id), level) })
}
const results = []
for (const f of fixtures) {
 const start = f.g
 const rows = []
 for (let i = 0; i < N; i++) {
  const g = structuredClone(start)
  g.seed = hashStr(`cup-easing:${f.name}:${i}`)
  g.cup = null; g.daily.stamina = 30; g.daily.staminaAt = now
  const before = g.coins
  const env = { now, today, seed: 1 }
  const entered = runAction(g, 'cup_enter', {}, env)
  assert(entered.ok, JSON.stringify(entered))
  const path = g.cup!.path.map(id => ratings.get(id)!)
  let wins = 0
  while (!g.cup!.done) {
   const round = g.cup!.round
   const played = runAction(g, 'cup_play', {}, { ...env, seed: hashStr(`cup-match:${f.name}:${i}:${round}`) })
   assert(played.ok, JSON.stringify(played))
   if ((played.result as any).res.win) wins++
  }
  rows.push({ rounds: path.length, path, wins, champion: g.cup!.won, coins: g.coins - before })
 }
 const group = (rs: typeof rows) => ({ cups: rs.length,
  firstWin: rs.filter(r => r.wins > 0).length / rs.length,
  twoWins: rs.filter(r => r.wins >= 2).length / rs.length,
  champion: rs.filter(r => r.champion).length / rs.length,
  wins: rs.reduce((s,r) => s+r.wins,0)/rs.length,
  coinsPerEntry: rs.reduce((s,r) => s+r.coins,0)/rs.length,
  firstOpponent: rs.reduce((s,r) => s+r.path[0],0)/rs.length,
  finalOpponent: rs.reduce((s,r) => s+r.path.at(-1)!,0)/rs.length })
 const result = { name: f.name, squad: start.squad, rating: squadRating(start.squad, id => levelOf(start,id)), all: group(rows), byDepth: Object.fromEntries([3,4,5].map(n => [n,group(rows.filter(r=>r.rounds===n))])), rows }
 if (comparison) {
  const old = comparison.results.find((r: any) => r.name === f.name)
  assert.deepEqual(result.squad, old.squad); assert.equal(result.rating, old.rating)
  assert.deepEqual(rows.map(r=>r.rounds), old.rows.map((r:any)=>r.rounds))
  console.log(JSON.stringify({ name: f.name, rating:result.rating, before:old.all, after:result.all }))
 } else console.log(JSON.stringify({name:f.name,rating:result.rating,...result.all}))
 results.push(result)
}
writeFileSync(output, JSON.stringify({ cupsPerFixture:N, results }, null, 2)+'\n')
