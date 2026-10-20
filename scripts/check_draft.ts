/**
 * 抢人大战 (engine/draft.ts + draft-api.js): lots spread from a star to a long
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
import { DRAFT_BUDGET, DRAFT_POSITIONS, DRAFT_ROUNDS, DRAFT_BID_SEC, cleanBid, cleanCode, dealLot, draftTable, roundRobin, settleRound, draftSchedule, draftPrize, DRAFT_PAID_ROOMS } from '../src/engine/draft'
import { cardById, isPlayerCard, personOf } from '../src/engine/cards'

// ---------------------------------------------------------------- the rules
{
  const taken = new Set<string>()
  for (let r = 0; r < DRAFT_ROUNDS; r++) {
    const lot = dealLot(77, r, 7, taken)
    assert.equal(lot.length, 7, `第 ${r + 1} 轮发 7 张`)
    const cards = lot.map((id) => cardById(id)!)
    assert(DRAFT_POSITIONS[r] === '教练' || cards.every(isPlayerCard))
    if (DRAFT_POSITIONS[r] === '教练') assert(cards.every((c) => c.kind === 'coach'), '最后一轮发教练')
    else if (DRAFT_POSITIONS[r] !== '自由人') assert(cards.every((c) => isPlayerCard(c) && c.role === DRAFT_POSITIONS[r]), '这一轮的位置')
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
  // a three-way cycle, all level: drawn by the room's seed, not by seat order (the host is seat 0)
  const cycle = [{ a: 0, b: 1, aWon: true, mapsA: 2, mapsB: 1 }, { a: 1, b: 2, aWon: true, mapsA: 2, mapsB: 1 }, { a: 2, b: 0, aWon: true, mapsA: 2, mapsB: 1 }]
  const firsts = new Set<number>()
  for (let seed = 0; seed < 30; seed++) firsts.add(draftTable(3, cycle, seed)[0].seat)
  assert.equal(firsts.size, 3, '三方循环相克时抽签，不按座位号')
  assert.deepEqual(draftTable(3, cycle, 7), draftTable(3, cycle, 7), '同一房间结果一样')
  // two level seats: the match between them decides
  // seats 0 and 1: two wins, +2 maps each; 1 beat 0
  const two = [
    { a: 0, b: 1, aWon: false, mapsA: 1, mapsB: 2 }, { a: 0, b: 2, aWon: true, mapsA: 2, mapsB: 0 }, { a: 0, b: 3, aWon: true, mapsA: 2, mapsB: 1 },
    { a: 1, b: 2, aWon: false, mapsA: 1, mapsB: 2 }, { a: 1, b: 3, aWon: true, mapsA: 2, mapsB: 0 }, { a: 2, b: 3, aWon: false, mapsA: 0, mapsB: 2 },
  ]
  for (let seed = 0; seed < 10; seed++) { const r = draftTable(4, two, seed); assert.deepEqual([r[0].seat, r[1].seat], [1, 0], '两人同分看直接交手') }
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
  engine, displayName, normalizeId: (v: unknown) => (typeof v === 'string' ? v : null), rateLimited: () => false, timer: false, minDays: 0,
  clock: () => now, compute: async (args: unknown[]) => { played++; return (engine as any).playOpenCupMatch(...args) },
  readBody: async (req: { body: unknown }) => JSON.stringify(req.body),
  json: (res: { body?: any }, _c: number, body: any) => { res.body = body },
} as never)
const call = async (path: string, body: object) => { const res: { body?: any } = {}; await api.route({ body }, res, `/api/card/draft${path}`, 't'); return res.body }
const ids = Array.from({ length: 7 }, (_, i) => `VM-DRFT-0000-0000-0000-000${i}`)
for (let i = 0; i < ids.length; i++) {
  const g = newGacha(ids[i], `玩家${i}`, '2026-10-18')
  g.pulls = i === 6 ? 3 : 200   // the last one is a new account: it plays, it is not paid
  await sql`insert into card_accounts (id_hash, name, state, created, verified) values (${hash(ids[i])}, ${`玩家${i}`}, ${sql.json(g)}, now() - interval '9 days', now())`
}
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
now += (DRAFT_BID_SEC + 2) * 1000
const tooLate = await call('/bid', { id: P2, round: 1, bid: { card: 0, amount: 1 } })
assert.match(tooLate.why ?? '', /结束/, '时间到了的出价不算')
s = await call('', { id: H })
assert.equal(s.room.round, 2, '时间到了按 0 出价结算')
assert.equal(s.room.seats[0].budget, 0, '出价不能超过预算（100 - 40 只剩 60）')
console.log('ok  暗标：全员出价立即结算、超时按 0 价、预算封顶、看不到别人出价')

for (let r = 2; r < DRAFT_ROUNDS; r++) {
  for (const p of [H, P1, P2]) await call('/bid', { id: p, round: r, bid: { card: r % 3, amount: 5 } })
}
s = await call('', { id: H })
assert.equal(s.room.status, 'showing', '六轮选完开始直播比赛')
assert.equal(played, 4, '三个人：循环赛三场 + 决赛一场')
assert(s.room.seats.every((x: any) => x.picks.length === 6 && cardById(x.picks[5])?.kind === 'coach'), '每人五名选手和一名教练')
const people = s.room.seats.flatMap((x: any) => x.picks.map((id: string) => personOf(cardById(id)!)))
assert.equal(new Set(people).size, 18, '全场没有重复的人')
assert.equal(s.room.games.length, 0, '直播刚开始，一场都还没出')
assert.equal(s.room.final, null)
assert(s.room.nextAt > now, '页面知道下一场什么时候出')
const raw = (await sql`select games, final from draft_rooms where code = ${code}`)[0]
const plan = draftSchedule(raw.games.length, raw.final.maps.length)
const t0 = now
now = t0 + plan.games[0]
assert.equal((await call('', { id: P1 })).room.games.length, 1, '一场一场出')
now = t0 + plan.games[2] + 1
s = await call('', { id: P1 })
assert(s.room.games.length === 3 && s.room.final && s.room.final.maps.length === 0, '循环赛出完，决赛开始')
assert(raw.final.maps.length >= 3 && raw.final.maps.length <= 5, '决赛 BO5')
const seedRow = (await sql`select seed from draft_rooms where code = ${code}`)[0]
const top2 = draftTable(3, raw.games, Number(seedRow.seed)).slice(0, 2).map((t) => t.seat).sort()
assert.deepEqual([raw.final.a, raw.final.b].sort(), top2, '循环赛前两名打决赛')
now = t0 + plan.final[0]
assert.equal((await call('', { id: P1 })).room.final.maps.length, 1, '决赛一张图一张图出')
assert.equal((await sql`select count(*)::int as n from card_mail where kind = 'draft'`)[0].n, 0, '没播完不发奖励（不剧透）')
now = t0 + plan.end
s = await call('', { id: H })
assert.equal(s.room.status, 'done')
const champ = raw.final.aWon ? raw.final.a : raw.final.b
assert.equal(s.room.seats[champ].place, 1, '决赛赢家第一')
const mail = await sql`select to_h, coins, body from card_mail where kind = 'draft' order by coins desc`
assert.deepEqual(mail.map((m: any) => m.coins), [draftPrize(1), draftPrize(2), draftPrize(3)], '按名次发金币')
assert.equal(mail[0].to_h, hash(ids[champ]))
assert.deepEqual(s.room.reward && [s.room.reward.place, s.room.reward.coins], [s.room.seats[0].place, draftPrize(s.room.seats[0].place)])
await api.sweep(now)
assert.equal(played, 4, '比赛只打一次')
assert.equal((await sql`select count(*)::int as n from card_mail where kind = 'draft'`)[0].n, 3, '奖励只发一次')
assert.equal((await call('', { id: P3 })).room, undefined, '没参加的人看不到')
assert((await call('/leave', { id: H })).ok)
assert.equal((await call('', { id: H })).room, undefined, '看完结果可以离开')
const g = (await sql`select state from card_accounts where id_hash = ${hash(H)}`)[0].state
assert.equal(Object.keys(g.cards).length, 0, '选秀不会把卡加进收藏')
console.log('ok  六轮（含教练）选完，循环赛逐场直播，前两名 BO5 决赛逐图揭晓，播完按名次发金币，只发一次')

// a whole room by API: everyone bids 0 on the first card
async function room(players: string[]) {
  for (const p of players) await call('/leave', { id: p })
  const c = (await call('/create', { id: players[0] })).code
  for (const p of players.slice(1)) assert((await call('/join', { id: p, code: c })).ok)
  assert((await call('/start', { id: players[0] })).ok)
  for (let r = 0; r < DRAFT_ROUNDS; r++) for (const p of players) await call('/bid', { id: p, round: r, bid: { card: 0, amount: 0 } })
  await call('', { id: players[0] })
  now += 10 * 60_000
  return (await call('', { id: players[0] })).room
}
const r2 = await room([H, P1, P2])
assert.equal(r2.status, 'done'); assert(r2.reward.coins > 0, `同一天第 ${DRAFT_PAID_ROOMS} 个房间还有奖励`)
const r3 = await room([H, P1, P2])
assert(r3.reward.coins === 0 && r3.reward.unpaid === 'cap', `每天只有前 ${DRAFT_PAID_ROOMS} 个房间有奖励`)
// a room where nobody bids: the clock drafts for them, and nobody is paid
{
  for (const p of [ids[0], ids[1], ids[2]]) await call('/leave', { id: p })
  const c = (await call('/create', { id: ids[0] })).code
  for (const p of [ids[1], ids[2]]) await call('/join', { id: p, code: c })
  await call('/start', { id: ids[0] })
  for (let r = 0; r < DRAFT_ROUNDS + 1; r++) { now += (DRAFT_BID_SEC + 2) * 1000; await call('', { id: ids[0] }) }
  now += 10 * 60_000
  const idleRoom = (await call('', { id: ids[1] })).room
  assert.equal(idleRoom.status, 'done')
  assert.equal(idleRoom.reward.unpaid, 'idle', '一轮都没自己出价的不发奖励')
}
const two = await room([ids[3], ids[4]])
assert(two.reward.unpaid === 'small' && two.games.length === 0 && two.final.maps.length >= 3, '两个人只打决赛，没有奖励')
const fresh = await room([ids[5], ids[6], ids[3]])
const freshSeat = fresh.seats.find((x: any) => x.me)
void freshSeat
assert.equal((await sql`select unpaid from draft_members where code = ${fresh.code} and id_hash = ${hash(ids[6])}`)[0].unpaid, 'gate', '开卡不够的新号不发')
console.log(`ok  每天前 ${DRAFT_PAID_ROOMS} 个房间有奖励、至少 3 人、新号不发、两人只打决赛`)

// matches that keep failing end the room instead of holding everyone in it
{
  let fails = 0
  const broken = makeDraftApi(sql, {
    engine, displayName, normalizeId: (v: unknown) => (typeof v === 'string' ? v : null), rateLimited: () => false, timer: false, minDays: 0,
    clock: () => now, compute: async () => { fails++; throw new Error('worker down') },
    readBody: async (req: { body: unknown }) => JSON.stringify(req.body),
    json: (res: { body?: any }, _c: number, body: any) => { res.body = body },
  } as never)
  const bcall = async (path: string, body: object) => { const res: { body?: any } = {}; await broken.route({ body }, res, `/api/card/draft${path}`, 't'); return res.body }
  for (const p of [ids[3], ids[4]]) await bcall('/leave', { id: p })
  const c = (await bcall('/create', { id: ids[3] })).code
  await bcall('/join', { id: ids[4], code: c }); await bcall('/start', { id: ids[3] })
  for (let r = 0; r < DRAFT_ROUNDS; r++) for (const p of [ids[3], ids[4]]) await bcall('/bid', { id: p, round: r, bid: { card: 0, amount: 0 } })
  for (let i = 0; i < 4; i++) await broken.sweep(now)
  const st = (await sql`select status, failed from draft_rooms where code = ${c}`)[0]
  assert(st.status === 'done' && st.failed && fails === 3, `比赛打不出来三次就结束房间（${fails} 次）`)
  assert((await bcall('/leave', { id: ids[3] })).ok)
  console.log('ok  比赛一直打不出来时房间会结束，不会把人卡住')
}
console.log('\nall 抢人大战 checks passed')
