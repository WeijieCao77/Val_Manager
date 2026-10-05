/**
 * The ladder board and the rival pool read from account_ladder / account_rivals
 * (account-projection.js, 2026-10-05) must say exactly what the old scans of
 * card_accounts.state said.
 *
 *   npx tsx scripts/check_account_projection.ts
 *
 * The reference is the old SQL, copied here verbatim (cards-api.js before
 * 2026-10-05). Six hundred accounts with every shape a save has been seen in —
 * missing ladders, numbers as strings, junk, ties, suspects, last season,
 * leagues as an array, fives with an empty seat — are ranked both ways on
 * every board, every account's own place is compared, and the rival pool is
 * compared row for row. Then three hundred random writes through plain UPDATEs
 * (the trigger's whole job) and the comparison again. Also: the backfill fills
 * rows written before the trigger and never overwrites a newer one, a
 * projection that throws does not fail the write, the /top route serves the
 * same board and a fresh own row, the boot migration re-creates a missing
 * trigger alone, and a load moves `seen` at most every five minutes.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { makeSql } from '../pglite-sql.js'

const { CARD_SCHEMA, BOARDS, makeCardApi, serverDay, engine } = await import('../cards-api.js')
const { PROJECTION_SCHEMA, SCHEMAS, applySchema } = await import('../db-schema.js')
const P = await import('../account-projection.js')

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const hash = (id: string) => createHash('sha256').update(id).digest('hex')

// a seeded generator, so a failure reproduces
let seed = 20261005
const rnd = () => { // mulberry32
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]
const int = (n: number) => Math.floor(rnd() * n)

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const newId = () => {
  let b = ''
  for (let i = 0; i < 20; i++) b += ALPHABET[int(32)]
  return `VM-${b.slice(0, 4)}-${b.slice(4, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}-${b.slice(16, 20)}`
}

const SEASON = engine.seasonOf(serverDay())
const CARD_IDS = Array.from({ length: 40 }, (_, i) => `p${i}`)

/** a ladder in any shape one has been stored in */
function ladder(): unknown {
  const r = rnd()
  if (r < 0.04) return undefined
  if (r < 0.06) return null
  if (r < 0.08) return 'junk'
  if (r < 0.09) return [1, 2]
  const l: Record<string, unknown> = {
    // small ranges, so ties fall through to stars, wins and the hash
    div: pick<unknown>([0, 1, 2, 3, 4, 5, 5, 5, '4', 'abc', 123, -1, 3.5, null]),
    points: pick<unknown>([0, 10, 10, 20, 20, 35, int(4000), '15', 1e10, 12.5, 'x']),
    stars: pick<unknown>([0, 1, 2, 3, '2', 9999, undefined]),
    wins: pick<unknown>([0, 0, 1, 2, 5, int(300), '7', 12345678, undefined]),
    losses: pick<unknown>([0, 0, 1, 3, int(300), 'zz', undefined]),
  }
  if (rnd() < 0.4) l.sWins = pick<unknown>([0, 1, 3, int(50), 'q'])
  if (rnd() < 0.4) l.sLosses = pick<unknown>([0, 2, int(50), null])
  return l
}
function state(name: string): Record<string, unknown> {
  const s: Record<string, unknown> = { name }
  const r = rnd()
  if (r < 0.7) s.season = SEASON
  else if (r < 0.8) s.season = String(SEASON)
  else if (r < 0.9) s.season = SEASON - 1
  // else: no season key at all, which reads as '0'
  const lad = ladder()
  if (lad !== undefined) s.ladder = lad
  const lr = rnd()
  if (lr < 0.5) {
    const leagues: Record<string, unknown> = {}
    for (const k of BOARDS) if (k !== 'open' && rnd() < 0.5) leagues[k] = ladder()
    if (rnd() < 0.1) leagues.bogus = ladder()
    s.leagues = leagues
  } else if (lr < 0.55) s.leagues = [ladder()]
  else if (lr < 0.58) s.leagues = 'nope'
  // the five
  const sr = rnd()
  const five = () => Array.from({ length: 5 }, () => pick(CARD_IDS))
  let slots: unknown
  if (sr < 0.6) slots = five()
  else if (sr < 0.7) slots = [...five().slice(0, 4), null]
  else if (sr < 0.75) slots = [...five(), 'p1']
  else if (sr < 0.8) slots = 'p1,p2'
  else if (sr < 0.85) slots = [1, 2, 3, 4, 5]
  else slots = undefined
  if (rnd() < 0.95) {
    s.squad = {
      ...(slots !== undefined ? { slots } : {}),
      coach: pick<unknown>(['c1', 'c2', null, 7, undefined, 'p3']),
    }
  }
  const cards: Record<string, unknown> = {}
  for (const id of [...CARD_IDS, 'c1', 'c2']) {
    if (rnd() < 0.6) cards[id] = { level: pick<unknown>([0, 1, 3, 5, 7.5, 20, '3', null]), ...(rnd() < 0.3 ? { evo: { aim: int(4) } } : {}) }
  }
  if (rnd() < 0.97) s.cards = cards
  return s
}

