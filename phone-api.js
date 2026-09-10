/**
 * A phone number behind every card account.
 *
 * 「太多人开小号了」— the account id is a random string the browser keeps, so
 * a second account was a private window away. From here an account plays
 * only after a mainland phone number has answered a code, and one number
 * holds one account: binding a number to an account claims it, a number
 * already holding another account cannot be bound again, and the same code
 * flow lets a player walk INTO the account a number holds (「用手机号进入」),
 * which is also the first real way to recover an id nobody wrote down.
 *
 * What is stored: never the number. sha256(salt + number) to match on, the
 * last four digits to show, and the account's own id encrypted with a server
 * key so a login can hand it back. Codes are stored hashed, expire in ten
 * minutes, allow five tries, and a number gets one code a minute and five a
 * day. The sender is Aliyun SMS (RPC signature, no SDK) when
 * ALIYUN_SMS_KEY_ID / ALIYUN_SMS_KEY_SECRET / ALIYUN_SMS_SIGN /
 * ALIYUN_SMS_TEMPLATE are set; without them codes go to the server log and to
 * the owner's admin route, which is how the owner verifies a player by hand
 * (overseas numbers cannot receive a mainland template — they message the
 * owner, who calls /api/admin/verify on their battle code).
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt } from 'node:crypto'

// the tables live in CARD_SCHEMA (cards-api.js), so every harness that builds
// the card tables has them; kept as a name for anything that imported it
export const PHONE_SCHEMA = ''

const CODE_TTL_MS = 10 * 60 * 1000
const MAX_TRIES = 5
const PER_MINUTE_MS = 60 * 1000
const PER_DAY = 5
const SALT = process.env.PHONE_SALT || process.env.ANALYTICS_TOKEN || 'valmanager-phone'
const KEY = createHash('sha256').update(process.env.PHONE_KEY || process.env.ANALYTICS_TOKEN || 'valmanager-phone-key').digest()

export const phoneHash = (phone) => createHash('sha256').update(`${SALT}:${phone}`).digest('hex')
const codeHash = (phoneH, code) => createHash('sha256').update(`${SALT}:${phoneH}:${code}`).digest('hex')

export function normalizePhone(raw) {
  let s = String(raw ?? '').replace(/[^\d+]/g, '')
  if (s.startsWith('+86')) s = s.slice(3)
  else if (s.startsWith('86') && s.length === 13) s = s.slice(2)
  else if (s.startsWith('0086')) s = s.slice(4)
  return /^1[3-9]\d{9}$/.test(s) ? s : null
}

export function encryptId(id) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', KEY, iv)
  const body = Buffer.concat([c.update(String(id), 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')
}

export function decryptId(enc) {
  const buf = Buffer.from(String(enc), 'base64')
  const d = createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
}

// ---------------------------------------------------------------- senders

/** the last codes handed out in dev mode, for the owner's admin route */
export const devCodes = []

const pct = (s) => encodeURIComponent(s).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~')

/** Aliyun Dysmsapi SendSms, RPC style signature v1. */
export async function sendAliyun(phone, code, env = process.env) {
  const params = {
    AccessKeyId: env.ALIYUN_SMS_KEY_ID, Action: 'SendSms', Format: 'JSON', PhoneNumbers: phone,
    RegionId: 'cn-hangzhou', SignName: env.ALIYUN_SMS_SIGN, SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: randomBytes(16).toString('hex'), SignatureVersion: '1.0',
    TemplateCode: env.ALIYUN_SMS_TEMPLATE, TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), Version: '2017-05-25',
  }
  const canon = Object.keys(params).sort().map((k) => `${pct(k)}=${pct(params[k])}`).join('&')
  const toSign = `GET&${pct('/')}&${pct(canon)}`
  const sig = createHmac('sha1', `${env.ALIYUN_SMS_KEY_SECRET}&`).update(toSign).digest('base64')
  const url = `https://dysmsapi.aliyuncs.com/?${canon}&Signature=${pct(sig)}`
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  const j = await r.json().catch(() => ({}))
  if (j?.Code !== 'OK') throw new Error(`aliyun ${j?.Code || r.status}: ${j?.Message || ''}`)
  return true
}

