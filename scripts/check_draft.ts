/**
 * 选秀夜 (engine/draft.ts + draft-api.js): lots spread from a star to a long
 * shot with nobody twice, the highest bid gets its card and the outbid take
 * the best left for free, budgets hold, the round robin is played once and the
 * table is right — on the real server module over an in-process database.
 *
 *   npx tsx scripts/check_draft.ts
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { newGacha } from '../src/engine/gacha'
import { DRAFT_BUDGET, DRAFT_POSITIONS, DRAFT_ROUNDS, cleanBid, cleanCode, dealLot, draftTable, roundRobin, settleRound } from '../src/engine/draft'
import { cardById, isPlayerCard, personOf } from '../src/engine/cards'

// ---------------------------------------------------------------- the rules
{
  const taken = new Set<string>()
  for (let r = 0; r < DRAFT_ROUNDS; r++) {
    const lot = dealLot(77, r, 7, taken)
    assert.equal(lot.length, 7, `第 ${r + 1} 轮发 7 张`)
    const cards = lot.map((id) => cardById(id)!)
    assert(cards.every(isPlayerCard))
    if (DRAFT_POSITIONS[r] !== '自由人') assert(cards.every((c) => isPlayerCard(c) && c.role === DRAFT_POSITIONS[r]), '这一轮的位置')
    const ratings = cards.map((c) => c.rating)
    assert(ratings[0] >= Math.max(...ratings.slice(1)), '第一张是这一轮最强的')
    assert(ratings[0] - Math.min(...ratings) >= 8, `从强到弱拉得开（${ratings.join('/')}）`)
    for (const c of cards) { assert(!taken.has(personOf(c)), '同一个人不会发两次'); taken.add(personOf(c)) }
  }
  assert.deepEqual(dealLot(77, 2, 5, new Set()), dealLot(77, 2, 5, new Set()), '同一颗种子同一手牌')
  console.log('ok  每轮按位置发 人数+1 张，从强到弱，同一个人不重复')

  const lot = ['a', 'b', 'c', 'd']
  const r = (id: string) => ({ a: 90, b: 80, c: 70, d: 60 }[id]!)
  let aw = settleRound(1, 0, lot, [{ card: 0, amount: 30 }, { card: 0, amount: 50 }, { card: 2, amount: 5 }], r)
  assert.deepEqual(aw.map((x) => [x.card, x.paid, x.won]), [[1, 0, false], [0, 50, true], [2, 5, true]], '出价高的拿走，被抢的免费拿剩下最好的')
  aw = settleRound(1, 0, lot, [null, { card: 3, amount: 0 }, null], r)
  assert.equal(new Set(aw.map((x) => x.card)).size, 3, '每人一张不重复')
  assert(aw.every((x) => x.paid === 0))
  const ties = new Set<number>()
  for (let s = 0; s < 40; s++) ties.add(settleRound(s, 0, lot, [{ card: 0, amount: 10 }, { card: 0, amount: 10 }], r)[0].card)
  assert.equal(ties.size, 2, '同价抽签，两边都可能拿到')
  assert.deepEqual(cleanBid({ card: 9, amount: 500 }, 4, 37), { card: 0, amount: 37 }, '乱出价改成合法的')
  assert.deepEqual(cleanBid({ card: 2, amount: -5 }, 4, 37), { card: 2, amount: 0 })
  assert.equal(cleanCode(' ab2cd '), 'AB2CD'); assert.equal(cleanCode('AB1CD'), null); assert.equal(cleanCode('ABCD'), null)
  assert.equal(roundRobin(6).length, 15)
  const t = draftTable(3, [{ a: 0, b: 1, aWon: true, mapsA: 2, mapsB: 0 }, { a: 0, b: 2, aWon: false, mapsA: 1, mapsB: 2 }, { a: 1, b: 2, aWon: true, mapsA: 2, mapsB: 1 }])
  assert.deepEqual(t.map((x) => [x.seat, x.wins, x.place]), [[0, 1, 1], [2, 1, 2], [1, 1, 3]], '同胜看净胜图')
  console.log('ok  暗标结算、同价抽签、出价清洗、房间码、积分榜')
}

// ---------------------------------------------------------------- a room on the server module
const { CARD_SCHEMA, engine } = await import('../cards-api.js')
const { DRAFT_SCHEMA, makeDraftApi } = await import('../draft-api.js')
const { displayName } = await import('../names.js')
const db = new PGlite(), sql = makeSql(db)
await db.exec(CARD_SCHEMA); await db.exec(DRAFT_SCHEMA)
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
let now = Date.parse('2026-10-18T12:00:00Z')
let played = 0
const api = makeDraftApi(sql, {
  engine, displayName, normalizeId: (v: unknown) => (typeof v === 'string' ? v : null), rateLimited: () => false, timer: false,
  clock: () => now, compute: async (args: unknown[]) => { played++; return (engine as any).playOpenCupMatch(...args) },
  readBody: async (req: { body: unknown }) => JSON.stringify(req.body),
  json: (res: { body?: any }, _c: number, body: any) => { res.body = body },
} as never)
const call = async (path: string, body: object) => { const res: { body?: any } = {}; await api.route({ body }, res, `/api/card/draft${path}`, 't'); return res.body }
const ids = Array.from({ length: 7 }, (_, i) => `VM-DRFT-0000-0000-0000-000${i}`)
for (let i = 0; i < ids.length; i++) await sql`insert into card_accounts (id_hash, name, state, created, verified) values (${hash(ids[i])}, ${`玩家${i}`}, ${sql.json(newGacha(ids[i], `玩家${i}`, '2026-10-18'))}, now(), now())`
const [H, P1, P2, P3] = ids

const made = await call('/create', { id: H })
assert(made.ok && cleanCode(made.code), '开房间拿到房间码')
const code = made.code
assert.match((await call('/create', { id: H })).why, /已经在一个房间/)
assert.match((await call('/start', { id: H })).why, /至少 2 个人/)
assert.match((await call('/join', { id: P1, code: 'ZZZZZ' })).why, /没有这个房间/)
for (const p of [P1, P2, P3]) assert((await call('/join', { id: p, code: code.toLowerCase() })).ok)
assert((await call('/join', { id: P1, code })).ok, '重复加入不占位')
assert((await call('/leave', { id: P3 })).ok)
let s = await call('', { id: H })
assert.deepEqual(s.room.seats.map((x: any) => x.name), ['玩家0', '玩家1', '玩家2'], '退出后座位补齐')
assert.match((await call('/start', { id: P1 })).why, /只有房主/)
assert((await call('/start', { id: H })).ok)
assert.match((await call('/join', { id: P3, code })).why, /已经开始/)
assert.match((await call('/leave', { id: P1 })).why, /打完才能走/)
s = await call('', { id: P1 })
assert.equal(s.room.status, 'bidding'); assert.equal(s.room.lot.length, 4); assert.equal(s.room.position, '决斗者')
console.log('ok  开房、加入、退出补位、只有房主能开始、开始后不能进出')

// round 1: everyone in → settles at once
await call('/bid', { id: H, round: 0, bid: { card: 0, amount: 40 } })
assert.match((await call('/bid', { id: H, round: 0, bid: { card: 1, amount: 1 } })).why, /出过价/)
s = await call('', { id: P1 })
assert(s.room.seats[0].bidIn && !s.room.seats[1].bidIn, '看得到谁出过价')
assert.equal(s.room.myBid, null, '看不到别人出多少')
assert.equal(JSON.stringify(s.room.seats).includes('"amount"'), false)
await call('/bid', { id: P1, round: 0, bid: { card: 0, amount: 25 } })
await call('/bid', { id: P2, round: 0, bid: { card: 3, amount: 0 } })
s = await call('', { id: H })
assert.equal(s.room.round, 1, '都出完价就进下一轮')
const budgets = s.room.seats.map((x: any) => x.budget)
assert.deepEqual(budgets, [DRAFT_BUDGET - 40, DRAFT_BUDGET, DRAFT_BUDGET], '赢的人付钱，被抢的不付')
assert.equal(s.room.history[0].awards[1].won, false, 'P1 被抢了')
// round 2: one player sleeps; the clock settles it
await call('/bid', { id: H, round: 1, bid: { card: 1, amount: 100 } })
await call('/bid', { id: P1, round: 1, bid: { card: 1, amount: 10 } })
s = await call('', { id: H })
assert.equal(s.room.round, 1, '还在等第三个人')
now += 26_000
s = await call('', { id: H })
assert.equal(s.room.round, 2, '时间到了按 0 出价结算')
assert.equal(s.room.seats[0].budget, 0, '出价不能超过预算（100 - 40 只剩 60）')
console.log('ok  暗标：全员出价立即结算、超时按 0 价、预算封顶、看不到别人出价')

for (let r = 2; r < DRAFT_ROUNDS; r++) {
  for (const p of [H, P1, P2]) await call('/bid', { id: p, round: r, bid: { card: r % 3, amount: 5 } })
}
s = await call('', { id: H })
assert.equal(s.room.status, 'done', '五轮选完就打循环赛')
assert.equal(played, 3, '三个人打三场')
assert(s.room.seats.every((x: any) => x.picks.length === 5), '每人五个')
const people = s.room.seats.flatMap((x: any) => x.picks.map((id: string) => personOf(cardById(id)!)))
assert.equal(new Set(people).size, 15, '全场没有重复的人')
assert.equal(s.room.table.length, 3); assert.equal(s.room.table[0].place, 1)
await api.sweep(now)
assert.equal(played, 3, '循环赛只打一次')
assert.equal((await call('', { id: P3 })).room, undefined, '没参加的人看不到')
assert((await call('/leave', { id: H })).ok)
assert.equal((await call('', { id: H })).room, undefined, '看完结果可以离开')
assert((await call('/create', { id: H })).ok, '离开后可以再开一间')
const g = (await sql`select state from card_accounts where id_hash = ${hash(H)}`)[0].state
assert.equal(Object.keys(g.cards).length, 0, '选秀不会把卡加进收藏')
console.log('ok  五轮选完自动打循环赛、只打一次、没人重复、不进收藏')
console.log('\nall 选秀夜 checks passed')
