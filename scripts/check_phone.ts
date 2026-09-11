/**
 * A phone behind every account. (2026-09-11)
 *
 *   npx tsx scripts/check_phone.ts
 *
 * 「太多人开小号了」: an account plays only after a mainland number has
 * answered a code, one number holds one account, and the same code lets a
 * player into the account the number holds. Codes are hashed, expire, allow
 * five tries; a number gets one code a minute. The dev sender (no Aliyun keys)
 * hands the code to the log and the admin route; the Aliyun request is
 * checked for its signature shape without sending.
 */
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { createHash } from 'node:crypto'
import { CARD_SCHEMA, makeCardApi, normalizeId } from '../cards-api.js'
import { checkVerify, devCodes, devMode, encryptId, decryptId, makePhoneApi, normalizePhone, sendVerify, smsConfigured } from '../phone-api.js'

process.env.PHONE_GATE = '1'
// the harness decides the mode, not the machine it runs on: CI carries Railway's
// variables, a laptop may carry Aliyun keys
process.env.PHONE_SMS_DEV = '1'
for (const k of ['ALIYUN_SMS_ACCESS_KEY_ID', 'ALIYUN_SMS_ACCESS_KEY_SECRET', 'ALIYUN_SMS_SIGN_NAME']) delete process.env[k]
const db = new PGlite()
const sql = makeSql(db)
await db.exec(CARD_SCHEMA)
let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const rateHits = new Map<string, number>()
const rateLimited = (key: string, max = 60) => { const n = (rateHits.get(key) ?? 0) + 1; rateHits.set(key, n); return n > max }
const readBody = (req: { body: string }) => Promise.resolve(req.body)
interface Res { code: number; body: Record<string, unknown>; headersSent?: boolean; writeHead?: unknown }
const json = (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body }
const hash = (id: string) => createHash('sha256').update(String(id)).digest('hex')
const cards = makeCardApi(sql, { rateLimited, readBody, json } as never)
const phone = makePhoneApi(sql, { readBody, json, rateLimited, normalizeId, hash, token: 'tok', tokenFrom: (_r: unknown, u: URL) => u.searchParams.get('token'), tokenOk: (a: string, b: string) => a === b } as never)
async function call(api: { route: (...a: never[]) => Promise<boolean> }, path: string, body: unknown, bucket = 'test', query = ''): Promise<Res> {
  const res: Res = { code: 0, body: {}, writeHead: () => ({ end: () => {} }) }
  const req = { body: JSON.stringify(body), method: path.startsWith('/api/admin') ? 'GET' : 'POST' }
  await api.route(req as never, res as never, path as never, bucket as never, new URL(`http://x${path}?${query}`) as never)
  return res
}

// ---- numbers ----------------------------------------------------------
check('大陆号码通过', normalizePhone('138 0013 8000') === '13800138000')
check('+86 前缀去掉', normalizePhone('+8613800138000') === '13800138000')
check('固话、海外号拒绝', normalizePhone('02112345678') === null && normalizePhone('+12125551234') === null)
check('id 加密能解回来', decryptId(encryptId('VM-ABCD-EFGH-JKMN-PQRS-TVWX')) === 'VM-ABCD-EFGH-JKMN-PQRS-TVWX')

// ---- a new account cannot play until bound ---------------------------
const ID = 'VM-ABCD-EFGH-JKMN-PQRS-TVWX'
let r = await call(cards, '/api/card/claim', { id: ID, name: '点点' })
check('新账号能建', r.body.ok === true)
r = await call(cards, '/api/card/load', { id: ID })
check('load 说没绑', r.body.ok === true && r.body.verified === false && r.body.phone === null, JSON.stringify({ v: r.body.verified, p: r.body.phone }))
const state = (r.body.state as Record<string, unknown>)
r = await call(cards, '/api/card/act', { id: ID, action: 'checkin', client: state })
check('没绑不能开包签到', r.body.ok === false && r.body.unverified === true, String(r.body.why))

