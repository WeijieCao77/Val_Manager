/**
 * The hourly prune's memo against real PostgreSQL commit order (stats.js prune, 2026-10-06).
 *
 *   PG_TEST_URL=postgres://postgres@127.0.0.1:55439/postgres npx tsx scripts/pg/check_prune_memo_pg.ts
 *
 * The memo lets each hour count only the rows that arrived instead of walking three million. Ids are handed out
 * before their transactions commit, so a count that trusts the largest id in sight misses a lower one committing
 * later (Codex's review: cap 10, eleven kept, the memo saying ten). The memo now counts only up to the fold's
 * watermark, under which nothing is still to come.
 *
 * Sixty simulated hours on a throwaway verify_* database: every hour some inserts commit, some are held open across
 * the prune and commit after it (late, with lower ids than ones already visible), some roll back (holes in the ids);
 * the watermark is what a fold would establish — the highest id below which every transaction has finished — and now
 * and then it lags; now and then the memo is a day old or an age pass deletes rows. After every prune:
 *   - the memo's count is the true number of rows in (floor, top];
 *   - the table holds exactly the cap, unless the cut was held back by the watermark (then never fewer).
 */
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import { prune, PRUNE_ANCHOR_MS } from '../../stats.js'

const base = process.env.PG_TEST_URL
if (!base) { console.log('SKIP: PG_TEST_URL not set'); process.exit(0) }
const admin = postgres(base, { max: 1, onnotice: () => {} })
const name = `verify_prune_${randomBytes(5).toString('hex')}`
await admin.unsafe(`create database ${name}`)
const url = new URL(base); url.pathname = `/${name}`
const sql = postgres(url.toString(), { max: 2, onnotice: () => {} })
const writers = Array.from({ length: 4 }, () => postgres(url.toString(), { max: 1, onnotice: () => {} }))
let bad = 0
const fail = (m: string) => { console.log('FAIL', m); bad++ }
const quiet = console.warn
console.warn = () => {}
let seed = 20261006
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
try {
  await sql`create table events (id bigserial primary key, ts timestamptz not null default now())`
  const CAP = 500
  await sql`insert into events (ts) select now() from generate_series(1, 650)`
  const memo: Record<string, number> = {}
  let watermark = 650
  // ids handed out but not yet finished (held open), each with its commit-or-rollback decision
  type Held = { id: number; done: Promise<void>; finish: () => void }
  let held: Held[] = []
  const insertHeld = async (w: postgres.Sql, rollback: boolean): Promise<Held> => {
    let finish!: () => void
    let gotId!: (n: number) => void
    const idP = new Promise<number>((r) => { gotId = r })
    const go = new Promise<void>((r) => { finish = r })
    const done = w.begin(async (tx) => {
      const [r] = await tx`insert into events (ts) values (now()) returning id`
      gotId(Number(r.id))
      await go
      if (rollback) throw new Error('rolled back')
    }).then(() => {}, () => {})
    return { id: await idP, done, finish }
  }
  let cutsHeldBack = 0, walks = 0
  for (let hour = 1; hour <= 60; hour++) {
    // finish what was held open last hour: these commit AFTER higher ids were already visible and counted
    for (const h of held) h.finish()
    await Promise.all(held.map((h) => h.done))
    held = []
    // this hour's traffic: plain commits, plus a few held open across the prune, some of which roll back
    await sql`insert into events (ts) select now() from generate_series(1, ${10 + Math.floor(rnd() * 40)})`
    for (let i = 0; i < 1 + Math.floor(rnd() * 3); i++) held.push(await insertHeld(writers[i % writers.length], rnd() < 0.3))
    await sql`insert into events (ts) select now() from generate_series(1, ${5 + Math.floor(rnd() * 20)})`
    // the fold's watermark: everything below the lowest id still open is finished; sometimes the fold lags
    const [{ hi }] = await sql`select max(id)::bigint as hi from events`
    const lowestOpen = held.length ? Math.min(...held.map((h) => h.id)) : Infinity
    const settled = Math.min(Number(hi), lowestOpen - 1)
    watermark = rnd() < 0.15 ? Math.max(watermark, settled - 40) : Math.max(watermark, settled)
    if (rnd() < 0.05) memo.at = Date.now() - PRUNE_ANCHOR_MS - 1
    if (rnd() < 0.04) { await sql`update events set ts = now() - interval '200 days' where id in (select id from events order by id limit 3)` }
    const anchoredAt = memo.at
    await prune(sql, 180, CAP, watermark, memo)
    // a full walk sets a new anchor time
    if (Number.isFinite(memo.at) && memo.at !== anchoredAt) walks++
    // the truth, counted the slow way
    const [{ n }] = await sql`select count(*)::int as n from events`
    if (Number.isFinite(memo.at)) {
      const [{ m }] = await sql`select count(*)::int as m from events where id > ${memo.floor} and id <= ${memo.top}`
      if (m !== memo.rows) fail(`hour ${hour}: memo says ${memo.rows} rows in (${memo.floor}, ${memo.top}], there are ${m}`)
      if (memo.top !== watermark) fail(`hour ${hour}: memo top ${memo.top} is not the watermark ${watermark}`)
    }
    // the held-open rows are not visible yet; once they commit they are counted, so judge the visible table now
    const [{ above }] = await sql`select count(*)::int as above from events where id > ${watermark}`
    if (n < CAP) fail(`hour ${hour}: ${n} rows, below the cap ${CAP}`)
    else if (n > CAP) {
      // only allowed when the cut could not reach: everything still kept under the watermark plus the tail is over
      const [{ under }] = await sql`select count(*)::int as under from events where id <= ${watermark}`
      if (under > 0 && n - above < CAP - above) fail(`hour ${hour}: ${n} rows over the cap with room to cut`)
      if (under > 0 && Number.isFinite(memo.at) && n !== CAP) fail(`hour ${hour}: ${n} rows, the memo trusted and the cap ${CAP}`)
      cutsHeldBack++
    }
  }
  for (const h of held) h.finish()
  await Promise.all(held.map((h) => h.done))
  console.warn = quiet
  console.log(bad ? `${bad} problem(s)` : `ok 60 hours: memo count exact every hour, cap exact (${cutsHeldBack} hour(s) held back by a lagging watermark, ${walks} full walk(s))`)
} catch (err) {
  console.warn = quiet
  console.log('FAIL', (err as Error).message); bad++
} finally {
  await Promise.allSettled([sql.end({ timeout: 2 }), ...writers.map((w) => w.end({ timeout: 2 }))])
  await admin.unsafe(`drop database if exists ${name} with (force)`)
  await admin.end({ timeout: 2 })
}
process.exit(bad ? 1 : 0)
