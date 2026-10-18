/** The 34 series of Champions Los Angeles 2023, as played, for 洛杉矶征途 — build_bangkok_series.mjs on event 1657.
 *
 *   node scripts/build_losangeles_series.mjs
 *
 * Reads scripts/cache/vlr_matches_la2023.json (fetch_la2023_maps.py) and keeps what a route needs: VLR's stage
 * label, the two teams by their tag in src/data/losangeles2023.json, and each map's name and score with the
 * sides in the series' own order.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const RAW = JSON.parse(readFileSync('src/data/losangeles2023.json', 'utf8'))
const cache = JSON.parse(readFileSync('scripts/cache/vlr_matches_la2023.json', 'utf8'))

// VLR writes the later names: KIWOOM DRX for the DRX of the event; Giants and KRÜ as the clubs were called then
const VLR_NAME = { 'kiwoom drx': 'DRX', fnatic: 'FNATIC' }
const tagOf = (name) => {
  const n = VLR_NAME[name.toLowerCase()] ?? name
  const hits = RAW.teams.filter((t) => t.name.toLowerCase() === n.toLowerCase())
  assert.equal(hits.length, 1, `exactly one team for ${name}`)
  return hits[0].tag
}

const series = Object.entries(cache.matches)
  .filter(([, m]) => !/showmatch/i.test(m.stage ?? ''))
  .map(([id, m]) => {
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

writeFileSync('src/data/losangeles2023_series.json', JSON.stringify({
  source: 'https://www.vlr.gg/event/matches/1657/valorant-champions-2023/?series_id=all',
  retrieved: '2026-10-18',
  series,
}, null, 1) + '\n')
console.log(`${series.length} series, ${series.reduce((n, s) => n + s.maps.length, 0)} maps → src/data/losangeles2023_series.json`)
