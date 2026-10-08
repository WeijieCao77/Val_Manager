/**
 * Reads that must not make a database stall worse (2026-10-08, docs/incident-2026-10-08).
 *
 *   npx tsx scripts/check_stall_reads.ts
 *
 * Twice that evening every pool on the site waited together — the daily
 * backup at 18:52 Beijing, the dashboard opened at 22:06 — and two reads
 * turned a slow database into a stuck one:
 *
 *   成交记录  every open of a tile re-ran the median over all of a card's
 *             sales; in the stall those were the first statements to time
 *             out, holding the interactive connections. Now kept a minute per
 *             card and level, asked once however many wait, a failure not kept.
 *   天梯榜    a projection read that timed out fell back to the old scan of
 *             every save — the heaviest read there is — into the stall. Now a
 *             timeout (or no connection) serves the last hundred built, or the
 *             error; only a projection that is wrong takes the scan.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { makeSql } from '../pglite-sql.js'
import { ALL_CARDS } from '../src/engine/cards'

const { makeCardApi, normalizeId, serverDay, engine: cardEngine } = await import('../cards-api.js')
const { SCHEMAS } = await import('../db-schema.js')
const P = await import('../account-projection.js')
const { displayName } = await import('../names.js')
const { makeMarketApi } = await import('../market-api.js')
const engine = await import('../src/engine/server.ts')

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
interface Res { code: number; body: Record<string, any> }
const json = (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body }
const readBody = (req: { body: string }) => Promise.resolve(req.body)
const hash = (id: string) => createHash('sha256').update(id).digest('hex')

/**
 * The shim with a hand on every statement: `seen` counts the ones whose text
 * matches, `fail` makes the next n of them throw what Postgres throws on a
 * statement timeout.
 */
function watched(sql: ReturnType<typeof makeSql>) {
  const seen = new Map<string, number>()
  const fail = new Map<string, number>()
  const wrap = Object.assign((strings: TemplateStringsArray, ...vals: unknown[]) => {
    const text = Array.isArray(strings) ? strings.join('?') : ''
    for (const k of new Set([...seen.keys(), ...fail.keys()])) {
      if (!text.includes(k)) continue
      seen.set(k, (seen.get(k) ?? 0) + 1)
      const n = fail.get(k) ?? 0
      if (n > 0) {
        fail.set(k, n - 1)
        return Promise.reject(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }))
      }
    }
    return (sql as any)(strings, ...vals)
  }, sql)
  return { sql: wrap as typeof sql, seen, fail, count: (k: string) => seen.get(k) ?? 0, watch: (k: string) => { if (!seen.has(k)) seen.set(k, 0) } }
}

// ---------------------------------------------------------------- 成交记录
{
  const db = new PGlite()
  const raw = makeSql(db)
  for (const s of SCHEMAS) await db.exec(s)
  const w = watched(raw)
  const MEDIAN = 'percentile_cont'
  w.watch(MEDIAN)
  const api = makeMarketApi(w.sql, { readBody, json, normalizeId, displayName, rateLimited: () => false, engine, timer: false } as never)
  const call = async (body: unknown) => {
    const res: Res = { code: 0, body: {} }
    await api.route({ body: JSON.stringify(body), method: 'POST', headers: {} } as never, res as never, '/api/market/history', 't')
    return res
  }
  const X = ALL_CARDS.find((c) => c.rarity === 'gold' && c.kind === 'player')!.id
  const Y = ALL_CARDS.find((c) => c.rarity === 'silver' && c.kind === 'player')!.id
  const sale = async (card: string, price: number) => {
    const [l] = await raw`insert into card_listings (seller_h, card_id, level, ask, status, created, closed, ends)
      values ('s', ${card}, 0, ${price}, 'sold', now() - interval '1 day', now(), now()) returning id`
    await raw`insert into card_offers (listing, buyer_h, price, status, made, settled) values (${l.id}, 'b', ${price}, 'accepted', now(), now())`
  }
  await sale(X, 500); await sale(X, 700); await sale(Y, 90)

  let r = await call({ cardId: X, level: 0 })
  check('第一次看：照常算', r.body.ok && r.body.sold === 2 && r.body.avg === 600 && w.count(MEDIAN) === 1, `${r.body.sold} 笔 · 均价 ${r.body.avg} · 查了 ${w.count(MEDIAN)} 次`)
  r = await call({ cardId: X, level: 0 })
  check('一分钟内再看同一张：不再查库，数字一样', w.count(MEDIAN) === 1 && r.body.sold === 2 && r.body.avg === 600, `查了 ${w.count(MEDIAN)} 次`)
  await call({ cardId: X, level: 1 })
  check('换个等级是另一份（同等级均价不同）', w.count(MEDIAN) === 2)
  await Promise.all(Array.from({ length: 8 }, () => call({ cardId: Y })))
  check('八个人同时看一张没缓存的卡：只查一次', w.count(MEDIAN) === 3, `查了 ${w.count(MEDIAN)} 次`)

  // a failure is not kept
  const Z = ALL_CARDS.find((c) => c.rarity === 'gold' && c.kind === 'player' && c.id !== X)!.id
  w.fail.set(MEDIAN, 1)
  let threw = false
  try { await call({ cardId: Z }) } catch { threw = true }
  const after = await call({ cardId: Z })
  check('查失败的不缓存：下一次重新查、能读到', threw && after.body.ok === true && w.count(MEDIAN) === 5, `第一次${threw ? '失败' : '没失败'} · 查了 ${w.count(MEDIAN)} 次`)

  // a minute later it is asked again and a new sale shows
  await sale(X, 1100)
  const realNow = Date.now
  Date.now = () => realNow() + 61_000
  try {
    r = await call({ cardId: X, level: 0 })
  } finally { Date.now = realNow }
  check('过了一分钟：重新查，新成交算进去', r.body.sold === 3 && w.count(MEDIAN) === 6, `${r.body.sold} 笔`)
}

