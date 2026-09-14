/** Invalid pack requests and damaged legacy inventory must not destroy value. */
import assert from 'node:assert/strict'
import { ALL_CARDS, COINS_FOR, DUPES_FOR, MAX_LEVEL, isPlayerCard } from '../src/engine/cards'
import {
  PACKS, collection, isPackKind, levelOf, migrateGacha, newGacha, openPack, upgradeCost,
} from '../src/engine/gacha'
import type { GachaState, PackKind } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'

const env = { now: Date.parse('2026-09-15T12:00:00Z'), today: '2026-09-15', seed: 12345 }
const fresh = () => newGacha('VM-CARD-INTEGRITY', '卡牌检查', env.today)
const value = (g: GachaState) => JSON.stringify({ coins: g.coins, cards: g.cards, packs: g.packs, pulls: g.pulls, seed: g.seed, pity: g.pity, mythicDry: g.mythicDry })
for (const kind of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'missing', '', null, 0, {}]) {
  for (const payWith of ['pack', 'coins'] as const) {
    const g = fresh(), before = value(g)
    assert.equal(isPackKind(kind), false)
    const out = runAction(g, 'open', { kind, payWith }, env)
    assert.equal(out.ok, false, `Reject ${String(kind)}`)
    assert.equal(value(g), before, 'Refused request must preserve assets and RNG')
    assert.throws(() => openPack(g, kind as PackKind, payWith), /没有这种卡包/)
    assert.equal(value(g), before, 'Direct engine calls also validate before mutation')
  }
}
for (const kind of Object.keys(PACKS)) assert(isPackKind(kind), `Real pack ${kind}`)
const valid = fresh()
assert.equal(runAction(valid, 'open', { kind: 'scout', payWith: 'pack' }, env).ok, true)
assert.equal(valid.packs.scout, 2)
assert.equal(valid.pulls, 1)
assert.equal(valid.coins, 3000)
console.log('ok prototype/invalid packs refused without asset or seed changes; ordinary opening works')

const player = ALL_CARDS.find(isPlayerCard)!
const second = ALL_CARDS.filter(isPlayerCard)[1]
const good = { id: player.id, level: 3, dupes: 4, seen: 8, got: '2026-09-01', spares: [1, 2, 5] }
{
  const g = fresh()
  g.cards[player.id] = structuredClone(good)
  const original = JSON.stringify(g.cards)
  migrateGacha(g, g.id)
  assert.equal(JSON.stringify(g.cards), original, 'Valid inventory is unchanged')
  const again = JSON.stringify(g.cards)
  migrateGacha(g, g.id)
  assert.equal(JSON.stringify(g.cards), again, 'Migration is idempotent')
}
for (const invalid of [null, 'bad', 42, false, [], [good]]) {
  const g = fresh()
  g.cards[player.id] = invalid as never
  assert.doesNotThrow(() => collection(g), 'Reading an unmigrated invalid row is safe')
  migrateGacha(g, g.id)
  assert.deepEqual(g.cards, {})
  assert.equal(collection(g).length, 0)
}
{
  const g = fresh()
  g.cards = [good] as never
  migrateGacha(g, g.id)
  assert.deepEqual(g.cards, {}, 'Arrays are not inventory dictionaries')
  g.cards = {
    [player.id]: { id: second.id, level: '2.9', dupes: '-3', seen: '4', spares: [3, '2', 0, 6, null, 'no', Infinity] },
    'p:historical-removed': { id: 'wrong', level: '1', dupes: '2', seen: 3 },
    ...JSON.parse('{"__proto__":{"id":"p:bad","level":5},"constructor":{"id":"p:bad","level":5}}'),
  } as never
  migrateGacha(g, g.id)
  assert.equal(g.cards[player.id].id, player.id)
  assert.equal(g.cards[player.id].level, 2)
  assert.equal(g.cards[player.id].dupes, 0)
  assert.deepEqual(g.cards[player.id].spares, [2, 3])
  assert.equal(g.cards['p:historical-removed'].level, 1, 'Keep old catalog rows for future restoration')
  assert.equal(upgradeCost(g, 'p:historical-removed').can, false)
  assert.equal(Object.hasOwn(g.cards, '__proto__'), false)
  assert.equal(Object.hasOwn(g.cards, 'constructor'), false)
}

const cases: [unknown, number][] = [
  ['1', 1], ['2.7', 2], [1.8, 1], [-3, 0], [99, MAX_LEVEL], ['11', MAX_LEVEL],
  [null, 0], [undefined, 0], [NaN, 0], [Infinity, 0], ['Infinity', 0], ['broken', 0], [true, 0],
]
for (const [raw, expected] of cases) {
  for (const migrated of [false, true]) {
    const g = fresh()
    g.coins = 100_000
    g.cards[player.id] = { ...good, level: raw, dupes: '99' } as never
    if (migrated) migrateGacha(g, g.id)
    assert.equal(levelOf(g, player.id), expected)
    const before = g.coins
    const out = runAction(g, 'upgrade', { cardId: player.id }, env)
    assert.equal(out.ok, expected < MAX_LEVEL)
    if (expected < MAX_LEVEL) {
      assert.equal(g.cards[player.id].level, expected + 1, 'Upgrade adds one numeric level, never concatenates')
      assert.equal(g.cards[player.id].dupes, 99 - DUPES_FOR[expected])
      assert.equal(g.coins, before - COINS_FOR[expected])
    } else assert.equal(g.coins, before)
  }
}
for (const raw of [NaN, Infinity, -10, 'broken', null, undefined]) {
  const g = fresh()
  g.cards[player.id] = { ...good, level: 0, dupes: raw, seen: raw } as never
  migrateGacha(g, g.id)
  assert.equal(g.cards[player.id].dupes, 0)
  assert.equal(g.cards[player.id].seen, 1)
  assert.equal(runAction(g, 'upgrade', { cardId: player.id }, env).ok, false)
}
console.log('ok damaged rows, historical IDs, integer levels, quantities, upgrade costs and valid-save preservation')
