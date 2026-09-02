/**
 * Nothing is half-done: every step that moves a card or a coin either
 * completes or leaves the account as it was.
 *
 *   npx tsx scripts/check_atomic.ts
 *
 * The market used to be written as "take the card / the coins, then insert
 * the listing / the offer / the mail". A database error or a dead process
 * between the two left an account short with nothing owed to it. Each of
 * those steps now runs in one transaction, and this proves it the direct
 * way: a database that throws on the second statement, and an account that
 * still holds everything afterwards.
 *
 * Also here: a listing, offer or swap id that is not a number is answered
 * 400, not a bigint cast error and a 500.
 */
process.env.ENGINE_FROM_SOURCE = '1'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { createHash } from 'node:crypto'
import { ALL_CARDS } from '../src/engine/cards'
import { STAMINA_MAX } from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'

const { CARD_SCHEMA, makeCardApi, normalizeId, battleCode } = await import('../cards-api.js')
const { makeMarketApi, TRADE_PULLS } = await import('../market-api.js')
const { displayName } = await import('../names.js')
const engine = await import('../src/engine/server.ts')

const db = new PGlite()
const sql = makeSql(db)
await db.exec(CARD_SCHEMA)

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const hashOf = (id: string) => createHash('sha256').update(id).digest('hex')