// ---- the old scans, verbatim -------------------------------------------------
type Sql = ReturnType<typeof makeSql>
const scannedBoard = (sql: Sql, league: string) => {
  const season = String(SEASON)
  return sql`
        with lad as (
          select id_hash, name, suspect,
            case when ${league} = 'open' then state->'ladder'
                 else state->'leagues'->${league} end as l
          from card_accounts
          where coalesce(state->>'season', '0') = ${season}
        ), ranked as (
          select
            id_hash, name,
            case when l->>'div' ~ '^[0-9]{1,2}$'
                 then (l->>'div')::int else 0 end as div,
            case when l->>'points' ~ '^[0-9]{1,9}$'
                 then (l->>'points')::int else 0 end as points,
            case when l->>'stars' ~ '^[0-9]{1,3}$'
                 then (l->>'stars')::int else 0 end as stars,
            case when coalesce(l->>'sWins', l->>'wins') ~ '^[0-9]{1,7}$'
                 then coalesce(l->>'sWins', l->>'wins')::int else 0 end as wins,
            case when coalesce(l->>'sLosses', l->>'losses') ~ '^[0-9]{1,7}$'
                 then coalesce(l->>'sLosses', l->>'losses')::int else 0 end as losses
          from lad
          where jsonb_typeof(l) = 'object'
            and not suspect
        ), kept as (
          select * from ranked where ${league} = 'open' or wins + losses > 0
        ), placed as (
          select *, rank() over (
            order by div desc, points desc, stars desc, wins desc, id_hash
          )::int as rk
          from kept
        )
        select rk, id_hash, name, div, points, stars, wins, losses
        from placed
        order by rk`
}
// the old pool with no per-division cap, so it is the whole set and can be compared
const scannedRivals = (sql: Sql) => sql`
      with seen as (
        select id_hash,
          case when lad->>'div' ~ '^[0-9]{1,2}$' then (lad->>'div')::int else 0 end as div
        from (
          select id_hash, state->'squad'->'slots' as slots, state->'ladder' as lad
          from card_accounts where not suspect
          offset 0
        ) a
        where jsonb_typeof(slots) = 'array'
          and jsonb_array_length(slots) = 5
          and (select count(*) from jsonb_array_elements(slots) e where jsonb_typeof(e) = 'string') = 5
      )
      select p.id_hash, a.name, a.state->'squad' as squad, p.div,
        case when a.state->'ladder'->>'points' ~ '^[0-9]{1,9}$'
             then (a.state->'ladder'->>'points')::int else 0 end as points,
        (select coalesce(jsonb_object_agg(k, jsonb_build_object('level', a.state->'cards'->k->'level', 'evo', a.state->'cards'->k->'evo')), '{}'::jsonb)
           from (select e #>> '{}' as k from jsonb_array_elements(a.state->'squad'->'slots') e
                 union select a.state->'squad'->>'coach') ks
          where k is not null and a.state->'cards' ? k) as cards
      from seen p join card_accounts a on a.id_hash = p.id_hash`

const strip = (r: Record<string, unknown>) => ({
  rk: r.rk, id_hash: r.id_hash, name: r.name, div: r.div, points: r.points, stars: r.stars, wins: r.wins, losses: r.losses,
})
const byId = (a: { id_hash: unknown }, b: { id_hash: unknown }) => (String(a.id_hash) < String(b.id_hash) ? -1 : 1)

