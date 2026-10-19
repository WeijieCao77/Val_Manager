/**
 * The hot paths do not read card_accounts or open_cup_entries from end to end (2026-10-18).
 *
 *   npx tsx scripts/check_scan_plans.ts                                                         # PGlite (the audit)
 *   PG_TEST_URL=postgres://postgres@127.0.0.1:55439/postgres npx tsx scripts/check_scan_plans.ts  # real PostgreSQL
 *
 * Prod, 2026-10-18: 310k sequential scans of card_accounts (83 MB) and 112k of open_cup_entries (44 MB), each
 * read off the disk because both sit over the 32 MB ring-buffer cutoff — 97% of the database's block reads in a
 * 21 s sample. What was scanning, and what it is now:
 *   - the 全服杯 page's 往届冠军 (publicState, refreshed every five seconds while anybody has the page open):
 *     `place = 1 and cup_id in (select …jsonb…)` hash-joined every entry; now each champion by its key.
 *   - the ladder's rival pool off the projection (once a minute): a plain join the planner hash-joined against
 *     the whole of card_accounts and a second pass of account_rivals, for a few hundred names; now by key.
 *   - the cups' hourly prune: `cup_id in (select …)` hash-joined both cup tables; now probes the keys.
 *   - the 对战码 lookups: `left(id_hash, $1)` and a bound `like` prefix are not card_code_idx's expression,
 *     and a generic plan of either reads every account; now `left(id_hash, 8)`.
 *   - the board's own place (boardOwn, every look at the board): one count over `ahead or tied` went to the heap
 *     of account_ladder for every row ahead; on the open board it is now two index-only ranges.
 *
 * The real code is run against a production-shaped fixture (scripts/pg/scan-fixture.ts) and every statement it
 * sends is captured and EXPLAINed twice — with its own parameters, and as the generic plan postgres.js's
 * prepared statements fall back to — and no plan may hold a Seq Scan of either table. The old statements are
 * EXPLAINed too, and must still scan here: a fixture on which they did not would prove nothing.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import { PGlite } from '@electric-sql/pglite'
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import { makeSql } from '../pglite-sql.js'
import { buildScanFixture } from './pg/scan-fixture'

const { CARD_SCHEMA, makeCardApi, normalizeId } = await import('../cards-api.js')
const { PROJECTION_SCHEMA } = await import('../db-schema.js')
const { boardOwn, rivalSample } = await import('../account-projection.js')
const { OPEN_CUP_SCHEMA, OPEN_CUP_V2_SCHEMA, makeOpenCupApi } = await import('../opencup-api.js')
const { displayName } = await import('../names.js')
const engine = await import('../src/engine/server.ts')

const HOT = ['card_accounts', 'open_cup_entries']
type Captured = { text: string; params: unknown[] }
const log: Captured[] = []
let taping = false

// ---- the two backends: the same tagged-template sql, a raw exec, and a way to EXPLAIN

let sql: any
let exec: (q: string) => Promise<any[]>
let explainJson: (text: string, params: unknown[] | null) => Promise<any>
let finish = async () => {}
const base = process.env.PG_TEST_URL
if (base) {
  const name = `verify_${Date.now()}_${randomBytes(4).toString('hex')}`
  const admin = postgres(base, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create database ${name}`)
  const url = new URL(base); url.pathname = `/${name}`
  sql = postgres(url.toString(), {
    max: 2, onnotice: () => {},
    debug: (_c: unknown, text: string, params: unknown[]) => { if (taping) log.push({ text, params: [...params] }) },
  })
  exec = (q) => sql.unsafe(q).simple()
  explainJson = async (text, params) => (params
    ? await sql.unsafe(`explain (format json) ${text}`, params as never[])
    : await sql.unsafe(`explain (generic_plan, format json) ${text}`).simple())[0]['QUERY PLAN']
  finish = async () => {
    await sql.end()
    await admin.unsafe(`drop database if exists ${name} with (force)`)
    await admin.end()
  }
} else {
  const db = new PGlite()
  const tapped = (d: any): any => ({
    query: (text: string, params: unknown[], opts: unknown) => { if (taping) log.push({ text, params: [...(params ?? [])] }); return d.query(text, params, opts) },
    exec: (q: string) => d.exec(q),
    transaction: (fn: (t: unknown) => unknown) => d.transaction((t: unknown) => fn(tapped(t))),
  })
  sql = makeSql(tapped(db))
  exec = async (q) => (await db.exec(q)).at(-1)?.rows ?? []
  const ser = { serializers: { 114: (x: unknown) => JSON.stringify(x), 3802: (x: unknown) => JSON.stringify(x) } }
  explainJson = async (text, params) => {
    const rows = params
      ? (await db.query<any>(`explain (format json) ${text}`, params, ser as never)).rows
      : (await db.exec(`explain (generic_plan, format json) ${text}`)).at(-1)!.rows as any[]
    const v = rows[0]['QUERY PLAN']
    return typeof v === 'string' ? JSON.parse(v) : v
  }
}

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

/** every relation a plan reads with a Seq Scan, sub-plans and init-plans included */
function seqScans(plan: any, out: string[] = []): string[] {
  if (plan['Node Type'] === 'Seq Scan') out.push(plan['Relation Name'])
  for (const p of plan.Plans ?? []) seqScans(p, out)
  return out
}
/** every node that reads `rel`, as its node type */
function readsOf(plan: any, rel: string, out: string[] = []): string[] {
  if (plan['Relation Name'] === rel) out.push(`${plan['Node Type']} (${plan.Alias})`)
  for (const p of plan.Plans ?? []) readsOf(p, rel, out)
  return out
}
const planOf = (j: any) => (Array.isArray(j) ? j[0].Plan : j.Plan)
const explainable = (t: string) => /^\s*(with|select|insert|update|delete)\b/i.test(t) && !/^\s*select\s+(pg_|set_config|1\s*$)/i.test(t)

