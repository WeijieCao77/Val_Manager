/**
 * The owner page's 亮点 numbers (stats-highlights.js), run against a real Postgres.
 *
 * Every query executes on the full schema the server boots with, and the
 * counts that matter come out as numbers a small hand-made population fixes:
 * retention counted on the right day, a sale counted once with its one
 * accepted offer, a cup's players counted as people, money as a number and
 * not the string postgres.js makes of an int8.
 *
 *     npx tsx scripts/check_admin_highlights.ts
 */
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { SCHEMAS } from '../db-schema.js'
import { highlights } from '../stats-highlights.js'
import { overview } from '../stats.js'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const db = new PGlite()
const sql = makeSql(db)
for (const s of SCHEMAS) await db.exec(s)

// three people. v1 arrived ten days ago and came back on days 1 and 7; v2
// arrived ten days ago and never returned; v3 arrived yesterday.
// The per-day list starts eleven days ago, so both ten-day cohorts count.
await db.exec(`
  insert into visitors (visitor_id, first_seen, last_seen, device, host) values
    ('v0', now() - interval '11 days', now() - interval '11 days', 'desktop', 'vctgames.com'),
    ('v1', now() - interval '10 days', now(), 'mobile', 'vctgames.com'),
    ('v2', now() - interval '10 days', now() - interval '10 days', 'mobile', 'www.vctgames.com'),
    ('v3', now() - interval '1 day',  now() - interval '1 day', 'mobile', null);
  insert into rollup_day_visitors (day, visitor_id) values
    ((now() - interval '11 days')::date, 'v0'),
    ((now() - interval '10 days')::date, 'v1'), ((now() - interval '9 days')::date, 'v1'), ((now() - interval '3 days')::date, 'v1'),
    ((now() - interval '10 days')::date, 'v2'),
    ((now() - interval '1 day')::date, 'v3'), (current_date, 'v1');
  insert into daily_stats (day, visitors, new_visitors) values
    ((now() - interval '10 days')::date, 2, 2), ((now() - interval '1 day')::date, 1, 1);
`)

// accounts: a made 40 days ago and seen today, b made 2 days ago and never back
const state = (coins: number, pulls: number) => JSON.stringify({ cards: { 'p:P1': { n: 1 } }, coins, pulls })
await db.query(`insert into card_accounts (id_hash, created, seen, saved, name, state) values
  ('aaaaaaaa00', now() - interval '40 days', now(), now(), '甲', $1::jsonb),
  ('bbbbbbbb00', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days', '乙', $2::jsonb)`,
  [state(3_000_000_000, 120), state(500, 10)])
await db.exec(`
  insert into card_phones (phone_h, id_hash, id_enc, last4, bound) values ('ph1', 'aaaaaaaa00', 'x', '1234', now() - interval '5 days');
  insert into card_listings (id, seller_h, card_id, level, ask, status, created, closed) values
    (1, 'aaaaaaaa00', 'p:P1', 0, 60, 'sold', now() - interval '3 hours', now() - interval '2 hours'),
    (2, 'aaaaaaaa00', 'p:P2', 1, 60, 'sold', now() - interval '3 days', now() - interval '3 days'),
    (3, 'bbbbbbbb00', 'p:P1', 0, 60, 'open', now(), null);
  insert into card_offers (listing, buyer_h, price, status, made) values
    (1, 'bbbbbbbb00', 2000000000, 'accepted', now() - interval '2 hours'),
    (1, 'cccccccc00', 900, 'outbid', now() - interval '2 hours'),
    (2, 'bbbbbbbb00', 300, 'accepted', now() - interval '3 days');
  insert into card_swaps (from_h, to_h, give_id, want_id, status) values ('aaaaaaaa00', 'bbbbbbbb00', 'p:P1', 'p:P2', 'done');
  insert into card_mail (to_h, kind, pack, count, coins) values ('aaaaaaaa00', 'grant', 'ten', 3, 0), ('bbbbbbbb00', 'grant', null, 1, 500);
  insert into open_cups (id, starts, status, entrants, champion, finished) values
    (1, now() - interval '1 day', 'done', 2, 'aaaaaaaa00', now() - interval '20 hours'),
    (2, now() - interval '2 hours', 'open', 1, null, null);
  insert into open_cup_entries (cup_id, id_hash, name) values (1, 'aaaaaaaa00', '甲'), (1, 'bbbbbbbb00', '乙'), (2, 'aaaaaaaa00', '甲');
  insert into enc_entries (id_hash, nat, five, score) values ('aaaaaaaa00', 'CN', '[]', 1), ('bbbbbbbb00', 'CN', '[]', 1);
`)

