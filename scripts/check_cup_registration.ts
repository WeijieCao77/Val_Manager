/** Real local card/market API regression; no online accounts are used. */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { ALL_CARDS, SQUAD_SLOTS, isPlayerCard, personOf, squadRating } from '../src/engine/cards'
import { enterCup, levelOf, newGacha, STAMINA_COST, STAMINA_MAX } from '../src/engine/gacha'
import type { CupRegistration, GachaState } from '../src/engine/gacha'
import type { ArenaResult } from '../src/engine/arena'
import { playCupMatch } from '../src/engine/arena'
import { runAction } from '../src/engine/cardActions'
import { CUP_TEAMS } from '../src/engine/cupTeams'

const { CARD_SCHEMA, makeCardApi, normalizeId } = await import('../cards-api.js')
const { makeMarketApi, TRADE_PULLS } = await import('../market-api.js')
const { displayName } = await import('../names.js')
const engine = await import('../src/engine/server.ts')
const db = new PGlite(), sql = makeSql(db)
await db.exec(CARD_SCHEMA)
type Reply = { code: number; body: { ok: boolean; why?: string; state?: GachaState; result?: any } }
const json = (res: Reply, code: number, body: Reply['body']) => { res.code = code; res.body = body }
const readBody = async (req: { body: string }) => req.body
const cards = makeCardApi(sql, { rateLimited: () => false, readBody, json } as never)
const market = makeMarketApi(sql, { readBody, json, normalizeId, displayName, rateLimited: () => false, engine } as never)
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
async function call(path: string, body: unknown) {
  const out: Reply = { code: 0, body: { ok: false } }
  await (path.startsWith('/api/market/') ? market : cards).route({ method: 'POST', body: JSON.stringify(body) } as never, out as never, path, 'cup-registration-test')
  return out.body
}
const act = (id: string, action: string, args = {}, client = {}) => call('/api/card/act', { id, action, args, client })
const stored = async (id: string): Promise<GachaState> => (await sql`select state from card_accounts where id_hash = ${hash(id)}`)[0].state
async function fixture(id: string, state: GachaState) {
  assert.equal((await call('/api/card/claim', { id, name: '杯赛验证' })).ok, true)
  await sql`update card_accounts set state = ${sql.json(state)}, created = now() - interval '4 days' where id_hash = ${hash(id)}`
}
function five(high: boolean) {
  const pool = ALL_CARDS.filter(isPlayerCard).filter(c => c.rarity === (high ? 'mythic' : 'bronze'))
    .sort((a, b) => high ? b.rating - a.rating : a.rating - b.rating)
  const used = new Set<string>()
  return SQUAD_SLOTS.map(role => {
    const card = pool.find(c => !used.has(personOf(c)) && (role === '自由人' || c.roles.includes(role)))!
    assert(card)
    used.add(personOf(card))
    return card.id
  })
}
const weak = { slots: five(false), coach: 'c:Cody' }
const strong = { slots: five(true), coach: 'c:bonkar' }
const today = new Date().toISOString().slice(0, 10)
function account(id: string) {
  const g = newGacha(id, '杯赛验证', today)
  g.cards = Object.fromEntries([...weak.slots, ...strong.slots, weak.coach, strong.coach].map(id => [id, { id, level: 0, dupes: 0, seen: 1, got: today }]))
  g.cards[weak.slots[0]].dupes = 3
  g.cards[weak.coach].dupes = 3
  g.squad = structuredClone(weak)
  g.coins = 100_000
  g.pulls = TRADE_PULLS + 1
  g.seed = 7654321
  g.daily.staminaAt = Date.now()
  return g
}
const A = 'VM-CVPA-CVPA-CVPA-CVPA-CVPA', B = 'VM-CVPB-CVPB-CVPB-CVPB-CVPB'
try {
  await fixture(A, account(A))
  // Check the malformed pack route through real request parsing and persistence.
  for (const kind of ['constructor', 'toString', '__proto__']) {
    const before = await stored(A)
    const out = await act(A, 'open', { kind, payWith: 'coins' })
    assert.equal(out.ok, false)
    const after = await stored(A)
    for (const key of ['coins', 'pulls', 'seed'] as const) assert.equal(after[key], before[key])
    assert.deepEqual(after.packs, before.packs)
  }

  const initial = await stored(A)
  const entered = await act(A, 'cup_enter')
  assert.equal(entered.ok, true)
  const registered = (await stored(A)).cup!.registration!
  assert.deepEqual(registered.squad, weak)
  assert(Object.values(registered.levels).every(level => level === 0))
  assert.equal((await stored(A)).daily.stamina, STAMINA_MAX - STAMINA_COST.cup)
  const path = (await stored(A)).cup!.path
  const drawStrong = structuredClone(initial)
  drawStrong.squad = structuredClone(strong)
  enterCup(drawStrong, squadRating(strong), Date.now())
  const rating = (ids: string[]) => ids.map(id => CUP_TEAMS.find(t => t.id === id)!.rating)
  assert(Math.max(...rating(path)) < Math.min(...rating(drawStrong.cup!.path)), 'Fixture demonstrates why weak-entry/strong-play would be profitable')

  // These are real actions: upgrade the registered player and coach, then put
  // another registered card in market escrow. No inventory lock is imposed.
  assert.equal((await act(A, 'upgrade', { cardId: weak.slots[0] })).ok, true)
  assert.equal((await act(A, 'upgrade', { cardId: weak.coach })).ok, true)
  assert.equal(levelOf(await stored(A), weak.slots[0]), 1)
  const sale = await call('/api/market/list', { id: A, cardId: weak.slots[1], ask: 20_000 })
  assert.equal(sale.ok, true, JSON.stringify(sale))
  assert.equal((await stored(A)).cards[weak.slots[1]], undefined, 'Registered card leaves inventory normally')
  const injected: CupRegistration = { squad: strong, levels: Object.fromEntries([...strong.slots, strong.coach].map(id => [id, 5])) }
  const repeat = await act(A, 'cup_enter', {}, { squad: strong, cup: { registration: injected } })
  assert.equal(repeat.ok, true)
  const changed = await stored(A)
  assert.deepEqual(changed.squad, strong)
  assert.deepEqual(changed.cup!.registration, registered, 'Client snapshot injection is ignored')
  assert.deepEqual(changed.cup!.path, path)
  assert.equal(changed.daily.stamina, STAMINA_MAX - STAMINA_COST.cup, 'Repeat entry is free and preserves the bracket')

  // Deterministic engine evidence independently checks that both the cards AND
  // registered levels actually reach the simulation, rather than just storage.
  const env = { now: Date.now(), today, seed: 33145 }
  const deterministic = structuredClone(changed)
  const expected = playCupMatch(registered.squad, id => registered.levels[id] ?? 0, path[0], 3, env.seed)
  const simulated = runAction(deterministic, 'cup_play', {}, env)
  assert(simulated.ok)
  assert.deepEqual((simulated.result as { res: ArenaResult }).res, expected)

  const played = await act(A, 'cup_play', {}, { squad: { slots: [], coach: null }, cup: { registration: injected } })
  assert.equal(played.ok, true, played.why)
  assert.deepEqual(played.result.registration, registered)
  const fielded = (played.result.res as ArenaResult).lines.map(line => line.cardId).sort()
  assert.deepEqual(fielded, [...weak.slots].sort(), 'Actual API match fields the weak registered five after sale, upgrade and squad changes')
  assert.equal((await stored(A)).daily.stamina, changed.daily.stamina)
  console.log('ok API: immutable registration, weak-entry exploit blocked, upgrades, market escrow, client injection, empty daily squad, exact simulation')

  for (let i = 0; i < 5 && !(await stored(A)).cup!.done; i++) assert.equal((await act(A, 'cup_play')).ok, true)
  assert.equal((await stored(A)).cup!.done, true)
  assert.equal((await act(A, 'cup_clear')).ok, true)
  assert.equal((await act(A, 'cup_enter', {}, { squad: strong })).ok, true)
  const next = (await stored(A)).cup!.registration!
  assert.deepEqual(next.squad, strong, 'A new cup registers the newly selected five')
  assert.notDeepEqual(next, registered)

  // A paid legacy bracket has no registration. Missing five must not lose its
  // ticket; the first valid play captures the then-current levels exactly once.
  const legacy = account(B)
  legacy.cards[weak.slots[0]].level = 2
  legacy.cards[weak.coach].level = 1
  enterCup(legacy, squadRating(legacy.squad, id => levelOf(legacy, id)), Date.now())
  assert.equal(legacy.cup!.registration, undefined)
  const legacyPath = [...legacy.cup!.path], stamina = legacy.daily.stamina
  legacy.squad = { slots: [null, null, null, null, null], coach: null }
  await fixture(B, legacy)
  const blocked = await act(B, 'cup_play')
  assert.equal(blocked.ok, false)
  assert.match(blocked.why!, /不会重新收费或抽签/)
  assert.deepEqual((await stored(B)).cup!.path, legacyPath)
  assert.equal((await stored(B)).daily.stamina, stamina)
  const resumed = await act(B, 'cup_play', {}, { squad: weak })
  assert.equal(resumed.ok, true, resumed.why)
  assert.deepEqual(resumed.result.registration.squad, weak)
  assert.equal(resumed.result.registration.levels[weak.slots[0]], 2)
  assert.equal(resumed.result.registration.levels[weak.coach], 1)
  assert.equal((await stored(B)).daily.stamina, stamina)
  assert.deepEqual((await stored(B)).cup!.path, legacyPath)
  console.log('ok new cups register current roster; legacy cups resume without new fee or draw; missing legacy lineup is explained')
} finally { await db.close() }