/** run `fn` and EXPLAIN everything it sent: the hot tables it seq-scans, per statement */
async function scansOf(fn: () => Promise<unknown>) {
  log.length = 0
  taping = true
  try { await fn() } finally { taping = false }
  const sent = log.splice(0)
  const found: { text: string; how: string; rels: string[] }[] = []
  for (const s of sent.filter((x) => explainable(x.text))) {
    for (const how of ['custom', 'generic'] as const) {
      const j = await explainJson(s.text, how === 'custom' ? s.params : null)
      const rels = seqScans(planOf(j)).filter((r) => HOT.includes(r))
      if (rels.length) found.push({ text: s.text.replace(/\s+/g, ' ').trim().slice(0, 140), how, rels })
    }
  }
  return { sent: sent.length, found }
}
const show = (f: { text: string; how: string; rels: string[] }[]) => f.map((x) => `[${x.how}] ${x.rels.join(',')}: ${x.text}`).join('\n      ')

// ---- the fixture

const t0 = performance.now()
await buildScanFixture(exec, [CARD_SCHEMA, PROJECTION_SCHEMA, OPEN_CUP_SCHEMA, OPEN_CUP_V2_SCHEMA])
console.log(`fixture (${base ? 'PostgreSQL' : 'PGlite'}): ${Math.round(performance.now() - t0)} ms`)
const [sizes] = await exec(`select (select count(*) from card_accounts)::int as accounts, (select count(*) from open_cup_entries)::int as entries,
  (select count(*) from account_rivals)::int as rivals`)
check('fixture is production-sized', sizes.accounts >= 70_000 && sizes.entries >= 30_000 && sizes.rivals > 40_000, JSON.stringify(sizes))

// ---- the controls: the statements as they were still scan on this fixture

const champIds = (await exec(`select id from open_cups where status = 'done' order by starts desc limit 8`)).map((r) => String(r.id))
const OLD: [string, string, unknown[]][] = [
  ['往届冠军', `select e.cup_id::text as cup, e.id_hash, e.name, e.five, e.score from open_cup_entries e
     where e.place = 1 and e.cup_id in (select (jsonb_array_elements_text($1::jsonb))::bigint)`, [champIds]],
  ['rival pool', `select r.id_hash, a.name, r.squad, r.div, r.points, r.cards
     from (select id_hash, row_number() over (partition by div order by random()) as n from account_rivals where not suspect) p
     join account_rivals r on r.id_hash = p.id_hash join card_accounts a on a.id_hash = p.id_hash where p.n <= $1`, [80]],
  ['cup prune', `delete from open_cup_entries where cup_id in (select id from open_cups where status in ('done', 'void') and starts < $1)`,
    [new Date(Date.now() - 14 * 86_400_000)]],
  ['own place', `select l.id_hash, 1 + (select count(*)::int from account_ladder o where o.league = $2 and o.season = $3 and not o.suspect
       and ($2 = 'open' or o.wins + o.losses > 0)
       and ((o.div, o.points, o.stars, o.wins) > (l.div, l.points, l.stars, l.wins)
         or ((o.div, o.points, o.stars, o.wins) = (l.div, l.points, l.stars, l.wins) and o.id_hash < l.id_hash))) as rk
     from account_ladder l where l.id_hash = $1 and l.league = $2`, ['x', 'open', '1']],
  ['对战码 by bound length', `select id_hash, name from card_accounts where left(id_hash, $1) = $2 limit 2`, [8, 'abcdef01']],
]
for (const [what, text, params] of OLD) {
  if (what === 'own place') {
    // account_ladder is not one of the two, and is not seq-scanned: the old count's sin was the heap behind the index
    const reads = [...readsOf(planOf(await explainJson(text, params)), 'account_ladder'), ...readsOf(planOf(await explainJson(text, null)), 'account_ladder')]
    check('control: the old own-place count reads account_ladder past its index', reads.some((r) => /\(o\)/.test(r) && !r.startsWith('Index Only Scan')), reads.join(', '))
    continue
  }
  const custom = seqScans(planOf(await explainJson(text, params))).filter((r) => HOT.includes(r))
  const generic = seqScans(planOf(await explainJson(text, null))).filter((r) => HOT.includes(r))
  check(`control: the old ${what} statement scans here`, custom.length + generic.length > 0,
    `custom [${custom}] generic [${generic}]`)
}

