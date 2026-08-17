/** Per-year, per-tier profiles — the shape a flat career average hides. */
import { readFileSync } from 'node:fs'

const c = JSON.parse(readFileSync('scripts/cache/vlr_seasons.json', 'utf8'))
const events: Record<string, { year: number; tier: string; slug: string }> = c.events
const stats: Record<string, any[]> = c.stats

type Cell = { rnd: number; r: number; acs: number }
const acc = new Map<string, Map<string, Cell>>()

for (const [eid, rows] of Object.entries(stats)) {
  const ev = events[eid]
  if (!ev) continue
  for (const row of rows) {
    if (!row.rnd || row.rating2 == null) continue
    for (const key of [`${ev.year}`, `tier:${ev.tier}`, 'all']) {
      if (!acc.has(row.ign)) acc.set(row.ign, new Map())
      const m = acc.get(row.ign)!
      const cur = m.get(key) ?? { rnd: 0, r: 0, acs: 0 }
      cur.rnd += row.rnd
      cur.r += row.rating2 * row.rnd
      cur.acs += (row.acs ?? 0) * row.rnd
      m.set(key, cur)
    }
  }
}

const show = (ign: string) => {
  const m = acc.get(ign)
  if (!m) { console.log(`${ign}: 没有数据`); return }
  const get = (k: string) => {
    const v = m.get(k)
    return v && v.rnd ? `R ${(v.r / v.rnd).toFixed(2)} ACS ${(v.acs / v.rnd).toFixed(0)} (${v.rnd}回合)` : '—'
  }
  console.log(`\n${ign}`)
  for (const y of ['2024', '2025', '2026']) console.log(`   ${y}  ${get(y)}`)
  console.log(`   国际赛 Champions ${get('tier:champions')}`)
  console.log(`          Masters   ${get('tier:masters')}`)
  console.log(`   赛区联赛         ${get('tier:league')}`)
}

for (const n of process.argv.slice(2)) show(n)
console.log(`\n覆盖选手数 ${acc.size}`)
