/**
 * 读点 on the real server module (swift-api.js) over an in-process database:
 * the queue pairs two players, a round waits for both or for the clock, a
 * lone player gets a ghost and then the AI, the finish rates and pays once
 * per win up to the day's cap, and nobody can call someone else's match.
 *
 *   npx tsx scripts/check_swift_api.ts
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { newGacha } from '../src/engine/gacha'
import { CUP_TEAMS } from '../src/engine/cupTeams'

const { CARD_SCHEMA, engine } = await import('../cards-api.js')
const { SWIFT_SCHEMA, SWIFT_WAIT_SEC, SWIFT_PAID_GAMES, SWIFT_WIN_COINS, SWIFT_LOSS_COINS, makeSwiftApi } = await import('../swift-api.js')
const { displayName } = await import('../names.js')
const db = new PGlite(), sql = makeSql(db)
await db.exec(CARD_SCHEMA); await db.exec(SWIFT_SCHEMA)
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
let now = Date.parse('2026-10-18T04:00:00Z')
const api = makeSwiftApi(sql, {
  engine, displayName, normalizeId: (v: unknown) => (typeof v === 'string' ? v : null), rateLimited: () => false, timer: false, minDays: 0,
  clock: () => now,
  readBody: async (req: { body: unknown }) => JSON.stringify(req.body),
  json: (res: { body?: any }, _c: number, body: any) => { res.body = body },
} as never)
const call = async (path: string, body: object) => { const res: { body?: any } = {}; await api.route({ body }, res, `/api/card/swift${path}`, 't'); return res.body }

const today = '2026-10-18'
const team = CUP_TEAMS[3]
async function account(id: string, name: string, pulls = 200) {
  const g = newGacha(id, name, today)
  g.pulls = pulls; g.squad = structuredClone(team.squad)
  for (const c of [...team.squad.slots, team.squad.coach].filter(Boolean) as string[]) g.cards[c] = { id: c, level: 2, dupes: 0, seen: 1, got: today }
  await sql`insert into card_accounts (id_hash, name, state, created, verified) values (${hash(id)}, ${name}, ${sql.json(g)}, now() - interval '9 days', now())`
}
const A = 'VM-SWFT-0000-0000-0000-0001', B = 'VM-SWFT-0000-0000-0000-0002', C = 'VM-SWFT-0000-0000-0000-0003', NEW = 'VM-SWFT-0000-0000-0000-0004'
await account(A, '甲'); await account(B, '乙'); await account(C, '丙'); await account(NEW, '新号', 5)
const empty = 'VM-SWFT-0000-0000-0000-0009'
await sql`insert into card_accounts (id_hash, name, state, created, verified) values (${hash(empty)}, '空', ${sql.json(newGacha(empty, '空', today))}, now(), now())`

// ---------------------------------------------------------------- queue and pairing
assert.match((await call('/queue', { id: empty })).why, /凑齐五个人/)
let q = await call('/queue', { id: A })
assert(q.ok && !q.match, '一个人排队先等着')
let s = await call('', { id: A })
assert(s.queue && !s.match, '页面看得到在排队')
now += 2000
q = await call("/queue", { id: B })
assert(q.ok && q.match, '第二个人进来就配上')
const id = q.match
s = await call('', { id: A })
assert.equal(s.match?.id, id); assert.equal(s.match.kind, 'live')
assert.equal(s.match.opponent.name, '乙')
assert.equal((await call('', { id: B })).match.opponent.name, '甲')
assert((await call('/queue', { id: A })).already, '比赛中再排队不会开第二场')
{
  // a player who queued and closed the page is not paired live
  await call('/queue', { id: C })
  now += 8000
  await call('/queue', { id: NEW })
  const gone = await call('', { id: NEW })
  assert(!gone.match, '离开页面的排队玩家不会被配成真人对局')
  await call('/leave', { id: C }); await call('/leave', { id: NEW })
}
console.log('ok  排队、配对、比赛中不能再排')

// ---------------------------------------------------------------- a round waits for both
const choiceFor = (v: any) => ({ buy: 'full', plan: v.plans[0], lead: 0, ult: null })
let va = (await call('', { id: A })).match.view
let r = await call('/call', { id: A, match: id, round: va.round, choice: choiceFor(va) })
assert(r.ok && r.match.view.locked && !r.match.view.theyLocked && r.match.view.log.length === 0, '一方定了要等另一方')
assert.match((await call('/call', { id: A, match: id, round: va.round, choice: choiceFor(va) })).why, /已经定了/)
const vb = (await call('', { id: B })).match.view
assert(vb.theyLocked && !vb.locked, '对面看得到你已经定了，看不到你定的什么')
assert.equal(JSON.stringify(vb).includes('"pending"'), false, '视图里没有对方的选择')
const d0 = (await sql`select deadline from swift_matches where id = ${id}`)[0].deadline
now += 3000
r = await call('/call', { id: B, match: id, round: vb.round, choice: choiceFor(vb) })
assert.equal(r.match.view.log.length, 1, '两边都定了就打这一回合')
assert.deepEqual(r.match.view.log[0].credits[0], [], '回合记录里看不到对方的钱')
assert(r.match.view.log[0].credits[1].length === 5, '自己的钱看得到')
const outsider = await call('/call', { id: C, match: id, round: 2, choice: choiceFor(vb) })
assert(!outsider.ok && outsider.match === undefined, '外人拿不到这场比赛的视图')
const nobody = await call('/call', { id: 'VM-NOPE-0000-0000-0000-0000', match: id, round: 2, choice: choiceFor(vb) })
assert(nobody.match === undefined)
assert.match((await call('/call', { id: B, match: id, round: 1, choice: choiceFor(vb) })).why, /回合已经过了|已经定了/)
assert.match((await call('/call', { id: C, match: id, round: 2, choice: choiceFor(vb) })).why, /不是你的比赛/)
console.log('ok  一回合等两边、看不到对方的选择、别人不能替你出')

// ---------------------------------------------------------------- the clock calls for a side that does not
va = (await call('', { id: A })).match.view
const before = (await sql`select deadline from swift_matches where id = ${id}`)[0].deadline
now += 5000
await call('/call', { id: A, match: id, round: va.round, choice: choiceFor(va) })
assert.equal(+(await sql`select deadline from swift_matches where id = ${id}`)[0].deadline, +before, '一方出招不会给双方重新计时')
void d0
now += (engine.SWIFT_CHOOSE_SEC + engine.SWIFT_REPLAY_SEC) * 1000
s = await call('', { id: A })
assert.equal(s.match.view.log.length, 2, '对方超时，系统替他出')
console.log('ok  超时代出')

// ---------------------------------------------------------------- play it out
for (let guard = 0; guard < 30; guard++) {
  const cur = (await call('', { id: A, match: id })).match
  if (cur.status === 'done') break
  for (const who of [A, B]) {
    const v = (await call('', { id: who })).match.view
    if (v.phase === 'choose' && !v.locked) await call('/call', { id: who, match: id, round: v.round, choice: choiceFor(v) })
    else if (v.scouted) await call('/recon', { id: who, match: id, plan: v.plans[1] })
  }
}
const endA = (await call('', { id: A, match: id })).match, endB = (await call('', { id: B, match: id })).match
assert.equal(endA.status, 'done')
const winnerHash = endA.view.winner === 0 ? hash(A) : hash(B)
const mail = await sql`select to_h, coins, kind from card_mail where kind = 'swift' order by coins desc`
assert.equal(mail.length, 2, '赢的输的都有')
assert.equal(mail[0].to_h, winnerHash); assert.equal(mail[0].coins, SWIFT_WIN_COINS)
assert.equal(mail[1].coins, SWIFT_LOSS_COINS)
assert(endA.ratings.delta === -endB.ratings.delta && endA.ratings.delta !== 0, '分数一涨一跌')
const players = await sql`select id_hash, rating, played, won, habit, side from swift_players order by id_hash`
assert.equal(players.length, 2); assert(players.every((p: any) => p.played === 1 && p.habit && p.side?.seats?.length === 5))
assert.equal((await call('', { id: A })).match, undefined, '比完了，页面回到排队前')
console.log(`ok  打完：赢的 ${SWIFT_WIN_COINS}、输的 ${SWIFT_LOSS_COINS} 金币，分数变化，习惯和阵容存下来当影子`)

// ---------------------------------------------------------------- a lone player gets a ghost, then the AI
await call('/queue', { id: C })
s = await call('', { id: C })
assert(s.queue, '还没到时间，继续等')
now += (SWIFT_WAIT_SEC + 1) * 1000
s = await call('', { id: C })
assert.equal(s.match?.kind, 'ghost', '等够了就派一个影子')
const gid = s.match.id
const gv = s.match.view
r = await call('/call', { id: C, match: gid, round: gv.round, choice: choiceFor(gv) })
assert.equal(r.match.view.log.length, 1, '影子马上出招，不用等')
await call('/leave', { id: C, match: gid, resign: true })
const res = (await call('', { id: C, match: gid })).match
assert(res.status === 'done' && res.view.winner === 1 && res.view.resigned === 0, '认输算输')
assert.equal((await sql`select count(*)::int as n from card_mail where to_h = ${hash(C)}`)[0].n, 0, '认输没有金币')
await sql`delete from swift_players`
await call('/queue', { id: C })
now += (SWIFT_WAIT_SEC + 1) * 1000
s = await call('', { id: C })
assert.equal(s.match?.kind, 'ai', '没有影子就是真实战队的 AI')
assert(s.match.opponent.name.length > 0)
console.log('ok  没人时先派影子、再派 AI；影子马上出招；认输')

// ---------------------------------------------------------------- the day's cap, and accounts that may not earn
async function playOut(who: string) {
  let mid: string | undefined
  for (let guard = 0; guard < 40; guard++) {
    const cur = (await call('', { id: who, ...(mid ? { match: mid } : {}) })).match
    if (!cur) { await call('/queue', { id: who }); now += (SWIFT_WAIT_SEC + 1) * 1000; continue }
    mid = cur.id
    if (cur.status === 'done') return cur
    const v = cur.view
    if (v.phase === 'choose' && !v.locked) await call('/call', { id: who, match: cur.id, round: v.round, choice: { buy: 'full', plan: v.plans[(v.round * 3) % 4], lead: 0, ult: null } })
    else if (v.scouted) await call('/recon', { id: who, match: cur.id, plan: v.scouted })
    else now += 30_000
  }
  throw new Error('match did not end')
}
let games = 0   // the first playOut finishes the AI match started above
let w = 0
for (let i = 0; i < SWIFT_PAID_GAMES + 1; i++) { const m = await playOut(C); games++; if (m.view.winner === 0) w++ }
const paid = await sql`select coins, body from card_mail where to_h = ${hash(C)} and kind = 'swift'`
assert.equal(paid.length, SWIFT_PAID_GAMES, `一天只有前 ${SWIFT_PAID_GAMES} 场发金币（打了 ${games} 场）`)
assert(paid.every((m: any) => m.coins === (m.body.won ? SWIFT_WIN_COINS : SWIFT_LOSS_COINS)), '赢输金额对')
const day = (await call('', { id: C })).me
assert.equal(day.dayGames, games); assert(day.dayWins >= w)
for (let i = 0; i < 8; i++) { const m = await playOut(NEW); if (m.view.winner === 0) break }
assert.equal((await sql`select count(*)::int as n from card_mail where to_h = ${hash(NEW)}`)[0].n, 0, '没开够卡的新号赢了也不发金币')
console.log(`ok  每天前 ${SWIFT_PAID_GAMES} 场有奖励（赢 ${SWIFT_WIN_COINS}、输 ${SWIFT_LOSS_COINS}），认输不发，新号不发`)

// ---------------------------------------------------------------- the sweep finishes what nobody reads
await call('/queue', { id: A })
now += (SWIFT_WAIT_SEC + 1) * 1000
const left = (await call('', { id: A })).match.id
const mailBefore = (await sql`select count(*)::int as n from card_mail where to_h = ${hash(A)}`)[0].n
now += 40_000
await api.sweep(now)
assert.equal((await sql`select jsonb_array_length(state->'log') as n from swift_matches where id = ${left}`)[0].n, 0, '离开半分钟（锁屏）不会被系统打掉')
for (let i = 0; i < 80; i++) { now += 30_000; await api.sweep(now); if ((await sql`select status from swift_matches where id = ${left}`)[0].status === 'done') break }
const idle = (await sql`select status, ratings from swift_matches where id = ${left}`)[0]
assert.equal(idle.status, 'done', '没人看的比赛会被打完')
assert.equal(idle.ratings['0'].unpaid, 'idle', '一回合都没自己出的不发奖励')
assert.equal((await sql`select count(*)::int as n from card_mail where to_h = ${hash(A)}`)[0].n, mailBefore)
assert.equal((await call('', { id: A })).recent?.id, left, '刷新后还能看到刚结束那场的结果')
// two formats queue apart
await call('/queue', { id: A, format: 'quick' })
await call('/queue', { id: B, format: 'full' })
assert(!(await call('', { id: A })).match && !(await call('', { id: B })).match, '快速和完整不会配到一起')
now += (SWIFT_WAIT_SEC + 1) * 1000
const fa = (await call('', { id: A })).match, fb = (await call('', { id: B })).match
const fmtOf = async (mid: string) => (await sql`select state->>'format' as f from swift_matches where id = ${mid}`)[0].f
assert.equal(await fmtOf(fa.id), 'quick'); assert.equal(await fmtOf(fb.id), 'full')
assert.equal(fb.view.format, 'full')
await call('/leave', { id: A, match: fa.id, resign: true }); await call('/leave', { id: B, match: fb.id, resign: true })
const board = (await call('', {})).board
assert(Array.isArray(board))
console.log('ok  无人比赛自动打完且不发奖励，快速/完整分开排，排行榜可读')
console.log('\nall 读点 server checks passed')