// ---- send, bind ---------------------------------------------------------
r = await call(phone, '/api/card/phone/send', { phone: '13800138000' })
check('发码成功（开发模式）', r.body.ok === true && r.body.dev === true, JSON.stringify(r.body))
const code = devCodes[0].code
check('验证码是六位数字', /^\d{6}$/.test(code))
r = await call(phone, '/api/card/phone/send', { phone: '13800138000' })
check('一分钟内不能再发', r.body.ok === false && typeof r.body.wait === 'number', String(r.body.why))
r = await call(phone, '/api/card/phone/bind', { id: ID, phone: '13800138000', code: '000000' })
check('错码拒绝', r.body.ok === false && String(r.body.why).includes('不对'))
r = await call(phone, '/api/card/phone/bind', { id: ID, phone: '13800138000', code })
check('对码绑定', r.body.ok === true && r.body.phone === '8000', JSON.stringify(r.body))
r = await call(cards, '/api/card/load', { id: ID })
check('load 说绑了、尾号 8000', r.body.verified === true && r.body.phone === '8000')
r = await call(cards, '/api/card/act', { id: ID, action: 'checkin', client: r.body.state })
check('绑了就能玩', r.body.ok === true, String(r.body.why ?? ''))
r = await call(phone, '/api/card/phone/bind', { id: ID, phone: '13800138000', code })
check('用过的码作废', r.body.ok === false)

// ---- one number, one account --------------------------------------------
const ID2 = 'VM-2222-2222-2222-2222-2222'
await call(cards, '/api/card/claim', { id: ID2, name: '小号' })
rateHits.clear()
await sql`delete from card_sms`
const sentBefore = devCodes.length
r = await call(phone, '/api/card/phone/send', { phone: '13800138000', for: 'bind', id: ID2 }, 'other')
check('用过的号给第二个账号发码：直接拒，不发', r.body.ok === false && r.body.taken === true && devCodes.length === sentBefore, String(r.body.why))
r = await call(phone, '/api/card/phone/send', { phone: '13800138000' }, 'other')
check('不带账号也一样拒', r.body.ok === false && r.body.taken === true && devCodes.length === sentBefore, String(r.body.why))
r = await call(phone, '/api/card/phone/bind', { id: ID2, phone: '13800138000', code: '123456' })
check('同一个号绑第二个账号被拒', r.body.ok === false && r.body.taken === true, String(r.body.why))
r = await call(phone, '/api/card/phone/send', { phone: '13900139000', for: 'bind', id: ID }, 'other2')
check('绑过的账号给第二个号发码：直接拒，不发', r.body.ok === false && r.body.bound === true && devCodes.length === sentBefore, String(r.body.why))
r = await call(phone, '/api/card/phone/send', { phone: '13900139000' }, 'other2')
const code3 = devCodes[0].code
r = await call(phone, '/api/card/phone/bind', { id: ID, phone: '13900139000', code: code3 })
check('一个账号不能绑第二个号', r.body.ok === false && r.body.bound === true, String(r.body.why))

// ---- walking into the account a number holds -----------------------------
await sql`delete from card_sms`
r = await call(phone, '/api/card/phone/send', { phone: '13900139000', for: 'login' }, 'login0')
check('没绑过的号要登录：直接拒，不发', r.body.ok === false && r.body.none === true, String(r.body.why))
r = await call(phone, '/api/card/phone/send', { phone: '13800138000', for: 'login' }, 'login')
check('绑过的号要登录：发', r.body.ok === true, String(r.body.why))
const code4 = devCodes[0].code
r = await call(phone, '/api/card/phone/login', { phone: '13800138000', code: code4 })
check('用手机号进入拿回账号 id', r.body.ok === true && r.body.id === ID, JSON.stringify(r.body))
r = await call(phone, '/api/card/phone/login', { phone: '13900139000', code: '123456' })
check('没绑过的号说没绑过', r.body.ok === false && r.body.none === true)

// ---- five tries, then a fresh code --------------------------------------
await sql`delete from card_sms`
const ID3 = 'VM-3333-3333-3333-3333-3333'
await call(cards, '/api/card/claim', { id: ID3, name: '试错' })
await call(phone, '/api/card/phone/send', { phone: '13700137000' }, 'tries')
let last: Res = { code: 0, body: {} }
for (let i = 0; i < 6; i++) last = await call(phone, '/api/card/phone/bind', { id: ID3, phone: '13700137000', code: '111111' }, `t${i}`)
check('五次之后要重新发', String(last.body.why).includes('重新发'))

