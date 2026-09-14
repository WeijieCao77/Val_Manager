/** SMS concurrency regressions. No network, no persistent/player database. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { CARD_SCHEMA, normalizeId } from '../cards-api.js'
import { makePhoneApi, phoneHash } from '../phone-api.js'

const db = new PGlite()
const sql = makeSql(db)
await db.exec(CARD_SCHEMA)
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
const options = {
  readBody: async (req: { body: unknown }) => JSON.stringify(req.body),
  json: (res: { body?: any }, _status: number, body: any) => { res.body = body },
  rateLimited: () => false, normalizeId, hash,
}
const make = (extra: object) => makePhoneApi(sql, { ...options, ...extra } as never)
async function call(api: ReturnType<typeof make>, action: string, body: object) {
  const res: { body?: any } = {}
  await api.route({ method: 'POST', body }, res, `/api/card/phone/${action}`, 'test', new URL('http://local'))
  return res.body
}
const deferred = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
const PHONE = '13800138000'
const PH = phoneHash(PHONE)
const IDS = ['VM-2222-2222-2222-2222-2222', 'VM-3333-3333-3333-3333-3333']
for (const id of IDS) await sql`insert into card_accounts (id_hash, state) values (${hash(id)}, '{}')`

// Profile saves/loads use ps/pl buckets; they must not spend the phone quotas.
const hits = new Map([['ps:test', 60], ['pl:test', 40]])
const isolated = makePhoneApi(sql, { ...options, sender: async () => {},
  rateLimited: (key: string, max: number) => {
    const n = (hits.get(key) ?? 0) + 1
    hits.set(key, n)
    return n > max
  },
} as never)
assert((await call(isolated, 'send', { phone: '13400134000' })).ok)
const unknownLogin = await call(isolated, 'login', { phone: '13400134000', code: '123456' })
assert(unknownLogin.none)
console.log('ok  档案读写不会占用手机号发码/登录限额')
await sql`delete from card_sms`

// An SMS in flight reserves its minute/day budget even through another API instance.
let sends = 0
const sending = deferred(), finishSend = deferred()
const delayed = make({ sender: async () => { sends++; sending.release(); await finishSend.promise } })
const other = make({ sender: async () => { sends++ }, checker: async () => true })
const firstSend = call(delayed, 'send', { phone: PHONE })
await sending.promise
const repeated = await Promise.all(Array.from({ length: 6 }, () => call(other, 'send', { phone: PHONE })))
assert.equal(sends, 1)
assert(repeated.every((r) => !r.ok && r.wait > 0))
// This query completes while the provider is blocked: no database transaction is held.
assert.equal((await sql`select count(*)::int as n from card_sms`)[0].n, 1)
finishSend.release()
assert((await firstSend).ok)
console.log('ok  同号并发发码只发送一条，供应商等待不占用数据库事务')

// One code cannot verify two accounts; overlapping checks receive a retryable refusal.
const checking = deferred(), finishCheck = deferred()
const verifier = make({ checker: async () => { checking.release(); await finishCheck.promise; return true } })
const bindA = call(verifier, 'bind', { id: IDS[0], phone: PHONE, code: '123456' })
await checking.promise
const bindB = await call(other, 'bind', { id: IDS[1], phone: PHONE, code: '123456' })
assert.equal(bindB.ok, false)
assert.match(bindB.why, /处理中/)
finishCheck.release()
assert((await bindA).ok)
assert.equal((await sql`select count(*)::int as n from card_accounts where verified is not null`)[0].n, 1)
assert.equal((await sql`select count(*)::int as n from card_phones`)[0].n, 1)
assert.equal((await sql`select code_h from card_sms`)[0].code_h, 'used')
assert.equal((await call(other, 'login', { phone: PHONE, code: '123456' })).ok, false)
assert.equal((await call(other, 'send', { phone: PHONE, for: 'login' })).ok, false)
console.log('ok  一个验证码只认证一个账号，消费后不能重放或重置一分钟限额')

// Starting at four failures, twenty simultaneous guesses buy only the fifth check.
await sql`update card_sms set tries = 4, code_h = ''`
let checks = 0
const wrong = make({ checker: async () => { checks++; return false } })
const guesses = await Promise.all(Array.from({ length: 20 }, () => call(wrong, 'login', { phone: PHONE, code: '000000' })))
assert(guesses.every((r) => !r.ok))
assert.equal(checks, 1)
assert.equal((await sql`select tries from card_sms`)[0].tries, 5)
assert.equal((await call(other, 'login', { phone: PHONE, code: '123456' })).ok, false)
console.log('ok  并发试错严格限制五次，旧 ctid 不能绕过次数')

// Five successful logins still count as five sends; expire only the minute in the fixture.
await sql`delete from card_sms`
for (let i = 0; i < 5; i++) {
  assert((await call(other, 'send', { phone: PHONE, for: 'login' })).ok)
  assert((await call(other, 'login', { phone: PHONE, code: '123456' })).ok)
  await sql`update card_sms set sent = sent - interval '61 seconds'`
}
const sixth = await call(other, 'send', { phone: PHONE, for: 'login' })
assert.equal(sixth.ok, false)
assert.match(sixth.why, /今天/)
assert.equal((await sql`select count(*)::int as n from card_sms`)[0].n, 5)
console.log('ok  成功登录保留每日五条配额')

// A provider failure releases only its own reservation, allowing a legitimate retry.
const failedPhone = '13900139000'
const fail = make({ sender: async () => { throw new Error('injected sender failure') } })
assert.equal((await call(fail, 'send', { phone: failedPhone })).ok, false)
assert.equal((await sql`select count(*)::int as n from card_sms where phone_h = ${phoneHash(failedPhone)}`)[0].n, 0)
assert((await call(other, 'send', { phone: failedPhone })).ok)
let failCheck = true
const flaky = make({ checker: async () => { if (failCheck) throw new Error('injected checker failure'); return true } })
assert.equal((await call(flaky, 'bind', { id: IDS[1], phone: failedPhone, code: '123456' })).ok, false)
failCheck = false
assert((await call(flaky, 'bind', { id: IDS[1], phone: failedPhone, code: '123456' })).ok)
console.log('ok  供应商失败释放预留，不吞掉仍有效的验证码')

// Two different numbers cannot race into the same account.
const thirdId = 'VM-4444-4444-4444-4444-4444'
await sql`insert into card_accounts (id_hash, state) values (${hash(thirdId)}, '{}')`
const p3 = '13700137000', p4 = '13600136000'
await call(other, 'send', { phone: p3 })
await call(other, 'send', { phone: p4 })
const both = await Promise.all([p3, p4].map((phone) => call(other, 'bind', { id: thirdId, phone, code: '123456' })))
assert.equal(both.filter((r) => r.ok).length, 1)
assert.equal((await sql`select count(*)::int as n from card_phones where id_hash = ${hash(thirdId)}`)[0].n, 1)
console.log('ok  同账号并发绑定不同手机号只保留一个')

// A write failure after the phone insert rolls back ownership and code consumption.
const fourthId = 'VM-5555-5555-5555-5555-5555', p5 = '13500135000'
await sql`insert into card_accounts (id_hash, state) values (${hash(fourthId)}, '{}')`
await call(other, 'send', { phone: p5 })
const failingSql = Object.assign((...args: any[]) => (sql as any)(...args), sql, {
  begin: (fn: (tx: any) => unknown) => sql.begin((tx: any) => fn(Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('').includes('update card_accounts set verified')) throw new Error('injected account write failure')
      return tx(strings, ...values)
    }, { json: tx.json },
  ))),
})
const writeFailure = makePhoneApi(failingSql, { ...options, checker: async () => true } as never)
assert.equal((await call(writeFailure, 'bind', { id: fourthId, phone: p5, code: '123456' })).ok, false)
assert.equal((await sql`select count(*)::int as n from card_phones where phone_h = ${phoneHash(p5)}`)[0].n, 0)
assert.equal((await sql`select verified from card_accounts where id_hash = ${hash(fourthId)}`)[0].verified, null)
assert.equal((await sql`select code_h from card_sms where phone_h = ${phoneHash(p5)}`)[0].code_h, '')
assert((await call(other, 'bind', { id: fourthId, phone: p5, code: '123456' })).ok)
console.log('ok  绑定写入失败整笔回滚，账号和验证码均可安全重试')

await db.close()
