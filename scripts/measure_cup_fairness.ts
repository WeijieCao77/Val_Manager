/** Reproducible 95-ish vs 85 club comparison, plus nearby/weaker controls. */
import { writeFileSync } from 'node:fs'
import { ALL_CARDS, isPlayerCard, squadRating } from '../src/engine/cards'
import { autoSquad, newGacha } from '../src/engine/gacha'
import * as arena from '../src/engine/arena'
import { WORLD_TEAMS } from '../src/engine/teams'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import { hashStr } from '../src/engine/rng'

const N = Number(process.argv[2] ?? 300)
const output = process.argv[3] ?? '/tmp/cup-fairness.json'
const play = process.argv[4] === 'legacy' ? arena.playArenaMatch : (arena as any).playCupMatch ?? arena.playArenaMatch
const fixtures = []
for (const club of ['EDG', 'PRX', 'FNC', 'NOVA', 'AT']) {
  const g = newGacha(`VM-CFAIR-${club}`, '公平性', '2026-09-14')
  for (const c of ALL_CARDS.filter(c => c.clubTag === club && c.rarity !== 'mythic' && (!isPlayerCard(c) || !c.event))) {
    g.cards[c.id] = { id: c.id, level: 0, dupes: 0, seen: 1, got: '2026-09-14' }
  }
  const squad = autoSquad(g)
  fixtures.push({ club, squad, rating: squadRating(squad) })
}
const results = []
for (const f of fixtures) {
  for (const bo of [3, 5] as const) {
    const opponents = (process.argv[4] === 'legacy' ? WORLD_TEAMS : CUP_TEAMS).filter(t => t.rating === 85)
    const rows = Array.from({ length: N }, (_, i) => {
      const opp = opponents[i % opponents.length]
      const seed = hashStr(`cup-fairness:${f.club}:${bo}:${i}`)
      const res = play(f.squad, () => 0, opp.id, bo, seed)
      return { opponent: opp.id, win: res.win, mapsWon: res.mapsWon, mapsLost: res.mapsLost }
    })
    const row = { ...f, bo, n: N, wins: rows.filter(r => r.win).length, rows }
    results.push(row)
    console.log(JSON.stringify({ club: f.club, rating: f.rating, opponentRating: 85, bo, n: N, winRate: row.wins / N }))
  }
}
writeFileSync(output, JSON.stringify({ mode: process.argv[4] ?? 'cup', results }, null, 2) + '\n')
