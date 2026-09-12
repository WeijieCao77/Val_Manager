/** The 34 series of Champions Seoul 2024, as played, for 首尔征途.
 *
 *   node scripts/build_seoul_series.mjs
 *
 * Reads the per-map cache written by scripts/fetch_seoul2024_maps.py
 * (gitignored) and keeps only what a route needs: VLR's stage label, the two
 * teams by their tag in src/data/seoul2024.json, and each map's name and
 * score with the sides in the series' own order. Nothing is inferred — a
 * series is its maps, and the winner is whoever took more of them.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const RAW = JSON.parse(readFileSync('src/data/seoul2024.json', 'utf8'))
const cache = JSON.parse(readFileSync('scripts/cache/vlr_matches_seoul2024.json', 'utf8'))

// VLR writes 「KIWOOM DRX」 and 「TALON」 where the roster says DRX and Talon Esports
const tagOf = (name) => {
  const hits = RAW.teams.filter((t) => {
    const a = t.name.toLowerCase()
    const b = name.toLowerCase()
    return a.includes(b) || b.includes(a)
  })
  assert.equal(hits.length, 1, `exactly one team for ${name}`)
  return hits[0].tag
}

const series = Object.entries(cache.matches).map(([id, m]) => {
  const [a, b] = m.maps[0].teams.map(tagOf)
  assert.notEqual(a, b, id)
  for (const map of m.maps) assert.deepEqual(map.teams.map(tagOf), [a, b], `${id} keeps its sides on every map`)
  return { id, stage: m.stage, a, b, maps: m.maps.map((x) => [x.map, x.score[0], x.score[1]]) }
}).sort((x, y) => Number(x.id) - Number(y.id))

assert.equal(series.length, 34, 'all 34 series of the event')
for (const t of RAW.teams) assert(series.some((s) => s.a === t.tag || s.b === t.tag), `${t.tag} played`)
for (const s of series) {
  const won = s.maps.filter(([, x, y]) => x > y).length
  const lost = s.maps.length - won
  assert(Math.max(won, lost) === 2 || Math.max(won, lost) === 3, `${s.id} is a finished BO3 or BO5`)
}

writeFileSync('src/data/seoul2024_series.json', JSON.stringify({
  source: 'https://www.vlr.gg/event/matches/2097/valorant-champions-2024/?series_id=all',
  retrieved: '2026-09-11',
  series,
}, null, 1) + '\n')
console.log(`${series.length} series, ${series.reduce((n, s) => n + s.maps.length, 0)} maps → src/data/seoul2024_series.json`)
