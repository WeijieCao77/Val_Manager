/**
 * The 退役 / 首尔 / 曼谷 collection ladders (owner, 2026-10-10).
 *
 *   npx tsx scripts/check_collect_rewards.ts
 *
 * - the rewards are the ones in 上线规格.md 第四节;
 * - only that series' 普卡 count (彩卡 and other cards do not);
 * - a claim pays every mark reached, once each, and is retroactive: an
 *   account that finished 首尔 before the ladder existed takes all five;
 * - the field lives on the server (SERVER_KEYS) and survives migrate, junk cleaned;
 * - the ladder returns about 5% of what finishing the set costs in coins.
 */
import assert from 'node:assert/strict'
import {
  COLLECT_REWARDS, COLLECT_SERIES, PACKS, SERVER_KEYS, collectProgress, migrateGacha, newGacha,
} from '../src/engine/gacha'
import type { CollectSeries, GachaState } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import { BANGKOK_CARDS, PLAYER_CARDS, RETIRED_CARDS, SEOUL_CARDS } from '../src/engine/cards'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) }, key: () => null, clear: () => store.clear(), get length() { return store.size },
}
const env = { today: '2026-10-10', now: Date.parse('2026-10-10T10:00:00Z'), seed: 7 }
const give = (g: GachaState, ids: string[]) => { for (const id of ids) g.cards[id] = { id, level: 0, dupes: 0, seen: 1, got: env.today } }
const normals: Record<CollectSeries, string[]> = {
  retired: RETIRED_CARDS.filter((c) => c.rarity !== 'mythic').map((c) => c.id),
  seoul2024: SEOUL_CARDS.filter((c) => c.rarity !== 'mythic').map((c) => c.id),
  bangkok2025: BANGKOK_CARDS.filter((c) => c.rarity !== 'mythic').map((c) => c.id),
}
const mythics: Record<CollectSeries, string[]> = {
  retired: RETIRED_CARDS.filter((c) => c.rarity === 'mythic').map((c) => c.id),
  seoul2024: SEOUL_CARDS.filter((c) => c.rarity === 'mythic').map((c) => c.id),
  bangkok2025: BANGKOK_CARDS.filter((c) => c.rarity === 'mythic').map((c) => c.id),
}

// the spec
const sig = (s: CollectSeries) => COLLECT_REWARDS[s].map((r) => `${r.at}:${r.coins}:${r.pack ?? ''}×${r.count ?? (r.pack ? 1 : 0)}`).join(' ')
assert.equal(sig('seoul2024'), '0.25:1500:×0 0.5:1500:elite×1 0.75:5000:×0 0.9:0:seoul2024×2 1:10000:retired×3')
assert.equal(sig('bangkok2025'), '0.5:1500:×0 0.9:0:bangkok2025×1 1:3000:retired×1')
assert.equal(sig('retired'), '0.25:1500:×0 0.5:1500:elite×1 0.75:5000:×0 0.9:0:retired×2 1:25000:ten×1')
assert.deepEqual(normals.retired.length, 169)
assert((SERVER_KEYS as readonly string[]).includes('collect'), 'collect is server-owned')

for (const series of COLLECT_SERIES) {
  const g = newGacha(`COL-${series}`, '审计', env.today)
  const ids = normals[series]
  // other cards and the series' 彩卡 do not move the bar
  give(g, PLAYER_CARDS.filter((c) => !c.event).slice(0, 200).map((c) => c.id))
  give(g, mythics[series])
  let p = collectProgress(g).find((x) => x.series === series)!
  assert.deepEqual([p.owned, p.total, p.ready.length], [0, ids.length, 0], `${series}: only its 普卡 count`)
  assert.equal(runAction(g, 'collect', { series }, env).ok, false)
  // one short of the first mark is short
  const first = COLLECT_REWARDS[series][0]
  const need = Math.ceil(first.at * ids.length)
  give(g, ids.slice(0, need - 1))
  assert.equal(collectProgress(g).find((x) => x.series === series)!.ready.length, 0, `${series}: one short`)
  give(g, ids.slice(0, need))
  const coins0 = g.coins
  const r1 = runAction(g, 'collect', { series }, env)
  assert(r1.ok, `${series}: first mark`)
  assert.equal(g.coins - coins0, first.coins)
  assert.equal(runAction(g, 'collect', { series }, env).ok, false, `${series}: once`)
  // the rest at once, retroactive
  give(g, ids)
  p = collectProgress(g).find((x) => x.series === series)!
  assert.equal(p.ready.length, COLLECT_REWARDS[series].length - 1)
  const before = { coins: g.coins, packs: { ...g.packs } }
  assert(runAction(g, 'collect', { series }, env).ok)
  const rest = COLLECT_REWARDS[series].slice(1)
  assert.equal(g.coins - before.coins, rest.reduce((a, r) => a + r.coins, 0))
  for (const r of rest) if (r.pack && r.pack !== 'self') {
    const want = rest.filter((x) => x.pack === r.pack).reduce((a, x) => a + (x.count ?? 1), 0)
    assert.equal((g.packs[r.pack] ?? 0) - (before.packs[r.pack] ?? 0), want, `${series}: ${r.pack}`)
  }
  assert.equal(g.collect?.[series], COLLECT_REWARDS[series].length)
  assert.equal(runAction(g, 'collect', { series }, env).ok, false, `${series}: nothing twice`)
  // survives the save; junk is cleaned
  const saved = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
  assert.equal(saved.collect?.[series], COLLECT_REWARDS[series].length)
  assert.equal(collectProgress(saved).find((x) => x.series === series)!.ready.length, 0)
  // what it gives back against what finishing costs (packs priced at their shop price)
  const worth = COLLECT_REWARDS[series].reduce((a, r) => a + r.coins + (r.pack && r.pack !== 'self' ? PACKS[r.pack].cost * (r.count ?? 1) : 0), 0)
  console.log(`ok   ${series}: ${ids.length} 张普卡，五档共值 ${worth} 金币`)
}
const junk = migrateGacha({ ...JSON.parse(JSON.stringify(newGacha('JUNK', '审计', env.today))), collect: { retired: 'x', seoul2024: 99, nope: 3 } }, 'JUNK')
assert.deepEqual(junk.collect, { seoul2024: COLLECT_REWARDS.seoul2024.length }, 'junk cleaned, overflow capped')
assert.equal(runAction(junk, 'collect', { series: 'nope' }, env).ok, false)
console.log('全部通过')