async function compareAll(sql: Sql, label: string, ids: string[]) {
  let boards = 0, owns = 0, ownBad = 0, topBad = 0
  for (const league of BOARDS) {
    const old = (await scannedBoard(sql, league)).map(strip)
    const top = (await P.boardTop(sql, league, String(SEASON))).map(strip)
    if (!isDeepStrictEqual(top, old.filter((r) => (r.rk as number) <= 100))) {
      topBad++
      console.log('   first difference', league, JSON.stringify(top.find((r, i) => !isDeepStrictEqual(r, old[i]))))
    }
    boards++
    const oldBy = new Map(old.map((r) => [r.id_hash, r]))
    for (const id of ids) {
      const h = hash(id)
      const own = await P.boardOwn(sql, h, league, String(SEASON))
      const want = oldBy.get(h) ?? null
      owns++
      if (!isDeepStrictEqual(own?.row ? strip(own.row) : null, want)) {
        ownBad++
        if (ownBad <= 3) console.log('   own differs', league, h.slice(0, 8), JSON.stringify(own?.row), JSON.stringify(want))
      }
    }
  }
  check(`${label}：${boards} 张榜的前一百与旧扫描一致`, topBad === 0, `${topBad} 张不一致`)
  check(`${label}：${owns} 次本人名次与旧扫描一致`, ownBad === 0, `${ownBad} 次不一致`)
  const oldPool = [...await scannedRivals(sql)].map((r) => ({ ...r })).sort(byId)
  const newPool = [...await P.rivalSample(sql, 1e6)].map((r) => ({ ...r })).sort(byId)
  check(`${label}：对手池 ${oldPool.length} 套阵容逐条一致`, isDeepStrictEqual(newPool, oldPool),
    `${newPool.length} vs ${oldPool.length}`)
  return oldPool.length
}

// ---- 1. accounts written before the trigger, then the trigger, then more -----
const db = new PGlite()
const sql = makeSql(db)
await db.exec(CARD_SCHEMA)
const ids: string[] = []
const insert = async (id: string, suspect = rnd() < 0.1) => {
  const name = pick(['点点', '阿杰', 'TenZ', '', '经理', 'x'.repeat(30)])
  await sql`insert into card_accounts (id_hash, name, state, suspect, ladder_at)
            values (${hash(id)}, ${name}, ${sql.json(state(name))}, ${suspect}, now() - interval '1 hour')`
}
for (let i = 0; i < 300; i++) { const id = newId(); ids.push(id); await insert(id) }
await db.exec(PROJECTION_SCHEMA)
const [{ n: before }] = await sql`select count(*)::int as n from account_ladder`
check('触发器只管之后的写入，旧账号要等回填', before === 0, `${before} 行`)
let st = await P.projectionComplete(sql)
check('回填前：触发器在，但未完成', st.trigger && !st.done, JSON.stringify(st))
for (let i = 0; i < 300; i++) { const id = newId(); ids.push(id); await insert(id) }
const [{ n: mid }] = await sql`select count(*)::int as n from (select id_hash from account_ladder union select id_hash from account_rivals) x`
check('触发器之后建的号已有投影', mid > 200 && mid <= 300, `${mid} 个账号`)
const walked = await P.backfill(sql, { batch: 37, pause: 0 })
check('回填只走没有投影的账号（批大小不整除也不漏），触发器写过的不再读', walked === 600 - mid && walked >= 300, `${walked}`)
st = await P.projectionComplete(sql)
check('回填后标记完成', st.done)
const pool0 = await compareAll(sql, '回填后', ids)
check('对手池不是空的（夹具有效）', pool0 > 100, `${pool0}`)

