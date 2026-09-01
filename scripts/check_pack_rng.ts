/**
 * Consecutive packs must not replay each other.
 *
 *   npx tsx scripts/check_pack_rng.ts [accounts]
 *
 * 「还有十连卡的爆率是不是有点问题，开了两个十连卡包好像有九张卡都一样……」
 *
 * They were right, and the shape of it is why nobody could prove it: WITHIN a
 * ten-pack the draws were fine (0.09 duplicates in ten), so any single pack
 * looked normal. Across two packs, 7.2 of the 20 cards repeated.
 *
 * The account's rng seed was written back after ONE burn, before the caller
 * had drawn anything — so the next pack started one step behind where this one
 * started and walked almost the same sequence, offset by a single draw. Every
 * pack type was affected; the ten-pack is simply where ten cards at a time
 * made it visible.
 *
 * The bar here is arithmetic rather than a guess: drawing k cards from a pool
 * of n with replacement, the expected number of repeats is k − n(1 − (1−1/n)^k).
 * Two ten-packs draw about 20 cards from pools of 91 / 169 / 258, which is
 * under one repeat. Anything near seven is the bug coming back.
 */
import { newGacha, openPack, PACKS, PACK_ORDER } from '../src/engine/gacha'
import type { PackKind } from '../src/engine/gacha'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  if (!ok) { bad++; console.log(`FAIL ${what}${detail ? `  ${detail}` : ''}`) }
}

const N = Number(process.argv[2] ?? 1500)
console.log(`每种包各开 ${N} 组（每组连开两包）\n`)
console.log('包         每包张数   包内重复   连开两包重复   独立抽卡应有')

for (const kind of PACK_ORDER) {
  const def = PACKS[kind]
  let within = 0
  let pair = 0
  let worstPair = 0
  for (let i = 0; i < N; i++) {
    const g = newGacha(`VM-${kind}-${i}`, '审计', '2026-09-01')
    g.coins = 1e9
    g.packs[kind] = 2
    const a = openPack(g, kind, 'pack').map((p) => p.card.id)
    const b = openPack(g, kind, 'pack').map((p) => p.card.id)
    within += a.length - new Set(a).size
    const both = [...a, ...b]
    const d = both.length - new Set(both).size
    pair += d
    worstPair = Math.max(worstPair, d)
  }
  const perPair = pair / N
  // the smallest pool a pack can draw from is the one it collides in most
  const smallest = kind === 'coach' ? 22 : 91
  const k = def.draws * 2
  const expected = k - smallest * (1 - (1 - 1 / smallest) ** k)
  console.log(
    `${def.name.padEnd(8)}  ${String(def.draws).padStart(6)}  `
    + `${(within / N).toFixed(3).padStart(9)}  ${perPair.toFixed(2).padStart(11)}  `
    + `${expected.toFixed(2).padStart(11)}（最差 ${worstPair}）`,
  )
  // Generous: three times the worst-case independent expectation. The bug sat
  // at twenty times it, so this catches a regression without failing on a run
  // of bad luck.
  check(perPair < expected * 3 + 0.5, `${def.name}：连开两包不该有这么多重复`,
    `${perPair.toFixed(2)} 张，独立抽卡约 ${expected.toFixed(2)} 张`)
}

// ---- the seed must move past everything a pack drew --------------------
{
  const g = newGacha('VM-SEED', '审计', '2026-09-01')
  g.coins = 1e9
  g.packs.ten = 1
  const before = g.seed
  openPack(g, 'ten', 'pack')
  const after = g.seed
  check(before !== after, '开完包之后 seed 变了')

  // two accounts on the same seed must diverge after the first pack, not walk
  // the same path one step apart
  const mk = () => {
    const x = newGacha('VM-SAME', '审计', '2026-09-01')
    x.coins = 1e9; x.packs.ten = 3
    return x
  }
  const p = mk()
  const q = mk()
  check(p.seed === q.seed, '两个同种子账号起点一致')
  const p1 = openPack(p, 'ten', 'pack').map((c) => c.card.id).join()
  const q1 = openPack(q, 'ten', 'pack').map((c) => c.card.id).join()
  check(p1 === q1, '同种子第一包完全一样——这是确定性，不是 bug')
  const p2 = openPack(p, 'ten', 'pack').map((c) => c.card.id)
  const p3 = openPack(p, 'ten', 'pack').map((c) => c.card.id)
  const overlap = p2.filter((x) => p3.includes(x)).length
  check(overlap <= 3, '同一个账号连着开的两包不该几乎一样', `重了 ${overlap} 张`)
}

// ---- and a pack cannot be re-rolled by reloading -----------------------
{
  const g = newGacha('VM-RELOAD', '审计', '2026-09-01')
  g.coins = 1e9
  g.packs.ten = 2
  const snapshot = g.seed
  const first = openPack(g, 'ten', 'pack').map((c) => c.card.id).join()
  // a tab that died mid-pack reloads from the seed the burn already wrote
  const reloaded = newGacha('VM-RELOAD', '审计', '2026-09-01')
  reloaded.coins = 1e9; reloaded.packs.ten = 1; reloaded.seed = snapshot
  const again = openPack(reloaded, 'ten', 'pack').map((c) => c.card.id).join()
  check(first === again, '同一个 seed 开出同一包（确定性还在）')
}

console.log(bad ? `\n${bad} 项不通过` : '\n全部通过')
process.exit(bad ? 1 : 0)
