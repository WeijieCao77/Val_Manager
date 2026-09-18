/**
 * An action named by the client happens once, however many times it is sent.
 *
 *   npx tsx scripts/check_idempotency.ts
 *
 * The answer to an act is kept in card_requests in the transaction that
 * changes the account. So: a reply lost on the way back, then retried — one
 * pack; the same request fired twice at once — one pack; two different
 * requests — two packs; an old client with no requestId — works as before.
 * (PGlite is one connection, so "at once" here is interleaved, not parallel;
 * scripts/pg/check_concurrency_pg.ts is the same test on a real server.)
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { newGacha } from '../src/engine/gacha'

const { CARD_SCHEMA, makeCardApi } = await import('../cards-api.js')
let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const db = new PGlite(), sql = makeSql(db)
await db.exec(CARD_SCHEMA)
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
type Reply = { code: number; body: Record<string, any> }
const json = (res: Reply, code: number, body: Reply['body']) => { res.code = code; res.body = body }
const cards = makeCardApi(sql, { rateLimited: () => false, readBody: async (req: { body: string }) => req.body, json } as never)
async function call(path: string, body: unknown) {
  const out: Reply = { code: 0, body: { ok: false } }
  await cards.route({ method: 'POST', body: JSON.stringify(body) } as never, out as never, path, 'idem')
  return out.body
}
const state = async (id: string) => (await sql`select state, rev from card_accounts where id_hash = ${hash(id)}`)[0] as { state: any; rev: number }
const today = new Date().toISOString().slice(0, 10)
const RID = (n: number) => `req-${String(n).padStart(4, '0')}-0123456789abcdef`

try {
  const A = 'VM-CVPM-CVPM-CVPM-CVPM-CVD4'
  await call('/api/card/claim', { id: A, name: '幂等' })
  const g = newGacha(A, '幂等', today)
  g.coins = 100000
  g.daily.staminaAt = Date.now()
  await sql`update card_accounts set state = ${sql.json(g)} where id_hash = ${hash(A)}`
  const client = { name: '幂等', squad: g.squad, presets: [], friends: [] }
  const open = (requestId?: string) => call('/api/card/act', { id: A, action: 'open', args: { kind: 'scout', payWith: 'coins' }, client, requestId })

  const before = await state(A)
  // 1. the reply is "lost": the client sends the same request again
  const first = await open(RID(1))
  const afterFirst = await state(A)
  const again = await open(RID(1))
  const afterAgain = await state(A)
  check('第一次：开了一包，金币扣了', first.ok && afterFirst.state.coins < before.state.coins && afterFirst.state.pulls > before.state.pulls)
  check('同一请求号重发：账号一点没动', afterAgain.rev === afterFirst.rev && afterAgain.state.coins === afterFirst.state.coins && afterAgain.state.pulls === afterFirst.state.pulls,
    `rev ${afterFirst.rev}→${afterAgain.rev}`)
  check('重发拿回的是第一次的结果', again.ok && again.replayed === true && isDeepStrictEqual(again.result, first.result))
  check('重发的回复带的是现在的账号和版本', again.rev === afterAgain.rev && again.state.coins === afterAgain.state.coins)

  // 2. the same request twice at once
  const [x, y] = await Promise.all([open(RID(2)), open(RID(2))])
  const afterPair = await state(A)
  check('同一请求号并发两次：只开一包', afterPair.state.pulls - afterAgain.state.pulls === first.result.pulled.length
    && [x, y].filter((r) => r.replayed).length === 1 && isDeepStrictEqual(x.result, y.result),
    `pulls +${afterPair.state.pulls - afterAgain.state.pulls}`)

  // 3. two different requests are two actions
  await open(RID(3)); await open(RID(4))
  const afterTwo = await state(A)
  check('两个不同请求号：开两包', afterTwo.state.pulls - afterPair.state.pulls === 2 * first.result.pulled.length)

  // 4. a refusal is remembered too, and changes nothing either time
  const poor = await call('/api/card/act', { id: A, action: 'upgrade', args: { cardId: 'p:nobody' }, client, requestId: RID(5) })
  const poor2 = await call('/api/card/act', { id: A, action: 'upgrade', args: { cardId: 'p:nobody' }, client, requestId: RID(5) })
  check('失败的操作重发：同一个拒绝', !poor.ok && !poor2.ok && poor2.replayed === true && poor.why === poor2.why)

  // 5. the same id on another action is refused and runs nothing
  const pulls5 = (await state(A)).state.pulls
  const clash = await call('/api/card/act', { id: A, action: 'checkin', args: {}, client, requestId: RID(1) })
  check('请求号挪到别的操作上：拒绝，不执行', !clash.ok && (await state(A)).state.pulls === pulls5 && !(await state(A)).state.daily?.checkedIn?.includes?.(today) )

  // 6. no requestId (an old tab): every send is an action, as it always was
  const p6 = (await state(A)).state.pulls
  await open(); await open()
  check('旧客户端不带请求号：照旧每次都执行', (await state(A)).state.pulls - p6 === 2 * first.result.pulled.length)

  // 7. malformed named writes must fail closed: clients retry named requests.
  const p7 = (await state(A)).state.pulls
  await open('short'); await open('short')
  check('不合格的请求号拒绝且不扣资产', (await state(A)).state.pulls === p7)
  const changed = await call('/api/card/act', { id: A, action: 'open', args: { kind: 'ten', payWith: 'coins' }, client, requestId: RID(1) })
  check('同号同操作换参数被拒绝', !changed.ok && (await state(A)).state.pulls === p7)

  // 8. mail is taken once
  await sql`insert into card_mail (to_h, kind, coins, count, body) values (${hash(A)}, 'grant', 500, 1, ${sql.json({})})`
  const c8 = (await state(A)).state.coins
  const m1 = await call('/api/card/act', { id: A, action: 'mail_take', args: {}, client, requestId: RID(8) })
  const m2 = await call('/api/card/act', { id: A, action: 'mail_take', args: {}, client, requestId: RID(8) })
  check('领邮件重发：金币只到账一次', m1.ok && m2.replayed === true && (await state(A)).state.coins === c8 + 500, `${c8} → ${(await state(A)).state.coins}`)

  // 9. the market: a bid sent twice escrows once; a listing sent twice lists once
  {
    const { makeMarketApi } = await import('../market-api.js')
    const { displayName } = await import('../names.js')
    const { normalizeId } = await import('../cards-api.js')
    const engine = await import('../src/engine/server.ts')
    const market = makeMarketApi(sql, {
      readBody: async (req: { body: string }) => req.body, json, normalizeId, displayName,
      rateLimited: () => false, engine, timer: false,
    } as never)
    const mcall = async (path: string, body: unknown) => {
      const out: Reply = { code: 0, body: { ok: false } }
      await market.route({ method: 'POST', body: JSON.stringify(body), headers: {} } as never, out as never, path, 'idem')
      return out.body
    }
    const S = 'VM-CVPM-CVPM-CVPM-CVPM-CVE5'
    for (const [id, name, coins, cards] of [[S, '卖家', 0, { 'p:P1': { id: 'p:P1', level: 0, dupes: 1 } }], [A + 'X', '', 0, {}]] as const) {
      if (!name) continue
      await sql`insert into card_accounts (id_hash, name, state, created, verified) values (${hash(id)}, ${name},
        ${sql.json({ coins, cards, pulls: 99 })}, now() - interval '9 days', now())`
    }
    await sql`update card_accounts set created = now() - interval '9 days', state = jsonb_set(state, '{pulls}', '99') where id_hash = ${hash(A)}`
    const l1 = await mcall('/api/market/list', { id: S, cardId: 'p:P1', ask: 1000, requestId: RID(20) })
    const l2 = await mcall('/api/market/list', { id: S, cardId: 'p:P1', ask: 1000, requestId: RID(20) })
    const listed = await sql`select count(*)::int as n from card_listings where seller_h = ${hash(S)}`
    check('挂牌重发：只挂一张，回的是同一个挂牌号', l1.ok && l2.ok && l2.replayed === true && l1.id === l2.id && listed[0].n === 1, `${listed[0].n} 张`)
    const before9 = (await state(A)).state.coins
    const b1 = await mcall('/api/market/offer', { id: A, listing: l1.id, price: 1000, requestId: RID(21) })
    const b2 = await mcall('/api/market/offer', { id: A, listing: l1.id, price: 1000, requestId: RID(21) })
    const bids = await sql`select count(*)::int as n from card_offers where buyer_h = ${hash(A)}`
    check('出价重发：只托管一次金币、只有一条出价', b1.ok && b2.ok && b2.replayed === true && bids[0].n === 1
      && (await state(A)).state.coins === before9 - 1000, `${before9} → ${(await state(A)).state.coins}`)
    const altered = await mcall('/api/market/offer', { id: A, listing: l1.id, price: 1100, requestId: RID(21) })
    check('市场同号不同出价拒绝且不扣款', !altered.ok && altered.clash && (await state(A)).state.coins === before9 - 1000)
    check('重发的回复不带旧账号，带的是现在的版本', b2.rev === (await state(A)).rev)
    const pk = await mcall('/api/market/peek', { id: A, ids: [l1.id, '999999'] })
    check('peek：只回还开着的那张，带着「你领先」', pk.ok && pk.listings.length === 1 && pk.listings[0].bid === true && pk.listings[0].best === 1000)
  }

  const kept = await sql`select count(*)::int as n, count(reply)::int as answered from card_requests where id_hash = ${hash(A)}`
  check('每个请求号一行，行行有答案', kept[0].n === 7 && kept[0].answered === 7, `${kept[0].answered}/${kept[0].n}`)
  // At most 100 deliveries per action; subsequent actions can claim the rest.
  await sql`insert into card_mail (to_h, kind, coins, count, body)
    select ${hash(A)}, 'grant', 1, 1, '{}'::jsonb from generate_series(1, 205)`
  const beforeBatch = (await state(A)).state.coins
  const batch = await call('/api/card/act', { id: A, action: 'mail_take', args: {}, client, requestId: RID(30) })
  check('批量领取最多100封，未领取保留', batch.ok && batch.result.mail.length === 100 && (await state(A)).state.coins === beforeBatch + 100
    && (await sql`select count(*)::int as n from card_mail where to_h = ${hash(A)} and taken is null`)[0].n === 105)
  // No dedup table during migration: fail closed, including the market.
  await db.exec('alter table card_requests rename to unavailable_requests')
  const cold = makeCardApi(sql, { rateLimited: () => false, readBody: async (req: { body: string }) => req.body, json } as never)
  const unavailable: Reply = { code: 0, body: {} }
  await cold.route({ method: 'POST', body: JSON.stringify({ id: A, action: 'open', args: { kind: 'scout', payWith: 'coins' }, client, requestId: RID(31) }) } as never,
    unavailable as never, '/api/card/act', 'idem')
  check('请求表未就绪返回503且不执行', unavailable.code === 503 && (await state(A)).state.coins === beforeBatch + 100)
  await db.exec('alter table unavailable_requests rename to card_requests')
  // A compacted old receipt still owns its request ID permanently.
  await sql`update card_requests set at = now() - interval '7 hours' where id_hash = ${hash(A)} and request_id = ${RID(1)}`
  await cold.route({ method: 'POST', body: JSON.stringify({ id: A, action: 'mail_take', args: {}, client, requestId: RID(32) }) } as never,
    unavailable as never, '/api/card/act', 'idem')
  // Compaction is asynchronous maintenance. A real connection pool does not
  // promise that the next query waits for it (PGlite's single queue did).
  let tombstone
  for (let i = 0; i < 100; i++) {
    tombstone = (await sql`select reply from card_requests where id_hash = ${hash(A)} and request_id = ${RID(1)}`)[0]
    if (tombstone?.reply?.trimmed) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const beforeOld = await state(A)
  const old = await open(RID(1))
  check('过期仅压缩回复，旧请求永不重新扣款', tombstone?.reply?.trimmed === true && old.replayed === true
    && (await state(A)).rev === beforeOld.rev && (await state(A)).state.coins === beforeOld.state.coins)


} finally {
  await db.close()
}
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
