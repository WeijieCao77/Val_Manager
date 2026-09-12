/**
 * The 彩卡包 and the 全图鉴 reward (2026-09-12).
 *
 *   npx tsx scripts/check_fullset.ts
 *
 * A 彩卡包 deals one 彩卡 every time, reaches every legend in the game,
 * and never touches the pity counters that the lotteries share. The
 * reward for the full 图鉴 — every card that is not a 彩卡 — is one of
 * them, once.
 */
import assert from 'node:assert/strict'
import {
  PACKS, PACK_ORDER, MYTHIC_FLOOR, HARD_PITY, newGacha, openPack, migrateGacha,
  fullSetProgress, claimFullSet, FULL_SET_CARDS, SERVER_KEYS,
} from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import { ALL_CARDS, LEGEND_CARDS, LEGEND_COACH_CARDS } from '../src/engine/cards'

const def = PACKS.legend
assert.equal(def.mythic, 1)
assert.equal(def.shop, false)
assert.equal(def.draws, 1)
assert(!PACK_ORDER.includes('legend'), 'the 彩卡包 is not on the shelf by default')

// deals only 彩卡, reaches all of them, and leaves the pity alone
const g = newGacha('FULLSET', '审计', '2026-09-12')
g.pity = 17; g.mythicDry = 900
const seen = new Set<string>()
for (let i = 0; i < 600; i++) {
  g.packs.legend = 1
  const out = openPack(g, 'legend', 'pack')
  assert.equal(out.length, 1)
  assert.equal(out[0].card.rarity, 'mythic', '彩卡包 dealt something other than a 彩卡')
  seen.add(out[0].card.id)
}
assert.equal(seen.size, LEGEND_CARDS.length + LEGEND_COACH_CARDS.length, 'every 彩卡 is reachable')
assert.equal(g.pity, 17, '彩卡包 moved the gold pity')
assert.equal(g.mythicDry, 900, '彩卡包 moved the 彩卡 floor')
assert.equal(g.packs.legend, 0)
assert.throws(() => openPack(g, 'legend', 'coins'), /买不到/)
assert.throws(() => openPack(g, 'legend', 'pack'), /没有这种卡包/)
// and a lottery still pays the floor after it
g.mythicDry = MYTHIC_FLOOR; g.pity = HARD_PITY
g.coins = 1e6
assert(openPack(g, 'scout', 'coins').some((p) => p.card.rarity === 'mythic'))
assert.equal(g.mythicDry, 0)

// the full set
const h = newGacha('FULLSET2', '审计', '2026-09-12')
assert.equal(FULL_SET_CARDS.size, ALL_CARDS.filter((c) => c.rarity !== 'mythic').length)
assert(!FULL_SET_CARDS.has(LEGEND_CARDS[0].id))
let p = fullSetProgress(h)
assert.deepEqual([p.owned, p.total, p.ready, p.claimed], [0, FULL_SET_CARDS.size, false, false])
assert.equal(claimFullSet(h), null)
// one short is still short
for (const id of [...FULL_SET_CARDS].slice(1)) h.cards[id] = { id, level: 0, dupes: 0, seen: 1, got: '2026-09-12' }
p = fullSetProgress(h)
assert.equal(p.owned, p.total - 1)
assert(!p.ready)
const env = { today: '2026-09-12', now: Date.parse('2026-09-12T10:00:00Z'), seed: 7 }
assert.equal(runAction(h, 'fullset', {}, env).ok, false)
// the last card
const last = [...FULL_SET_CARDS][0]
h.cards[last] = { id: last, level: 0, dupes: 0, seen: 1, got: '2026-09-12' }
p = fullSetProgress(h)
assert(p.ready && !p.claimed)
// a legend on top changes nothing about the count
h.cards[LEGEND_CARDS[0].id] = { id: LEGEND_CARDS[0].id, level: 0, dupes: 0, seen: 1, got: '2026-09-12' }
assert.equal(fullSetProgress(h).owned, FULL_SET_CARDS.size)
const r = runAction(h, 'fullset', {}, env)
assert(r.ok && (r.result as { got: string }).got.includes('彩卡包'))
assert.equal(h.packs.legend, 1)
assert.equal(h.fullSet, 1)
p = fullSetProgress(h)
assert(p.claimed && !p.ready)
assert.equal(runAction(h, 'fullset', {}, env).ok, false, 'once, ever')
assert.equal(h.packs.legend, 1)
assert(h.log.some((l) => l.text.includes('全图鉴')))
// survives the save
assert((SERVER_KEYS as readonly string[]).includes('fullSet'))
const saved = migrateGacha(JSON.parse(JSON.stringify(h)), h.id)
assert.equal(saved.fullSet, 1)
assert.equal(saved.packs.legend, 1)
const junk = migrateGacha({ ...JSON.parse(JSON.stringify(h)), fullSet: 'yes' }, h.id)
assert.equal(junk.fullSet, undefined)
console.log(`彩卡包 deals ${seen.size} 彩卡, 全图鉴 is ${FULL_SET_CARDS.size} cards — all good`)