// ---- 2. three hundred writes of every kind, through plain SQL -----------------
for (let i = 0; i < 300; i++) {
  const id = pick(ids)
  const h = hash(id)
  const r = rnd()
  if (r < 0.45) await sql`update card_accounts set state = ${sql.json(state('改'))} where id_hash = ${h}`
  else if (r < 0.6) await sql`update card_accounts set state = jsonb_set(state, '{ladder,points}', ${sql.json(int(5000))}) where id_hash = ${h} and jsonb_typeof(state->'ladder') = 'object'`
  else if (r < 0.7) await sql`update card_accounts set suspect = not suspect where id_hash = ${h}`
  else if (r < 0.75) await sql`update card_accounts set state = '{}' where id_hash = ${h}`
  else if (r < 0.8) await sql`update card_accounts set state = state - 'squad' where id_hash = ${h}`
  else if (r < 0.85) await sql`update card_accounts set name = ${'新名' + i} where id_hash = ${h}`
  else if (r < 0.9) await sql`update card_accounts set seen = now() where id_hash = ${h}`
  else if (r < 0.95) {
    await sql`delete from card_accounts where id_hash = ${h}`
    ids.splice(ids.indexOf(id), 1)
  } else { const nid = newId(); ids.push(nid); await insert(nid) }
}
await compareAll(sql, '三百次写入后', ids)
const [{ n: orphans }] = await sql`
  select (select count(*) from account_ladder l where not exists (select 1 from card_accounts a where a.id_hash = l.id_hash))
       + (select count(*) from account_rivals r where not exists (select 1 from card_accounts a where a.id_hash = r.id_hash)) as n`
check('删号连带删投影，没有孤儿行', Number(orphans) === 0, `${orphans}`)

// ---- 3. the re-projection reads the state under its lock, not a copy ---------
// (the backfill and the repair both go through account_reproject_v1; Codex's
// review found the old insert-only backfill could revive rows a newer state had
// removed, when handed an older copy)
{
  const h = hash(ids[0])
  const five = { season: SEASON, ladder: { div: 3, points: 70, stars: 0, wins: 1, losses: 0 }, squad: { slots: ['a', 'b', 'c', 'd', 'e'], coach: 'f' }, cards: { a: { level: 1 } } }
  await sql`update card_accounts set state = ${sql.json(five)} where id_hash = ${h}`
  await sql`update card_accounts set state = ${sql.json({ season: SEASON, cards: {} })} where id_hash = ${h}`
  const gone = async () => (await sql`select (select count(*) from account_ladder where id_hash = ${h}) + (select count(*) from account_rivals where id_hash = ${h}) as n`)[0].n
  check('新存档去掉了天梯和阵容，投影行随之删除', Number(await gone()) === 0)
  // stale rows planted as an older writer would have left them
  await sql`insert into account_ladder (id_hash, league, season, div, points, stars, wins, losses, suspect) values (${h}, 'open', ${String(SEASON)}, 3, 70, 0, 1, 0, false)`
  await sql`insert into account_rivals (id_hash, div, points, squad, cards, suspect) values (${h}, 3, 70, ${sql.json(five.squad)}, '{}', false)`
  await sql`select account_reproject_v1(${h})`
  check('重新投影读当前存档：旧行被删，不会复活', Number(await gone()) === 0)
  // and it overwrites a row that is wrong rather than keeping it
  await sql`update card_accounts set state = ${sql.json({ ...five, ladder: { ...five.ladder, points: 4321 } })} where id_hash = ${h}`
  await sql`update account_ladder set points = 1 where id_hash = ${h} and league = 'open'`
  await sql`select account_reproject_v1(${h})`
  const [row] = await sql`select points from account_ladder where id_hash = ${h} and league = 'open'`
  check('重新投影改正与存档不符的行', row?.points === 4321, JSON.stringify(row))
  const src = (await import('node:fs')).readFileSync('account-projection.js', 'utf8')
  check('重新投影先锁账号行再读（for share）', /select state, suspect into v_state, v_suspect from card_accounts where id_hash = p_id for share/.test(src))
}

