/**
 * The hourly prune's memo, on every push (stats.js prune, 2026-10-06).
 *
 *   npx tsx scripts/check_prune_memo.ts
 *
 * The memo lets an hour's prune count the rows that came in instead of walking the whole table. This runs the
 * arithmetic on PGlite over forty simulated hours — holes in the ids, a fold that lags or stalls, a day-old anchor, an
 * age pass deleting rows — and checks after every run that the memo's count is the true count and the table is at
 * the cap. Commit order (a lower id committing after a higher one) needs two real connections:
 * scripts/pg/check_prune_memo_pg.ts.
 */
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { prune, PRUNE_ANCHOR_MS } from '../stats.js'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const db = new PGlite()
const sql = makeSql(db) as any
await db.exec('create table events (id bigserial primary key, ts timestamptz not null default now())')
const quiet = console.warn
console.warn = () => {}
const CAP = 300
let seed = 7
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
await sql`insert into events (ts) select now() from generate_series(1, 420)`
const memo: Record<string, number> = {}
let watermark = 420, wrong = 0, over = 0, walks = 0, counted = 0
for (let hour = 1; hour <= 40; hour++) {
  await sql`insert into events (ts) select now() from generate_series(1, ${5 + Math.floor(rnd() * 30)})`
  // a hole: ids handed out and never used, as a rejected duplicate beacon leaves
  if (rnd() < 0.3) await sql`select setval('events_id_seq', nextval('events_id_seq') + ${1 + Math.floor(rnd() * 9)})`
  await sql`insert into events (ts) select now() from generate_series(1, ${Math.floor(rnd() * 10)})`
  const [{ hi }] = await sql`select max(id)::bigint as hi from events`
  // the fold usually reaches the top; sometimes it lags a little, sometimes it is stuck where it was
  const r = rnd()
  watermark = r < 0.1 ? watermark : r < 0.25 ? Math.max(watermark, Number(hi) - 12) : Number(hi)
  if (rnd() < 0.05) memo.at = Date.now() - PRUNE_ANCHOR_MS - 1
  if (rnd() < 0.05) await sql`update events set ts = now() - interval '200 days' where id in (select id from events order by id limit 2)`
  const before = memo.at
  await prune(sql, 180, CAP, watermark, memo)
  if (Number.isFinite(memo.at) && memo.at !== before) walks++
  const [{ n }] = await sql`select count(*)::int as n from events`
  if (Number.isFinite(memo.at)) {
    counted++
    const [{ m }] = await sql`select count(*)::int as m from events where id > ${memo.floor} and id <= ${memo.top}`
    if (m !== memo.rows) wrong++
    if (n !== CAP) wrong++
  } else if (n > CAP) over++
  if (n < CAP) wrong++
}
console.warn = quiet
check('forty hours: the memo counts what is there and the table sits at the cap', wrong === 0,
  `${counted} counted hours, ${walks} walks, ${over} hours held over by a stuck fold`)
check('the counted path is the usual one, the walk the exception', counted >= 30 && walks >= 2 && walks <= 12, `${counted} / ${walks}`)

// no watermark (a caller that did not fold first): the memo is never trusted, the walk keeps it exact
{
  const m2: Record<string, number> = {}
  await sql`insert into events (ts) select now() from generate_series(1, 50)`
  await prune(sql, 180, CAP, null, m2)
  const [{ n }] = await sql`select count(*)::int as n from events`
  check('without a watermark nothing is remembered and the cap still holds', n === CAP && !Number.isFinite(m2.at), `${n}`)
}
console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
