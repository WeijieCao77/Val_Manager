/**
 * The ladder projection (account-projection.js) on real PostgreSQL, with real
 * concurrency — what PGlite, one connection, cannot show.
 *
 *   PG_TEST_URL=postgres://postgres@127.0.0.1:55439/postgres node --import tsx scripts/pg/check_projection_pg.ts
 *
 * A disposable database is created and dropped. Checked:
 *   1. the boot migration installs it, is a no-op the second time, and puts
 *      back a missing trigger alone;
 *   2. the re-projection (backfill/repair) reads the account under its row
 *      lock: a writer mid-transaction is waited for and its state is what gets
 *      projected — an older copy cannot bring back rows a newer state removed
 *      (Codex's review, 2026-10-05) — and a writer arriving during a
 *      re-projection waits for it and then wins;
 *   3. two backfills at once (two server instances) with eight writers and
 *      two-account trades running through them end with every row equal to a
 *      reference computed from the saves, no deadlock, nothing dirty;
 *   4. a projection failure is noted dirty in the writer's transaction and the
 *      repair clears it; /top and /rivals answer under concurrent writes.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import postgres from 'postgres'
import { randomBytes, createHash } from 'node:crypto'

const url = process.env.PG_TEST_URL
if (!url) throw new Error('PG_TEST_URL required: a dedicated disposable test PostgreSQL only')
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) && process.env.PG_TEST_ISOLATED !== '1') {
  throw new Error('Remote database requires PG_TEST_ISOLATED=1 and a dedicated test database; never production')
}

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const latch = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r }); return { p, open } }

const admin = postgres(url, { max: 1, onnotice: () => {} })
const dbName = `verify_proj_${Date.now()}_${randomBytes(3).toString('hex')}`
await admin.unsafe(`create database "${dbName}"`)
const testUrl = new URL(url)
testUrl.pathname = '/' + dbName
const { safeTransactions } = await import('../../db-transactions.js')
const pools: ReturnType<typeof postgres>[] = []
const pool = (max: number) => {
  const p = safeTransactions(postgres(testUrl.toString(), { max, onnotice: () => {}, connection: { statement_timeout: 30000, lock_timeout: 15000 } }), `t${pools.length}`)
  pools.push(p)
  return p
}

try {
  const sql = pool(12)
  const { applySchema, SCHEMAS } = await import('../../db-schema.js')
  const { BOARDS, makeCardApi, engine, serverDay } = await import('../../cards-api.js')
  const P = await import('../../account-projection.js')
  const SEASON = engine.seasonOf(serverDay())

  // ---- 1. the boot migration ---------------------------------------------------
  {
    const logs: string[] = []
    const log = console.log
    console.log = (...a: unknown[]) => { logs.push(a.join(' ')) }
    let first, second
    try {
      first = await applySchema(sql)
      second = await applySchema(sql)
    } finally { console.log = log }
    check('1. 启动迁移在真实 PG 上建好全部 schema', first?.ready === true && SCHEMAS.length === 10)
    check('1. 第二次启动什么都不锁', second?.ready === true && logs.some((l) => l.includes('already at this version')), logs.at(-1))
    const st = await P.projectionComplete(sql)
    check('1. 触发器已装上', st.trigger)
    await sql`drop trigger card_accounts_projection_v1 on card_accounts`
    await sql`delete from schema_marks`
    logs.length = 0
    console.log = (...a: unknown[]) => { logs.push(a.join(' ')) }
    let third
    try { third = await applySchema(sql) } finally { console.log = log }
    check('1. 缺了触发器：只补这一份', third?.ready === true && (await P.projectionComplete(sql)).trigger && logs.some((l) => l.includes('1 of 10')), logs.join(' | '))
  }

  // ---- fixtures ------------------------------------------------------------------
  const LEAGUES = BOARDS
  const stateOf = (i: number, v = 0) => ({
    season: i % 7 === 0 ? SEASON - 1 : SEASON,
    ladder: { div: (i + v) % 6, points: (i * 37 + v * 11) % 900, stars: (i + v) % 3, wins: (i + v) % 40, losses: i % 30, ...(i % 3 ? { sWins: v % 9 } : {}) },
    ...(i % 4 ? { leagues: { gold: { div: v % 6, points: v * 3, stars: 0, wins: v % 5, losses: 1 } } } : {}),
    squad: i % 5 ? { slots: ['p1', 'p2', 'p3', 'p4', `p${5 + (v % 3)}`], coach: 'c1' } : { slots: ['p1', null, 'p3', 'p4', 'p5'], coach: null },
    cards: { p1: { level: (i + v) % 6 }, p3: { level: 2, evo: { aim: v % 3 } }, c1: { level: 1 } },
  })
  const N = Number(process.env.PG_PROJ_N) || 400
  const ids = Array.from({ length: N }, (_, i) => hash(`acct${i}`))
  const seed = async () => {
    await sql`alter table card_accounts disable trigger card_accounts_projection_v1`
    await sql`delete from card_accounts`
    await sql`delete from account_projection_marks`
    for (let i = 0; i < N; i += 100) {
      const rows = ids.slice(i, i + 100).map((id, k) => ({ id_hash: id, name: `p${i + k}`, state: stateOf(i + k), suspect: (i + k) % 17 === 0 }))
      await sql`insert into card_accounts ${sql(rows.map((r) => ({ ...r, state: sql.json(r.state) })), 'id_hash', 'name', 'state', 'suspect')}`
    }
    await sql`alter table card_accounts enable trigger card_accounts_projection_v1`
  }

  /** every projected row that differs from what the saves say, both ways */
  const leagueList = sql.unsafe(`(values ${LEAGUES.map((l: string) => `('${l}')`).join(',')}) as lg(k)`)
  const mismatches = async () => {
    const [{ n: ladder }] = await sql`
      with expected as (
        select a.id_hash, lg.k as league, coalesce(a.state->>'season', '0') as season,
          case when l->>'div' ~ '^[0-9]{1,2}$' then (l->>'div')::int else 0 end as div,
          case when l->>'points' ~ '^[0-9]{1,9}$' then (l->>'points')::int else 0 end as points,
          case when l->>'stars' ~ '^[0-9]{1,3}$' then (l->>'stars')::int else 0 end as stars,
          case when coalesce(l->>'sWins', l->>'wins') ~ '^[0-9]{1,7}$' then coalesce(l->>'sWins', l->>'wins')::int else 0 end as wins,
          case when coalesce(l->>'sLosses', l->>'losses') ~ '^[0-9]{1,7}$' then coalesce(l->>'sLosses', l->>'losses')::int else 0 end as losses,
          a.suspect
        from card_accounts a cross join ${leagueList}
        cross join lateral (select case when lg.k = 'open' then a.state->'ladder' else a.state->'leagues'->lg.k end as l) x
        where jsonb_typeof(x.l) = 'object'
      ), actual as (select id_hash, league, season, div, points, stars, wins, losses, suspect from account_ladder)
      select (select count(*) from (select * from expected except select * from actual) a)
           + (select count(*) from (select * from actual except select * from expected) b) as n`
    const [{ n: rivals }] = await sql`
      with seen as (
        select id_hash from card_accounts
        where jsonb_typeof(state->'squad'->'slots') = 'array' and jsonb_array_length(state->'squad'->'slots') = 5
          and (select count(*) from jsonb_array_elements(state->'squad'->'slots') e where jsonb_typeof(e) = 'string') = 5
      ), expected as (
        select a.id_hash,
          case when a.state->'ladder'->>'div' ~ '^[0-9]{1,2}$' then (a.state->'ladder'->>'div')::int else 0 end as div,
          case when a.state->'ladder'->>'points' ~ '^[0-9]{1,9}$' then (a.state->'ladder'->>'points')::int else 0 end as points,
          a.state->'squad' as squad,
          (select coalesce(jsonb_object_agg(k, jsonb_build_object('level', a.state->'cards'->k->'level', 'evo', a.state->'cards'->k->'evo')), '{}'::jsonb)
             from (select e #>> '{}' as k from jsonb_array_elements(a.state->'squad'->'slots') e union select a.state->'squad'->>'coach') ks
            where k is not null and a.state->'cards' ? k) as cards,
          a.suspect
        from seen join card_accounts a using (id_hash)
      ), actual as (select id_hash, div, points, squad, cards, suspect from account_rivals)
      select (select count(*) from (select * from expected except select * from actual) a)
           + (select count(*) from (select * from actual except select * from expected) b) as n`
    return { ladder: Number(ladder), rivals: Number(rivals) }
  }

  // ---- 2. the re-projection reads under the row lock --------------------------------
  await seed()
  {
    const X = ids[1]                                 // a full five and a ladder, never projected yet
    check('2. 前置：X 还没有投影', (await sql`select count(*)::int as n from account_rivals where id_hash = ${X}`)[0].n === 0)
    const writer = pool(1)
    const reader = pool(1)
    const plain = pool(1)
    const go = latch()
    const inWriter = latch()
    // W clears X's five and ladder, and holds the transaction open
    const w = writer.begin(async (tx) => {
      await tx`update card_accounts set state = state - 'squad' - 'ladder' - 'leagues' where id_hash = ${X}`
      inWriter.open()
      await go.p
    })
    await inWriter.p
    const [old] = await plain`select state ? 'squad' as has from card_accounts where id_hash = ${X}`
    check('2. 写入未提交时，普通读仍看到旧存档（旧的插入式回填就是读到这个）', old.has === true)
    let settled = false
    const b = reader`select account_reproject_v1(${X})`.then(() => { settled = true })
    await sleep(400)
    const [wait] = await plain`select count(*)::int as n from pg_locks where not granted`
    check('2. 重新投影在等 W 的行锁，没有先读旧存档', !settled && wait.n >= 1, `等待锁 ${wait.n}`)
    go.open(); await w; await b
    const [left] = await sql`select (select count(*) from account_ladder where id_hash = ${X}) + (select count(*) from account_rivals where id_hash = ${X}) as n`
    check('2. W 提交后读到的是新存档：被删掉的行没有复活', Number(left.n) === 0, `${left.n} 行`)

    // the other way round: a re-projection holds the lock, the writer waits for it, then wins
    const Y = ids[2]
    const hold = latch()
    const inB = latch()
    const b2 = reader.begin(async (tx) => {
      await tx`select account_reproject_v1(${Y})`
      inB.open()
      await hold.p
    })
    await inB.p
    let wrote = false
    const w2 = writer`update card_accounts set state = jsonb_set(state, '{ladder,points}', '7777') where id_hash = ${Y}`.then(() => { wrote = true })
    await sleep(400)
    check('2. 反过来：写入等重新投影提交', !wrote)
    hold.open(); await b2; await w2
    const [y] = await sql`select points from account_ladder where id_hash = ${Y} and league = 'open'`
    check('2. 之后写入的触发器覆盖投影：7777', y?.points === 7777, JSON.stringify(y))
  }

  // ---- 3. two backfills at once, eight writers and two-account trades -----------------
  await seed()
  {
    const errors: string[] = []
    let writes = 0, trades = 0
    let stop = false
    const writer = async (k: number) => {
      const db = pool(1)
      let v = k * 1000
      while (!stop) {
        v++
        const i = (v * 7919) % N
        const id = ids[i]
        try {
          switch (v % 6) {
            case 0: await db`update card_accounts set state = state - 'squad' - 'ladder' where id_hash = ${id}`; break
            case 1: await db`update card_accounts set state = ${db.json(stateOf(i, v))} where id_hash = ${id}`; break
            case 2: await db`update card_accounts set suspect = not suspect where id_hash = ${id}`; break
            case 3: await db`update card_accounts set state = jsonb_set(state, '{ladder}', ${db.json({ div: v % 6, points: v % 999, stars: 1, wins: 2, losses: 3 })}) where id_hash = ${id}`; break
            case 4: {
              // a trade: two accounts in one transaction, locked in a fixed order as the market locks them
              const j = (i + 1 + (v % 50)) % N
              const [a, b] = [ids[i], ids[j]].sort()
              await db.begin(async (tx) => {
                await tx`select id_hash from card_accounts where id_hash = any(${[a, b]}) order by id_hash for update`
                await tx`update card_accounts set state = jsonb_set(state, '{ladder,points}', ${db.json(v % 500)}) where id_hash = ${a}`
                await tx`update card_accounts set state = ${db.json(stateOf(j, v))} where id_hash = ${b}`
              })
              trades++
              break
            }
            default: await db`update card_accounts set seen = now() where id_hash = ${id}`
          }
          writes++
        } catch (e) { errors.push((e as Error).message) }
      }
    }
    const writers = Array.from({ length: 8 }, (_, k) => writer(k))
    await sleep(100)
    const t = performance.now()
    const [nA, nB] = await Promise.all([P.backfill(pool(1), { batch: 25, pause: 0 }), P.backfill(pool(1), { batch: 25, pause: 0 })])
    const ms = Math.round(performance.now() - t)
    await sleep(300)
    stop = true
    await Promise.all(writers)
    check('3. 两个实例同时回填，都完成', nA > 0 && nB > 0 && (await P.projectionComplete(sql)).done, `${nA} + ${nB} 次，${ms} ms`)
    check('3. 期间 8 个写入者、含双账号交易，没有死锁或其他错误', errors.length === 0 && writes > 200 && trades > 20,
      `${writes} 次写入、${trades} 笔交易，错误 ${errors.length}${errors.length ? '：' + errors[0] : ''}`)
    const m = await mismatches()
    check('3. 结束后：每一行天梯投影都等于存档推算的结果', m.ladder === 0, `${m.ladder} 处不一致`)
    check('3. 结束后：对手池投影逐条等于存档', m.rivals === 0, `${m.rivals} 处不一致`)
    check('3. 没有待修复账号', await P.projectionClean(sql))
  }

  // ---- 4. the dirty path on real PG, and the routes under concurrent writes -----------
  {
    const Z = ids[3]
    await sql`alter table account_rivals add constraint projection_fixture check (points < 0) not valid`
    let ok = true
    try { await sql`update card_accounts set state = jsonb_set(state, '{ladder,points}', '4321'), suspect = true where id_hash = ${Z}` } catch { ok = false }
    await sql`alter table account_rivals drop constraint projection_fixture`
    const [d] = await sql`select why from account_projection_dirty where id_hash = ${Z}`
    check('4. 投影失败：写入照常成功，账号记入待修复', ok && !!d, d?.why)
    const n = await P.repairDirty(sql)
    const m = await mismatches()
    check('4. 修复后干净且全部一致', n === 1 && await P.projectionClean(sql) && m.ladder === 0 && m.rivals === 0, JSON.stringify(m))

    interface Res { code: number; body: Record<string, unknown> }
    const api = makeCardApi(pool(4), {
      rateLimited: () => false, readBody: (req: { body: string }) => Promise.resolve(req.body),
      json: (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body },
      slow: pool(2),
    } as never)
    const call = async (path: string, body: unknown) => {
      const res: Res = { code: 0, body: {} }
      await api.route({ body: JSON.stringify(body), method: 'POST' } as never, res as never, path, 't')
      return res
    }
    let stop = false
    const w = (async () => {
      const db = pool(2)
      let v = 0
      while (!stop) { v++; await db`update card_accounts set state = jsonb_set(state, '{ladder,points}', ${db.json(v % 800)}), ladder_at = now() where id_hash = ${ids[v % N]}` }
    })()
    const replies = await Promise.all(Array.from({ length: 60 }, (_, k) => k % 3
      ? call('/api/card/top', { league: k % 2 ? 'open' : 'gold' })
      : call('/api/card/rivals', { div: k % 6 })))
    stop = true
    await w
    check('4. 并发写入时 60 个 /top、/rivals 请求全部成功', replies.every((r) => r.code === 200 && r.body.ok === true),
      replies.filter((r) => r.code !== 200 || r.body.ok !== true).map((r) => JSON.stringify(r.body)).slice(0, 2).join(' '))
  }
} finally {
  await Promise.all(pools.map((p) => p.end({ timeout: 5 })))
  await admin.unsafe(`drop database if exists "${dbName}" with (force)`)
  await admin.end({ timeout: 5 })
}
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