// ---- 4. a projection that throws never fails the write — and is never trusted until repaired
{
  const h = hash(ids[1])
  const base = { season: SEASON, ladder: { div: 5, points: 7, stars: 0, wins: 1, losses: 1 }, squad: { slots: ['p1', 'p2', 'p3', 'p4', 'p5'], coach: 'c1' }, cards: {} }
  await sql`update card_accounts set state = ${sql.json(base)}, suspect = false where id_hash = ${h}`
  // Codex's case: the rival row fails, the score and the flag both change, and nothing writes the account again
  await db.exec('alter table account_rivals add constraint projection_fixture check (points < 1000) not valid')
  let ok = true
  try {
    await sql`update card_accounts set state = ${sql.json({ ...base, ladder: { ...base.ladder, points: 5000 } })}, suspect = true, rev = rev + 1 where id_hash = ${h}`
  } catch { ok = false }
  await db.exec('alter table account_rivals drop constraint projection_fixture')
  const [acc] = await sql`select suspect, state->'ladder'->>'points' as p from card_accounts where id_hash = ${h}`
  const [proj] = await sql`select points, suspect from account_ladder where id_hash = ${h} and league = 'open'`
  check('投影出错时，账号写入照常成功', ok && acc?.p === '5000' && acc?.suspect === true, JSON.stringify(acc))
  check('出错的那次投影整体回滚，旧行不留半截', proj?.points === 7 && proj?.suspect === false, JSON.stringify(proj))
  const [dirty] = await sql`select why from account_projection_dirty where id_hash = ${h}`
  check('出错的账号记入待修复表', !!dirty && String(dirty.why).includes('projection_fixture'), JSON.stringify(dirty))
  check('有待修复账号时投影不算干净', !(await P.projectionClean(sql)))
  // the repair, with nothing writing the account again
  const n = await P.repairDirty(sql)
  const [after] = await sql`select points, suspect from account_ladder where id_hash = ${h} and league = 'open'`
  const inPool = (await P.rivalSample(sql, 1e6)).some((r: { id_hash: string }) => r.id_hash === h)
  check('修复后：分数、可疑标记都同步，待修复表清空', n === 1 && after?.points === 5000 && after?.suspect === true && await P.projectionClean(sql), JSON.stringify(after))
  check('修复后：可疑账号不在对手池', !inPool)
  // a later good write also clears a dirty note on its own
  await sql`insert into account_projection_dirty (id_hash, why) values (${h}, 'fixture')`
  await sql`update card_accounts set state = jsonb_set(state, '{ladder,points}', '5001') where id_hash = ${h}`
  check('之后一次成功的写入也会清掉待修复记录', await P.projectionClean(sql))
  // if even the note cannot be written, the write fails rather than leave a stale projection unrecorded
  await db.exec('alter table account_ladder add constraint projection_fixture check (points < 1000) not valid')
  await db.exec("alter table account_projection_dirty add constraint dirty_fixture check (why <> why) not valid")
  let failed = false
  try { await sql`update card_accounts set state = jsonb_set(state, '{ladder,points}', '6000') where id_hash = ${h}` } catch { failed = true }
  await db.exec('alter table account_ladder drop constraint projection_fixture')
  await db.exec('alter table account_projection_dirty drop constraint dirty_fixture')
  const [still] = await sql`select state->'ladder'->>'points' as p from card_accounts where id_hash = ${h}`
  check('连待修复记录都写不进时，这次写入整体失败（不留无记录的过期投影）', failed && still?.p === '5001', JSON.stringify(still))
}

// ---- 4b. ...but the backfill fails loudly, so a broken function is never marked ready
{
  const db3 = new PGlite()
  const sql3 = makeSql(db3)
  await db3.exec(CARD_SCHEMA)
  for (let i = 0; i < 3; i++) {
    await sql3`insert into card_accounts (id_hash, name, state) values (${hash(newId())}, 'x', ${sql3.json({ season: SEASON, ladder: { div: 2, points: 5, stars: 0, wins: 1, losses: 0 } })})`
  }
  await db3.exec(PROJECTION_SCHEMA)
  await db3.exec('alter table account_ladder add constraint projection_fixture check (div > 50) not valid')
  let threw = ''
  await P.backfill(sql3, { pause: 0 }).catch((e: Error) => { threw = e.message })
  check('回填遇到错误会抛出，不吞掉', threw.includes('projection_fixture'), threw || '没抛')
  check('回填失败时不标记完成，读者继续用旧扫描', !(await P.projectionComplete(sql3)).done)
  await db3.exec('alter table account_ladder drop constraint projection_fixture')
  const n = await P.backfill(sql3, { pause: 0 })
  check('修好后再回填，补齐并标记完成', n === 3 && (await P.projectionComplete(sql3)).done, `${n}`)
  await db3.close()
}

