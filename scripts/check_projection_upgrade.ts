/**
 * The ladder projection's upgrade from v1 to v2, as a deploy will meet it (2026-10-10).
 *
 *   npx tsx scripts/check_projection_upgrade.ts
 *
 * v1 baked the five ladders of its day into the function body; the boot
 * migration finds objects by name, so a new ladder (传奇联赛, 全系列赛) would
 * have had no board. v2 projects whatever ladders a state holds. Starting from
 * a database as production has it — v1 installed, backfilled, marked
 * (scripts/fixtures/account-projection-v1.js is that module, frozen) — this
 * runs the real boot migration and checks:
 *   - v2 is installed beside v1 without dropping anything (no exclusive lock);
 *   - readers wait for the v2 mark; the v2 backfill walks only accounts with no
 *     rows and leaves every existing row exactly as it was;
 *   - with both triggers firing, a new ladder gets its row, its board, and
 *     loses the row when the state drops it; the old ladders are unchanged.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { makeSql } from '../pglite-sql.js'

const V1 = await import('./fixtures/account-projection-v1.js')
const { CARD_SCHEMA, engine, serverDay } = await import('../cards-api.js')
const { applySchema } = await import('../db-schema.js')
const P = await import('../account-projection.js')

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
const SEASON = engine.seasonOf(serverDay())
const L = (div: number, wins: number) => ({ div, stars: 1, points: div >= 5 ? wins * 10 : 0, best: div, wins, losses: 2, streak: 0, sWins: wins, sLosses: 2 })

const db = new PGlite()
const sql = makeSql(db)
await db.exec(CARD_SCHEMA)
// production today: v1, backfilled, marked
await db.exec(V1.projectionSchema(['open', 'gold', 'silver', 'bronze', 'hof']))
const ids = Array.from({ length: 60 }, (_, i) => `VM-UPGR-0000-0000-0000-${String(i).padStart(4, '0')}`)
for (const [i, id] of ids.entries()) {
  const state = { name: `号${i}`, season: SEASON, ladder: L(i % 6, i), leagues: i % 3 ? { gold: L(i % 4, i) } : {} }
  await sql`insert into card_accounts (id_hash, name, state, suspect) values (${hash(id)}, ${'号' + i}, ${sql.json(state)}, false)`
}
await V1.backfill(sql, { pause: 0 })
const snap = async () => JSON.stringify(await sql`select id_hash, league, season, div, points, stars, wins, losses, suspect from account_ladder order by id_hash, league`)
const before = await snap()
check('起点：v1 已装、已回填、已标记', (await V1.projectionComplete(sql)).done)

// the deploy: the real boot migration
const log = console.log
console.log = () => {}
let applied
try { applied = await applySchema(sql) } finally { console.log = log }
check('启动迁移成功', !!applied?.ready, JSON.stringify(applied))
const [t] = await sql`select count(*) filter (where tgname = 'card_accounts_projection_v1')::int as v1,
                             count(*) filter (where tgname = 'card_accounts_projection_v2')::int as v2
                      from pg_trigger where tgrelid = 'card_accounts'::regclass`
check('v2 触发器装上，v1 留着不拆（拆要独占锁）', t.v1 === 1 && t.v2 === 1, JSON.stringify(t))
let st = await P.projectionComplete(sql)
check('读方等 v2 标记：触发器在、还没完成', st.trigger && !st.done, JSON.stringify(st))
const walked = await P.backfill(sql, { pause: 0 })
check('v2 回填只走没有投影行的账号', walked === 0, `${walked}`)
st = await P.projectionComplete(sql)
check('v2 标记完成', st.done)
check('升级前后已有的行一模一样', (await snap()) === before)

// a new ladder, with both triggers firing
const h = hash(ids[7])
await sql`update card_accounts set state = jsonb_set(state, '{leagues,retired}', ${sql.json(L(3, 9))}) where id_hash = ${h}`
const [r] = await sql`select div, wins from account_ladder where id_hash = ${h} and league = 'retired'`
check('传奇联赛的段位写进投影', r?.div === 3 && r?.wins === 9, JSON.stringify(r))
const top = await P.boardTop(sql, 'retired', String(SEASON))
check('传奇联赛排行榜有这个号', top.length === 1 && top[0].id_hash === h, JSON.stringify(top.map((x: { id_hash: string }) => x.id_hash.slice(0, 6))))
await sql`update card_accounts set state = jsonb_set(state, '{leagues,mixed}', ${sql.json(L(1, 4))}) where id_hash = ${h}`
check('全系列赛也写进去', (await sql`select 1 from account_ladder where id_hash = ${h} and league = 'mixed'`).length === 1)
await sql`update card_accounts set state = state #- '{leagues,retired}' where id_hash = ${h}`
check('存档里没了，投影行也删掉', (await sql`select 1 from account_ladder where id_hash = ${h} and league = 'retired'`).length === 0)
const [o] = await sql`select div, wins from account_ladder where id_hash = ${h} and league = 'open'`
check('公开赛那一行不受影响', o?.div === 7 % 6 && o?.wins === 7, JSON.stringify(o))
await sql`update card_accounts set state = jsonb_set(state, '{leagues}', ${sql.json({ 'Bad Key': L(2, 2), [('x').repeat(30)]: L(2, 2) })}) where id_hash = ${h}`
const odd = await sql`select league from account_ladder where id_hash = ${h} order by league`
check('奇怪的键不写', odd.every((x: { league: string }) => /^[a-z]{1,20}$/.test(x.league)), JSON.stringify(odd))
const [{ n: dirty }] = await sql`select count(*)::int as n from account_projection_dirty`
check('一路没有写坏的账号', dirty === 0, `${dirty}`)
await db.close()

if (bad) { console.log(`${bad} 项不对`); process.exit(1) }
console.log('全部通过')
