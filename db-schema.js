import { SCHEMA } from './analytics.js'
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

export async function applySchema(sql) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`set local lock_timeout = '20s'`)
        await tx.unsafe(`select pg_advisory_xact_lock(${SCHEMA_LOCK})`)
        for (const schema of SCHEMAS) await tx.unsafe(schema)
      })
      console.log('analytics: connected, schema ready')
      return
    } catch (err) {
      const wait = attempt * 1500
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

