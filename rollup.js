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
 * Every event is folded into them exactly once, behind a watermark, and the
 * pruner is only ever allowed below that watermark — see rollup().
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

-- How far into the events table the fold has got (events.id), and the day the
-- fold was first run on this database — see rollup() for what that day means.
create table if not exists rollup_state (
  key           text primary key,
  last_id       bigint not null default 0,
  bootstrap_day date,
  updated       timestamptz not null default now()
);
-- What a day is made of while it can still grow: who came, which sessions and
-- the largest running totals each one reported, and the plain counts. Every
-- event is folded into these exactly once (the watermark moves in the same
-- transaction), so a day's figures never depend on its events still existing.
-- Retained for correct handling of late events; archival requires a sealed-day policy.
create table if not exists rollup_day_visitors (
  day        date not null,
  visitor_id text not null,
  primary key (day, visitor_id)
);
create table if not exists rollup_day_sessions (
  day        date not null,
  session_id text not null,
  secs       int not null default 0,
  turn_total int not null default 0,
  primary key (day, session_id)
);
create table if not exists rollup_day_counts (
  day            date primary key,
  career_starts  int not null default 0,
  old_turns      int not null default 0,
  card_starts    int not null default 0,
  card_pulls     int not null default 0,
  card_matches   int not null default 0,
  errors         int not null default 0,
  events         int not null default 0
);
`

const KEY = 'events'
/** Events folded per transaction: bounds how long one fold holds its connection. */
const FOLD_BATCH = 10_000
/** Bounded work per call; backlog is resumed at the durable watermark next time. */
const FOLD_PASSES = 40
/** How long the per-day working sets are kept. */
// Working sets are retained until an explicit archival policy seals old days.

/** The highest events.id already folded into the permanent tables; 0 before the first fold. */
export async function foldedUpTo(sql) {
  const r = await sql`select last_id from rollup_state where key = ${KEY}`
  return Number(r[0]?.last_id ?? 0)
}

/**
 * Fold the events not folded yet into the permanent tables.
 *
 * It used to recompute the last three days from whatever events were in the
 * table and OVERWRITE daily_stats with the answer. The row ceiling deletes
 * oldest-first and at this volume reaches inside those three days, so the next
 * run recomputed a day from the half of it that was left and wrote the smaller
 * number over the right one (reproduced 2026-09-18: four visitors, prune to
 * two events, roll up — the day says two).
 *
 * Now every event is folded exactly once. A watermark (rollup_state.last_id)
 * says how far the fold has got; one transaction folds the next batch into
 * the per-day working sets, rebuilds the daily_stats rows of the days it
 * touched FROM those sets, and moves the watermark. A crash rolls all three
 * back together; a rerun finds nothing above the watermark and changes
 * nothing; two processes are serialised by the watermark's row lock. The
 * pruner may only delete at or below the watermark (pruneFolded), so there is
 * no order of events in which a deletion can take a number back.
 *
 * Not a sum into daily_stats and not a max over it: distinct visitors and
 * per-session running totals cannot be merged from day totals, which is why
 * the working sets hold visitors and sessions, not counts of them.
 *
 * The first run on a database that already has history meets days the old
 * method wrote, whose events are partly gone. For those days — up to and
 * including the day of that first run, recorded as bootstrap_day — a rebuilt
 * figure is only allowed to raise what is stored. Later days are complete in
 * the working sets by construction and are written as computed.
 *
 * `lagSec`: events younger than this are left for the next run. An insert
 * takes its id a moment before it commits, and an id below the watermark that
 * commits after the fold would never be folded.
 */
export async function rollup(sql, opts = {}) {
  const lagSec = typeof opts === 'object' && Number.isFinite(opts.lagSec) ? Math.max(0, opts.lagSec) : 30
  const batch = typeof opts === 'object' && opts.batch > 0 ? Math.trunc(opts.batch) : FOLD_BATCH
  const run = (fn) => (sql.begin ? sql.begin(fn) : fn(sql))
  let folded = 0, people = 0, passes = 0
  const days = new Set()
  for (; passes < FOLD_PASSES; passes++) {
    const step = await run(async (db) => {
      await db`insert into rollup_state (key, last_id, bootstrap_day) values (${KEY}, 0, current_date) on conflict (key) do nothing`
      const st = await db`select last_id, bootstrap_day from rollup_state where key = ${KEY} for update`
      // Wait for in-flight inserts before advancing past their sequence IDs.
      // A time lag alone cannot protect against a delayed commit. The lock
      // lasts one bounded fold and permits readers.
      await db`set local lock_timeout = '1s'`
      await db`lock table events in share mode`
      const from = Number(st[0].last_id)
      const top = await db`
        select max(id) as hi from (
          select id from events
           where id > ${from} and ts <= now() - make_interval(secs => ${lagSec})
           order by id limit ${batch}) x`
      const to = Number(top[0]?.hi ?? 0)
      if (!to || to <= from) return null

      // One row per person, ever. least/greatest because a batch can arrive out
      // of order and a re-delivered beacon can be older than what is stored.
      const ppl = await db`
        insert into visitors (visitor_id, first_seen, last_seen, device, host)
        select e.visitor_id, min(e.ts), max(e.ts),
               (array_agg(e.device order by e.ts desc))[1],
               (array_agg(e.props->>'host' order by e.ts desc) filter (where e.props ? 'host'))[1]
        from events e
        where e.id > ${from} and e.id <= ${to} and e.visitor_id is not null
        group by e.visitor_id
        on conflict (visitor_id) do update set
          first_seen = least(visitors.first_seen, excluded.first_seen),
          last_seen  = greatest(visitors.last_seen, excluded.last_seen),
          device     = coalesce(excluded.device, visitors.device),
          host       = coalesce(excluded.host, visitors.host)`

      await db`
        insert into rollup_day_visitors (day, visitor_id)
        select distinct date_trunc('day', ts)::date, visitor_id from events
         where id > ${from} and id <= ${to} and visitor_id is not null
        on conflict do nothing`

      // Playtime and turns both arrive as RUNNING TOTALS per session — the ping
      // resends the accumulated figure — so each is the largest value that
      // session ever reported, and the day is the sum of those.
      await db`
        insert into rollup_day_sessions (day, session_id, secs, turn_total)
        select date_trunc('day', ts)::date, session_id,
               max(case when name in ('session_ping', 'session_end') and props->>'active_s' ~ '^[0-9]{1,6}$'
                        then (props->>'active_s')::int else 0 end),
               max(case when name = 'turns' and props->>'turns' ~ '^[0-9]{1,6}$'
                        then (props->>'turns')::int else 0 end)
          from events
         where id > ${from} and id <= ${to} and visitor_id is not null
         group by 1, 2
        on conflict (day, session_id) do update set
          secs = greatest(rollup_day_sessions.secs, excluded.secs),
          turn_total = greatest(rollup_day_sessions.turn_total, excluded.turn_total)`

      // plain counts ARE additive, and adding is safe because each event passes here once
      await db`
        insert into rollup_day_counts (day, career_starts, old_turns, card_starts, card_pulls, card_matches, errors, events)
        select date_trunc('day', ts)::date,
               count(*) filter (where name in ('career_start', 'career_resume'))::int,
               count(*) filter (where name = 'turn')::int,
               count(*) filter (where name = 'card_start')::int,
               count(*) filter (where name = 'card_pull')::int,
               count(*) filter (where name = 'card_match')::int,
               count(*) filter (where name = 'error')::int,
               count(*)::int
          from events
         where id > ${from} and id <= ${to} and visitor_id is not null
         group by 1
        on conflict (day) do update set
          career_starts = rollup_day_counts.career_starts + excluded.career_starts,
          old_turns     = rollup_day_counts.old_turns + excluded.old_turns,
          card_starts   = rollup_day_counts.card_starts + excluded.card_starts,
          card_pulls    = rollup_day_counts.card_pulls + excluded.card_pulls,
          card_matches  = rollup_day_counts.card_matches + excluded.card_matches,
          errors        = rollup_day_counts.errors + excluded.errors,
          events        = rollup_day_counts.events + excluded.events`

      const touched = await db`
        select distinct date_trunc('day', ts)::date as day from events
         where id > ${from} and id <= ${to} and visitor_id is not null`
      const list = touched.map((r) => (r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10)))
      if (list.length) {
        await db`
          insert into daily_stats (
            day, visitors, new_visitors, sessions, active_min, career_starts, turns,
            card_starts, card_pulls, card_matches, errors, events, built)
          select c.day,
                 (select count(*)::int from rollup_day_visitors v where v.day = c.day),
                 -- new to the GAME, not new to the day: read off the permanent table
                 coalesce((select count(*)::int from visitors v
                            where v.first_seen >= c.day and v.first_seen < c.day + 1), 0),
                 (select count(*)::int from rollup_day_sessions s where s.day = c.day),
                 coalesce((select round(sum(s.secs) / 60.0)::int from rollup_day_sessions s where s.day = c.day), 0),
                 c.career_starts,
                 c.old_turns + coalesce((select sum(s.turn_total)::int from rollup_day_sessions s where s.day = c.day), 0),
                 c.card_starts, c.card_pulls, c.card_matches, c.errors, c.events, now()
            from rollup_day_counts c
           where c.day in (select (jsonb_array_elements_text(${db.json(list)}::jsonb))::date)
          on conflict (day) do update set
            visitors      = case when daily_stats.day <= ${st[0].bootstrap_day} then greatest(daily_stats.visitors, excluded.visitors) else excluded.visitors end,
            new_visitors  = case when daily_stats.day <= ${st[0].bootstrap_day} then greatest(daily_stats.new_visitors, excluded.new_visitors) else excluded.new_visitors end,
            sessions      = case when daily_stats.day <= ${st[0].bootstrap_day} then greatest(daily_stats.sessions, excluded.sessions) else excluded.sessions end,
            active_min    = case when daily_stats.day <= ${st[0].bootstrap_day} then greatest(daily_stats.active_min, excluded.active_min) else excluded.active_min end,
            career_starts = case when daily_stats.day <= ${st[0].bootstrap_day} then greatest(daily_stats.career_starts, excluded.career_starts) else excluded.career_starts end,
            turns         = case when daily_stats.day <= ${st[0].bootstrap_day} then greatest(daily_stats.turns, excluded.turns) else excluded.turns end,
            card_starts   = case when daily_stats.day <= ${st[0].bootstrap_day} then greatest(daily_stats.card_starts, excluded.card_starts) else excluded.card_starts end,
            card_pulls    = case when daily_stats.day <= ${st[0].bootstrap_day} then greatest(daily_stats.card_pulls, excluded.card_pulls) else excluded.card_pulls end,
            card_matches  = case when daily_stats.day <= ${st[0].bootstrap_day} then greatest(daily_stats.card_matches, excluded.card_matches) else excluded.card_matches end,
            errors        = case when daily_stats.day <= ${st[0].bootstrap_day} then greatest(daily_stats.errors, excluded.errors) else excluded.errors end,
            events        = case when daily_stats.day <= ${st[0].bootstrap_day} then greatest(daily_stats.events, excluded.events) else excluded.events end,
            built = now()`
      }
      const moved = await db`select count(*)::int as n from events where id > ${from} and id <= ${to}`
      await db`update rollup_state set last_id = ${to}, updated = now() where key = ${KEY}`
      return { people: ppl.count ?? 0, days: list, n: moved[0]?.n ?? 0, full: (moved[0]?.n ?? 0) >= batch }
    })
    if (!step) break
    folded += step.n
    people += step.people
    for (const d of step.days) days.add(d)
    if (!step.full) break
  }
  // Retain membership sets: late events may revisit old days. Pruning these
  // without an immutable day-close policy would silently erase distinct counts.
  return { visitors: people, days: days.size, events: folded, caughtUp: passes < FOLD_PASSES }
}

/**
 * The pruner, allowed only what has been folded.
 *
 * `prune` is the policy (age, row ceiling); the watermark is the permission.
 * Called after a rollup that failed, or before one has ever run, this deletes
 * nothing that the permanent tables have not already counted.
 */
export async function pruneFolded(sql, prune, days, maxRows) {
  return prune(sql, days, maxRows, await foldedUpTo(sql))
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
