/** Would weighting the later rounds reorder the 首尔 2024 cards? Offline; reads
 * the per-map cache from scripts/fetch_seoul2024_maps.py and changes nothing.
 *
 *   node scripts/analyze_seoul_stages.mjs
 *
 * Every map line is weighted by its rounds (how VLR aggregates an event) times
 * the weight of the round it was played in, then settled toward the field by
 * six maps and put through the card formula — the same steps as
 * src/engine/seoul2024.ts. Clutch has no per-map record and stays unweighted.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const RAW = JSON.parse(readFileSync('src/data/seoul2024.json', 'utf8'))
const cache = JSON.parse(readFileSync('scripts/cache/vlr_matches_seoul2024.json', 'utf8'))
const idOf = (p) => p.profile.split('/')[4]
const byId = new Map(RAW.players.map((p) => [idOf(p), p]))

// 0 groups · 1 first playoff rounds · 2 semifinal-and-later brackets · 3 grand final
const tierOf = (stage) => {
  const s = (stage ?? '').toLowerCase()
  if (!s.startsWith('playoffs')) return 0
  if (s.includes('grand final')) return 3
  if (/upper semifinal|upper final|lower round 3|lower final/.test(s)) return 2
  return 1
}
const TIER_CN = ['小组赛', '季后赛前段', '四强阶段', '总决赛']
const labels = {}
for (const m of Object.values(cache.matches)) labels[m.stage] = { tier: tierOf(m.stage), n: (labels[m.stage]?.n ?? 0) + 1 }
console.log('rounds found:')
for (const [s, v] of Object.entries(labels)) console.log(`  ${TIER_CN[v.tier]}  ${s} ×${v.n}`)

const lines = new Map()
let unmatched = 0
for (const m of Object.values(cache.matches)) {
  for (const map of m.maps) {
    const rounds = map.score[0] + map.score[1]
    for (const r of map.rows) {
      const p = byId.get(r.vlrId)
      if (!p) { unmatched++; continue }
      if (!lines.has(p.ign)) lines.set(p.ign, [])
      lines.get(p.ign).push({ tier: tierOf(m.stage), rounds, rating: r.rating2, acs: r.acs, kpr: r.k / rounds, apr: r.a / rounds, kast: r.kast })
    }
  }
}
const wmean = (xs, key, w) => xs.reduce((s, x) => s + x[key] * w(x), 0) / xs.reduce((s, x) => s + w(x), 0)

// does the per-map library add back up to the event page the cards were built from?
let worst = { d: 0 }, sumD = 0, mapsOff = []
for (const p of RAW.players) {
  const xs = lines.get(p.ign) ?? []
  if (xs.length !== p.maps) mapsOff.push(`${p.ign} ${xs.length}/${p.maps}`)
  if (!xs.length) continue
  const d = Math.abs(wmean(xs, 'rating', (x) => x.rounds) - p.rating)
  sumD += d
  if (d > worst.d) worst = { d, ign: p.ign }
}
console.log(`\ncheck: ${lines.size}/80 players matched, ${unmatched} unmatched rows; maps differing: ${mapsOff.length ? mapsOff.join(', ') : 'none'}`)
console.log(`check: per-map rating (round-weighted) vs event page: mean |diff| ${(sumD / lines.size).toFixed(3)}, worst ${worst.ign} ${worst.d.toFixed(3)}`)

const STATS = ['rating', 'acs', 'kpr', 'kast', 'apr']
const MAPS = RAW.players.reduce((s, p) => s + p.maps, 0)
const FIELD = Object.fromEntries(STATS.map((k) => [k, RAW.players.reduce((s, p) => s + p[k] * p.maps, 0) / MAPS]))
const bounded = (n) => Math.max(55, Math.min(96, Math.round(n)))
const card = (p, stat) => bounded(70 + ((stat.rating * p.maps + FIELD.rating * 6) / (p.maps + 6) - 0.75) * 45)
const rarity = (r) => (r >= 84 ? 'gold' : r >= 76 ? 'silver' : 'bronze')

const SCHEMES = { 不加权: [1, 1, 1, 1], 轻度: [1, 1.25, 1.5, 2], 中度: [1, 1.5, 2, 3], 重度: [1, 2, 3, 4] }
const WATCH = ['ZmjjKK', 'CHICHOO', 'Smoggy', 'S1Mon', 'nobody', 'RieNs', 'MiniBoo', 'Wo0t', 'Derke', 'Chronicle', 'aspas', 'trexx', 'primmie', 'TenZ']
const report = { labels, schemes: {} }
for (const [name, W] of Object.entries(SCHEMES)) {
  const rows = RAW.players.map((p) => {
    const xs = lines.get(p.ign) ?? []
    const stat = Object.fromEntries(STATS.map((k) => [k, xs.length ? wmean(xs, k, (x) => x.rounds * W[x.tier]) : p[k]]))
    return { ign: p.ign, team: p.team, maps: p.maps, weighted: +stat.rating.toFixed(3), card: card(p, stat) }
  }).sort((a, b) => b.card - a.card || b.weighted - a.weighted)
  const rank = (ign) => rows.findIndex((r) => r.ign === ign) + 1
  const counts = ['gold', 'silver', 'bronze'].map((k) => rows.filter((r) => rarity(r.card) === k).length).join('/')
  console.log(`\n${name} ${JSON.stringify(W)}  金/银/铜 ${counts}`)
  console.log('  top 10:', rows.slice(0, 10).map((r) => `${r.ign}(${r.team}) ${r.card}`).join(' · '))
  console.log('  watch :', WATCH.map((n) => `${n} ${rows.find((r) => r.ign === n).card}·#${rank(n)}`).join(' · '))
  report.schemes[name] = { weights: W, rows }
}

console.log('\nround-weighted VLR rating by stage (maps):')
for (const team of ['EDG', 'TH', 'LEV', 'SEN', 'FNC']) {
  for (const p of RAW.players.filter((x) => x.team === team)) {
    const xs = lines.get(p.ign) ?? []
    const by = TIER_CN.map((_, t) => { const ys = xs.filter((x) => x.tier === t); return ys.length ? `${wmean(ys, 'rating', (x) => x.rounds).toFixed(2)}(${ys.length})` : '—' })
    console.log(`  ${team.padEnd(4)} ${p.ign.padEnd(10)} 全部 ${p.rating.toFixed(2)} | ${by.map((v, t) => `${TIER_CN[t]} ${v}`).join(' · ')}`)
  }
}
writeFileSync('analysis/seoul_stages.json', JSON.stringify(report, null, 2) + '\n')
console.log('\nSaved analysis/seoul_stages.json')