export const smsConfigured = (env = process.env) =>
  !!(env.ALIYUN_SMS_KEY_ID && env.ALIYUN_SMS_KEY_SECRET && env.ALIYUN_SMS_SIGN && env.ALIYUN_SMS_TEMPLATE)

async function send(phone, code, sender) {
  if (sender) return sender(phone, code)
  if (smsConfigured()) return sendAliyun(phone, code)
  devCodes.unshift({ last4: phone.slice(-4), code, at: new Date().toISOString() })
  devCodes.splice(50)
  console.log(`sms(dev): ****${phone.slice(-4)} code ${code}`)
  return true
}

// ---------------------------------------------------------------- the api

export function makePhoneApi(sql, { readBody, json, rateLimited, normalizeId, hash, token, tokenFrom, tokenOk, sender }) {
  const guard = (res, key, max) => {
    if (rateLimited(key, max)) { json(res, 429, { ok: false, why: '操作太频繁，稍等一下。' }); return true }
    return false
  }
  const body = async (req, res) => {
    try { return JSON.parse(await readBody(req, 4096)) } catch { json(res, 400, { ok: false }); return null }
  }

  async function sendCode(req, res, bucket) {
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    if (guard(res, `ps:${bucket}`, 6)) return
    const b = await body(req, res)
    if (!b) return
    const phone = normalizePhone(b.phone)
    if (!phone) { json(res, 200, { ok: false, why: '只收中国大陆的 11 位手机号。海外号码请到抖音私信作者人工处理。' }); return }
    const ph = phoneHash(phone)
    const recent = await sql`select sent from card_sms where phone_h = ${ph} and sent > now() - interval '1 day' order by sent desc`
    if (recent.length && Date.now() - new Date(recent[0].sent).getTime() < PER_MINUTE_MS) {
      json(res, 200, { ok: false, why: '一分钟内只能发一次，稍等。', wait: Math.ceil((PER_MINUTE_MS - (Date.now() - new Date(recent[0].sent).getTime())) / 1000) })
      return
    }
    if (recent.length >= PER_DAY) { json(res, 200, { ok: false, why: '这个号今天发得太多了，明天再试。' }); return }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    try {
      await send(phone, code, sender)
    } catch (err) {
      console.warn('sms: send failed —', err.message)
      json(res, 200, { ok: false, why: '短信没发出去，稍后再试。' })
      return
    }
    await sql`insert into card_sms (phone_h, code_h, ip) values (${ph}, ${codeHash(ph, code)}, ${bucket})`
    json(res, 200, { ok: true, wait: 60, dev: !smsConfigured() && !sender })
  }

  /** the freshest usable code for a number; consumes a try; null = no match */
  async function verify(ph, code) {
    const rows = await sql`select ctid, code_h, tries, sent from card_sms where phone_h = ${ph}
                           and sent > now() - interval '10 minutes' order by sent desc limit 1`
    if (!rows.length) return { ok: false, why: '验证码过期了，重新发一个。' }
    const r = rows[0]
    if (r.tries >= MAX_TRIES) return { ok: false, why: '试错太多次了，重新发一个。' }
    await sql`update card_sms set tries = tries + 1 where ctid = ${r.ctid}`
    if (r.code_h !== codeHash(ph, String(code ?? '').trim())) return { ok: false, why: '验证码不对。' }
    await sql`delete from card_sms where phone_h = ${ph}`
    return { ok: true }
  }

  async function bind(req, res, bucket) {
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    if (guard(res, `pb:${bucket}`, 20)) return
    const b = await body(req, res)
    if (!b) return
    const id = normalizeId(b.id)
    const phone = normalizePhone(b.phone)
    if (!id || !phone) { json(res, 200, { ok: false, why: '手机号或账号不对。' }); return }
    const ph = phoneHash(phone)
    const me = hash(id)
    const acct = await sql`select verified from card_accounts where id_hash = ${me}`
    if (!acct.length) { json(res, 200, { ok: false, why: '账号还没建好，刷新再试。' }); return }
    const held = await sql`select id_hash from card_phones where phone_h = ${ph}`
    if (held.length && held[0].id_hash !== me) {
      json(res, 200, { ok: false, why: '这个手机号已经绑了另一个账号。一个号只能有一个账号；要进那个账号，用「用手机号进入」。', taken: true })
      return
    }
    const mine = await sql`select last4 from card_phones where id_hash = ${me}`
    if (mine.length && !held.length) { json(res, 200, { ok: false, why: `这个账号已经绑了尾号 ${mine[0].last4} 的手机。`, bound: true }); return }
    const v = await verify(ph, b.code)
    if (!v.ok) { json(res, 200, v); return }
    await sql.begin(async (tx) => {
      await tx`insert into card_phones (phone_h, id_hash, id_enc, last4) values (${ph}, ${me}, ${encryptId(id)}, ${phone.slice(-4)})
               on conflict (phone_h) do nothing`
      await tx`update card_accounts set verified = coalesce(verified, now()), verify_via = coalesce(verify_via, 'sms') where id_hash = ${me}`
    })
    json(res, 200, { ok: true, phone: phone.slice(-4) })
  }

  async function login(req, res, bucket) {
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    if (guard(res, `pl:${bucket}`, 20)) return
    const b = await body(req, res)
    if (!b) return
    const phone = normalizePhone(b.phone)
    if (!phone) { json(res, 200, { ok: false, why: '手机号不对。' }); return }
    const ph = phoneHash(phone)
    const held = await sql`select id_enc, last4 from card_phones where phone_h = ${ph}`
    if (!held.length) { json(res, 200, { ok: false, why: '这个手机号还没绑过账号。', none: true }); return }
    const v = await verify(ph, b.code)
    if (!v.ok) { json(res, 200, v); return }
    let id
    try { id = decryptId(held[0].id_enc) } catch { json(res, 200, { ok: false, why: '账号记录读不出来，请联系作者。' }); return }
    json(res, 200, { ok: true, id, phone: held[0].last4 })
  }

  const admin = (req, url, res) => {
    if (!token || !tokenOk(tokenFrom ? tokenFrom(req, url) : url.searchParams.get('token'), token)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
      return false
    }
    return true
  }

  /** the owner verifies an account by hand: ?code=<对战码>&via=douyin:xxx */
  async function adminVerify(req, res, url) {
    if (!admin(req, url, res)) return
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    const code = String(url.searchParams.get('code') || '').toLowerCase().slice(0, 8)
    const via = String(url.searchParams.get('via') || 'manual').slice(0, 60)
    if (code.length !== 8) { json(res, 400, { ok: false, why: 'code' }); return }
    const rows = await sql`update card_accounts set verified = coalesce(verified, now()), verify_via = ${`manual:${via}`}
                           where left(id_hash, 8) = ${code} returning name, verified`
    json(res, 200, { ok: rows.length > 0, matched: rows.length, name: rows[0]?.name ?? null })
  }

  async function adminCodes(req, res, url) {
    if (!admin(req, url, res)) return
    json(res, 200, { ok: true, configured: smsConfigured(), codes: devCodes })
  }

  return {
    async route(req, res, path, bucket, url) {
      if (path === '/api/card/phone/send') { if (req.method !== 'POST') { json(res, 405, { ok: false }); return true } await sendCode(req, res, bucket); return true }
      if (path === '/api/card/phone/bind') { if (req.method !== 'POST') { json(res, 405, { ok: false }); return true } await bind(req, res, bucket); return true }
      if (path === '/api/card/phone/login') { if (req.method !== 'POST') { json(res, 405, { ok: false }); return true } await login(req, res, bucket); return true }
      if (path === '/api/admin/verify') { await adminVerify(req, res, url); return true }
      if (path === '/api/admin/sms') { await adminCodes(req, res, url); return true }
      return false
    },
  }
}

/** Is this account allowed to play? On unless PHONE_GATE=0 (the test harnesses). */
export const phoneGate = () => process.env.PHONE_GATE !== '0'

export async function isVerified(sql, idHash) {
  if (!phoneGate()) return true
  const rows = await sql`select verified from card_accounts where id_hash = ${idHash}`
  return !!rows[0]?.verified
}
