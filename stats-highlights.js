/**
 * The numbers worth saying out loud: growth, retention, the market, the cups.
 *
 * stats.js answers 「这个改动有没有用」 from the events window, which at this
 * volume holds about a day. Everything here is read from tables that are never
 * pruned — visitors, rollup_day_visitors, card_accounts, the market and cup
 * ledgers — so a figure like 「累计成交」 or 「第 7 天留存」 covers the whole
 * life of the site, not the last few hours of events.
 *
 * Read only, and nothing here reads card_accounts.state: that column is most
 * of the table's half a gigabyte, and overview() already pays for one pass
 * over it (the coin and pull totals ride along on that pass).
 *
 * Days are the database's days (UTC on Railway), the same days the rollup
 * folds into, so a cohort and its later visits are counted on one calendar.
 */

/** float8, not bigint: postgres.js hands int8 back as a string */
export async function highlights(sql, { cardName = (id) => id } = {}) {
  const [
    active, cohorts, accounts, accountCohorts, newAccounts, phones, phoneTotal,
    devices, hosts, peak, market, marketDaily, topSales, hotCards, openNow,
    marketHours, swaps, grants, openCups, openCupDaily, openCupPlayers, bigCups,
    teamCups, teamCupPlayers, ladder, enc,
  ] = await Promise.all([
    // DAU / WAU / MAU over the permanent per-day visitor list
    sql`
      select count(distinct visitor_id) filter (where day = current_date - 1)::int as dau_y,
             count(distinct visitor_id) filter (where day = current_date)::int     as dau_t,
             count(distinct visitor_id) filter (where day > current_date - 7)::int as wau,
             count(distinct visitor_id)::int                                       as mau
      from rollup_day_visitors where day > current_date - 30`,

    // Classic day-N retention by first-visit day: came back ON day 1, 3, 7, 14, 30.
    // Only cohorts that start after the per-day list does, or their later days
    // would be missing and read as people who never came back.
    sql`
      with b as (select min(day) as d from rollup_day_visitors),
      c as (
        select v.visitor_id, v.first_seen::date as d0
        from visitors v, b
        where b.d is not null and v.first_seen::date > b.d and v.first_seen > current_date - 60
      )
      select c.d0 as cohort,
             count(distinct c.visitor_id)::int                                 as size,
             count(distinct r.visitor_id) filter (where r.day = c.d0 + 1)::int  as d1,
             count(distinct r.visitor_id) filter (where r.day = c.d0 + 3)::int  as d3,
             count(distinct r.visitor_id) filter (where r.day = c.d0 + 7)::int  as d7,
             count(distinct r.visitor_id) filter (where r.day = c.d0 + 14)::int as d14,
             count(distinct r.visitor_id) filter (where r.day = c.d0 + 30)::int as d30
      from c left join rollup_day_visitors r on r.visitor_id = c.visitor_id and r.day > c.d0
      group by c.d0 order by c.d0`,

    sql`
      select count(*)::int                                                       as total,
             count(*) filter (where seen > now() - interval '1 day')::int        as a1,
             count(*) filter (where seen > now() - interval '7 days')::int       as a7,
             count(*) filter (where seen > now() - interval '30 days')::int      as a30,
             count(*) filter (where created > now() - interval '1 day')::int     as new1,
             count(*) filter (where created > now() - interval '7 days')::int    as new7,
             count(*) filter (where verified is not null)::int                   as verified,
             count(*) filter (where suspect)::int                                as suspect,
             min(created)                                                        as since
      from card_accounts`,

    // 开瓦包 has no per-day visit list, only created and the last time seen —
    // so its retention is the rolling kind: still showing up N days or more after
    // the account was made. Weekly cohorts, newest last.
    sql`
      select date_trunc('week', created)::date as week,
             count(*)::int                                                        as size,
             count(*) filter (where seen >= created + interval '1 day')::int      as r1,
             count(*) filter (where seen >= created + interval '7 days')::int     as r7,
             count(*) filter (where seen >= created + interval '30 days')::int    as r30
      from card_accounts where created > now() - interval '84 days'
      group by 1 order by 1`,

    sql`select created::date as day, count(*)::int as n from card_accounts
        where created > current_date - 60 group by 1 order by 1`,
    sql`select bound::date as day, count(*)::int as n from card_phones
        where bound > current_date - 60 group by 1 order by 1`,
    sql`select count(*)::int as n from card_phones`,

    sql`select coalesce(device, '?') as device, count(*)::int as n from visitors group by 1 order by 2 desc limit 8`,
    sql`select coalesce(host, '(没记录)') as host, count(*)::int as n from visitors group by 1 order by 2 desc limit 8`,
    sql`select day, visitors, new_visitors from daily_stats order by visitors desc, day desc limit 1`,

    // the market, all time: a sale is a sold listing and its one accepted offer
    sql`
      select count(*)::int                                         as sales,
             coalesce(sum(o.price), 0)::float8                     as coins,
             count(distinct o.buyer_h)::int                        as buyers,
             count(distinct l.seller_h)::int                       as sellers,
             coalesce(percentile_cont(0.5) within group (order by o.price), 0)::float8 as median,
             count(*) filter (where l.closed > now() - interval '1 day')::int        as sales24,
             coalesce(sum(o.price) filter (where l.closed > now() - interval '1 day'), 0)::float8 as coins24,
             min(l.closed)                                         as since
      from card_listings l join card_offers o on o.listing = l.id and o.status = 'accepted'
      where l.status = 'sold'`,
    sql`
      select l.closed::date as day, count(*)::int as n, coalesce(sum(o.price), 0)::float8 as coins,
             count(distinct o.buyer_h)::int as buyers
      from card_listings l join card_offers o on o.listing = l.id and o.status = 'accepted'
      where l.status = 'sold' and l.closed > current_date - 30
      group by 1 order by 1`,
    sql`
      select l.card_id, l.level, o.price, l.closed
      from card_listings l join card_offers o on o.listing = l.id and o.status = 'accepted'
      where l.status = 'sold' order by o.price desc, l.closed desc limit 5`,
    sql`
      select l.card_id, count(*)::int as n, coalesce(sum(o.price), 0)::float8 as coins,
             coalesce(percentile_cont(0.5) within group (order by o.price), 0)::float8 as median
      from card_listings l join card_offers o on o.listing = l.id and o.status = 'accepted'
      where l.status = 'sold' and l.closed > now() - interval '7 days'
      group by 1 order by 2 desc, 3 desc limit 10`,
    sql`
      select (select count(*) from card_listings where status = 'open')::int                          as listings,
             (select count(*) from card_offers where made > now() - interval '1 day')::int            as bids24`,
    // when the market is busy, by Beijing hour, over two weeks
    sql`
      select extract(hour from (l.closed at time zone 'UTC') + interval '8 hours')::int as hour, count(*)::int as n
      from card_listings l
      where l.status = 'sold' and l.closed > now() - interval '14 days'
      group by 1 order by 1`,
    sql`select status, count(*)::int as n from card_swaps group by 1 order by 2 desc`,
    sql`
      select count(*)::int                                                     as mails,
             count(*) filter (where made > now() - interval '7 days')::int     as mails7,
             count(distinct to_h)::int                                         as people,
             coalesce(sum(count) filter (where pack is not null), 0)::int      as packs,
             coalesce(sum(coins), 0)::float8                                   as coins
      from card_mail where kind = 'grant'`,

    // 全服杯
    sql`
      select count(*)::int                                                             as cups,
             count(*) filter (where finished is not null)::int                         as finished,
             coalesce(sum(entrants), 0)::int                                           as entries,
             coalesce(max(entrants), 0)::int                                           as max_entrants,
             coalesce(round(avg(entrants) filter (where starts > now() - interval '7 days')), 0)::int as avg7,
             min(starts)                                                               as since
      from open_cups`,
    sql`select starts::date as day, count(*)::int as cups, coalesce(sum(entrants), 0)::int as entries
        from open_cups where starts > current_date - 30 group by 1 order by 1`,
    sql`select count(distinct id_hash)::int as n from open_cup_entries`,
    sql`
      select c.id, c.starts, c.entrants, e.name as champion
      from open_cups c left join open_cup_entries e on e.cup_id = c.id and e.id_hash = c.champion
      order by c.entrants desc, c.starts desc limit 3`,
    // 全服组队杯
    sql`
      select count(*)::int                                       as cups,
             count(*) filter (where finished is not null)::int   as finished,
             coalesce(sum(entrants), 0)::int                     as entries,
             coalesce(max(entrants), 0)::int                     as max_entrants,
             coalesce(sum(teams), 0)::int                        as teams
      from team_cups`,
    sql`select count(distinct id_hash)::int as n from team_cup_entries`,
    // the ladder as the trigger-kept board holds it, this season's record per league
    sql`
      select league, div, count(*)::int as n, coalesce(sum(wins + losses), 0)::float8 as matches
      from account_ladder where not suspect group by 1, 2 order by 1, 2`,
    sql`select nat, count(*)::int as n from enc_entries group by 1 order by 2 desc, 1 limit 8`,
  ])

  const named = (id) => { try { return cardName(id) || id } catch { return id } }
  return {
    active: active[0] ?? {},
    cohorts,
    accounts: { ...(accounts[0] ?? {}), phones: phoneTotal[0]?.n ?? 0 },
    accountCohorts,
    newAccounts, phones,
    devices, hosts, peak: peak[0] ?? null,
    market: {
      ...(market[0] ?? {}),
      ...(openNow[0] ?? {}),
      daily: marketDaily,
      top: topSales.map((r) => ({ card: named(r.card_id), level: r.level, price: r.price, at: r.closed })),
      hot: hotCards.map((r) => ({ card: named(r.card_id), n: r.n, coins: r.coins, median: r.median })),
      hours: marketHours,
      swaps,
      grants: grants[0] ?? {},
    },
    openCup: { ...(openCups[0] ?? {}), players: openCupPlayers[0]?.n ?? 0, daily: openCupDaily, biggest: bigCups },
    teamCup: { ...(teamCups[0] ?? {}), players: teamCupPlayers[0]?.n ?? 0 },
    ladder,
    enc,
  }
}
