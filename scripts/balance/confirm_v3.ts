/**
 * The confirmation of balance v3 (2026-09-20), on seeds and fives the fit never saw.
 *
 *   SHARD=i/k npx tsx scripts/balance/confirm_v3.ts [outdir] [n=6000]
 *
 * v3 was fitted to BO3 targets on the v2 probe table (pool 0x7ea1, labels
 * probe-train:*). This plays the real engine on another pool with other
 * labels, v2 beside v3 on the same dice, BO3 and BO5, and the cases the
 * group asks about: a full five at +5 and a coach at +5.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { CUP_TEAMS } from '../../src/engine/cupTeams'
import { buildPool, five, pairsAt, row, run } from './lib'
import type { Five, Pair } from './lib'

const OUT = process.argv[2] ?? 'analysis/balance_v3/raw'
const N = Number(process.argv[3] ?? 6000)
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number)
mkdirSync(OUT, { recursive: true })

const pool = buildPool(0xd3a7, 70)
interface Job { name: string; bo: 3 | 5; rule: number; pairs: Pair[] }
const jobs: Job[] = []
const add = (name: string, pairs: Pair[]) => {
  if (!pairs.length) throw new Error(`${name}: 没有可用的阵容组合`)
  for (const bo of [3, 5] as const) for (const rule of [2, 3]) jobs.push({ name, bo, rule, pairs })
}
for (const g of [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15]) {
  add(`+${g}`, pairsAt(pool, g === 0 ? 0.06 : g, g === 0 ? 0.06 : 0.12, 200, 3000 + g * 10))
}
const prx = CUP_TEAMS.find((t) => t.tag === 'PRX')!
const prxAt = (key: string, lv: number, coachLv: number): Five => {
  const levels: Record<string, number> = {}
  prx.squad.slots.forEach((id) => { if (id) levels[id] = lv })
  if (prx.squad.coach) levels[prx.squad.coach] = coachLv
  return five(key, 'club', prx.squad, levels)
}
const base = prxAt('PRX+0', 0, 0)
const versus = (hi: Five): Pair[] => [{ hi, lo: base, gap: hi.score - base.score }]
add('PRX 全员+5 对 +0', versus(prxAt('PRX+5', 5, 0)))
add('PRX 只教练+5 对 +0', versus(prxAt('PRX coach+5', 0, 5)))
add('PRX 全员及教练+5 对 +0', versus(prxAt('PRX all+5', 5, 5)))

const done: unknown[] = []
jobs.forEach((j, i) => {
  if (i % shards !== shard) return
  const t = run(j.pairs, j.bo, N, `confirm-v3:${j.name}`, j.rule)
  const gaps = j.pairs.map((p) => p.gap)
  const rec = { job: i, name: j.name, bo: j.bo, rule: j.rule, pairs: j.pairs.length,
    gapMean: gaps.reduce((s, g) => s + g, 0) / gaps.length, ...row(t), seatA: t.seatA / t.n }
  done.push(rec)
  console.log(`${j.name} BO${j.bo} v${j.rule}: ${(rec.rate * 100).toFixed(1)}% of ${N}`)
  writeFileSync(`${OUT}/confirm_${shard}.json`, JSON.stringify(done, null, 1))
})
