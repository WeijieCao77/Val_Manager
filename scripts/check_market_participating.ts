/** Outbid listings remain reachable; pagination, ownership and current auction data. */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
const { CARD_SCHEMA, normalizeId } = await import('../cards-api.js')
const { makeMarketApi, PAGE } = await import('../market-api.js')
const { displayName } = await import('../names.js')
const engine = await import('../src/engine/server.ts')
const db = new PGlite(), sql = makeSql(db)
await db.exec(CARD_SCHEMA)
const api = makeMarketApi(sql, {
  readBody: async (req: { body: string }) => req.body,
  json: (res: any, code: number, body: any) => { res.code = code; res.body = body },
  normalizeId, displayName, rateLimited: () => false, engine, timer: false,
} as never)
const me = 'VM-BBBB-BBBB-BBBB-BBBB-BBBB', other = 'VM-CCCC-CCCC-CCCC-CCCC-CCCC', seller = 'VM-SSSS-SSSS-SSSS-SSSS-SSSS'
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
const call = async (path: string, body: object) => {
  const res: any = {}
  await api.route({ body: JSON.stringify(body), method: 'POST' } as never, res, `/api/market/${path}`, 'test')
  return res
}
try {
  for (const id of [me, other, seller]) {
    const g = engine.newGacha(id, id, '2026-01-01'); g.coins = 100000; g.pulls = 99
    await sql`insert into card_accounts (id_hash, name, state, created, verified)
      values (${hash(id)}, ${id}, ${JSON.stringify(g)}, now() - interval '9 days', now())`
  }
  const add = async () => String((await sql`insert into card_listings (seller_h, card_id, level, ask, ends, hours)
    values (${hash(seller)}, 'p:P1', 2, 1000, now() + interval '2 hours', 2) returning id`)[0].id)
  const first = await add()
  assert.equal((await call('offer', { id: me, listing: first, price: 1000 })).body.ok, true)
  assert.equal((await call('offer', { id: other, listing: first, price: 1050 })).body.ok, true)
  let page = (await call('participating', { id: me })).body
  assert.equal(page.listings.length, 1)
  assert.equal(page.listings[0].id, first)
  assert.equal(page.listings[0].bid, false)
  assert.equal(page.listings[0].best, 1050)
  assert.equal(page.listings[0].min, 1103)
  assert.equal(page.listings[0].level, 2)
  assert.equal((await call('offer', { id: me, listing: first, price: page.listings[0].min })).body.ok, true)
  page = (await call('participating', { id: me })).body
  assert.equal(page.listings.length, 1, 'rebidding does not duplicate the tile')
  assert.equal(page.listings[0].bid, true)
  const beforeMail = await sql`select count(*)::int as n from card_mail`
  await call('participating', { id: me })
  assert.deepEqual(await sql`select count(*)::int as n from card_mail`, beforeMail, 'read does not settle or refund')
  const unrelated = await add()
  assert(!(await call('participating', { id: me })).body.listings.some((l: any) => l.id === unrelated))
  assert.equal((await call('participating', { id: seller })).body.listings.length, 0)
  assert.equal((await call('participating', {})).code, 400)
  assert.equal((await call('participating', { id: me, cursor: 'invalid' })).code, 400)
  for (const status of ['sold', 'pulled', 'expired']) {
    await sql`update card_listings set status = ${status} where id = ${first}::bigint`
    assert.equal((await call('participating', { id: me })).body.listings.length, 0)
  }
  await sql`update card_listings set status = 'open', ends = now() - interval '1 second' where id = ${first}::bigint`
  assert.equal((await call('participating', { id: me })).body.listings.length, 0, 'ended but not yet settled excluded')
  const expected: string[] = []
  for (let i = 0; i < PAGE + 3; i++) {
    const id = await add(); expected.unshift(id)
    await sql`insert into card_offers (listing, buyer_h, price, status) values (${id}::bigint, ${hash(me)}, 1000, 'outbid')`
    await sql`insert into card_offers (listing, buyer_h, price, status) values (${id}::bigint, ${hash(me)}, 1100, 'outbid')`
  }
  page = (await call('participating', { id: me })).body
  assert.equal(page.listings.length, PAGE)
  assert(page.next)
  const second = (await call('participating', { id: me, cursor: page.next })).body
  assert.equal(second.listings.length, 3)
  assert.equal(second.next, null)
  assert.deepEqual([...page.listings, ...second.listings].map((l: any) => l.id), expected)
  const peek = (await call('peek', { id: me, ids: [expected[0]] })).body
  assert.deepEqual(peek.listings[0], page.listings[0], 'shortcut and shelf use identical live details')
  console.log('PASS actual outbid/rebid flow, live price, no duplicates, account isolation, ended auctions and 63-row pagination')
} finally { await db.close() }
