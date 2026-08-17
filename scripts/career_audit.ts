/** Sanity-check the career scrape before anything is derived from it. */
import { readFileSync } from 'node:fs'

type Line = {
  R?: number; acs?: number; kd?: number; kast?: number; adr?: number
  kpr?: number; apr?: number; fkpr?: number; fdpr?: number; rnd?: number
  miss?: boolean; agents?: string[]
}

const cache: Record<string, Line> = JSON.parse(
  readFileSync('scripts/cache/vlr_career.json', 'utf8'),
)
const world = JSON.parse(readFileSync('src/data/world.json', 'utf8'))

const rows = Object.entries(cache).filter(([k, v]) => !k.startsWith('_') && !v.miss)
console.log(`已抓 ${rows.length} 人\n`)

// 1. every value inside a plausible band for professional VALORANT
const BANDS: [keyof Line, number, number][] = [
  ['R', 0.4, 1.9], ['acs', 90, 330], ['kd', 0.3, 2.2], ['kast', 0.45, 0.92],
  ['adr', 55, 220], ['kpr', 0.25, 1.2], ['apr', 0.0, 0.8],
  ['fkpr', 0.0, 0.35], ['fdpr', 0.0, 0.35],
]
let bad = 0
for (const [name, l] of rows) {
  for (const [k, lo, hi] of BANDS) {
    const v = l[k] as number | undefined
    if (v == null) continue
    if (v < lo || v > hi) {
      if (bad++ < 8) console.log(`  ⚠ ${name}: ${k} = ${v}（合理区间 ${lo}~${hi}）`)
    }
  }
}
console.log(bad ? `❌ ${bad} 个越界值` : '✅ 所有数值都在职业赛合理区间内')

// 2. the columns must not be confused with each other again
const swapped = rows.filter(([, l]) => (l.R ?? 0) > 5 || (l.acs ?? 0) < 5)
console.log(swapped.length
  ? `❌ ${swapped.length} 人疑似列错位（R 或 ACS 数量级不对）`
  : '✅ 没有列错位：R 都是个位数，ACS 都是百位数')

// 3. rounds should exceed a single season for most veterans
const rnds = rows.map(([, l]) => l.rnd ?? 0).sort((a, b) => a - b)
const med = rnds[Math.floor(rnds.length / 2)]
console.log(`回合数 中位 ${med}，最少 ${rnds[0]}，最多 ${rnds[rnds.length - 1]}`)

// 4. distribution should look like the sport, not like noise
const avg = (k: keyof Line) => {
  const v = rows.map(([, l]) => l[k] as number).filter((x) => x != null)
  return (v.reduce((s, x) => s + x, 0) / v.length).toFixed(3)
}
console.log(`\n均值  R ${avg('R')}  ACS ${avg('acs')}  K/D ${avg('kd')}  ` +
  `KAST ${avg('kast')}  ADR ${avg('adr')}`)
console.log('真实 VCT 参考  R ~1.00  ACS ~200  K/D ~1.00  KAST ~0.71  ADR ~135')

// 5. career should correlate with this season for the same player
const pairs: [string, number, number][] = []
for (const p of world.players) {
  const c = cache[p.ign]
  if (!c || c.miss || !c.acs || !p.vlr?.acs) continue
  pairs.push([p.ign, p.vlr.acs, c.acs])
}
if (pairs.length > 10) {
  const mx = pairs.reduce((s, x) => s + x[1], 0) / pairs.length
  const my = pairs.reduce((s, x) => s + x[2], 0) / pairs.length
  const cov = pairs.reduce((s, x) => s + (x[1] - mx) * (x[2] - my), 0)
  const sx = Math.sqrt(pairs.reduce((s, x) => s + (x[1] - mx) ** 2, 0))
  const sy = Math.sqrt(pairs.reduce((s, x) => s + (x[2] - my) ** 2, 0))
  const r = cov / (sx * sy)
  console.log(`\nACS 2026 vs 生涯 相关系数 ${r.toFixed(3)}（${pairs.length} 人）`)
  console.log(r > 0.5 ? '✅ 强相关：同一批人，两个窗口，说得通'
    : '❌ 相关性过低，解析可能仍有问题')

  const moved = pairs
    .map(([n, a, b]) => ({ n, a, b, d: b - a }))
    .sort((x, y) => y.d - x.d)
  console.log('\n生涯明显好于今年（今年在低谷）：')
  for (const m of moved.slice(0, 5)) console.log(`  ${m.n.padEnd(11)} 今年 ${m.a.toFixed(0)} → 生涯 ${m.b.toFixed(0)}  +${m.d.toFixed(0)}`)
  console.log('今年明显好于生涯（今年在爆发）：')
  for (const m of moved.slice(-5)) console.log(`  ${m.n.padEnd(11)} 今年 ${m.a.toFixed(0)} → 生涯 ${m.b.toFixed(0)}  ${m.d.toFixed(0)}`)
}
