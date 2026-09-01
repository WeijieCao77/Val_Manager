/**
 * What survives the pruner.
 *
 * The events table is a rolling window — 180 days by policy, four million rows
 * by capacity, and at the volume this game reached the row ceiling bites first:
 * 3.5 million rows is about a day of history. Everything older is deleted, and
 * on 8/31 that took a month of it before anyone noticed.
 *
 * So the numbers worth keeping are computed BEFORE the deletion and written to
 * two tables that are never pruned:
 *
 *   visitors     one row per person, ever. This is the only way a cumulative
 *                player count can survive: you cannot count distinct visitors
 *                over rows you have thrown away. One row per visitor against
 *                341 events per visitor is a factor of three hundred, so this
 *                stays small for years.
 *   daily_stats  one row per day, ever. The shape of the dashboard's headline
 *                numbers, frozen as they were on the day.
 *
 * Both are upserted, so re-running is free and a day still in progress keeps
 * being corrected until it stops moving. That is also what makes the ordering
 * safe: roll up, then prune. Never the other way round.
 */

export const ROLLUP_SCHEMA = `
create table if not exists visitors (
  visitor_id text primary key,
  first_seen timestamptz not null,
  last_seen  timestamptz not null,
  device     text,
  host       text
);
create index if not exists visitors_first_idx on visitors (first_seen);

create table if not exists daily_stats (
  day            date primary key,
  visitors       int  not null default 0,
  new_visitors   int  not null default 0,
  sessions       int  not null default 0,
  active_min     int  not null default 0,
  career_starts  int  not null default 0,
  turns          int  not null default 0,
  card_starts    int  not null default 0,
  card_pulls     int  not null default 0,
  card_matches   int  not null default 0,
  errors         int  not null default 0,
  events         int  not null default 0,
  built          timestamptz not null default now()
);
`

/**
 * Fold the event window into the two permanent tables.
 *
 * `days` bounds the work: everything inside the window is recomputed, which is
 * what corrects a day that was still in progress last time. Beyond that the
 * rows are already frozen and the events are gone anyway.
 */
export async function rollup(sql, days = 3) {
  const since = `${Math.max(1, days)} days`

  // One row per person, ever. `least`/`greatest` because a batch can arrive out
  // of order and a re-delivered beacon can be older than what is already stored.
  const people = await sql`
    insert into visitors (visitor_id, first_seen, last_seen, device, host)
    select e.visitor_id, min(e.ts), max(e.ts),
           (array_agg(e.device order by e.ts desc))[1],
           (array_agg(e.props->>'host' order by e.ts desc) filter (where e.props ? 'host'))[1]
    from events e
    where e.ts > now() - ${since}::interval and e.visitor_id is not null
    group by e.visitor_id
    on conflict (visitor_id) do update set
      first_seen = least(visitors.first_seen, excluded.first_seen),
      last_seen  = greatest(visitors.last_seen, excluded.last_seen),
      device     = coalesce(excluded.device, visitors.device),
      host       = coalesce(excluded.host, visitors.host)`

  // Playtime and turns both arrive as RUNNING TOTALS per session — the ping
  // resends the accumulated figure — so each is the largest value that session
  // ever reported, and the day is the sum of those. Adding the pings up instead
  // would count the same minutes five times over.
  const daily = await sql`
    with win as (
      select ts, visitor_id, session_id, name, props
      from events
      where ts > now() - ${since}::interval and visitor_id is not null
    ),
    per_session as (
      select date_trunc('day', ts)::date as day, session_id,
             max(case when name in ('session_ping', 'session_end')
                       and props->>'active_s' ~ '^[0-9]{1,6}$'
                      then (props->>'active_s')::int else 0 end) as secs,
             max(case when name = 'turns' and props->>'turns' ~ '^[0-9]{1,6}$'
                      then (props->>'turns')::int else 0 end) as turn_total
      from win group by 1, 2
    ),
    rolled as (
      select day,
             coalesce(round(sum(secs) / 60.0)::int, 0) as active_min,
             coalesce(sum(turn_total)::int, 0)         as turn_total
      from per_session group by 1
    ),
    agg as (
      select
        date_trunc('day', ts)::date                                 as day,
        count(distinct visitor_id)::int                             as visitors,
        count(distinct session_id)::int                             as sessions,
        count(*) filter (where name in ('career_start', 'career_resume'))::int as career_starts,
        -- the old row-per-turn shape, still in the window until it ages out
        count(*) filter (where name = 'turn')::int                  as old_turns,
        count(*) filter (where name = 'card_start')::int            as card_starts,
        count(*) filter (where name = 'card_pull')::int             as card_pulls,
        count(*) filter (where name = 'card_match')::int            as card_matches,
        count(*) filter (where name = 'error')::int                 as errors,
        count(*)::int                                               as events
      from win group by 1
    )
    insert into daily_stats (
      day, visitors, new_visitors, sessions, active_min, career_starts, turns,
      card_starts, card_pulls, card_matches, errors, events, built)
    select
      a.day, a.visitors,
      -- new to the GAME, not new to the day: read off the permanent table, so
      -- it stays right long after the events that proved it are gone
      coalesce((select count(*)::int from visitors v
                where v.first_seen >= a.day and v.first_seen < a.day + 1), 0),
      a.sessions,
      coalesce(r.active_min, 0),
      a.career_starts,
      a.old_turns + coalesce(r.turn_total, 0),
      a.card_starts, a.card_pulls, a.card_matches, a.errors, a.events, now()
    from agg a left join rolled r on r.day = a.day
    on conflict (day) do update set
      visitors = excluded.visitors, new_visitors = excluded.new_visitors,
      sessions = excluded.sessions, active_min = excluded.active_min,
      career_starts = excluded.career_starts, turns = excluded.turns,
      card_starts = excluded.card_starts, card_pulls = excluded.card_pulls,
      card_matches = excluded.card_matches, errors = excluded.errors,
      events = excluded.events, built = now()`

  return { visitors: people.count ?? 0, days: daily.count ?? 0 }
}

/** The permanent history, for the dashboard. */
export async function history(sql, days = 90) {
  const [rows, totals] = await Promise.all([
    sql`select * from daily_stats where day > current_date - ${days}::int
        order by day desc limit 400`,
    sql`select count(*)::int as players,
               min(first_seen) as since,
               count(*) filter (where last_seen > now() - interval '7 days')::int as active7
        from visitors`,
  ])
  return { days: rows, totals: totals[0] ?? { players: 0, since: null, active7: 0 } }
}
