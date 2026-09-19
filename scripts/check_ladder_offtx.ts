/**
 * A ladder match played OUTSIDE its database transaction: one request is one
 * match, 体力 is spent once, a full queue spends nothing, a five changed while
 * the match was being played is the five that gets played, and the rival scan
 * runs once for everybody who asks while it is cold.
 *
 *   npx tsx scripts/check_ladder_offtx.ts
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { newGacha } from '../src/engine/gacha'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import { MatchQueueFull, createMatchComputer } from '../match-worker.js'

const { CARD_SCHEMA, makeCardApi, engine } = await import('../cards-api.js')
const db = new PGlite(), raw = makeSql(db)
await db.exec(CARD_SCHEMA)
// count the scans that read every account
let scans = 0
const sql: any = (strings: TemplateStringsArray, ...values: unknown[]) => {
  if (strings.join('?').includes('partition by div')) scans++
  return raw(strings, ...values)
}
Object.assign(sql, raw)
sql.json = raw.json.bind(raw); sql.begin = raw.begin?.bind(raw); sql.unsafe = raw.unsafe?.bind(raw)

type Reply = { code: number; body: Record<string, any> }
const json = (res: Reply, code: number, body: Reply['body']) => { res.code = code; res.body = body }
// a match computer the test holds the door of
let hold: Promise<void> | null = null
let full = false
let played = 0
const matches = {
  async run(g: any, action: string, args: any, env: any) {
    if (full) throw new MatchQueueFull()
    if (hold) await hold
    played++
    return { out: engine.runAction(g, action, args, env), g, ms: 1 }
  },
  stats: () => ({}),
}
const cards = makeCardApi(sql, { rateLimited: () => false, readBody: async (req: { body: string }) => req.body, json, matches } as never)
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
async function call(path: string, body: unknown) {
  const out: Reply = { code: 0, body: { ok: false } }
  await cards.route({ method: 'POST', body: JSON.stringify(body) } as never, out as never, path, 'offtx')
  return out.body
}
const today = new Date().toISOString().slice(0, 10)
const idOf = (i: number) => `VM-CVPM-CVPM-CVPM-CVPM-CV${'0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(i / 32)]}${'0123456789ABCDEFGHJKMNPQRSTVWXYZ'[i % 32]}`
async function account(i: number) {
  const id = idOf(i), team = CUP_TEAMS[i % CUP_TEAMS.length]
  await call('/api/card/claim', { id, name: `队${i}` })
  const g = newGacha(id, `队${i}`, today)
  const ids = [...team.squad.slots, team.squad.coach].filter((x): x is string => !!x)
  g.cards = Object.fromEntries(ids.map((c) => [c, { id: c, level: 1, dupes: 0, seen: 1, got: today }]))
  g.squad = structuredClone(team.squad)
  g.ladder = { ...g.ladder, div: 4, stars: 2, best: 4 }
  g.daily.stamina = 20; g.daily.staminaAt = Date.now()
  await raw`update card_accounts set state = ${raw.json(g)} where id_hash = ${hash(id)}`
  return id
}
const row = async (id: string) => (await raw`select state, rev from card_accounts where id_hash = ${hash(id)}`)[0]
const total = (s: any) => s.ladder.wins + s.ladder.losses
const rid = (n: number) => `offtx-request-${String(n).padStart(6, '0')}`

const ids: string[] = []
for (let i = 0; i < 12; i++) ids.push(await account(i))
cards.invalidate()
const me = ids[0]

// 1. twelve cold requests, one scan
scans = 0
const first = await Promise.all(ids.map((id, i) => call('/api/card/act', { id, action: 'ladder', args: {}, client: {}, requestId: rid(i) })))
assert(first.every((r) => r.ok && r.result?.res?.bo === 5), JSON.stringify(first.find((r) => !r.ok)))
assert.equal(scans, 1, `对手池冷启动时只扫一次，扫了 ${scans} 次`)
console.log('ok  十二个人同时开打：每人一场 BO5，对手池全表扫描只跑一次')

// 2. the same tap sent twice while the match is still being played
const before = await row(me)
let open!: () => void
hold = new Promise<void>((r) => { open = r })
played = 0
const twice = [1, 2].map(() => call('/api/card/act', { id: me, action: 'ladder', args: {}, client: {}, requestId: rid(100) }))
await new Promise((r) => setTimeout(r, 50))
open(); hold = null
const [a, b] = await Promise.all(twice)
const after = await row(me)
assert(a.ok && b.ok && (a.replayed === true) !== (b.replayed === true), '一份是原答复，一份是重放')
assert.deepEqual(a.result.res.maps?.length, b.result.res.maps?.length)
assert.equal(total(after.state), total(before.state) + 1, '只记一场')
assert.equal(after.state.daily.stamina, before.state.daily.stamina - engine.STAMINA_COST.ladder, '体力只扣一次')
assert.equal(played, 1, '只算了一场')
console.log('ok  同一请求连点两次：算一场、记一场、扣一次体力，第二份是重放')

// 3. the queue is full: told so, nothing spent
full = true
const was = await row(me)
const refused = await call('/api/card/act', { id: me, action: 'ladder', args: {}, client: {}, requestId: rid(200) })
full = false
const still = await row(me)
assert(!refused.ok && refused.busy && /排队/.test(refused.why))
assert.deepEqual([still.rev, still.state.daily.stamina, total(still.state)], [was.rev, was.state.daily.stamina, total(was.state)])
const retry = await call('/api/card/act', { id: me, action: 'ladder', args: {}, client: {}, requestId: rid(200) })
assert(retry.ok && !retry.replayed, '同一请求号之后还能正常打')
console.log('ok  排队已满：提示稍后再试，体力、场次、版本号都没动；同一请求号之后可重试')

// 4. the account is written by somebody else while the match is being played
const pre = await row(me)
hold = new Promise<void>((r) => { open = r })
played = 0
const racing = call('/api/card/act', { id: me, action: 'ladder', args: {}, client: {}, requestId: rid(300) })
await new Promise((r) => setTimeout(r, 50))
await raw`update card_accounts set state = jsonb_set(state, '{coins}', '777777'::jsonb), rev = rev + 1 where id_hash = ${hash(me)}`
open(); hold = null
const raced = await racing
const post = await row(me)
assert(raced.ok)
assert.equal(played, 2, '旧版本上算的那场作废，重算一场')
assert.equal(post.state.coins >= 777777, true, '别人写进去的金币还在')
assert.equal(total(post.state), total(pre.state) + 1)
assert.equal(post.state.daily.stamina, pre.state.daily.stamina - engine.STAMINA_COST.ladder)
console.log('ok  算比赛期间账号被改：旧结果不写入，按新账号重打，仍只记一场、扣一次体力')

// 5. the real worker plays the same rules
const real = createMatchComputer({ workers: 1, queue: 4 })
const g0 = engine.mergeClientFields(engine.migrateGacha((await row(ids[3])).state, ids[3]), {})
const env = { now: Date.now(), today, seed: 424242, rival: null }
const viaWorker = await real.run(structuredClone(g0), 'ladder', {}, env)
const inline = engine.runAction(structuredClone(g0), 'ladder', {}, env)
real.close()
assert.deepEqual(JSON.parse(JSON.stringify(viaWorker.out)), JSON.parse(JSON.stringify(inline)), 'worker 和主线程同一颗种子打出同一场')
console.log('ok  worker 线程里的比赛和主线程逐字节一致（同种子）')

// 6. the shape that made it slow cannot come back unnoticed
const src = readFileSync(new URL('../cards-api.js', import.meta.url), 'utf8')
const open2 = src.slice(src.indexOf('const openAttempt = async'), src.indexOf('// One account\'s actions take turns'))
const txStart = open2.indexOf('await run(async (db)')
assert(txStart > 0 && open2.indexOf('pickRival(') < txStart && open2.indexOf('matches.run(') < txStart && open2.indexOf('engine.runAction(') < txStart, '找对手和算比赛都必须在事务开始之前')
assert(!/pickRival\([^)]*\bdb\b/.test(src), 'pickRival 不再接受事务连接')
console.log('ok  源码：找对手、算比赛都在事务之外')
await db.close()