let h: Awaited<ReturnType<typeof highlights>> | null = null
try {
  h = await highlights(sql as never, { cardName: (id: string) => (id === 'p:P1' ? 'ZmjjKK' : id) })
  check('每一条亮点查询都跑得通', true)
} catch (err) {
  check('每一条亮点查询都跑得通', false, (err as Error).message)
}

if (h) {
  check('WAU/MAU 按人数，不按行数', h.active.mau === 4 && h.active.wau === 2 && h.active.dau_t === 1 && h.active.dau_y === 1, JSON.stringify(h.active))
  const c10 = h.cohorts.find((c: any) => c.size === 2)
  check('留存按首访那天分组：两人里一人第 1 天、第 7 天回来', !!c10 && c10.d1 === 1 && c10.d7 === 1 && c10.d3 === 0, JSON.stringify(h.cohorts))
  // by the day, not String(): PGlite hands a date back as a Date on some machines and a string on others
  const dayOf = (t: unknown) => new Date(t as string).toISOString().slice(0, 10)
  const v0Day = new Date(Date.now() - 11 * 86400000).toISOString().slice(0, 10)
  check('早于按日名单的那一批不算（它的回访看不见）', h.cohorts.length === 2 && !h.cohorts.some((c: any) => dayOf(c.cohort) === v0Day), JSON.stringify(h.cohorts))
  check('卡牌账号：总数、今天活跃、绑手机', h.accounts.total === 2 && h.accounts.a1 === 1 && h.accounts.phones === 1, JSON.stringify(h.accounts))
  const old = h.accountCohorts.find((c: any) => c.size === 1 && c.r30 === 1)
  check('开瓦包滚动留存：40 天前建号、今天还在的算第 30 天', !!old, JSON.stringify(h.accountCohorts))
  check('成交只数接受的那个出价', h.market.sales === 2 && h.market.coins === 2_000_000_300, JSON.stringify({ sales: h.market.sales, coins: h.market.coins }))
  check('金额是数字，不是 int8 字符串', typeof h.market.coins === 'number' && typeof h.market.grants.coins === 'number')
  check('24 小时成交', h.market.sales24 === 1 && h.market.coins24 === 2_000_000_000)
  check('最贵一笔带卡名', h.market.top[0]?.card === 'ZmjjKK' && h.market.top[0]?.price === 2_000_000_000, JSON.stringify(h.market.top))
  check('挂着的卡和交换', h.market.listings === 1 && h.market.swaps.some((s: any) => s.status === 'done' && s.n === 1))
  check('后台发放：两封信、三个包、500 金币', h.market.grants.mails === 2 && h.market.grants.packs === 3 && h.market.grants.coins === 500, JSON.stringify(h.market.grants))
  check('交易时段是北京时间的小时', h.market.hours.every((x: any) => x.hour >= 0 && x.hour < 24) && h.market.hours.reduce((a: number, x: any) => a + x.n, 0) === 2)
  check('全服杯：人次和人数分开', h.openCup.entries === 3 && h.openCup.players === 2 && h.openCup.finished === 1, JSON.stringify(h.openCup))
  check('最大一届带冠军名', h.openCup.biggest[0]?.champion === '甲', JSON.stringify(h.openCup.biggest))
  check('国家队杯按国籍', h.enc[0]?.nat === 'CN' && h.enc[0]?.n === 2)
  check('来源域名没记录的有名字', h.hosts.some((x: any) => x.host === '(没记录)'))
  check('最高 DAU 那天', h.peak?.visitors === 2)
}

// the coin and pull totals ride on overview()'s one pass over the saves
try {
  const o: any = await overview(sql as never, 30)
  const a = o.cards.accounts
  check('金币总量、抽卡总数随存档统计一起出来，是数字', a.total_coins === 3_000_000_500 && a.total_pulls === 130, JSON.stringify({ c: a.total_coins, p: a.total_pulls }))
} catch (err) {
  check('overview 还跑得通', false, (err as Error).message)
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
