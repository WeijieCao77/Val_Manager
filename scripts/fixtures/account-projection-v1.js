/**
 * The ladder board and the rival pool, kept beside the account instead of
 * read out of it (2026-10-05).
 *
 * Both used to be a scan of card_accounts.state — every account's whole save,
 * ~50 KB of TOASTed JSON each — to pull out six numbers per ladder or one five.
 * The board ran that scan whenever a player who had just acted looked at it,
 * and the rival pool once a minute. Here the numbers live in two small tables
 * that the board and the pool read instead.
 *
 * The save stays the truth. The tables are written by a trigger on
 * card_accounts, in the same transaction as the save: every path that writes a
 * state or flips `suspect` — an action, a cosmetic save, a trade, a cup prize,
 * an owner's flag, a check script poking a row — is covered without any of
 * them knowing these tables exist.
 *
 * A projection that throws never fails the write it rides on, but it is never
 * forgotten either: the account goes into account_projection_dirty in the same
 * transaction, the readers go back to the old scans while anything is listed
 * there (`projectionClean`), and repairDirty() re-projects the listed accounts.
 * Only if even that note cannot be written does the write fail — then nothing
 * could be trusted afterwards.
 *
 * Accounts that existed before the trigger are filled in by backfill(). It and
 * the repair share account_reproject_v1, which LOCKS the account row and reads
 * the state as it stands under that lock: a write in flight is waited for and
 * then read, and no write can land between the read and the projection — so
 * an old copy can neither overwrite a newer row nor bring back one a newer
 * state removed. Readers use the tables only once the trigger exists, the
 * backfill has finished and nothing is dirty; until then the old scans serve.
 *
 * Changing what the functions write means a new version suffix (_v2): the
 * boot migration notices missing objects by name, not changed bodies.
 */