/**
 * The same database, but every statement matching `pattern` throws — inside
 * a transaction too, which is the point: the throw has to roll back what
 * came before it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function failing(base: any, pattern: RegExp): any {
  const run = async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    if (pattern.test(strings.join(' '))) throw new Error(`injected failure on: ${pattern}`)
    return base(strings, ...vals)
  }
  return Object.assign(run, {
    unsafe: base.unsafe, json: base.json,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    begin: (fn: (t: any) => Promise<unknown>) => base.begin((t: unknown) => fn(failing(t, pattern))),
  })
}

interface Res { code: number; body: Record<string, unknown> }
const json = (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body }
const readBody = (req: { body: string }) => Promise.resolve(req.body)
const deps = { readBody, json, normalizeId, displayName, rateLimited: () => false, engine }
const cards = makeCardApi(sql, { rateLimited: () => false, readBody, json } as never)
const market = makeMarketApi(sql, deps as never)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(api: any, path: string, body: unknown): Promise<Res> {
  const res: Res = { code: 0, body: {} }
  await api.route({ body: JSON.stringify(body), method: 'POST' } as never, res as never, path, 't')
  return res
}
const stored = async (id: string): Promise<GachaState> =>
  (await sql`select state from card_accounts where id_hash = ${hashOf(id)}` as unknown as { state: GachaState }[])[0].state
const patch = async (id: string, path: string, value: unknown) =>
  sql`update card_accounts set state = jsonb_set(state, ${`{${path}}`}::text[], ${JSON.stringify(value)}::jsonb) where id_hash = ${hashOf(id)}`

const A = 'VM-AAAA-AAAA-AAAA-AAAA-AAAA'
const B = 'VM-BBBB-BBBB-BBBB-BBBB-BBBB'
const silver = ALL_CARDS.filter((c) => c.rarity === 'silver' && c.kind === 'player').map((c) => c.id)
const owned = (id: string, level = 0, dupes = 0) => ({ id, level, dupes, seen: 1 + dupes, got: '2026-09-01' })
await call(cards, '/api/card/claim', { id: A, name: '甲' })
await call(cards, '/api/card/claim', { id: B, name: '乙' })
for (const id of [A, B]) await patch(id, 'pulls', TRADE_PULLS + 5)
await patch(A, 'cards', { [silver[0]]: owned(silver[0], 2), [silver[1]]: owned(silver[1]) })
await patch(B, 'cards', { [silver[2]]: owned(silver[2]) })
await patch(B, 'coins', 5000)

// ---- listing: the card cannot leave if the listing cannot be written
console.log('挂牌：')
{
  const broken = makeMarketApi(failing(sql, /insert into card_listings/), deps as never)
  const before = await stored(A)
  let threw = false
  try { await call(broken, '/api/market/list', { id: A, cardId: silver[0], ask: 1000 }) } catch { threw = true }
  const after = await stored(A)
  check('挂牌写不进去时整个请求失败', threw)
  check('卡还在账号里，等级没变', !!after.cards[silver[0]] && after.cards[silver[0]].level === 2 && after.rev === before.rev)
  check('没有半个挂牌留下', ((await sql`select count(*)::int as n from card_listings`) as unknown as { n: number }[])[0].n === 0)
  const r = await call(market, '/api/market/list', { id: A, cardId: silver[0], ask: 1000 })
  check('好的数据库上同一个请求成功', r.body.ok === true && !(await stored(A)).cards[silver[0]])
}
const listing = String((await sql`select id from card_listings where status = 'open'` as unknown as { id: number }[])[0].id)

// ---- bidding: the coins cannot leave if the offer cannot be written
console.log('\n出价：')
{
  const broken = makeMarketApi(failing(sql, /insert into card_offers/), deps as never)
  let threw = false
  try { await call(broken, '/api/market/offer', { id: B, listing, price: 1000 }) } catch { threw = true }
  check('报价写不进去时整个请求失败', threw)
  check('金币一分没少', (await stored(B)).coins === 5000, `${(await stored(B)).coins}`)
  const r = await call(market, '/api/market/offer', { id: B, listing, price: 1000 })
  check('好的数据库上出价成功并扣款', r.body.ok === true && (await stored(B)).coins === 4000)
}

// ---- accepting: if the mail cannot be written, the sale did not happen
console.log('\n成交：')
{
  const offer = String((await sql`select id from card_offers where status = 'open'` as unknown as { id: number }[])[0].id)
  const broken = makeMarketApi(failing(sql, /insert into card_mail/), deps as never)
  let threw = false
  try { await call(broken, '/api/market/answer', { id: A, offer, accept: true }) } catch { threw = true }
  const o = (await sql`select status from card_offers where id = ${offer}::bigint` as unknown as { status: string }[])[0]
  const l = (await sql`select status from card_listings where id = ${listing}::bigint` as unknown as { status: string }[])[0]
  check('邮件写不进去时整个请求失败', threw)
  check('报价和挂牌都还是 open，没有一半成交', o.status === 'open' && l.status === 'open', `${o.status}/${l.status}`)
  const r = await call(market, '/api/market/answer', { id: A, offer, accept: true })
  const mail = (await sql`select kind, to_h from card_mail order by id` as unknown as { kind: string; to_h: string }[])
  check('好的数据库上成交，买卖双方都有邮件', r.body.ok === true
    && mail.some((m) => m.kind === 'bought' && m.to_h === hashOf(B))
    && mail.some((m) => m.kind === 'sold' && m.to_h === hashOf(A)))
}

// ---- taking mail: marked taken and applied together, or neither
console.log('\n收信：')
{
  const broken = makeCardApi(failing(sql, /update card_accounts/), { rateLimited: () => false, readBody, json } as never)
  const waiting = async (id: string) =>
    ((await sql`select count(*)::int as n from card_mail where to_h = ${hashOf(id)} and taken is null`) as unknown as { n: number }[])[0].n
  const before = await waiting(B)
  const r = await call(broken, '/api/card/act', { id: B, action: 'mail_take', args: {}, client: {} })
  check('账号写不进去时请求以 500 结束', r.code === 500, `${r.code}`)
  check('邮件没有被标成已收', (await waiting(B)) === before && before > 0, `${before} → ${await waiting(B)}`)
  const ok = await call(cards, '/api/card/act', { id: B, action: 'mail_take', args: {}, client: {} })
  check('好的数据库上收信成功，卡到账', ok.body.ok === true && !!(await stored(B)).cards[silver[0]] && (await waiting(B)) === 0)
}

// ---- swaps: the card and the point of 体力 stay if the swap row cannot be written
console.log('\n换卡：')
{
  await patch(A, 'daily', { ...(await stored(A)).daily, stamina: STAMINA_MAX, staminaAt: Date.now() })
  const broken = makeMarketApi(failing(sql, /insert into card_swaps/), deps as never)
  const before = await stored(A)
  let threw = false
  try { await call(broken, '/api/market/swap', { id: A, code: battleCode(hashOf(B)), giveId: silver[1], wantId: silver[2] }) } catch { threw = true }
  const after = await stored(A)
  check('交换写不进去时整个请求失败', threw)
  check('卡和体力都还在', !!after.cards[silver[1]] && after.daily.stamina === before.daily.stamina && after.rev === before.rev)
}

// ---- ids that are not numbers
console.log('\n乱写的编号：')
{
  const bad = async (path: string, body: Record<string, unknown>) => (await call(market, path, { id: A, ...body })).code
  check('listing: "abc" → 400', (await bad('/api/market/unlist', { listing: 'abc' })) === 400)
  check('offer on listing "abc" → 400', (await bad('/api/market/offer', { listing: 'abc', price: 1 })) === 400)
  check('answer offer "abc" → 400', (await bad('/api/market/answer', { offer: 'abc', accept: true })) === 400)
  check('swap_answer "abc" → 400', (await bad('/api/market/swap_answer', { swap: 'abc', accept: true })) === 400)
  check('swap_cancel "1e9" → 400', (await bad('/api/market/swap_cancel', { swap: '1e9' })) === 400)
  check('a real number that does not exist is just gone', (await call(market, '/api/market/unlist', { id: A, listing: '99999' })).body.gone === true)
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
