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
    hosts, midReview, cardFunnel, packs, challenge, cardMatches, cardAccounts,
    overplayed, saveSize,
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
          -- 'turns' is the rollup, 'turn' the row-per-turn it replaced; the
          -- funnel only asks whether anyone ever advanced one
          bool_or(name in ('turn', 'turns'))                        as c_turn,
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

    /**
     * How deep the ones who do play get.
     *
     * Reads two shapes and adds them up. The new one is a single row per
     * session carrying running totals — `turns` and the deepest day reached —
     * which is why it is a max per session and then a sum per visitor: a
     * re-delivered beacon repeats a total, and repeating a total is harmless
     * only if it is read as a max. The old one is a row per turn, counted, and
     * stays in until those rows age out of the 180-day window.
     *
     * The numeric guards are not decoration: the type check alone is not
     * enough, because 1.5 is a number and '1.5'::bigint throws, and 1e20 is a
     * number and overflows. Going via numeric handles the fraction and the
     * range handles the rest. A season is 336 days and a long career a few
     * thousand; anything past 20000 is somebody poking the endpoint, and it is
     * excluded rather than clamped — clamping would put the ceiling itself on
     * the dashboard as 「最深的一档」.
     */
    sql`
      select
        coalesce(round(avg(day))::int, 0)      as avg_game_day,
        coalesce(max(day), 0)                  as max_game_day,
        coalesce(round(avg(turns), 1), 0)      as avg_turns
      from (
        select visitor_id, max(day)::bigint as day, sum(turns) as turns
        from (
          select visitor_id, session_id,
                 max((props->>'day')::numeric)   as day,
                 max((props->>'turns')::numeric) as turns
          from events
          where name = 'turns'
            and jsonb_typeof(props->'day') = 'number'
            and jsonb_typeof(props->'turns') = 'number'
            and (props->>'day')::numeric between 0 and 20000
            and (props->>'turns')::numeric between 0 and 100000
            and ts > now() - ${since}::interval
          group by 1, 2
          union all
          select visitor_id, session_id,
                 max((props->>'day')::numeric) as day,
                 count(*)::numeric             as turns
          from events
          where name = 'turn' and jsonb_typeof(props->'day') = 'number'
            and (props->>'day')::numeric between 0 and 20000
            and ts > now() - ${since}::interval
          group by 1, 2
        ) s
        group by visitor_id
      ) t(visitor_id, day, turns)`,

    sql`
      select coalesce(device, '?') as device, count(distinct visitor_id)::int as visitors
      from events where ts > now() - ${since}::interval
      group by device order by visitors desc`,

    /**
     * Which screens get opened, and how often.
     *
     * Same two shapes as the turn counts: 'screens' is one row per screen per
     * session carrying a running count (max per session, then summed), 'screen'
     * is the old row-per-visit (counted). Both are folded together so the
     * number does not visibly halve on the day the rollup ships.
     */
    sql`
      select screen, sum(n)::int as n
      from (
        select props->>'to' as screen, session_id,
               max((props->>'hits')::numeric) as n
        from events
        where name = 'screens' and ts > now() - ${since}::interval
          and props ? 'to' and jsonb_typeof(props->'hits') = 'number'
          and (props->>'hits')::numeric between 0 and 100000
        group by 1, 2
        union all
        select props->>'to', session_id, count(*)::numeric
        from events
        where name = 'screen' and ts > now() - ${since}::interval and props ? 'to'
        group by 1, 2
      ) t(screen, session_id, n)
      group by screen order by n desc limit 12`,

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

    // Errors, with the number that says how bad it is. 134,000 occurrences is
    // either everybody or one person clicking all week, and counting rows
    // could not tell those apart — an autosave error repeats on every single
    // commit, so one afflicted career produces thousands of them.
    sql`
      select props->>'msg' as msg, count(*)::int as n,
             count(distinct visitor_id)::int as visitors, max(ts) as last_seen
      from events where name = 'error' and ts > now() - ${since}::interval
      group by 1 order by visitors desc, n desc limit 10`,

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

    // ---- which door people came in by.
    //
    // The game answers on more than one domain, all of them the same Railway
    // service writing to this same table, so "is the new domain carrying any
    // traffic" was a question the data could not answer: a referrer names
    // somewhere else, and somewhere else is null for most of this audience.
    // Only rows written after this shipped carry a host at all.
    sql`
      select coalesce(props->>'host', '(这次改动之前)') as host,
             count(distinct visitor_id)::int as visitors
      from events
      where name = 'session_start' and ts > now() - ${since}::interval
      group by 1 order by visitors desc limit 8`,

    // ---- the五年之约: offered once a career, and the answer is the single
    // clearest statement of whether people want more of this game or less.
    sql`
      select
        count(distinct visitor_id) filter (where props->>'settle' = '0')::int as continued,
        count(distinct visitor_id) filter (where props->>'settle' = '1')::int as settled
      from events
      where name = 'mid_review' and ts > now() - ${since}::interval`,

    // ---- 开瓦包, which had no panel of its own at all: the front page said how
    // many people tapped it and nothing said what happened next. Same rule as
    // the career funnel — each step contains the ones after it, so this is
    // "reached at least this far", never "fired this event".
    sql`
      with step as (
        select visitor_id,
          bool_or(name = 'home_go' and props->>'go' = 'cards') as tapped,
          bool_or(name = 'card_start')  as entered,
          bool_or(name = 'card_pull')   as pulled,
          bool_or(name = 'card_match')  as fought,
          bool_or(name = 'card_signin') as signed,
          count(distinct date_trunc('day', ts)) filter (
            where name in ('card_start', 'card_pull', 'card_match', 'card_signin')
          ) as card_days
        from events
        where ts > now() - ${since}::interval
        group by visitor_id
      ), reached as (
        select
          (tapped or entered or pulled or fought or signed) as touched,
          (entered or pulled or fought or signed)           as entered,
          (pulled or fought or signed)                      as pulled,
          (fought or signed)                                as fought,
          signed                                            as signed,
          card_days >= 2                                    as came_back
        from step
      )
      select count(*) filter (where touched)::int   as touched,
             count(*) filter (where entered)::int   as entered,
             count(*) filter (where pulled)::int    as pulled,
             count(*) filter (where fought)::int    as fought,
             count(*) filter (where signed)::int    as signed,
             count(*) filter (where came_back)::int as came_back
      from reached`,

    // Which packs get opened, and what comes out of them. The drop rates are
    // published in the game, so this is the other half of that promise: what
    // the published number actually looks like once a few thousand cards have
    // been dealt. The regex guards are the house pattern — a prop is only cast
    // when it is unmistakably a small whole number.
    sql`
      select props->>'kind' as kind,
             count(*)::int                                        as opens,
             count(distinct visitor_id)::int                      as visitors,
             count(*) filter (where props->>'paid' = 'coins')::int as bought,
             coalesce(sum(case when props->>'gold' ~ '^[0-9]{1,3}$'
                               then (props->>'gold')::int else 0 end), 0)  as gold,
             coalesce(sum(case when props->>'dupes' ~ '^[0-9]{1,3}$'
                               then (props->>'dupes')::int else 0 end), 0) as dupes
      from events
      where name = 'card_pull' and ts > now() - ${since}::interval and props ? 'kind'
      group by 1 order by opens desc limit 10`,

    // ---- 每日挑战: the one thing in the card mode that asks a player to know
    // something. Whether it lands is a solve rate, not a play count — a puzzle
    // nobody solves is a puzzle nobody comes back to.
    sql`
      select props->>'kind' as kind,
             count(*)::int                                          as played,
             count(distinct visitor_id)::int                        as visitors,
             count(*) filter (where props->>'solved' = '1')::int    as solved,
             coalesce(round(avg(case when props->>'tries' ~ '^[0-9]{1,2}$'
               then (props->>'tries')::int end)
               filter (where props->>'solved' = '1'), 1), 0)        as avg_tries,
             coalesce(max(case when props->>'streak' ~ '^[0-9]{1,4}$'
               then (props->>'streak')::int else 0 end), 0)         as best_streak
      from events
      where name = 'card_challenge' and ts > now() - ${since}::interval and props ? 'kind'
      group by 1 order by played desc`,

    // 天梯 and 杯赛 are the reason to own the cards at all.
    sql`
      select props->>'mode' as mode,
             count(*)::int                                     as played,
             count(distinct visitor_id)::int                   as visitors,
             count(*) filter (where props->>'won' = 'true')::int as wins
      from events
      where name = 'card_match' and ts > now() - ${since}::interval and props ? 'mode'
      group by 1 order by played desc`,

    // ---- the collections themselves.
    //
    // Not events: the card mode is the one part of this game with a real
    // server-side save, so how big a collection gets and how far up the ladder
    // people climb can be asked of the saves rather than inferred from what
    // somebody's browser managed to report. `materialized` is load-bearing —
    // it forces the shape filter to run before anything casts, and a cast that
    // throws takes the whole dashboard down for as long as the row exists.
    sql`
      with acc as materialized (
        select created, seen, saved, state
        from card_accounts
        where jsonb_typeof(state->'cards') = 'object'
      )
      select
        count(*)::int                                                        as accounts,
        count(*) filter (where created > now() - ${since}::interval)::int    as fresh,
        count(*) filter (where seen    > now() - ${since}::interval)::int    as active,
        count(*) filter (where coalesce(saved, seen)::date > created::date)::int as came_back,
        coalesce(round(avg(k.owned))::int, 0)                                as avg_owned,
        coalesce(max(k.owned), 0)                                            as max_owned,
        coalesce(round(avg(v.pulls))::int, 0)                                as avg_pulls,
        coalesce(max(v.pulls), 0)                                            as max_pulls,
        coalesce(max(v.div), 0)                                              as max_div,
        coalesce(max(v.streak), 0)                                           as max_streak
      from acc a,
        lateral (select count(*)::int as owned from jsonb_object_keys(a.state->'cards')) k,
        lateral (select
          case when a.state->>'pulls' ~ '^[0-9]{1,9}$' then (a.state->>'pulls')::int else 0 end as pulls,
          case when a.state->'ladder'->>'div' ~ '^[0-9]{1,3}$'
               then (a.state->'ladder'->>'div')::int else 0 end as div,
          case when a.state->'daily'->>'streak' ~ '^[0-9]{1,5}$'
               then (a.state->'daily'->>'streak')::int else 0 end as streak
        ) v`,

    /**
     * Saves whose match count does not fit in the hours the account has existed.
     *
     * The card save lives in the browser and is written back wholesale — that
     * is the design, and an anti-cheat pass on a browser game is theatre. But
     * `created` is set by the server on insert and is the one number a player
     * cannot touch, so it can be checked against one they can: 体力 refills a
     * point every 50 minutes, caps at 15, and a ladder match costs 2. That
     * fixes a ceiling of about 14 matches a day, and anything far past it did
     * not come from playing.
     *
     * Reported, not enforced. There is one honest way to trip it — playing a
     * long time offline in 仅本机 and only then connecting, which stamps a
     * fresh `created` on an old save — so the answer to a flagged row is to
     * look at it, not to delete it.
     */
    sql`
      with acc as materialized (
        select created, name, id_hash, state
        from card_accounts
        where jsonb_typeof(state->'ladder') = 'object'
      )
      select
        a.name, a.id_hash, a.created,
        v.wins, v.losses, (v.wins + v.losses) as played,
        round(extract(epoch from now() - a.created) / 3600)::int as hours,
        -- 15 banked at the start, then one point every 50 minutes, 2 a match
        floor((15 + extract(epoch from now() - a.created) / 3000) / 2)::int as ceiling
      from acc a,
        lateral (select
          case when a.state->'ladder'->>'wins' ~ '^[0-9]{1,9}$'
               then (a.state->'ladder'->>'wins')::int else 0 end as wins,
          case when a.state->'ladder'->>'losses' ~ '^[0-9]{1,9}$'
               then (a.state->'ladder'->>'losses')::int else 0 end as losses
        ) v
      where v.wins + v.losses
            > floor((15 + extract(epoch from now() - a.created) / 3000) / 2)
      order by (v.wins + v.losses)
             - floor((15 + extract(epoch from now() - a.created) / 3000) / 2) desc
      limit 20`
      // The only query here that reads a table another module owns. Everything
      // in this file is fetched in one Promise.all, so one rejection is the
      // whole dashboard refusing to load — an empty card panel is the better
      // failure.
      .catch(() => []),

    // ---- how big careers get, against the budget the browser gives them.
    //
    // The save lives in localStorage: 5MB per origin on iOS Safari, counted in
    // UTF-16, so about 2.5 million characters for the autosave, any manual
    // saves, the tutorial's parked copy and the card mode together. Three
    // quarters of this audience is on a phone. Twice now a season's worth of
    // per-match paperwork has quietly filled it and every autosave started
    // failing, and both times it was found by accident. It is a number on the
    // wall now: the median career, the big ones, and how many of them were
    // already too big to write.
    sql`
      with sizes as (
        select visitor_id,
               max((props->>'kb')::int) as kb,
               max((props->>'day')::int) as day,
               -- the rescue path: the browser refused the write, old match
               -- paperwork was dropped and it went in. A success, counted
               -- here rather than in the error list it used to sit in.
               bool_or(props->>'shrunk' = '1') as shrunk
        from events
        where name in ('save_size', 'error')
          and ts > now() - ${since}::interval
          and props->>'kb' ~ '^[0-9]{1,6}$'
        group by visitor_id
      )
      select
        count(*)::int                                              as careers,
        coalesce(round(percentile_cont(0.5)
          within group (order by kb))::int, 0)                     as p50,
        coalesce(round(percentile_cont(0.9)
          within group (order by kb))::int, 0)                     as p90,
        coalesce(max(kb), 0)                                       as max_kb,
        coalesce(round(avg(day))::int, 0)                          as avg_day,
        count(*) filter (where kb > 1500)::int                     as over_1500,
        count(*) filter (where shrunk)::int                        as shrunk
      from sizes`,
  ])

  return {
    days,
    headline: headline[0] ?? {},
    daily, retention, sessions: sessions[0] ?? {},
    funnel: funnel[0] ?? {}, depth: depth[0] ?? {},
    devices, screens, clubs, referrers, errors,
    home: home[0] ?? {}, careers: careers[0] ?? {},
    unlocks, accounts: accounts[0] ?? {},
    hosts, midReview: midReview[0] ?? {}, saveSize: saveSize[0] ?? {},
    cards: {
      funnel: cardFunnel[0] ?? {},
      packs,
      challenge,
      matches: cardMatches,
      accounts: cardAccounts[0] ?? {},
      overplayed,
    },
  }
}

