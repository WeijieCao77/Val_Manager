/**
 * A 十连包's promised gold is the pack's, not the pity's (owner, 2026-10-10,
 * 2026-10-13 「十连包不占金卡保底」): its first gold — rolled or put in by the
 * floor — leaves the gold pity counting. A second gold, the 45th-draw gold and
 * a彩卡 reset it as ever.
 *
 *   npx tsx scripts/check_ten_floor_pity.ts
 *
 * Under the 10-10 rule only the floor's gold was spared, and at 6% a draw the
 * roll usually comes first: from 20 pity, three single-gold packs in four still
 * fell to 0.
 */
import { HARD_PITY, newGacha, openPack } from '../src/engine/gacha'

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

const g = newGacha('TENFLOOR', '审计', '2026-10-13')
// from 20 the pack runs into soft pity but can never reach the 45th draw
let single = 0, singleKept = 0, multi = 0, multiReset = 0
for (let i = 0; i < 20000; i++) {
  g.pity = 20
  g.packs.ten = 1
  const out = openPack(g, 'ten', 'pack')
  if (out.some((p) => p.card.rarity === 'mythic')) continue
  const golds = out.filter((p) => p.card.rarity === 'gold').length
  if (golds === 1) { single++; if (g.pity === 30) singleKept++ }
  if (golds >= 2) { multi++; if (g.pity < 30) multiReset++ }
}
check(single > 0 && singleKept === single, '十连包只出一张金卡时金卡保底不清空（抽到的、补的都一样）', `${singleKept}/${single}`)
check(multi > 0 && multiReset === multi, '十连包第二张金卡照常清空金卡保底', `${multiReset}/${multi}`)

// the 45th draw is the pity paying out, ten pack or not
let hard = 0, hardReset = 0, maxPity = 0
for (let i = 0; i < 5000; i++) {
  g.pity = HARD_PITY - 3
  g.packs.ten = 1
  const out = openPack(g, 'ten', 'pack')
  maxPity = Math.max(maxPity, g.pity)
  if (out.some((p) => p.card.rarity === 'mythic')) continue
  hard++
  if (g.pity < 10) hardReset++
}
check(hardReset === hard, `第 ${HARD_PITY} 抽必出的金卡照常清空金卡保底`, `${hardReset}/${hard}`)
check(maxPity < HARD_PITY, `金卡保底不会越过第 ${HARD_PITY} 抽`, `最高 ${maxPity}`)

// other packs: every gold resets, as before
let scoutGold = 0, scoutKept = 0
for (let i = 0; i < 20000; i++) {
  g.pity = 20
  g.packs.scout = 1
  const out = openPack(g, 'scout', 'pack')
  if (out.some((p) => p.card.rarity === 'gold') && !out.some((p) => p.card.rarity === 'mythic')) {
    scoutGold++
    if (g.pity >= 21) scoutKept++
  }
}
check(scoutGold > 0 && scoutKept === 0, '别的包抽到金卡照常清空金卡保底', `${scoutGold} 包`)
if (bad) { console.log(`${bad} failed`); process.exit(1) }
console.log('全部通过')
