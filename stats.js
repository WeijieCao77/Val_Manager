/**
 * The questions the dashboard answers.
 *
 * Each one exists because it changes what the owner would do next. "How many
 * requests did we serve" changes nothing and is not here. "Half the people who
 * pick a club never advance a single turn" changes the next thing you build.
 *
 * Playtime is deliberately the sum of confirmed active minutes reported by the
 * client, not the wall-clock span of a session. A tab left open overnight
 * reports no heartbeats while it is hidden, so the night is not playtime.
 */

/** Everything at once, so the dashboard is a single round trip. */
export async function overview(sql, days = 30) {
  const since = `${days} days`

  const [
    headline, daily, retention, sessions, funnel, depth,
    devices, screens, clubs, referrers, errors,
    home, careers, unlocks, accounts,
  ] = await Promise.all([
    // The number that goes at the top: people who came back on a later day.
    // One visit is a click on a link; two days is a game someone chose again.
    sql`
      with per_visitor as (
        select visitor_id,
               count(distinct date_trunc('day', ts)) as days_active,
               min(ts) as first_seen
        from events
        where ts > now() - ${since}::interval
        group by visitor_id
      )
      select
        count(*)::int                                            as visitors,
        count(*) filter (where days_active >= 2)::int            as returned,
        count(*) filter (where days_active >= 4)::int            as regulars,
        coalesce(round(100.0 * count(*) filter (where days_active >= 2)
                 / nullif(count(*), 0))::int, 0)                 as return_pct
      from per_visitor`,

    // shape of the last N days: is it growing, and is it new people or the same ones
    sql`
      with d as (
        select date_trunc('day', ts)::date as day, visitor_id, min(ts) over () as x
        from events where ts > now() - ${since}::interval
      ),
      firsts as (
        select visitor_id, min(date_trunc('day', ts))::date as first_day
        from events group by visitor_id
      )
      select d.day,
             count(distinct d.visitor_id)::int                                   as visitors,
             count(distinct d.visitor_id) filter (where f.first_day = d.day)::int as new_visitors
      from d join firsts f using (visitor_id)
      group by d.day order by d.day`,

    // did the people who arrived on day X come back on day X+1 / +7
    sql`
      with firsts as (
        select visitor_id, min(date_trunc('day', ts))::date as cohort
        from events group by visitor_id
      ),
      active as (
        select distinct visitor_id, date_trunc('day', ts)::date as day from events
      )
      select f.cohort,
             count(distinct f.visitor_id)::int as size,
             count(distinct a1.visitor_id)::int as d1,
             count(distinct a7.visitor_id)::int as d7
      from firsts f
      left join active a1 on a1.visitor_id = f.visitor_id and a1.day = f.cohort + 1
      left join active a7 on a7.visitor_id = f.visitor_id and a7.day = f.cohort + 7
      where f.cohort > (now() - ${since}::interval)::date
      group by f.cohort order by f.cohort`,

    // How long a sitting lasts, in confirmed active minutes.
    //
    // Taken as the largest figure a session ever reported, not the one in its
    // session_end: iOS Safari drops pagehide often enough that requiring a
    // final event would silently discard the playtime of much of this
    // audience. The running total is pinged every few minutes for exactly this.
    sql`
      with per_session as (
        select session_id, max((props->>'active_s')::numeric) as active_s
        from events
        where name in ('session_end', 'session_ping')
          and ts > now() - ${since}::interval
          -- one anonymous POST with active_s:"x" would otherwise make this
          -- query — and so the whole dashboard — fail forever, and a plausible
          -- 1e308 would render a 308-digit "median session"
          and jsonb_typeof(props->'active_s') = 'number'
          and (props->>'active_s')::numeric between 0 and 86400
        group by session_id
      )
      select
        count(*)::int as n,
        coalesce(round(avg(active_s) / 60, 1), 0)                                  as avg_min,
        coalesce(round(((percentile_cont(0.5) within group (order by active_s))::numeric) / 60, 1), 0) as median_min,
        count(*) filter (where active_s < 60)::int   as under_1min,
        count(*) filter (where active_s >= 900)::int as over_15min
      from per_session`,

    // Where people stop.
    //
    // Two things this has to get right or it lies. The join must stay inside
    // the window — joining on visitor_id alone pulled in every event the
    // person ever produced, so someone who played months ago counted as having
    // advanced this week. And each step must CONTAIN the ones after it: you
    // cannot have watched a match without having advanced a turn, so a step is
    // "reached at least this far", not "fired this event". Without that the
    // chart drew more people finishing a stage than starting a career.
    sql`
      with step as (
        select visitor_id,
          bool_or(name = 'career_start' or name = 'career_resume') as c_start,
          bool_or(name = 'turn')                                   as c_turn,
          bool_or(name in ('match_watched', 'match_skipped'))      as c_match,
          bool_or(name = 'stage_done')                             as c_stage,
          bool_or(name = 'season_done')                            as c_season
        from events
        where ts > now() - ${since}::interval
        group by visitor_id
      ), reached as (
        select visitor_id,
          (c_season)                                               as finished_season,
          (c_season or c_stage)                                    as finished_stage,
          (c_season or c_stage or c_match)                         as played,
          (c_season or c_stage or c_match or c_turn)               as advanced,
          (c_season or c_stage or c_match or c_turn or c_start)    as started
        from step
      )
      select count(*)::int                                    as arrived,
             count(*) filter (where started)::int             as started,
             count(*) filter (where advanced)::int            as advanced,
             count(*) filter (where played)::int              as played,
             count(*) filter (where finished_stage)::int      as finished_stage,
             count(*) filter (where finished_season)::int     as finished_season
      from reached`,

    // how deep the ones who do play get
    sql`
      select
        coalesce(round(avg(day))::int, 0)      as avg_game_day,
        coalesce(max(day), 0)                  as max_game_day,
        coalesce(round(avg(turns), 1), 0)      as avg_turns
      from (
        select visitor_id,
               max((props->>'day')::numeric)::bigint as day,
               count(*)                             as turns
        from events
        where name = 'turn' and jsonb_typeof(props->'day') = 'number'
          -- The type check is not enough on its own: 1.5 is a number and
          -- '1.5'::bigint throws, 1e20 is a number and overflows. Going via
          -- numeric handles the fraction, the range handles the rest, and both
          -- are needed. This also heals rows already written, which a fix at
          -- ingest cannot do.
          -- A season is 336 days and a long career a few thousand. Anything
          -- past that is not a deep save, it is someone testing the endpoint —
          -- clamping it to the ceiling would put that ceiling on the dashboard
          -- as "deepest run", so it is excluded rather than squashed.
          and (props->>'day')::numeric between 0 and 20000
          and ts > now() - ${since}::interval
        group by visitor_id
      ) t(visitor_id, day, turns)`,

    sql`
      select coalesce(device, '?') as device, count(distinct visitor_id)::int as visitors
      from events where ts > now() - ${since}::interval
      group by device order by visitors desc`,

    // the last screen of a session is where someone gave up
    sql`
      select props->>'to' as screen, count(*)::int as n
      from events
      where name = 'screen' and ts > now() - ${since}::interval and props ? 'to'
      group by 1 order by n desc limit 12`,

    sql`
      select props->>'club' as club, props->>'tier' as tier, count(*)::int as n
      from events
      where name = 'career_start' and ts > now() - ${since}::interval and props ? 'club'
      group by 1, 2 order by n desc limit 15`,

    sql`
      select coalesce(props->>'ref', '(直接打开)') as ref, count(distinct visitor_id)::int as visitors
      from events
      where name = 'session_start' and ts > now() - ${since}::interval
      group by 1 order by visitors desc limit 10`,

    sql`
      select props->>'msg' as msg, count(*)::int as n, max(ts) as last_seen
      from events where name = 'error' and ts > now() - ${since}::interval
      group by 1 order by n desc limit 10`,

    // ---- the front page, which is now the first decision anybody makes.
    // Counted per visitor rather than per click: somebody who opens the
    // manager four times is one person who chose the manager.
    sql`
      with seen as (
        select visitor_id,
          bool_or(name = 'home_go' and props->>'go' = 'career') as went_career,
          bool_or(name = 'home_go' and props->>'go' = 'cards')  as went_cards
        from events
        where ts > now() - ${since}::interval
        group by visitor_id
      )
      select
        count(*)::int                                                as visitors,
        count(*) filter (where went_career)::int                     as career,
        count(*) filter (where went_cards)::int                      as cards,
        count(*) filter (where went_career and went_cards)::int      as both,
        count(*) filter (where not went_career and not went_cards)::int as neither
      from seen`,

    // ---- how careers actually end. Being sacked was tracked from the start;
    // reaching 2036 was not tracked at all until this release.
    sql`
      select
        count(*) filter (where props->>'finished' = '1')::int as finished,
        count(*) filter (where props->>'finished' = '0')::int as sacked,
        coalesce(round(avg((props->>'seasons')::numeric)
          filter (where (props->>'seasons') ~ '^[0-9]+$'))::int, 0) as avg_seasons,
        coalesce(round(avg((props->>'honours')::numeric)
          filter (where (props->>'honours') ~ '^[0-9]+$'))::int, 0) as avg_honours
      from events
      where name = 'game_over' and ts > now() - ${since}::interval`,

    // ---- which of the 65 anybody actually earns. The reachability audit
    // proves they all can be; this is the half it cannot answer, and a row
    // that never appears is content nobody has ever seen.
    sql`
      select props->>'kind' as kind, props->>'key' as key,
             -- the game sends its own name for the thing, so this panel never
             -- keeps a second copy of sixty-five titles that could drift
             max(props->>'name') as name,
             count(distinct visitor_id)::int as visitors
      from events
      where name = 'unlock' and ts > now() - ${since}::interval and props ? 'key'
      group by 1, 2 order by visitors desc limit 40`,

    // ---- the account is opt-in, so its take-up is worth watching on its own
    sql`
      select
        count(distinct visitor_id) filter (where props->>'act' = 'new')::int     as made,
        count(distinct visitor_id) filter (where props->>'act' = 'restore')::int as restored
      from events
      where name = 'account' and ts > now() - ${since}::interval`,
  ])

  return {
    days,
    headline: headline[0] ?? {},
    daily, retention, sessions: sessions[0] ?? {},
    funnel: funnel[0] ?? {}, depth: depth[0] ?? {},
    devices, screens, clubs, referrers, errors,
    home: home[0] ?? {}, careers: careers[0] ?? {},
    unlocks, accounts: accounts[0] ?? {},
  }
}

