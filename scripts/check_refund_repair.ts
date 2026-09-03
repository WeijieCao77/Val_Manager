/**
 * The repair for the bids the market swallowed — scripts/refund_stranded_offers.js.
 *
 *   npx tsx scripts/check_refund_repair.ts
 *
 * One buyer, three failed bids: one refunded when it expired, one refunded
 * when it was declined, one expired the old way with no mail at all. The
 * ledger must come out 900 short, the repair must post exactly that, and
 * running it again must post nothing.
 */
process.env.ENGINE_FROM_SOURCE = '1'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
const { CARD_SCHEMA } = await import('../cards-api.js')
const { owed, repair } = await import('./refund_stranded_offers.js')

const db = new PGlite()
const sql = makeSql(db)
await db.exec(CARD_SCHEMA)
let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

await sql`insert into card_accounts (id_hash, name, state) values ('h-buyer', '买家', '{}'), ('h-seller', '卖家', '{}')`
const l = (await sql`insert into card_listings (seller_h, card_id, level, ask, status)
  values ('h-seller', 'p:P1', 0, 1000, 'expired') returning id`)[0].id
await sql`insert into card_offers (listing, buyer_h, price, status) values
  (${l}, 'h-buyer', 1000, 'expired'), (${l}, 'h-buyer', 950, 'declined'), (${l}, 'h-buyer', 900, 'expired')`
await sql`insert into card_mail (to_h, kind, coins) values ('h-buyer', 'offer_expired', 1000), ('h-buyer', 'offer_declined', 950)`

const before = await owed(sql)
check('账本差的正好是那笔没退的', before.length === 1 && before[0].coins === 900, JSON.stringify(before))
await repair(sql, false)
check('不带 --apply 只是看看，不发信', (await sql`select count(*)::int as n from card_mail`)[0].n === 2)
await repair(sql, true)
check('补发之后账平了', (await owed(sql)).length === 0)
const mail = await sql`select kind, coins, body from card_mail where to_h = 'h-buyer' order by id desc limit 1`
check('补的那封信是退款、900 金币、带标记', mail[0].kind === 'offer_expired' && mail[0].coins === 900
  && (mail[0].body as { repair?: string })?.repair?.startsWith('stranded'), JSON.stringify(mail[0]))
await repair(sql, true)
check('再跑一次什么都不发', (await sql`select count(*)::int as n from card_mail`)[0].n === 3)

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
