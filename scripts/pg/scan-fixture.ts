/**
 * A production-shaped card_accounts / open_cup_entries for reading query plans (2026-10-18).
 *
 * Sized off prod's pg_stat_user_tables that day: ~74k accounts in an ~83 MB heap (most saves small enough to
 * stay inline, the big collections toasted), ~33k cup entries over a fortnight of 全服杯 (one every two hours,
 * ~200 a cup; the cups themselves are kept for good), one rival row per account with a whole five, an open-ladder row for every account that has played. The plans
 * are what the scripts read, so the row counts and the statistics matter, not the card ids.
 */
export const FIXTURE = { accounts: 74_000, cupsKept: 168, cupsTotal: 380, perCup: 200 }

export async function buildScanFixture(exec: (q: string) => Promise<unknown>, schemas: string[], n = FIXTURE) {
  for (const s of schemas) await exec(s)
  // the ladder trigger would project 74k saves one by one; the fixture writes the projection itself below
  await exec(`alter table card_accounts disable trigger user`)
  await exec(`
    insert into card_accounts (id_hash, created, seen, saved, name, rev, state, suspect, ladder_seen, ladder_at)
    select h, now() - make_interval(days => (i % 50)), now() - make_interval(hours => (i % 600)), now() - make_interval(hours => (i % 600)),
      'p' || i, 1 + i % 40,
      jsonb_build_object(
        'pulls', i % 900, 'coins', (i * 37) % 50000, 'season', case when i % 3 = 0 then '0' else '1' end,
        'ladder', jsonb_build_object('div', i % 9, 'points', (i * 7) % 400, 'stars', i % 5, 'wins', i % 120, 'losses', i % 90, 'sWins', i % 40),
        'squad', case when i % 4 = 0 then '{}'::jsonb else jsonb_build_object(
          'slots', jsonb_build_array('c' || (i % 300), 'c' || ((i + 1) % 300), 'c' || ((i + 2) % 300), 'c' || ((i + 3) % 300), 'c' || ((i + 4) % 300)),
          'coach', 'k' || (i % 40)) end,
        'daily', jsonb_build_object('streak', i % 30),
        'cards', (select jsonb_object_agg('c' || k, jsonb_build_object('level', k % 6, 'count', 1 + k % 3, 'got', 1760000000000 + k))
                    from generate_series(0, case when i % 5 = 0 then 260 else 6 + i % 9 end) k)
          || jsonb_build_object('k' || (i % 40), jsonb_build_object('level', 1)))
      , i % 97 = 0, null, null
    from (select i, encode(sha256(('acct' || i)::bytea), 'hex') as h from generate_series(1, ${n.accounts}) i) x`)
  await exec(`alter table card_accounts enable trigger user`)
  await exec(`
    insert into account_rivals (id_hash, div, points, squad, cards, suspect)
    select id_hash, (state->'ladder'->>'div')::int, (state->'ladder'->>'points')::int, state->'squad', '{}'::jsonb, suspect
      from card_accounts where jsonb_typeof(state->'squad'->'slots') = 'array'`)
  await exec(`
    insert into account_ladder (id_hash, league, season, div, points, stars, wins, losses, suspect)
    select id_hash, 'open', state->>'season', (state->'ladder'->>'div')::int, (state->'ladder'->>'points')::int,
      (state->'ladder'->>'stars')::int, (state->'ladder'->>'wins')::int, (state->'ladder'->>'losses')::int, suspect
      from card_accounts where (state->'ladder'->>'wins')::int > 0`)
  // a fortnight of entries, every cup since the 全服杯 began
  await exec(`
    insert into open_cups (starts, status, round, rounds, entrants, champion, finished, format_version, phase)
    select date_trunc('hour', now()) + interval '2 hours' - make_interval(hours => 2 * j),
      case when j = 0 then 'open' when j = 1 then 'live' else 'done' end, 5, 9, ${n.perCup},
      case when j > 1 then encode(sha256(('acct' || (j * 131 % ${n.accounts} + 1))::bytea), 'hex') end,
      case when j > 1 then date_trunc('hour', now()) + interval '2 hours' - make_interval(hours => 2 * j - 1) end, 2, 'swiss'
    from generate_series(0, ${n.cupsTotal - 1}) j`)
  // the live cup's next round a day off, so a clock pass in a check reads and prunes but plays nothing
  await exec(`update open_cups set step_sec = 86400 where status = 'live'`)
  await exec(`
    insert into open_cup_entries (cup_id, id_hash, name, five, score, alive, wins, place, joined, swiss_wins, swiss_losses)
    select c.id, encode(sha256(('acct' || ((c.id * 977 + k * 131) % ${n.accounts} + 1))::bytea), 'hex'), 'p' || k,
      jsonb_build_object('slots', jsonb_build_array('c1', 'c2', 'c3', 'c4', 'c5'), 'coach', 'k1', 'levels', jsonb_build_object('c1', 3),
        -- prod's fives carry the score breakdown: ~1.3 KB a row, inline
        'parts', (select jsonb_agg(jsonb_build_object('id', 'c' || q, 'aim', q * 1.5, 'util', q * 0.5)) from generate_series(1, 28 + k % 3) q)),
      80 + k % 20, k % 7 = 0, k % 4, null, c.starts - interval '1 hour', k % 3, k % 3
    from (select id, starts, row_number() over (order by starts desc) as rn from open_cups) c,
      generate_series(1, ${n.perCup}) k
    where c.rn <= ${n.cupsKept}
    on conflict do nothing`)
  // the champion's row, as the cup's last round writes it
  await exec(`
    insert into open_cup_entries (cup_id, id_hash, name, five, score, place)
    select id, champion, 'champ', '{"slots":["c1","c2","c3","c4","c5"],"coach":"k1"}', 99, 1 from open_cups
     where champion is not null and starts >= (select min(starts) from (select starts from open_cups order by starts desc limit ${n.cupsKept}) s)
    on conflict (cup_id, id_hash) do update set place = 1`)
  await exec(`vacuum analyze card_accounts, account_rivals, account_ladder, open_cups, open_cup_entries`)
}
