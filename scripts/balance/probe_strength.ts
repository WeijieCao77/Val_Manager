/**
 * Step one of the calibration: what does a round-strength gap E win?
 *
 *   npx tsx scripts/balance/probe_strength.ts [perPoint=4000] [out.json]
 *
 * In a card match the round strength is the ONLY thing the curve changes, so
 * P(win | E) is one curve per format, whoever the ten men are. It is measured
 * here on real fives through the real entry point, with a probe "curve" that
 * returns a constant E. TRAINING seeds: nothing in this file is evidence that
 * a target was met — scripts/balance/confirm.ts is, on seeds this never saw.
 */
import { writeFileSync } from 'node:fs'
import { GAP_CURVES } from '../../src/engine/arena'
import { buildPool, pairsAt, run, row, pct } from './lib'

const N = Number(process.argv[2] ?? 4000)
const OUT = process.argv[3]
const pool = buildPool(0x7ea1)
// any pairs with a real gap; the probe ignores its size
const pairs = [...pairsAt(pool, 3, 2.5, 150, 11), ...pairsAt(pool, 9, 3, 150, 12)]
const GRID = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10, 12, 14, 17, 20, 25]
const t0 = Date.now()
const out: Record<string, unknown>[] = []
console.log('E      BO3            BO5')
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number)
GRID.forEach((E, i) => {
  if (i % shards !== shard) return
  GAP_CURVES[900 + i] = () => E
  const b3 = row(run(pairs, 3, N, `probe-train:${E}`, 900 + i))
  const b5 = row(run(pairs, 5, N, `probe-train:${E}`, 900 + i))
  out.push({ E, bo3: b3, bo5: b5 })
  console.log(`${String(E).padEnd(5)}  ${pct(b3.rate)} ±${pct((b3.hi - b3.lo) / 2)}   ${pct(b5.rate)} ±${pct((b5.hi - b5.lo) / 2)}`)
})
console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s, ${N} series per cell, ${pairs.length} pairs`)
if (OUT) writeFileSync(OUT, JSON.stringify({ perPoint: N, pairs: pairs.length, grid: out }, null, 1))