/**
 * Keep the table from growing forever.
 *
 * A few hundred players will not trouble Postgres, but "will not trouble it
 * this year" is not a retention policy. Raw events older than half a year go;
 * nothing on the dashboard looks further back than that.
 */
export async function prune(sql, days = 180, maxRows = 3_000_000, maxBytes = 1_200_000_000) {
  const byAge = await sql`delete from events where ts < now() - ${`${days} days`}::interval`
  // Age alone cannot recover from a flood: a million rows written this morning
  // are all in date. Oldest-first by id gives the table a hard ceiling that a
  // restart can climb back under.
  const byCount = await sql`
    delete from events
    where id <= (select max(id) - ${maxRows} from events)`

  // ...and a row ceiling alone cannot recover from a FAT flood. Measured on a
  // real engine the widest legal row is ~2.4kB, so the 1.5GB write-refusal
  // budget is reached at roughly 640k rows — a fifth of the row ceiling. The
  // table filled, ingestion switched itself off, and prune deleted nothing
  // because both ceilings were still far away. Delete oldest-first in batches
  // until the size is back under budget.
  let bySize = 0
  for (let pass = 0; pass < 20; pass++) {
    let bytes = 0
    try {
      const r = await sql`select pg_total_relation_size('events') as b`
      bytes = Number(r[0]?.b ?? 0)
    } catch { break }
    if (bytes <= maxBytes) break
    const cut = await sql`
      delete from events
      where id in (select id from events order by id limit 200000)`
    if (!cut.count) break
    bySize += cut.count
    try { await sql`vacuum (analyze) events` } catch { /* not fatal */ }
  }
  return (byAge.count ?? 0) + (byCount.count ?? 0) + bySize
}