// ---- 5. the /top route: legacy until ready, then the projection ---------------
{
  const db2 = new PGlite()
  const sql2 = makeSql(db2)
  for (const s of SCHEMAS) await db2.exec(s)
  // accounts the trigger has not seen: a projection with no backfill yet
  await db2.exec(`alter table card_accounts disable trigger card_accounts_projection_v1`)
  const people: string[] = []
  for (let i = 0; i < 250; i++) {
    const id = newId(); people.push(id)
    const s = { season: SEASON, ladder: { div: 5, points: 1000 + i * 3, stars: 0, wins: i, losses: 1 }, squad: { slots: ['p1', 'p2', 'p3', 'p4', 'p5'], coach: 'c1' }, cards: { p1: { level: 2 } } }
    await sql2`insert into card_accounts (id_hash, name, state, ladder_at) values (${hash(id)}, ${'玩家' + i}, ${sql2.json(s)}, now() - interval '1 hour')`
  }
  await db2.exec(`alter table card_accounts enable trigger card_accounts_projection_v1`)
  await sql2`delete from account_projection_marks`

  interface Res { code: number; body: Record<string, unknown> }
  const json = (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body }
  const readBody = (req: { body: string }) => Promise.resolve(req.body)
  const api = makeCardApi(sql2, { rateLimited: () => false, readBody, json, slow: sql2 } as never)
  const top = async (id?: string, league = 'open') => {
    const res: Res = { code: 0, body: {} }
    await api.route({ body: JSON.stringify({ id, league }), method: 'POST' } as never, res as never, '/api/card/top', 't')
    return res.body as { ok: boolean; rows: { rank: number; name: string; tag: string; points: number; me: boolean }[] }
  }
  const low = people[10] // rank 240 of 250
  const first = await top(low)
  check('投影未就绪时榜单照旧（扫描）', first.ok && first.rows.length === 101 && first.rows[100].rank === 240 && first.rows[100].me,
    `${first.rows.length} 行 · 末行 #${first.rows.at(-1)?.rank}`)
  // the first look started the backfill on the slow pool; wait for it
  for (let i = 0; i < 100 && !(await P.projectionComplete(sql2)).done; i++) await new Promise((r) => setTimeout(r, 20))
  check('第一次看榜触发了回填', (await P.projectionComplete(sql2)).done)
  // readiness is re-asked every 30 s; a fresh api asks at once
  const api2 = makeCardApi(sql2, { rateLimited: () => false, readBody, json, slow: sql2 } as never)
  const top2 = async (id?: string) => {
    const res: Res = { code: 0, body: {} }
    await api2.route({ body: JSON.stringify({ id, league: 'open' }), method: 'POST' } as never, res as never, '/api/card/top', 't')
    return res.body as typeof first
  }
  const second = await top2(low)
  check('就绪后榜单与扫描结果完全一样', isDeepStrictEqual(second, first))
  // the player climbs: his own row is fresh on the next look, and the hundred is rebuilt for him
  await sql2`update card_accounts set state = jsonb_set(state, '{ladder,points}', '99999'), ladder_at = now() where id_hash = ${hash(low)}`
  const third = await top2(low)
  check('刚打完的人进了前一百，看到的是新榜（第一名、只出现一次）',
    third.rows[0].me && third.rows[0].points === 99999 && third.rows.filter((r) => r.me).length === 1 && third.rows.length === 100,
    `#1 ${third.rows[0].name} ${third.rows[0].points} · ${third.rows.length} 行`)
  // somebody else, outside the hundred, moving: everybody else's cached board is untouched, his own row is fresh
  const other = people[3]
  await sql2`update card_accounts set state = jsonb_set(state, '{ladder,points}', '1001'), ladder_at = now() where id_hash = ${hash(other)}`
  const mine = await top2(other)
  const own = mine.rows.find((r) => r.me)
  const [{ n: ahead }] = await sql2`select count(*)::int as n from card_accounts where (state->'ladder'->>'points')::int > 1001
    or ((state->'ladder'->>'points')::int = 1001 and (state->'ladder'->>'wins')::int > 3)`
  check('榜外玩家：本人名次即时、不重建别人的前一百', !!own && own.points === 1001 && own.rank === ahead + 1 && mine.rows.length === 101,
    `#${own?.rank}（应 #${ahead + 1}）`)
  const anon = await top2()
  check('匿名看榜：一百行，没有“我”', anon.rows.length === 100 && !anon.rows.some((r) => r.me))
  // the rival pool off the projection
  const rr: Res = { code: 0, body: {} }
  await api2.route({ body: JSON.stringify({ div: 5, id: low }), method: 'POST' } as never, rr as never, '/api/card/rivals', 't')
  const rivals = (rr.body as { rivals: { slots: string[]; levels: Record<string, number>; name: string }[] }).rivals ?? []
  check('对手池（投影）给出 12 套五人，等级照旧', rivals.length === 12 && rivals.every((x) => x.slots.length === 5 && x.levels.p1 === 2),
    `${rivals.length} 套`)
  check('对手池里没有自己', !rivals.some((x) => x.name === '玩家10'))

  // a dirty account: the route serves the truth (the scan) and starts the repair
  const victim = people[200]
  await db2.exec('alter table account_ladder add constraint projection_fixture check (points < 50000) not valid')
  await sql2`update card_accounts set state = jsonb_set(state, '{ladder,points}', '88888'), ladder_at = now() where id_hash = ${hash(victim)}`
  await db2.exec('alter table account_ladder drop constraint projection_fixture')
  const [stale] = await sql2`select points from account_ladder where id_hash = ${hash(victim)} and league = 'open'`
  const api3 = makeCardApi(sql2, { rateLimited: () => false, readBody, json, slow: sql2 } as never)
  const top3 = async (id?: string) => {
    const res: Res = { code: 0, body: {} }
    await api3.route({ body: JSON.stringify({ id, league: 'open' }), method: 'POST' } as never, res as never, '/api/card/top', 't')
    return res.body as typeof first
  }
  const dirtyView = await top3(victim)
  check('投影有待修复账号时，榜单回到扫描并显示真实分数', stale?.points !== 88888 && dirtyView.rows[1]?.me && dirtyView.rows[1]?.points === 88888,
    `投影 ${stale?.points} · 榜上 #${dirtyView.rows.find((r) => r.me)?.rank} ${dirtyView.rows.find((r) => r.me)?.points}`)
  for (let i = 0; i < 100 && !(await P.projectionClean(sql2)); i++) await new Promise((r) => setTimeout(r, 20))
  const [repaired] = await sql2`select points from account_ladder where id_hash = ${hash(victim)} and league = 'open'`
  check('看榜触发修复，投影补正、待修复表清空', repaired?.points === 88888 && await P.projectionClean(sql2), JSON.stringify(repaired))

  // ---- 6. a load moves `seen` at most every five minutes ----------------------
  const tester = people[20]
  const g = engine.newGacha(tester, '测试', serverDay())
  g.daily.staminaAt = Date.now()
  await sql2`update card_accounts set state = ${sql2.json((({ id, ...rest }) => { void id; return rest })(g))}, seen = now() - interval '1 minute' where id_hash = ${hash(tester)}`
  const seenOf = async () => (await sql2`select seen from card_accounts where id_hash = ${hash(tester)}`)[0].seen.getTime()
  const s0 = await seenOf()
  const load = async () => {
    const res: Res = { code: 0, body: {} }
    await api2.route({ body: JSON.stringify({ id: tester }), method: 'POST' } as never, res as never, '/api/card/load', 't')
    return res.body
  }
  const l1 = await load()
  check('load 正常', l1.ok === true, JSON.stringify(l1).slice(0, 80))
  check('一分钟前刚上线：seen 不再改写', (await seenOf()) === s0)
  await sql2`update card_accounts set seen = now() - interval '6 minutes' where id_hash = ${hash(tester)}`
  await load()
  check('超过五分钟：seen 更新', Date.now() - (await seenOf()) < 60_000)

  // ---- 7. the boot migration puts back a missing trigger, and sends only that schema
  await db2.exec('drop trigger card_accounts_projection_v1 on card_accounts')
  await sql2`drop table if exists schema_marks`
  const logs: string[] = []
  const log = console.log
  console.log = (...a: unknown[]) => { logs.push(a.join(' ')) }
  let applied
  try { applied = await applySchema(sql2) } finally { console.log = log }
  const [t] = await sql2`select count(*)::int as n from pg_trigger where tgname = 'card_accounts_projection_v1'`
  check('启动迁移发现缺触发器，只补这一份', applied?.ready === true && t.n === 1 && logs.some((l) => l.includes('1 of 10')), logs.join(' | '))
  await db2.close()
}

