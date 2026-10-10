/**
 * The 十连包's guaranteed gold is the pack's promise, not a pull: it must not
 * reset the gold pity (owner, 2026-10-10).
 *
 *   npx tsx scripts/check_ten_floor_pity.ts
 *
 * A natural gold resets the counter, so a ten pack whose only gold is the
 * floor's shows the counter moving on by all ten draws; under the old rule it
 * fell to 0. The hard pity must still fire, so the counter never reaches it.
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

const g = newGacha('TENFLOOR', '审计', '2026-10-10')
let floorOnly = 0, floorKept = 0, overflow = 0, maxPity = 0
for (let i = 0; i < 20000; i++) {
  const before = g.pity
  g.packs.ten = 1
  const out = openPack(g, 'ten', 'pack')
  const golds = out.filter((p) => p.card.rarity === 'gold').length
  const mythics = out.filter((p) => p.card.rarity === 'mythic').length
  if (g.pity > before + 10) overflow++
  maxPity = Math.max(maxPity, g.pity)
  // one gold and the counter still went up by ten: that gold was the floor's
  if (golds === 1 && mythics === 0 && g.pity === before + 10) floorKept++
  if (golds === 1 && mythics === 0) floorOnly++
}
check(floorKept > 0, '十连包补出来的金卡不清空金卡保底', `${floorKept} 包（单金卡的包共 ${floorOnly}）`)
check(overflow === 0, '一包最多推进 10 抽保底')
check(maxPity < HARD_PITY, `第 ${HARD_PITY} 抽必出金卡照常生效`, `最高 ${maxPity}`)
if (bad) { console.log(`${bad} failed`); process.exit(1) }
console.log('全部通过')
