/**
 * Give back the coins the market swallowed.
 *
 *   node scripts/refund_stranded_offers.js            # says who is owed what
 *   node scripts/refund_stranded_offers.js --apply    # posts the refunds
 *   railway run --service val-manager node scripts/refund_stranded_offers.js --apply
 *
 * Until 2026-09-03 a listing that died of three ignored offers expired any
 * bid still sitting on it without mailing the coins home — the card was gone
 * from the shelf and the money was gone with it (「出价的金币被卡了」). The
 * sweep refunds now; this settles the past.
 *
 * Nothing here needs to know which offer was the one: every bid that ended
 * without a purchase — expired or declined — was owed its price back, and
 * every refund ever mailed is a row in card_mail, so per buyer the debt is
 * simply the sum of one minus the sum of the other. One mail per buyer for
 * the difference, tagged so a second run finds nothing to do.
 */
import { makeSql } from '../pglite-sql.js'

const TAG = 'stranded-offers-2026-09-03'

/** buyer -> coins owed, for everyone the ledger comes out short on. */
export async function owed(sql) {
  const rows = await sql`
    with lost as (
      select buyer_h, sum(price)::int as due
      from card_offers where status in ('expired', 'declined', 'withdrawn')
      group by buyer_h),
    back as (
      select to_h as buyer_h, sum(coins)::int as got
      from card_mail where kind in ('offer_expired', 'offer_declined', 'offer_withdrawn', 'outbid')
      group by to_h)
    select l.buyer_h, l.due, coalesce(b.got, 0) as got
    from lost l left join back b on b.buyer_h = l.buyer_h
    where l.due > coalesce(b.got, 0)
    order by l.due - coalesce(b.got, 0) desc`
  return rows.map((r) => ({ buyer_h: r.buyer_h, coins: r.due - r.got }))
}

export async function repair(sql, apply) {
  const debts = await owed(sql)
  for (const d of debts) {
    const name = (await sql`select name from card_accounts where id_hash = ${d.buyer_h}`)[0]?.name ?? '?'
    console.log(`${apply ? '退' : '欠'} ${name} ${d.coins} 金币  (${d.buyer_h.slice(0, 8)}…)`)
    if (apply) {
      await sql`
        insert into card_mail (to_h, kind, card_id, level, coins, pack, count, body)
        values (${d.buyer_h}, 'offer_expired', null, 0, ${d.coins}, null, 1,
                ${sql.json({ repair: TAG })})`
    }
  }
  console.log(debts.length ? `${debts.length} 人${apply ? '已补发' : '被欠着'}，共 ${debts.reduce((a, d) => a + d.coins, 0)} 金币`
    : '账都平的，没有人被欠')
  return debts
}

if (process.argv[1] && process.argv[1].endsWith('refund_stranded_offers.js')) {
  const apply = process.argv.includes('--apply')
  const url = process.env.DATABASE_URL
  if (!url) { console.error('DATABASE_URL 没设'); process.exit(2) }
  let sql
  if (url.startsWith('pglite')) {
    const { PGlite } = await import('@electric-sql/pglite')
    sql = makeSql(new PGlite())
  } else {
    const { default: postgres } = await import('postgres')
    sql = postgres(url, { max: 2, ssl: url.includes('railway.internal') ? false : 'require', onnotice: () => {} })
  }
  try {
    await repair(sql, apply)
  } finally {
    await sql.end?.()
  }
}