// ---- the owner verifies by hand --------------------------------------------
const ID4 = 'VM-4444-4444-4444-4444-4444'
await call(cards, '/api/card/claim', { id: ID4, name: '海外' })
r = await call(phone, '/api/admin/verify', {}, 'admin', `token=tok&code=${hash(ID4).slice(0, 8)}&via=douyin:abc`)
check('后台按对战码手工验证', r.body.ok === true && r.body.matched === 1, JSON.stringify(r.body))
r = await call(cards, '/api/card/load', { id: ID4 })
check('手工验证后能玩、没有手机', r.body.verified === true && r.body.phone === null)
r = await call(phone, '/api/admin/verify', {}, 'admin', `token=wrong&code=${hash(ID4).slice(0, 8)}`)
check('没有口令看不到后台路由', r.code === 0 || r.code === 404)
r = await call(phone, '/api/admin/sms', {}, 'admin', 'token=tok')
check('后台能看开发模式的验证码', r.body.ok === true && Array.isArray(r.body.codes))
check('后台能看发码与绑定的数量，不见号码', r.body.stats && r.body.stats.sent24 >= 1 && r.body.stats.bound >= 1 && !JSON.stringify(r.body.stats).includes('138'))

// ---- the Aliyun 号码认证 requests, without sending ---------------------------
{
  const seen: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    seen.push(String(url))
    const u = new URL(String(url))
    return { status: 200, json: async () => (u.searchParams.get('Action') === 'CheckSmsVerifyCode' ? { Code: 'OK', Model: { VerifyResult: 'PASS' } } : { Code: 'OK' }) }
  }) as never
  const env = { ALIYUN_SMS_ACCESS_KEY_ID: 'AK', ALIYUN_SMS_ACCESS_KEY_SECRET: 'SK', ALIYUN_SMS_SIGN_NAME: '速通互联验证码' }
  check('三个变量齐了才算配置好', smsConfigured(env) && !smsConfigured({ ALIYUN_SMS_ACCESS_KEY_ID: 'AK' }))
  check('Railway 上没配置不是开发模式，除非测试显式要求', !devMode({ RAILWAY_ENVIRONMENT: 'production' }) && devMode({}) && devMode({ RAILWAY_ENVIRONMENT: 'production', PHONE_SMS_DEV: '1' }))
  const ok = await sendVerify('13800138000', env)
  const u = new URL(seen[0])
  check('SendSmsVerifyCode 走号码认证接口、带齐参数', ok && u.hostname === 'dypnsapi.aliyuncs.com' && u.searchParams.get('Action') === 'SendSmsVerifyCode'
    && u.searchParams.get('PhoneNumber') === '13800138000' && u.searchParams.get('SignName') === '速通互联验证码'
    && u.searchParams.get('TemplateCode') === '100001' && u.searchParams.get('TemplateParam') === '{"code":"##code##","min":"5"}'
    && u.searchParams.get('ValidTime') === '300' && u.searchParams.get('CodeLength') === '6'
    && u.searchParams.get('Version') === '2017-05-25' && !!u.searchParams.get('Signature'), u.search.slice(0, 120))
  const pass = await checkVerify('13800138000', '123456', env)
  const c = new URL(seen[1])
  check('CheckSmsVerifyCode 由阿里云判定', pass && c.searchParams.get('Action') === 'CheckSmsVerifyCode' && c.searchParams.get('VerifyCode') === '123456')
  globalThis.fetch = realFetch
}

// ---- with the sender and checker injected, the account flow is the same ----
{
  const sent: string[] = []
  const inj = makePhoneApi(sql, { readBody, json, rateLimited, normalizeId, hash, token: 'tok', tokenFrom: (_r: unknown, u: URL) => u.searchParams.get('token'), tokenOk: (a: string, b: string) => a === b,
    sender: async (p: string) => { sent.push(p) }, checker: async (_p: string, c: string) => c === '424242' } as never)
  const ID5 = 'VM-5555-5555-5555-5555-5555'
  await call(cards, '/api/card/claim', { id: ID5, name: '真短信' })
  await sql`delete from card_sms`
  let r = await call(inj, '/api/card/phone/send', { phone: '13600136000' }, 'inj')
  check('配置好时验证码不在本地生成', r.body.ok === true && r.body.dev === false && sent[0] === '13600136000' && devCodes.every((d) => d.last4 !== '6000'))
  r = await call(inj, '/api/card/phone/bind', { id: ID5, phone: '13600136000', code: '000000' }, 'inj')
  check('阿里云说不对就不对', r.body.ok === false)
  r = await call(inj, '/api/card/phone/bind', { id: ID5, phone: '13600136000', code: '424242' }, 'inj')
  check('阿里云说通过就绑上', r.body.ok === true && r.body.phone === '6000', JSON.stringify(r.body))
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
