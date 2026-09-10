import { SCHEMA } from './analytics.js'
import { createHash } from 'node:crypto'
import { CARD_SCHEMA } from './cards-api.js'
import { PROFILE_SCHEMA } from './profile-api.js'
import { SITE_SCHEMA } from './site-api.js'
import { ROLLUP_SCHEMA } from './rollup.js'

/**
 * Bring the schema up to date on boot, without letting that take the game down.
 *
 * The DDL is a long list of `add column if not exists` and `create index if
 * not exists` — catch-up for a database that is nearly always already
 * correct. Two things went wrong with running it plainly.
 *
 * A Railway deploy overlaps containers, so two processes ran the same ALTERs
 * at the same time while the outgoing one was still serving writes, and on
 * 2026-09-09 they deadlocked. Postgres kills one, the throw landed in the
 * catch below, `sql` became null — and a process that never has a database
 * again serves the whole of card mode as 「离线或服务器忙」 until somebody
 * notices and redeploys. An advisory lock now means only one process is
 * inside the DDL at a time, and it waits its turn rather than fighting.
 *
 * And a failed migration is not a reason to throw the connection away. Every
 * table it touches was created by an earlier boot; the one case where the
 * game genuinely cannot run is a database with no card_accounts in it, so
 * that is the only thing asked before keeping the connection.
 */
export const SCHEMAS = [SCHEMA, CARD_SCHEMA, PROFILE_SCHEMA, SITE_SCHEMA, ROLLUP_SCHEMA]
/** any constant, as long as every deploy of this service uses the same one */
const SCHEMA_LOCK = 5150409

/**
 * A fingerprint of the whole list. Once a database has had exactly this list
 * applied, boot has nothing to do and must not touch a table lock: an
 * `alter table … add column if not exists` that is merely WAITING for its
 * lock queues every other query on that table behind it, and on 09-10 four
 * such waits of 20 s each — one per retry, while another container's boot
 * chores held the lock — were the minute of 「特别卡」 the group reported
 * on every deploy. Steady state now costs one catalog read.
 */
const SCHEMA_HASH = createHash('sha1').update(SCHEMAS.join('\n')).digest('hex')
const MARK_TABLE = `create table if not exists schema_marks (hash text primary key, at timestamptz not null default now())`

// What the list declares, read off its text: the tables, the columns each
// `add column if not exists` would add, the indexes. Checked against the
// catalogs before a single DDL statement is sent — `alter table … add column
// if not exists` takes its exclusive lock BEFORE it looks for the column, and
// on `events`, which is written every second, that wait never ends inside a
// lock timeout and holds every telemetry insert (and so the pool) while it lasts.
const DECLARED = (() => {
  const t = SCHEMAS.join('\n').toLowerCase()
  return {
    tables: [...new Set([...t.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]))],
    columns: [...t.matchAll(/alter table (\w+) add column if not exists (\w+)/g)].map((m) => [m[1], m[2]]),
    indexes: [...new Set([...t.matchAll(/create (?:unique )?index if not exists (\w+)/g)].map((m) => m[1]))],
  }
})()

async function nothingToDo(sql) {
  const cols = await sql.unsafe(`select table_name, column_name from information_schema.columns where table_schema = 'public'`)
  const have = new Set((Array.isArray(cols) ? cols : []).map((r) => `${r.table_name}.${r.column_name}`))
  const tables = new Set((Array.isArray(cols) ? cols : []).map((r) => r.table_name))
  if (DECLARED.tables.some((t) => !tables.has(t))) return false
  if (DECLARED.columns.some(([t, c]) => !have.has(`${t}.${c}`))) return false
  const idx = await sql.unsafe(`select indexname from pg_indexes where schemaname = 'public'`)
  const names = new Set((Array.isArray(idx) ? idx : []).map((r) => r.indexname))
  return DECLARED.indexes.every((i) => names.has(i))
}

async function mark(sql) {
  await sql.unsafe(MARK_TABLE)
  await sql.unsafe(`insert into schema_marks (hash) values ('${SCHEMA_HASH}') on conflict do nothing`)
}

async function alreadyApplied(sql) {
  const [t] = await sql.unsafe(`select to_regclass('public.schema_marks') as t`)
  if (!t?.t) return false
  const [m] = await sql.unsafe(`select 1 as ok from schema_marks where hash = '${SCHEMA_HASH}'`)
  return !!m?.ok
}

export async function applySchema(sql) {
  try {
    if (await alreadyApplied(sql)) {
      console.log('analytics: schema already at this version, nothing to lock')
      return
    }
    if (await nothingToDo(sql)) {
      // every table, column and index is already there: record the version
      // and never send the DDL — that is what a boot under traffic must do
      await mark(sql)
      console.log('analytics: schema complete by the catalogs, version recorded, nothing locked')
      return
    }
  } catch (err) {
    console.warn('analytics: schema pre-check failed —', err.message)
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await sql.begin(async (tx) => {
        // 5 s, not 20: a wait here holds up every query on the table
        await tx.unsafe(`set local lock_timeout = '5s'`)
        await tx.unsafe(`select pg_advisory_xact_lock(${SCHEMA_LOCK})`)
        for (const schema of SCHEMAS) await tx.unsafe(schema)
      })
      await mark(sql)
      console.log('analytics: connected, schema ready')
      return
    } catch (err) {
      // back off for longer than the lock wait itself, so four attempts do
      // not add up to a minute of queued queries
      const wait = attempt * 5000
      console.warn(`analytics: schema attempt ${attempt} failed — ${err.message}`)
      if (attempt < 4) await new Promise((r) => setTimeout(r, wait))
    }
  }
  // Out of attempts. If the tables are there, the migration had nothing to add
  // that this process needs, and the game runs.
  const [row] = await sql.unsafe(`select to_regclass('public.card_accounts') as t`)
  if (!row?.t) throw new Error('schema never applied and card_accounts does not exist')
  console.warn('analytics: schema not applied, but the tables are there — carrying on')
}

