/** A lower sequence id committing after a later event must not be lost. */
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../../pglite-sql.js'
import assert from 'node:assert/strict'
import { SCHEMA } from '../../analytics.js'
import { ROLLUP_SCHEMA, rollup } from '../../rollup.js'
const db = new PGlite(), sql = makeSql(db)
await db.exec(SCHEMA); await db.exec(ROLLUP_SCHEMA)
let inserted!: () => void, release!: () => void
const ready = new Promise<void>(r => inserted = r), gate = new Promise<void>(r => release = r)
const writer = sql.begin(async t => {
 await t`insert into events (ts,n,visitor_id,session_id,seq,device,name,props) values (now()-interval '1 day',1,'slow','slow',1,'phone','session_start','{}')`
 inserted(); await gate
})
try {
 await ready
 await sql`insert into events (ts,n,visitor_id,session_id,seq,device,name,props) values (now()-interval '1 day',2,'fast','fast',1,'phone','session_start','{}')`
 let done = false
 const fold = rollup(sql, {lagSec: 0}).then(x => { done = true; return x })
 // Synchronize by observing PostgreSQL's lock queue, not relying on a sleep race.
 let waiting = false
 for (let i=0; i<100; i++) {
  const locks = await sql`select 1 from pg_locks where relation='events'::regclass and mode='ShareLock' and not granted`
  if (locks.length) { waiting = true; break }
  await new Promise(r => setTimeout(r, 10))
 }
 assert.equal(waiting, true, 'fold waits for the insert transaction instead of crossing its id')
 assert.equal(done, false)
 release(); await writer; await fold
 const rows = await sql`select sum(events)::int as n from daily_stats`
 assert.equal(rows[0].n, 2)
 await rollup(sql, {lagSec:0})
 assert.equal((await sql`select sum(events)::int as n from daily_stats`)[0].n, 2)
 console.log('ok delayed lower-id commit folded exactly once; real transaction lock verified')
} finally { release(); await writer; await db.close() }
