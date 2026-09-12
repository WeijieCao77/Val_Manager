/** Stage-weighted Champions Seoul 2024 numbers for the 首尔 2024 cards.
 *
 *   node scripts/build_seoul_stages.mjs
 *
 * Every map counts by its rounds (how VLR adds up an event) times the round it
 * was played in: groups 1 · first playoff rounds 1.5 · upper semifinal to lower
 * final 2 · grand final 3. Reads the per-map cache written by
 * scripts/fetch_seoul2024_maps.py (gitignored) and writes the result where the
 * engine can import it. Clutch has no per-map record and is left to the event
 * page. scripts/analyze_seoul_stages.mjs compares this against other weights.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const WEIGHTS = [1, 1.5, 2, 3]
const tierOf = (stage) => {
  const s = (stage ?? '').toLowerCase()
  if (!s.startsWith('playoffs')) return 0
  if (s.includes('grand final')) return 3
  if (/upper semifinal|upper final|lower round 3|lower final/.test(s)) return 2
  return 1
}

const RAW = JSON.parse(readFileSync('src/data/seoul2024.json', 'utf8'))
const cache = JSON.parse(readFileSync('scripts/cache/vlr_matches_seoul2024.json', 'utf8'))
assert.equal(Object.keys(cache.matches).length, 34, 'all 34 series of the event')
const idOf = (p) => p.profile.split('/')[4]
const lines = new Map(RAW.players.map((p) => [idOf(p), []]))
for (const m of Object.values(cache.matches)) {
  for (const map of m.maps) {
    const rounds = map.score[0] + map.score[1]
    for (const r of map.rows) {
      lines.get(r.vlrId)?.push({ w: rounds * WEIGHTS[tierOf(m.stage)], rating: r.rating2, acs: r.acs, kast: r.kast, kpr: r.k / rounds, apr: r.a / rounds })
    }
  }
}
const players = {}
for (const p of RAW.players) {
  const xs = lines.get(idOf(p))
  assert.equal(xs.length, p.maps, `${p.ign}: every map he played`)
  const mean = (k) => xs.reduce((s, x) => s + x[k] * x.w, 0) / xs.reduce((s, x) => s + x.w, 0)
  players[idOf(p)] = {
    ign: p.ign, rating: +mean('rating').toFixed(3), acs: +mean('acs').toFixed(1),
    kast: +mean('kast').toFixed(1), kpr: +mean('kpr').toFixed(3), apr: +mean('apr').toFixed(3),
  }
}
writeFileSync('src/data/seoul2024_stages.json', JSON.stringify({
  weights: { groups: 1, firstPlayoffRounds: 1.5, upperSemifinalToLowerFinal: 2, grandFinal: 3 },
  source: 'https://www.vlr.gg/event/matches/2097/valorant-champions-2024/?series_id=all',
  retrieved: '2026-09-11',
  players,
}, null, 1) + '\n')
console.log(`Wrote src/data/seoul2024_stages.json: ${Object.keys(players).length} players · ZmjjKK ${players[idOf(RAW.players.find((p) => p.ign === 'ZmjjKK'))].rating} (event ${RAW.players.find((p) => p.ign === 'ZmjjKK').rating})`)
