/**
 * The slow, reproducible confirmation of balance v2 (2026-09-18).
 *
 *   SHARD=i/k npx tsx scripts/balance/confirm.ts <outdir> [scale=1]
 *   npx tsx scripts/balance/summarize.ts <outdir>
 *
 * Seeds and mixed fives here are NOT the ones the curve was fitted on
 * (probe_strength.ts: pool 0x7ea1, labels probe-train:*). Every job is a
 * fixed list of pairs and a fixed label, so a rerun reproduces the counts,
 * and the three rules play the same dice: 1 = the live curve until today,
 * 801 = the 09-18 morning recommendation 0.40d + 1.10·max(d−3,0), 2 = v2.
 * Seats alternate every series. `scale` shrinks every sample for a dry run.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { GAP_CURVES } from '../../src/engine/arena'
import { CUP_TEAMS } from '../../src/engine/cupTeams'
import { chemistry } from '../../src/engine/cards'
import { COACHES, ORDINARY, buildPool, five, pairsAt, row, run } from './lib'
import type { Five, Pair } from './lib'

GAP_CURVES[801] = (d) => 0.40 * d + 1.10 * Math.max(0, d - 3)
const RULES = [1, 801, 2]
const OUT = process.argv[2] ?? 'analysis/balance_v2/raw'
const SCALE = Number(process.argv[3] ?? 1)
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number)
mkdirSync(OUT, { recursive: true })

const pool = buildPool(0xc0f1, 70)
interface Job { section: string; name: string; bo: 3 | 5; rule: number; n: number; pairs: Pair[] }
const jobs: Job[] = []
const add = (section: string, name: string, bo: 3 | 5, n: number, pairs: Pair[], rules = RULES) => {
  if (!pairs.length) throw new Error(`${section} ${name}: 没有可用的阵容组合`)
  for (const rule of rules) jobs.push({ section, name, bo, rule, n: Math.max(200, Math.round(n * SCALE)), pairs })
}

// A — the four targets, BO5, 20,000 each, every rule
const KEY = [2, 3, 5, 10]
const REST = [0, 1, 4, 6, 8, 12, 15, 20, 21]
const at = (gap: number, tol = 0.12, want = 200) => pairsAt(pool, gap === 0 ? 0.06 : gap, gap === 0 ? 0.06 : tol, want, 1000 + Math.round(gap * 10))
for (const g of KEY) add('bo5-key', `+${g}`, 5, 20000, at(g))
// B — the rest of the BO5 curve
for (const g of REST) add('bo5-rest', `+${g}`, 5, 5000, at(g))
// C — the BO3 table, measured on its own, same curve
for (const g of [...KEY, ...REST].sort((a, b) => a - b)) add('bo3', `+${g}`, 3, 6000, at(g))
// D — either side of the old knee and the targets: the formula is continuous by
// construction (check_balance_v2 proves it); this shows the engine has no step there
for (const g of [1.9, 2, 2.1, 2.9, 3, 3.1, 4.9, 5, 5.1]) add('edges', `+${g.toFixed(1)}`, 5, 8000, pairsAt(pool, g, 0.04, 200, 77 + Math.round(g * 10)), [2])

// E — the group's cases, on PRX's own five
const prx = CUP_TEAMS.find((t) => t.tag === 'PRX')!
const prxAt = (key: string, lv: number, coachLv: number, only?: number): Five => {
  const levels: Record<string, number> = {}
  prx.squad.slots.forEach((id, i) => { if (id) levels[id] = only === undefined || only === i ? lv : 0 })
  if (prx.squad.coach) levels[prx.squad.coach] = coachLv
  return five(key, 'club', prx.squad, levels)
}
const base = prxAt('PRX+0', 0, 0)
const versus = (hi: Five, lo: Five = base): Pair[] => [{ hi, lo, gap: hi.score - lo.score }]
for (const bo of [3, 5] as const) {
  add('cases', 'PRX 全员+3 对 +0', bo, 5000, versus(prxAt('PRX+3', 3, 0)))
  add('cases', 'PRX 全员+5 对 +0', bo, 5000, versus(prxAt('PRX+5', 5, 0)))
  add('cases', 'PRX 单张+1 对 +0', bo, 5000, versus(prxAt('PRX one+1', 1, 0, 0)))
  add('cases', 'PRX 单张+5 对 +0', bo, 5000, versus(prxAt('PRX one+5', 5, 0, 0)))
  add('cases', 'PRX 只教练+5 对 +0', bo, 5000, versus(prxAt('PRX coach+5', 0, 5)))
  add('cases', 'PRX 全员及教练+3 对 +0', bo, 5000, versus(prxAt('PRX all+3', 3, 3)))
  // the same five on both seats: the only honest 50%
  add('cases', '同一套阵容对自己（座位对称）', bo, 5000, CUP_TEAMS.slice(0, 40).map((t) => {
    const f = five(`mirror:${t.tag}`, 'club', t.squad, {})
    return { hi: f, lo: f, gap: 0 }
  }))
}

// F — 默契: a club five against mixed fives, everything else held still.
// No coach on either side, every card +0, every man in a role he covers, a
// caller on both — what is left is ability and 默契.
{
  const bare = buildPool(0xc4e3, 400).filter((f) => f.kind !== 'club')
    .map((f) => five(f.key, f.kind, { slots: f.squad.slots, coach: null }, {}))
  const clubs = CUP_TEAMS.map((t) => five(`club:${t.tag}`, 'club', { slots: t.squad.slots, coach: null }, {}))
    // a club five with nobody flagged as caller pays three points for it; leave those out
    .filter((f) => !chemistry(f.squad).noIgl && !chemistry(f.squad).misfits.length)
  for (const kind of ['nation', 'region', 'cross', 'mythic'] as const) {
    const mixed = bare.filter((f) => f.kind === kind)
    // 1: ability alike (mean within 0.3), 默契 at least 20 apart — the gap is the 默契
    const alike: Pair[] = []
    // 2: final score alike (within 0.15) where the mixed five has the better cards and the worse 默契
    const level: Pair[] = []
    for (const c of clubs) for (const m of mixed) {
      if (c.chem - m.chem < 20) continue
      if (Math.abs(c.mean - m.mean) <= 0.3) alike.push({ hi: c, lo: m, gap: c.score - m.score })
      if (Math.abs(c.score - m.score) <= 0.15 && m.mean - c.mean >= 1.5) {
        // "hi" is the club five: a rate above 50% would be a hidden bonus for being a club
        level.push({ hi: c, lo: m, gap: c.score - m.score })
      }
    }
    const take = (ps: Pair[]) => ps.sort((a, b) => a.hi.key.localeCompare(b.hi.key) || a.lo.key.localeCompare(b.lo.key))
      .filter((_, i, all) => i % Math.max(1, Math.floor(all.length / 150)) === 0).slice(0, 150)
    for (const bo of [3, 5] as const) {
      add('chem-ability-alike', `整编 对 ${kind}`, bo, 5000, take(alike), [1, 2])
      add('chem-score-alike', `整编 对 ${kind}`, bo, 5000, take(level), [1, 2])
    }
  }
}
void COACHES; void ORDINARY

const mine = jobs.map((j, i) => ({ j, i })).filter(({ i }) => i % shards === shard)
console.log(`${jobs.length} jobs, ${jobs.reduce((s, j) => s + j.n, 0)} series; this shard ${mine.length}`)
if (process.env.DRY) {
  const seen = new Set<string>()
  for (const j of jobs) {
    const k = `${j.section} ${j.name} BO${j.bo}`
    if (seen.has(k)) continue
    seen.add(k)
    const gaps = j.pairs.map((p) => p.gap)
    console.log(`${k.padEnd(44)} n=${j.n} pairs=${j.pairs.length} gap ${(gaps.reduce((s, g) => s + g, 0) / gaps.length).toFixed(2)} [${Math.min(...gaps).toFixed(2)}, ${Math.max(...gaps).toFixed(2)}]`)
  }
  process.exit(0)
}
const done: unknown[] = []
for (const { j, i } of mine) {
  const t0 = Date.now()
  const t = run(j.pairs, j.bo, j.n, `confirm:${j.section}:${j.name}`, j.rule)
  const gaps = j.pairs.map((p) => p.gap)
  const rec = {
    job: i, section: j.section, name: j.name, bo: j.bo, rule: j.rule, pairs: j.pairs.length,
    gapMean: gaps.reduce((s, g) => s + g, 0) / gaps.length, gapMin: Math.min(...gaps), gapMax: Math.max(...gaps),
    chemGap: j.pairs.reduce((s, p) => s + p.hi.chem - p.lo.chem, 0) / j.pairs.length,
    meanGap: j.pairs.reduce((s, p) => s + p.hi.mean - p.lo.mean, 0) / j.pairs.length,
    ...row(t), seatA: t.seatA / t.n,
  }
  done.push(rec)
  console.log(`${j.section} ${j.name} BO${j.bo} rule ${j.rule}: ${(rec.rate * 100).toFixed(1)}% of ${j.n} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
  writeFileSync(`${OUT}/confirm_${shard}.json`, JSON.stringify(done, null, 1))
}
