/** Offline audit; never modifies production values or player accounts.
 * node --import tsx scripts/analyze_seoul_balance.ts [seeds=16] [collectionAccounts=200]
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  BASE_PLAYER_CARDS, SEOUL_CARDS, LEGEND_CARDS, COACH_CARDS, SQUAD_SLOTS,
  cardById, chemistry, personOf, squadRating, SALVAGE, rarityOf,
} from '../src/engine/cards'
import type { PlayerCard, Squad } from '../src/engine/cards'
import { playRivalMatch } from '../src/engine/arena'
import { PACKS, newGacha, openPack } from '../src/engine/gacha'
import { SEOUL_TEAMS } from '../src/engine/seoul2024'
import { Rng } from '../src/engine/rng'

const seeds = Number(process.argv[2] ?? 16)
const accounts = Number(process.argv[3] ?? 200)
assert(Number.isInteger(seeds) && seeds >= 2 && seeds % 2 === 0)
assert(Number.isInteger(accounts) && accounts > 0)
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const player = (id: string) => cardById(id) as PlayerCard
const coaches = COACH_CARDS.filter(c => !c.legend)
interface Hand extends Squad { name: string; group: string; mean: number }

// Enumerate club lineups, keeping people unique across versions. Missing a role
// is permitted but priced explicitly; requiring an IGL would drop historical PRX.
function best(pool: PlayerCard[], coach: string | null, name: string, group: string): Hand | null {
  let chosen: PlayerCard[] | null = null, score = -Infinity
  function visit(picks: PlayerCard[], value: number) {
    if (picks.length === 5) {
      const total = value - (picks.some(c => c.isIgl) ? 0 : 15)
      if (total > score) { score = total; chosen = [...picks] }
      return
    }
    const role = SQUAD_SLOTS[picks.length]
    for (const c of pool) {
      if (picks.some(p => personOf(p) === personOf(c))) continue
      visit([...picks, c], value + c.rating - (role === '自由人' || c.roles.includes(role) ? 0 : 6))
    }
  }
  if (new Set(pool.map(personOf)).size < 5) return null
  visit([], 0)
  const picked = chosen as PlayerCard[] | null
  return picked ? { name, group, slots: picked.map(c => c.id), coach, mean: avg(picked.map(c => c.rating)) } : null
}
const coachFor = (clubId: string | null) => coaches.filter(c => clubId && c.clubId === clubId).sort((a, b) => b.rating - a.rating)[0]?.id ?? null
const baseClubs = [...new Set(BASE_PLAYER_CARDS.map(c => c.clubId).filter(Boolean))].flatMap(id => {
  const pool = BASE_PLAYER_CARDS.filter(c => c.clubId === id)
  const hand = best(pool, coachFor(id), pool[0].clubTag!, 'base')
  return hand && !chemistry(hand).noIgl && !chemistry(hand).misfits.length ? [hand] : []
}).sort((a, b) => b.mean - a.mean).slice(0, 12)
assert.equal(baseClubs.length, 12)
const eventClubs = SEOUL_TEAMS.map(t => best(SEOUL_CARDS.filter(c => c.clubTag === t.tag), coachFor(t.clubId), `S24-${t.tag}`, 'event')!)
const hybridClubs = baseClubs.flatMap(base => {
  const id = player(base.slots[0]!).clubId
  if (!SEOUL_CARDS.some(c => c.clubId === id)) return []
  return [best([...BASE_PLAYER_CARDS, ...SEOUL_CARDS].filter(c => c.clubId === id), base.coach, `hybrid-${base.name}`, 'hybrid')!]
})
// Fixed set of strong, role-complete mixed Seoul hands; a sample, not an optimum.
const rng = new Rng(20260911)
const sampled: Hand[] = [], seen = new Set<string>()
for (let i = 0; i < 2000; i++) {
  const picks: PlayerCard[] = []
  for (const role of SQUAD_SLOTS) {
    const pool = SEOUL_CARDS.filter(c => !picks.includes(c) && (role === '自由人' || c.roles.includes(role)))
      .sort((a, b) => b.rating - a.rating).slice(0, 14)
    picks.push(rng.pick(pool))
  }
  if (!picks.some(c => c.isIgl)) continue
  const key = picks.map(c => c.id).sort().join('|')
  if (seen.has(key)) continue
  seen.add(key)
  const hand: Hand = { name: `S24-mix-${i}`, group: 'event-mix', slots: picks.map(c => c.id), coach: null, mean: avg(picks.map(c => c.rating)) }
  hand.coach = [...coaches].sort((a, b) =>
    (chemistry({ ...hand, coach: b.id }).score + b.rating) - (chemistry({ ...hand, coach: a.id }).score + a.rating))[0].id
  sampled.push(hand)
}
sampled.sort((a, b) => squadRating(b) - squadRating(a) || b.mean - a.mean)
const hands = [...eventClubs, ...hybridClubs, ...sampled.slice(0, 4)]
const legendEdg = best(LEGEND_CARDS.filter(c => c.clubTag === 'EDG' && c.legend?.id.includes('2024')), coachFor(SEOUL_TEAMS[0].clubId), 'legend-EDG', 'legend')!
assert(legendEdg)
hands.push(legendEdg)
for (const h of [...hands, ...baseClubs]) {
  assert.equal(new Set(h.slots.map(id => personOf(player(id!)))).size, 5)
}
const sourceFiles = ['src/engine/seoul2024.ts', 'src/data/seoul2024.json', 'src/engine/cards.ts', 'src/engine/gacha.ts', 'src/engine/arena.ts', 'src/engine/match.ts']
const hashes = () => Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]))
const sourceHashes = hashes()
const rows: { name: string; group: string; level: number; opponent: string; wins: number; n: number }[] = []
const rival = (h: Hand, level: number) => ({ ...h, tag: h.name, levels: Object.fromEntries([...h.slots, h.coach].filter(Boolean).map(id => [id!, level])), div: 4, points: 2000 })
for (const level of [0, 5]) {
  for (const hand of hands) {
    for (let j = 0; j < baseClubs.length; j++) {
      let wins = 0
      for (let k = 0; k < seeds; k++) {
        const seed = 911003 + j * 100003 + k * 7919
        const away = k % 2 === 1
        const result = away
          ? playRivalMatch(baseClubs[j], () => level, rival(hand, level), 3, seed)
          : playRivalMatch(hand, () => level, rival(baseClubs[j], level), 3, seed)
        wins += Number(away ? !result.win : result.win)
      }
      rows.push({ name: hand.name, group: hand.group, level, opponent: baseClubs[j].name, wins, n: seeds })
    }
  }
  console.log(`Finished level ${level}: ${hands.length * baseClubs.length * seeds} BO3`)
}

// Purchases only; zero starting collection, fixed dates, real pack RNG/pity.
// Recycling is a budget estimate: account remains richly funded; no upgrades,
// free rewards, trades, discounts, daily earning model, or probability shortcuts.
const collection: Record<string, number>[] = []
for (let i = 0; i < accounts; i++) {
  const g = newGacha(`S24-PACING-${i}`, 'audit', '2026-09-11')
  g.coins = 1e9
  let packs = 0, salvage = 0
  const thresholds: Record<string, number> = {}
  while (Object.keys(g.cards).length < 80 && packs < 10000) {
    const pulls = openPack(g, 'seoul2024', 'coins', '2026-09-11')
    packs++
    for (const p of pulls) if (g.cards[p.card.id].dupes > 0) {
      salvage += g.cards[p.card.id].dupes * SALVAGE[p.card.rarity]
      g.cards[p.card.id].dupes = 0
    }
    for (const n of [20, 40, 60, 72, 80]) if (thresholds[`p${n}`] == null && Object.keys(g.cards).length >= n) {
      thresholds[`p${n}`] = packs
      thresholds[`net${n}`] = packs * PACKS.seoul2024.cost - salvage
    }
  }
  assert(thresholds.p80)
  collection.push(thresholds)
}
const quantile = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]
const pacing = Object.fromEntries([20, 40, 60, 72, 80].map(n => [n, {
  packsP10: quantile(collection.map(x => x[`p${n}`]), .1),
  packsMedian: quantile(collection.map(x => x[`p${n}`]), .5),
  packsP90: quantile(collection.map(x => x[`p${n}`]), .9),
  netCoinsMedian: quantile(collection.map(x => x[`net${n}`]), .5),
}]))
const packStats = ['seoul2024', 'elite'].map(kind => {
  const g = newGacha(`S24-RATES-${kind}`, 'audit', '2026-09-11')
  g.coins = 1e9
  let goldPacks = 0, rating = 0, salvage = 0
  const rarity: Record<string, number> = {}
  for (let i = 0; i < 20000; i++) {
    const pulls = openPack(g, kind as 'elite' | 'seoul2024', 'coins', '2026-09-11')
    goldPacks += Number(pulls.some(p => p.card.rarity === 'gold'))
    for (const { card } of pulls) { rarity[card.rarity] = (rarity[card.rarity] ?? 0) + 1; rating += card.rating; salvage += SALVAGE[card.rarity] }
  }
  return { kind, packs: 20000, rarity, goldPackRate: goldPacks / 20000, meanRating: rating / 60000, fullDupeSalvagePerPack: salvage / 20000 }
})
const summaries = hands.flatMap(h => [0, 5].map(level => {
  const rs = rows.filter(r => r.name === h.name && r.level === level)
  return { name: h.name, group: h.group, level, mean: h.mean, rating: squadRating(h, () => level), chemistry: chemistry(h), winRate: rs.reduce((s, r) => s + r.wins, 0) / rs.reduce((s, r) => s + r.n, 0) }
}))
assert.deepEqual(hashes(), sourceHashes, 'Production sources must not change during the audit')
const report = {
  meta: { seeds, accounts, sourceHashes, matches: rows.reduce((s, r) => s + r.n, 0), method: 'Fixed twelve ordinary club opponents; same seeds and lineups at levels 0/5; alternating A/B; each opponent equal weight; ordinary coaches chosen by club, mixed event hands sampled. Offline scenario, not live win rates or globally optimal lineups.' },
  rarityMismatch: SEOUL_CARDS.filter(c => c.rarity !== rarityOf(c.rating)).map(c => ({ ign: c.ign, rating: c.rating, event: c.rarity, normal: rarityOf(c.rating) })),
  cards: SEOUL_CARDS.map(c => ({ id: c.id, ign: c.ign, team: c.clubTag, rating: c.rating, rarity: c.rarity, maps: c.seoul!.maps, attrs: c.attrs })),
  baseClubs, hands, summaries, rows, packStats, pacing, collection,
}
writeFileSync('analysis/seoul_balance.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ summaries: summaries.map(({ chemistry, ...r }) => ({ ...r, chemistry: chemistry.score })), packStats, pacing, rarityMismatch: report.rarityMismatch }, null, 2))
console.log('Saved analysis/seoul_balance.json; production values unchanged.')