/** The ladders the trigger projects, in a closed list so nothing in a save can add one. */
export function projectionSchema(leagues) {
  const names = [...new Set(['open', ...leagues])]
  if (!names.every((n) => /^[a-z]{1,20}$/.test(n))) throw new Error('account projection: bad league name')
  const list = names.map((n) => `'${n}'`).join(', ')
  return `
create table if not exists account_ladder (
  id_hash  text not null references card_accounts (id_hash) on delete cascade,
  league   text not null,
  season   text not null,
  div      int  not null,
  points   int  not null,
  stars    int  not null,
  wins     int  not null,
  losses   int  not null,
  suspect  boolean not null,
  primary key (id_hash, league)
);
create index if not exists account_ladder_board_idx
  on account_ladder (league, season, div desc, points desc, stars desc, wins desc, id_hash) where not suspect;
create table if not exists account_rivals (
  id_hash  text primary key references card_accounts (id_hash) on delete cascade,
  div      int   not null,
  points   int   not null,
  squad    jsonb not null,
  cards    jsonb not null,
  suspect  boolean not null
);
create index if not exists account_rivals_div_idx on account_rivals (div) where not suspect;
create table if not exists account_projection_marks (
  name text primary key,
  at   timestamptz not null default now()
);
-- accounts whose projection failed and is not to be trusted until repaired
create table if not exists account_projection_dirty (
  id_hash text primary key references card_accounts (id_hash) on delete cascade,
  at      timestamptz not null default now(),
  why     text
);

-- One account's rows, from one state: written, replaced, or removed when the
-- state no longer has them. Raises on any error; the callers decide what an
-- error means. Every cast is behind a pattern test, the same ones the old
-- scans used.
create or replace function account_project_v1(p_id text, p_state jsonb, p_suspect boolean)
returns void language plpgsql as $fn$
declare
  s jsonb := p_state;
  k text;
  l jsonb;
  v_season text;
  v_div int; v_points int; v_stars int; v_wins int; v_losses int;
  v_slots jsonb;
  v_cards jsonb;
  v_full boolean := false;
begin
  v_season := coalesce(s->>'season', '0');
  foreach k in array array[${list}]::text[] loop
    l := case when k = 'open' then s->'ladder' else s->'leagues'->k end;
    if l is null or jsonb_typeof(l) is distinct from 'object' then
      delete from account_ladder where id_hash = p_id and league = k;
      continue;
    end if;
    v_div    := case when l->>'div' ~ '^[0-9]{1,2}$' then (l->>'div')::int else 0 end;
    v_points := case when l->>'points' ~ '^[0-9]{1,9}$' then (l->>'points')::int else 0 end;
    v_stars  := case when l->>'stars' ~ '^[0-9]{1,3}$' then (l->>'stars')::int else 0 end;
    v_wins   := case when coalesce(l->>'sWins', l->>'wins') ~ '^[0-9]{1,7}$'
                     then coalesce(l->>'sWins', l->>'wins')::int else 0 end;
    v_losses := case when coalesce(l->>'sLosses', l->>'losses') ~ '^[0-9]{1,7}$'
                     then coalesce(l->>'sLosses', l->>'losses')::int else 0 end;
    insert into account_ladder as t (id_hash, league, season, div, points, stars, wins, losses, suspect)
    values (p_id, k, v_season, v_div, v_points, v_stars, v_wins, v_losses, p_suspect)
    on conflict (id_hash, league) do update
      set season = excluded.season, div = excluded.div, points = excluded.points, stars = excluded.stars,
          wins = excluded.wins, losses = excluded.losses, suspect = excluded.suspect
      where (t.season, t.div, t.points, t.stars, t.wins, t.losses, t.suspect)
            is distinct from (excluded.season, excluded.div, excluded.points, excluded.stars,
                              excluded.wins, excluded.losses, excluded.suspect);
  end loop;

  -- the rival pool: a five with every seat filled, placed by the open ladder
  -- whatever the season (as the old scan placed it)
  v_slots := s->'squad'->'slots';
  if jsonb_typeof(v_slots) = 'array' then
    if jsonb_array_length(v_slots) = 5 then
      v_full := (select count(*) from jsonb_array_elements(v_slots) e where jsonb_typeof(e) = 'string') = 5;
    end if;
  end if;
  if v_full then
    l := s->'ladder';
    v_div    := case when l->>'div' ~ '^[0-9]{1,2}$' then (l->>'div')::int else 0 end;
    v_points := case when l->>'points' ~ '^[0-9]{1,9}$' then (l->>'points')::int else 0 end;
    -- the six cards on the sheet and nothing else of the collection
    select coalesce(jsonb_object_agg(ks.k, jsonb_build_object('level', s->'cards'->ks.k->'level', 'evo', s->'cards'->ks.k->'evo')), '{}'::jsonb)
      into v_cards
      from (select e #>> '{}' as k from jsonb_array_elements(v_slots) e
            union select s->'squad'->>'coach') ks
     where ks.k is not null and s->'cards' ? ks.k;
    insert into account_rivals as t (id_hash, div, points, squad, cards, suspect)
    values (p_id, v_div, v_points, s->'squad', v_cards, p_suspect)
    on conflict (id_hash) do update
      set div = excluded.div, points = excluded.points, squad = excluded.squad,
          cards = excluded.cards, suspect = excluded.suspect
      where (t.div, t.points, t.squad, t.cards, t.suspect)
            is distinct from (excluded.div, excluded.points, excluded.squad, excluded.cards, excluded.suspect);
  else
    delete from account_rivals where id_hash = p_id;
  end if;
end
$fn$;

-- The trigger: project the row being written. A failure is rolled back to
-- this block, noted as dirty in the writer's own transaction, and the write
-- goes on; if the note itself cannot be written, the write fails with it.
create or replace function account_projection_trigger_v1() returns trigger language plpgsql as $fn$
begin
  begin
    perform account_project_v1(new.id_hash, new.state, new.suspect);
  exception when others then
    raise warning 'account projection failed for %, marked dirty: %', left(new.id_hash, 8), sqlerrm;
    insert into account_projection_dirty (id_hash, why) values (new.id_hash, left(sqlerrm, 300))
    on conflict (id_hash) do update set at = now(), why = excluded.why;
    return null;
  end;
  -- a good projection supersedes an earlier failure
  delete from account_projection_dirty where id_hash = new.id_hash;
  return null;
end
$fn$;

-- One account, re-projected from the state as it stands: the row is locked
-- first (FOR SHARE: a writer in flight is waited for, no new one lands until
-- this statement ends), then read, then projected, then its dirty note, if
-- any, is cleared. Raises on error. Shared by the backfill and the repair.
create or replace function account_reproject_v1(p_id text) returns boolean language plpgsql as $fn$
declare
  v_state jsonb;
  v_suspect boolean;
begin
  select state, suspect into v_state, v_suspect from card_accounts where id_hash = p_id for share;
  if not found then
    delete from account_projection_dirty where id_hash = p_id;
    return false;
  end if;
  perform account_project_v1(p_id, v_state, v_suspect);
  delete from account_projection_dirty where id_hash = p_id;
  return true;
end
$fn$;

-- created only when missing: dropping a trigger takes an exclusive lock on the
-- busiest table in the database, adding one blocks only its writes (and the
-- boot check finds the trigger by the name on the line below)
do $do$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'card_accounts_projection_v1' and tgrelid = 'card_accounts'::regclass) then
    create trigger card_accounts_projection_v1
      after insert or update of state, suspect on card_accounts
      for each row execute function account_projection_trigger_v1();
  end if;
end
$do$;
`
}

export const PROJECTION_MARK = 'v1'
const BATCH = 200

/**
 * Project every account the trigger has not written yet, then mark the tables
 * complete. Returns the accounts walked; throws on the first account that
 * cannot be projected, and then nothing is marked.
 *
 * One account per statement, never a batch: each statement holds its account's
 * row lock and rows until it ends, and holding several could deadlock against
 * a trade writing two accounts. Accounts created or written after the trigger
 * existed are the trigger's (or the repair's), so only accounts with no rows at
 * all are walked — an account whose state simply has no ladder and no full five
 * is walked too, and correctly ends with no rows.
 */
