/**
 * What the open ladder asks of a five, division by division.
 *
 *   npx tsx scripts/measure_ladder_experience.ts [matches per cell]
 *
 * Club opponents only (青铜–铂金 always, and 钻石+ when the pool has no rival).
 */
import { ladderPool, DIVISIONS } from '../src/engine/gacha'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import { WORLD_TEAMS } from '../src/engine/teams'
import { squadRating } from '../src/engine/cards'
import { playArenaMatch } from '../src/engine/arena'

const N = Number(process.argv[2] ?? 200)
const sorted = CUP_TEAMS.slice().sort((a, b) => a.rating - b.rating)
const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
for (let d = 0; d < DIVISIONS.length; d++) {
  const pool = ladderPool(d).map((id) => WORLD_TEAMS.find((t) => t.id === id)!.rating)
  console.log(`${DIVISIONS[d]} 对手池: ${Math.min(...pool)}–${Math.max(...pool)}（${pool.length} 队）`)
}
for (const q of [0, 0.25, 0.5, 0.75, 0.999]) {
  const me = at(q)
  const cells: string[] = []
  for (let d = 0; d < DIVISIONS.length; d++) {
    const pool = ladderPool(d)
    let w = 0
    for (let i = 0; i < N; i++) if (playArenaMatch(me.squad, () => 0, pool[i % pool.length], 3, 9000 + i * 17 + d).win) w++
    cells.push(`${DIVISIONS[d]} ${(100 * w / N).toFixed(0)}%`)
  }
  console.log(`阵容 ${squadRating(me.squad)}: ${cells.join('  ')}`)
}