// ---- the paths as they are now

const json = (r: any, code: number, body: any) => { r.code = code; r.body = body }
const deps = {
  json, readBody: async (r: any) => r.body, rateLimited: () => false, normalizeId, displayName, engine,
  timer: false, compute: async () => { throw new Error('no cup is played in this check') },
}
const cards = makeCardApi(sql, deps as never)
const solo = makeOpenCupApi(sql, deps as never)
const call = async (api: any, path: string, body: unknown) => {
  const r: any = {}
  await api.route({ method: 'POST', body: JSON.stringify(body), headers: {} }, r, path, 'scan')
  return r
}
const [someone] = await exec(`select id_hash from open_cup_entries e join open_cups c on c.id = e.cup_id where c.status = 'live' limit 1`)

{
  // an account near the bottom of the open board: nearly everybody is ahead of it
  const [low] = await exec(`select id_hash, season from account_ladder where league = 'open' and not suspect
    order by div, points, stars, wins, id_hash desc limit 1 offset 20`)
  log.length = 0
  taping = true
  const own = await boardOwn(sql, low.id_hash, 'open', low.season).finally(() => { taping = false })
  const sent = log.splice(0).filter((x) => x.text.includes('from account_ladder o'))
  const reads: string[] = []
  for (const x of sent) {
    for (const params of [x.params, null]) reads.push(...readsOf(planOf(await explainJson(x.text, params)), 'account_ladder').filter((r) => !/\(l\)/.test(r)))
  }
  check('own place on the open board counts on the index alone', own?.row?.rk > 1 && reads.length === 4 && reads.every((r) => r.startsWith('Index Only Scan')),
    `rank ${own?.row?.rk} · ${reads.join(', ')}`)
}
{
  const r = await scansOf(() => rivalSample(sql, 80))
  check('rival pool reads no hot table end to end', r.sent > 0 && !r.found.length, show(r.found))
}
{
  // a clock pass: nothing is due, so it reads the due cups and prunes the old ones (first: the page's read
  // below starts a pass of its own, and the prune runs once an hour)
  const r = await scansOf(() => solo.advance(Date.now()))
  check('全服杯 clock pass and prune read no hot table end to end', r.sent > 0 && !r.found.length, show(r.found))
}
{
  // the page's public state and its 冠军榜, as a visitor sees it
  const r = await scansOf(async () => {
    const res = await call(solo, '/api/card/opencup', {})
    if (res.body?.ok !== true || !res.body.last?.champion) throw new Error(`open cup state: ${JSON.stringify(res.body).slice(0, 200)}`)
    if (!res.body.recent?.some((c: any) => c.champion)) throw new Error('open cup state lists no past champion')
  })
  check('全服杯 public state reads no hot table end to end', r.sent > 0 && !r.found.length, show(r.found))
}
{
  const r = await scansOf(async () => {
    await call(cards, '/api/card/friend', { code: someone.id_hash.slice(0, 8) })
    await call(cards, '/api/card/friend_cards', { code: 'abcdef01' })
  })
  check('对战码 lookups read no hot table end to end', r.sent >= 2 && !r.found.length, show(r.found))
}

await finish()
if (bad) { console.log(`\n${bad} check(s) FAILED`); process.exit(1) }
console.log('\nall scan-plan checks passed')