export async function backfill(db, { batch = BATCH, pause = 50 } = {}) {
  let after = ''
  let walked = 0
  for (;;) {
    const ids = (await db`
      select a.id_hash from card_accounts a
      where a.id_hash > ${after}
        and not exists (select 1 from account_ladder l where l.id_hash = a.id_hash)
        and not exists (select 1 from account_rivals r where r.id_hash = a.id_hash)
      order by a.id_hash limit ${batch}`).map((r) => r.id_hash)
    if (!ids.length) break
    for (const id of ids) await db`select account_reproject_v1(${id})`
    walked += ids.length
    after = ids[ids.length - 1]
    if (pause) await new Promise((r) => setTimeout(r, pause))
  }
  await db`insert into account_projection_marks (name) values (${PROJECTION_MARK}) on conflict do nothing`
  return walked
}

/** Re-project the accounts noted dirty, oldest first, one per statement. Returns how many were cleared; throws on the first that still fails. */
export async function repairDirty(db, { batch = BATCH } = {}) {
  let cleared = 0
  for (;;) {
    const ids = (await db`select id_hash from account_projection_dirty order by at limit ${batch}`).map((r) => r.id_hash)
    if (!ids.length) return cleared
    for (const id of ids) {
      await db`select account_reproject_v1(${id})`
      cleared++
    }
  }
}

/** Whether the tables may be read: the trigger is in place and the backfill finished. */
export async function projectionComplete(db) {
  const [r] = await db`
    select exists (select 1 from pg_trigger
                    where tgname = 'card_accounts_projection_v1' and tgrelid = 'card_accounts'::regclass) as trig,
           to_regclass('public.account_projection_marks') is not null as marks`
  if (!r?.trig || !r?.marks) return { trigger: !!r?.trig, done: false }
  const [m] = await db`select 1 as ok from account_projection_marks where name = ${PROJECTION_MARK}`
  return { trigger: true, done: !!m?.ok }
}

/** No account's projection is waiting on a repair. */
export async function projectionClean(db) {
  const [r] = await db`select not exists (select 1 from account_projection_dirty) as clean`
  return !!r?.clean
}

/**
 * The board's top hundred, off the projection: an index walk that stops at a
 * hundred rows. Ranked the way the old scan ranked — division, 大师 points,
 * stars, wins, then the hash, so no two rows tie and a rank is a position.
 */
export async function boardTop(db, league, season, limit = 100) {
  const rows = await db`
    select l.id_hash, a.name, l.div, l.points, l.stars, l.wins, l.losses
    from account_ladder l join card_accounts a on a.id_hash = l.id_hash
    where l.league = ${league} and l.season = ${season} and not l.suspect
      and (${league} = 'open' or l.wins + l.losses > 0)
    order by l.div desc, l.points desc, l.stars desc, l.wins desc, l.id_hash
    limit ${limit}`
  return rows.map((r, i) => ({ ...r, rk: i + 1 }))
}

/**
 * One account on a board: its row and its place, read now. The place is one
 * plus the rows ahead of it under the board's order. `at` is the account's
 * ladder_at, so a caller can tell whether a cached board predates its last
 * write. Null when the account does not exist.
 */
export async function boardOwn(db, mine, league, season) {
  const [r] = await db`
    select a.ladder_at, a.name, l.id_hash, l.div, l.points, l.stars, l.wins, l.losses,
      case when l.id_hash is null then null else 1 + (
        select count(*)::int from account_ladder o
        where o.league = ${league} and o.season = ${season} and not o.suspect
          and (${league} = 'open' or o.wins + o.losses > 0)
          and ((o.div, o.points, o.stars, o.wins) > (l.div, l.points, l.stars, l.wins)
            or ((o.div, o.points, o.stars, o.wins) = (l.div, l.points, l.stars, l.wins) and o.id_hash < l.id_hash))
      ) end as rk
    from card_accounts a
    left join account_ladder l on l.id_hash = a.id_hash and l.league = ${league} and l.season = ${season}
      and not l.suspect and (${league} = 'open' or l.wins + l.losses > 0)
    where a.id_hash = ${mine}`
  if (!r) return null
  const at = r.ladder_at ? new Date(r.ladder_at).getTime() : 0
  if (!r.id_hash) return { at, row: null }
  return {
    at,
    row: { rk: r.rk, id_hash: r.id_hash, name: r.name, div: r.div, points: r.points, stars: r.stars, wins: r.wins, losses: r.losses },
  }
}

/** Up to `perDiv` fives from every division, at random — the shape the old scan returned. */
export async function rivalSample(db, perDiv) {
  return db`
    select r.id_hash, a.name, r.squad, r.div, r.points, r.cards
    from (
      select id_hash, row_number() over (partition by div order by random()) as n
      from account_rivals where not suspect
    ) p
    join account_rivals r on r.id_hash = p.id_hash
    join card_accounts a on a.id_hash = p.id_hash
    where p.n <= ${perDiv}`
}
