/**
 * The owner's 封禁 panel (owner, 2026-10-08): bans that grow 3 → 5 → 7 days, a lifted ban that does not count,
 * where every listed account stands, and the 倒卡 lists as they happen rather than a week's sum.
 *
 *   npx tsx scripts/check_guard_owner.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { CARD_SCHEMA, engine, normalizeId } from '../cards-api.js'
import { makeMarketApi } from '../market-api.js'
import { banDays } from '../market-guard.js'
import { displayName } from '../names.js'
process.env.PHONE_GATE = '0'

assert.deepEqual([0, 1, 2, 3, 20].map(banDays), [3, 5, 7, 9, 30], '3、5、7、9……最多 30')
console.log('ok  天数：第一次 3 天，每再犯一次多 2 天，最多 30 天')

const db = new PGlite()
await db.exec(CARD_SCHEMA)
const sql = makeSql(db)
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
const TOKEN = 'owner-token'
const api = makeMarketApi(sql, {
  engine, normalizeId, displayName, rateLimited: () => false, timer: false,
  token: TOKEN, tokenFrom: (req: { token?: string }) => req.token ?? null, tokenOk: (a: string, b: string) => a === b,
  readBody: async (req: { body: unknown }) => JSON.stringify(req.body),
  json: (res: { body?: any }, _status: number, body: any) => { res.body = body },
} as never)
const guard = async (body: object) => {
  const res: { body?: any } = {}
  await api.route({ body, token: TOKEN, url: '/api/market/guard' } as never, res as never, '/api/market/guard', 'test')
  return res.body
}

const names = ['大号', '小号', '路人', '老实人']
const [MAIN, ALT, PASSER, HONEST] = names.map((n, i) => `VM-TEST-000${i}-AAAA-BBBB-CCCC`)
for (const [i, id] of [MAIN, ALT, PASSER, HONEST].entries()) {
  await sql`insert into card_accounts (id_hash, name, state, created) values (${hash(id)}, ${names[i]}, ${sql.json({ coins: 1000, pulls: 50 })}, now() - interval '30 days')`
}
const code = (id: string) => hash(id).slice(0, 8)

// ---- escalation and the lifted one
let r = await guard({ code: code(ALT), action: 'status' })
assert(r.ok && r.ban.strikes === 0 && r.ban.running === null && r.ban.next === 3, '没封过：下次 3 天')
r = await guard({ code: code(ALT), action: 'ban' })
assert(r.ok && r.days === 3 && r.nth === 1, `第一次手动封，不填天数：3 天 — ${JSON.stringify(r)}`)
r = await guard({ code: code(ALT), action: 'ban' })
assert(!r.ok && r.running && /已经在封禁中/.test(r.why), '封禁中再点一次：不叠第二条')
assert.equal((await sql`select count(*)::int as n from market_bans where id_hash = ${hash(ALT)}`)[0].n, 1)
r = await guard({ code: code(ALT), action: 'status' })
assert(r.ban.running && r.ban.strikes === 1 && r.ban.next === 5, '封禁中：第 1 次，下次 5 天')
// it runs out
await sql`update market_bans set until = now() - interval '1 minute', made = now() - interval '3 days'`
api.guard.invalidate()
r = await guard({ code: code(ALT), action: 'ban' })
assert(r.ok && r.days === 5 && r.nth === 2, `第二次：5 天 — ${JSON.stringify(r)}`)
r = await guard({ code: code(ALT), action: 'lift' })
assert(r.ok && r.lifted === 1)
r = await guard({ code: code(ALT), action: 'status' })
assert(r.ban.running === null && r.ban.strikes === 1 && r.ban.forgiven === 1 && r.ban.next === 5, `解封的那次不计：仍是 1 次、下次 5 天 — ${JSON.stringify(r.ban)}`)
r = await guard({ code: code(ALT), action: 'ban' })
assert(r.ok && r.days === 5, '解封后再封：5 天（误封不算一次）')
await guard({ code: code(ALT), action: 'lift' })
r = await guard({ code: code(ALT), action: 'ban', days: 10 })
assert(r.ok && r.days === 10, '填了天数就按填的')
await sql`update market_bans set until = now() - interval '1 minute' where id_hash = ${hash(ALT)} and lifted is null`
api.guard.invalidate()
r = await guard({ code: code(ALT), action: 'ban' })
assert(r.ok && r.days === 7 && r.nth === 3, `第三次：7 天 — ${JSON.stringify(r)}`)
console.log('ok  手动封按次数：3 天、5 天、7 天；封禁中不重复封；手动解封的那次不计；填了天数就按填的')

// ---- the lists: newest first, every account with where it stands
const card = engine.ALL_CARDS.find((c) => c.rarity === 'gold' && c.kind === 'player')!.id
async function sale(seller: string, buyer: string, price: number, minutesAgo: number) {
  const [l] = await sql`insert into card_listings (seller_h, card_id, level, ask, status, created, closed, ends)
    values (${hash(seller)}, ${card}, 0, 700, 'sold', now() - make_interval(mins => ${minutesAgo + 5}), now() - make_interval(mins => ${minutesAgo}), now() - make_interval(mins => ${minutesAgo}))
    returning id`
  await sql`insert into card_offers (listing, buyer_h, price, status, made, settled)
    values (${l.id}, ${hash(buyer)}, ${price}, 'accepted', now() - make_interval(mins => ${minutesAgo}), now() - make_interval(mins => ${minutesAgo}))`
}
// the card's market: ten fair sales between strangers
for (let i = 0; i < 10; i++) await sale(PASSER, HONEST, 800 + i * 10, 60 * 24 * 5 + i)
await sale(ALT, MAIN, 90_000, 300)      // five hours ago: a dump
await sale(ALT, MAIN, 168_000, 20)      // twenty minutes ago: another, bigger
await sale(MAIN, ALT, 900, 10)          // and a card going back the other way
await sale(PASSER, HONEST, 6000, 60 * 24 * 4) // four days ago: outside the window
const rep = await guard({})
assert(rep.ok)
const sales = rep.moving.sales
assert.equal(sales.length, 2, `最近 3 天的高价成交两笔（四天前的不在） — ${sales.length}`)
assert(sales[0].price === 168_000 && sales[1].price === 90_000, '最新的在前')
assert(sales[0].f && sales[0].ratio > 20, '20 倍以上标离谱')
assert.equal(sales[0].seller.code, code(ALT).toUpperCase())
assert(sales[0].seller.ban.running && sales[0].seller.ban.strikes === 3, '卖家正在封禁、第 3 次')
assert(sales[0].buyer.ban.running === null && sales[0].buyer.ban.strikes === 0 && sales[0].buyer.ban.next === 3, '买家没封过')
assert(sales[0].pair.day === 3 && sales[0].pair.both, '这两个号 24 小时成交 3 次、互相买过')
const pairs = rep.moving.pairs
assert.equal(pairs.length, 1, '一对')
assert(pairs[0].n === 3 && pairs[0].aBought + pairs[0].bBought === 3 && pairs[0].aBought && pairs[0].bBought)
assert(Date.now() - Date.parse(pairs[0].last) < 11 * 60_000 + 5000, '最后一次是十分钟前')
assert([pairs[0].a.code, pairs[0].b.code].sort().join() === [code(ALT), code(MAIN)].map((c) => c.toUpperCase()).sort().join())
assert(rep.bans.every((b: any) => b.ban && typeof b.ban.strikes === 'number'), '封禁记录里每个号也带状态')
console.log('ok  名单：最近 3 天的高价成交按时间倒序、离谱的标出来；24 小时互相成交的一对；每个号都带封没封过、封禁中到几点')

await db.close()
console.log('\n全部通过')