// ---- 7b. caches built off the projection are dropped the moment it goes dirty (Codex recheck)
{
  const db4 = new PGlite()
  const sql4 = makeSql(db4)
  for (const s of SCHEMAS) await db4.exec(s)
  const ppl = [newId(), newId(), newId(), newId()]
  for (const [i, id] of ppl.entries()) {
    const st = { season: SEASON, ladder: { div: 5, points: 100 + i, stars: 0, wins: 3, losses: 1 }, squad: { slots: ['p1', 'p2', 'p3', 'p4', 'p5'], coach: 'c1' }, cards: { p1: { level: 2 } } }
    await sql4`insert into card_accounts (id_hash, name, state) values (${hash(id)}, ${'对手' + i}, ${sql4.json(st)})`
  }
  interface Res4 { code: number; body: Record<string, unknown> }
  const json4 = (res: Res4, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body }
  const api4 = makeCardApi(sql4, { rateLimited: () => false, readBody: (req: { body: string }) => Promise.resolve(req.body), json: json4, slow: sql4 } as never)
  const call4 = async (path: string, body: unknown) => {
    const res: Res4 = { code: 0, body: {} }
    await api4.route({ body: JSON.stringify(body), method: 'POST' } as never, res as never, path, 't')
    return res.body
  }
  const rivalNames = async () => ((await call4('/api/card/rivals', { div: 5, id: ppl[0] })).rivals as { name: string }[]).map((r) => r.name)
  const boardNames = async () => ((await call4('/api/card/top', { id: ppl[0] })).rows as { name: string }[]).map((r) => r.name)
  await call4('/api/card/top', { id: ppl[0] })   // starts the backfill
  for (let i = 0; i < 100 && !(await P.projectionComplete(sql4)).done; i++) await new Promise((r) => setTimeout(r, 20))
  const realNow = Date.now
  let skew = 0
  Date.now = () => realNow() + skew
  try {
    skew += 31_000                                 // past the readiness re-ask
    check('预热：对手池（投影）里有对手1', (await rivalNames()).includes('对手1'))
    check('预热：榜单（投影）里有对手1', (await boardNames()).includes('对手1'))
    // 对手1 is flagged and his score moves, and the rival row fails; nothing writes him again
    await db4.exec('alter table account_rivals add constraint projection_fixture check (points < 1000) not valid')
    await sql4`update card_accounts set state = jsonb_set(state, '{ladder,points}', '5000'), suspect = true where id_hash = ${hash(ppl[1])}`
    await db4.exec('alter table account_rivals drop constraint projection_fixture')
    check('前置：对手1 已记入待修复', !(await P.projectionClean(sql4)))
    skew += 6_000                                  // past the five-second health check, well inside the 60 s pool
    check('同一实例、对手池缓存未过期：投影变脏后不再给出被标记的对手1', !(await rivalNames()).includes('对手1'))
    check('同一实例：榜单也不再显示被标记的对手1', !(await boardNames()).includes('对手1'))
    for (let i = 0; i < 100 && !(await P.projectionClean(sql4)); i++) await new Promise((r) => setTimeout(r, 20))
    check('修复完成、待修复表清空', await P.projectionClean(sql4))
    skew += 6_000
    check('修复后：对手池仍不含对手1', !(await rivalNames()).includes('对手1'))
    skew += 61_000                                 // the pool expires and is rebuilt — off the clean projection
    await rivalNames(); await new Promise((r) => setTimeout(r, 50))
    const after = await rivalNames()
    check('修复后重建（投影）：对手池不含对手1，其他人都在', !after.includes('对手1') && after.includes('对手2') && after.includes('对手3'), after.join(','))
    check('修复后：榜单不含对手1', !(await boardNames()).includes('对手1'))
  } finally { Date.now = realNow }
  await db4.close()
}

// ---- 8. the board query walks the index and stops, rather than sorting everything
{
  for (let i = 0; i < 3000; i++) await insert(newId(), false)
  await sql`analyze account_ladder`
  const plan = (await sql.unsafe(`explain select l.id_hash from account_ladder l join card_accounts a on a.id_hash = l.id_hash
    where l.league = 'open' and l.season = '${SEASON}' and not l.suspect and ('open' = 'open' or l.wins + l.losses > 0)
    order by l.div desc, l.points desc, l.stars desc, l.wins desc, l.id_hash limit 100`)).map((r: Record<string, string>) => Object.values(r)[0]).join('\n')
  check('前一百走 account_ladder_board_idx，不全表排序', plan.includes('account_ladder_board_idx') && !/\bSort\b/.test(plan), plan.split('\n')[0])
}

await db.close()
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