// ---------------------------------------------------------------- 天梯榜
{
  const db = new PGlite()
  const raw = makeSql(db)
  for (const s of SCHEMAS) await db.exec(s)
  const SEASON = cardEngine.seasonOf(serverDay())
  const people: string[] = []
  for (let i = 0; i < 60; i++) {
    const id = `VM-TEST-${String(i).padStart(4, '0')}-AAAA-BBBB-CCCC`
    people.push(id)
    const s = { season: SEASON, ladder: { div: 5, points: 1000 + i * 3, stars: 0, wins: i, losses: 1 }, squad: { slots: ['p1', 'p2', 'p3', 'p4', 'p5'], coach: 'c1' } }
    await raw`insert into card_accounts (id_hash, name, state, ladder_at) values (${hash(id)}, ${'玩家' + i}, ${raw.json(s)}, now() - interval '1 hour')`
  }
  // build the projection the way the site does on its first look, then use a fresh api that sees it ready
  const boot = makeCardApi(raw, { rateLimited: () => false, readBody, json, slow: raw } as never)
  await boot.route({ body: JSON.stringify({ league: 'open' }), method: 'POST' } as never, { code: 0, body: {} } as never, '/api/card/top', 't')
  for (let i = 0; i < 200 && !(await P.projectionComplete(raw)).done; i++) await new Promise((r) => setTimeout(r, 20))
  check('投影回填完成（前置）', (await P.projectionComplete(raw)).done)

  const w = watched(raw)
  const OWN = 'from account_ladder o'   // boardOwn: the caller's own row and place
  const SCAN = 'with lad as ('          // rankedRows: every save, the old board
  w.watch(OWN); w.watch(SCAN)
  const api = makeCardApi(w.sql, { rateLimited: () => false, readBody, json, slow: w.sql } as never)
  const top = async (id?: string) => {
    const res: Res = { code: 0, body: {} }
    await api.route({ body: JSON.stringify({ id, league: 'open' }), method: 'POST' } as never, res as never, '/api/card/top', 't')
    return res
  }
  const me = people[5]
  const first = await top(me)
  check('平时：读投影，不扫存档', first.body.ok && first.body.rows.length === 60 && w.count(SCAN) === 0, `${first.body.rows?.length} 行 · 扫描 ${w.count(SCAN)} 次`)

  w.fail.set(OWN, 3)
  const stalled = await top(me)
  check('读自己名次超时：给最近建好的那一百，不去扫全部存档',
    stalled.code === 200 && stalled.body.ok && stalled.body.rows.length === 60 && w.count(SCAN) === 0,
    `HTTP ${stalled.code} · ${stalled.body.rows?.length} 行 · 扫描 ${w.count(SCAN)} 次`)

  // no board kept yet (a fresh process) and the database stalled: the error, still no scan
  const cold = makeCardApi(w.sql, { rateLimited: () => false, readBody, json, slow: w.sql } as never)
  const res: Res = { code: 0, body: {} }
  await cold.route({ body: JSON.stringify({ id: me, league: 'open' }), method: 'POST' } as never, res as never, '/api/card/top', 't')
  check('刚启动、还没有榜又超时：直接报错，也不扫', res.code === 500 && w.count(SCAN) === 0, `HTTP ${res.code} · 扫描 ${w.count(SCAN)} 次`)

  // a projection that is WRONG (not a timeout) still has the old scan behind it
  const broken = makeCardApi(w.sql, { rateLimited: () => false, readBody, json, slow: w.sql } as never)
  const realOwn = w.fail.get(OWN)
  w.fail.set(OWN, 0)
  const orig = (w.sql as any)
  const sqlBroken = Object.assign((strings: TemplateStringsArray, ...vals: unknown[]) =>
    (Array.isArray(strings) && strings.join('?').includes(OWN)
      ? Promise.reject(Object.assign(new Error('column l.stars does not exist'), { code: '42703' }))
      : orig(strings, ...vals)), orig)
  const broken2 = makeCardApi(sqlBroken as never, { rateLimited: () => false, readBody, json, slow: sqlBroken } as never)
  const res2: Res = { code: 0, body: {} }
  await broken2.route({ body: JSON.stringify({ id: me, league: 'open' }), method: 'POST' } as never, res2 as never, '/api/card/top', 't')
  check('投影本身坏了（不是超时）：照旧退回扫描', res2.code === 200 && res2.body.rows?.length === 60 && w.count(SCAN) === 1, `HTTP ${res2.code} · 扫描 ${w.count(SCAN)} 次`)
  void broken; void realOwn
}

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
