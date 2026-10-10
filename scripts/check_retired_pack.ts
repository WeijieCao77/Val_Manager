/**
 * The 退役 series and its pack (owner, 2026-10-10).
 *
 *   npx tsx scripts/check_retired_pack.ts [packs]
 *
 * - the 退役选手包 deals only retired cards, and its 彩卡 only the retired eight;
 * - its 彩卡 floor is its own (RETIRED_FLOOR = 600): it never moves or spends the
 *   shared MYTHIC_FLOOR counter, and no other pack moves its counter;
 * - no other pack deals a retired card; the 全图鉴 does not count them;
 * - ids are unique, a 彩卡 is the same person as his 普卡 (personOf);
 * - how many packs a full set takes: ~320 at 16% gold (all three metals are
 *   bottlenecks of similar size with 169 cards, so the gold rate barely moves it).
 */
import {
  FULL_SET_CARDS, MYTHIC_FLOOR, PACKS, PACK_ORDER, RETIRED_FLOOR, newGacha, openPack, packCost,
} from '../src/engine/gacha'
import type { PackKind } from '../src/engine/gacha'
import { ALL_CARDS, RETIRED_CARDS, personOf } from '../src/engine/cards'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) }, key: () => null, clear: () => store.clear(), get length() { return store.size },
}
let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  ${detail}` : ''}`)
  if (!ok) bad++
}
const N = Number(process.argv[2] ?? 20000)

const retiredIds = new Set(RETIRED_CARDS.map((c) => c.id))
const legends = RETIRED_CARDS.filter((c) => c.rarity === 'mythic')
check(RETIRED_CARDS.length === 177 && legends.length === 8, '退役卡 169 张普卡 + 8 张彩卡', `${RETIRED_CARDS.length - legends.length} + ${legends.length}`)
check(new Set(ALL_CARDS.map((c) => c.id)).size === ALL_CARDS.length, '卡号不重复')
check(RETIRED_CARDS.every((c) => c.event === 'retired' && c.retired === true), '每张退役卡都标了系列和退役')
const byPerson = new Map(RETIRED_CARDS.filter((c) => c.rarity !== 'mythic').map((c) => [personOf(c), c]))
check(legends.every((l) => byPerson.has(personOf(l))), '彩卡和本人普卡是同一个人')
check(![...FULL_SET_CARDS].some((id) => retiredIds.has(id)), '全图鉴不算退役卡')

// the retired pack
const g = newGacha('RETIRED', '审计', '2026-10-10')
g.coins = Number.MAX_SAFE_INTEGER
g.mythicDry = 777
let others = 0, mythics = 0, maxDry = 0, golds = 0, draws = 0
for (let i = 0; i < N; i++) {
  for (const p of openPack(g, 'retired', 'coins')) {
    draws++
    if (!retiredIds.has(p.card.id)) others++
    if (p.card.rarity === 'mythic') mythics++
    if (p.card.rarity === 'gold') golds++
  }
  maxDry = Math.max(maxDry, g.retiredDry ?? 0)
}
check(others === 0, '退役包只出退役卡', `${others} 张不是`)
check(maxDry <= RETIRED_FLOOR, `连续 ${RETIRED_FLOOR} 抽没出彩卡，下一抽必出`, `最长 ${maxDry} 抽没出`)
check(g.mythicDry === 777, '退役包不动现役彩卡保底', `${g.mythicDry}`)
console.log(`     ${N} 包：彩卡 ${mythics} 张（每 ${Math.round(draws / Math.max(1, mythics))} 抽一张），金卡率 ${(golds / draws * 100).toFixed(1)}%`)

// every other pack: never a retired card, never the retired counter
const h = newGacha('OTHERS', '审计', '2026-10-10')
h.coins = Number.MAX_SAFE_INTEGER
h.retiredDry = 123
let leaked = 0
for (const kind of PACK_ORDER.filter((k) => k !== 'retired') as PackKind[]) {
  for (let i = 0; i < 2000; i++) {
    h.packs[kind] = 1
    for (const p of openPack(h, kind, 'pack')) if (retiredIds.has(p.card.id)) leaked++
  }
}
check(leaked === 0, '其他卡包抽不到退役卡', `${leaked}`)
check(h.retiredDry === 123, '其他卡包不动退役彩卡保底', `${h.retiredDry}`)
check(PACKS.retired.cost === 3000 && PACKS.retired.gold === 0.16 && PACKS.retired.mythic === 0.0004 && MYTHIC_FLOOR === 1200,
  '出率按站长定的：3000 金币、金 16%、彩卡每抽 0.04%，现役保底仍 1200')

// the launch week (owner, 2026-10-10): China-time 10-11 is day one, days 1–3 85折, 4–7 9折
const prices = ['2026-10-10', '2026-10-11', '2026-10-13', '2026-10-14', '2026-10-17', '2026-10-18'].map((d) => packCost('retired', d))
check(prices.join() === '3000,2550,2550,2700,2700,3000', '上线 3 天 85 折、第 4–7 天 9 折、第 8 天恢复原价', prices.join(' / '))
const s = newGacha('SALE', '审计', '2026-10-11')
s.coins = 2550
let paid = true
try { openPack(s, 'retired', 'coins', '2026-10-11') } catch { paid = false }
check(paid && s.coins === 0, '实际扣的是折后价', String(s.coins))

// how long a full set takes (普卡 only, like the region bars)
const normals = new Set(RETIRED_CARDS.filter((c) => c.rarity !== 'mythic').map((c) => c.id))
const runs: number[] = []
for (let r = 0; r < 60; r++) {
  const k = newGacha(`SET${r}`, '审计', '2026-10-10')
  k.coins = Number.MAX_SAFE_INTEGER
  const have = new Set<string>()
  let packs = 0
  while (have.size < normals.size && packs < 3000) {
    packs++
    for (const p of openPack(k, 'retired', 'coins')) if (normals.has(p.card.id)) have.add(p.card.id)
  }
  runs.push(packs)
}
runs.sort((a, b) => a - b)
const median = runs[runs.length >> 1]
check(median > 200 && median < 400, '收齐 169 张普卡约 320 包（卡池是首尔的两倍多，金卡率高低影响不大）', `中位数 ${median} 包`)

if (bad) { console.log(`${bad} failed`); process.exit(1) }
console.log('全部通过')