/**
 * Keep the table from growing forever.
 *
 * A few hundred players will not trouble Postgres, but "will not trouble it
 * this year" is not a retention policy. Raw events older than half a year go;
 * nothing on the dashboard looks further back than that.
 */
export async function prune(sql, days = 180, maxRows = 4_000_000) {
  const byAge = await sql`delete from events where ts < now() - ${`${days} days`}::interval`

  // Oldest-first down to a row ceiling, addressed by POSITION rather than by
  // id arithmetic. `id <= max(id) - maxRows` assumes the ids are dense and
  // they are not: the dedupe index rejects a re-delivered batch after the
  // sequence has already handed out its numbers, so the gaps grow with every
  // flaky phone and the threshold drifts further into live data.
  const byCount = await sql`
    delete from events
    where id in (select id from events order by id desc offset ${maxRows})`

  const total = (byAge.count ?? 0) + (byCount.count ?? 0)
  if (total) {
    console.warn(`analytics: pruned ${total} events`
      + ` — over-age ${byAge.count ?? 0}, over-rows ${byCount.count ?? 0}`)
  }
  return total
}


/**
 * Why there is no size-based deletion here any more.
 *
 * There was: a loop that compared pg_total_relation_size against a byte budget
 * and deleted 200k rows a pass until it came under. It never came under, and
 * it could not have. Plain VACUUM marks space reusable but does NOT return it
 * to the operating system — only VACUUM FULL shrinks the file, and that takes
 * an exclusive lock — so the size a DELETE leaves behind is the size it
 * started with. Every boot therefore ran all twenty passes and deleted four
 * million rows however little was actually over, and a day of eight deploys
 * took thirty days of play data down to one.
 *
 * The deeper point is that the rule was never sound in either direction:
 * deleting rows cannot free disk, so it cannot answer the problem it was
 * written for. What bounds the table is the row ceiling, which is exact, and
 * converges, and is trivially checked. Bloat is reported to the dashboard
 * instead of being fought with a chainsaw — if the file is ever far larger
 * than the rows in it, that is a VACUUM FULL to run deliberately, not
 * something a boot should decide on its own.
 */

/**
 * What the retention policy is doing to the history, for the dashboard.
 *
 * The thirty days that went missing went missing SILENTLY — nothing on the
 * screen said the table had a ceiling, was near it, or had just cut a month
 * off the back. So the numbers are on the wall now.
 */
export async function storage(sql, maxRows = 4_000_000) {
  try {
    const r = await sql`
      select count(*)::bigint as rows,
             min(ts) as oldest,
             max(ts) as newest,
             pg_total_relation_size('events')::bigint as bytes
      from events`
    const row = r[0] ?? {}
    return {
      rows: Number(row.rows ?? 0),
      oldest: row.oldest ?? null,
      newest: row.newest ?? null,
      bytes: Number(row.bytes ?? 0),
      maxRows,
    }
  } catch {
    return { rows: 0, oldest: null, newest: null, bytes: 0, maxRows }
  }
}
