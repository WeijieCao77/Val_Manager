// Review reproductions only. Fresh in-memory database; no production access.
// Run from repository root: node docs/performance-audit-2026-10-05/review-repro.mjs
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
import { makeSql } from '../../pglite-sql.js'
import { projectionSchema, backfill, projectionComplete, boardTop, rivalSample } from '../../account-projection.js'

const db = new PGlite()
const sql = makeSql(db)
const results = []
await db.exec(`create table card_accounts (
  id_hash text primary key, state jsonb not null, suspect boolean not null default false,
  name text, ladder_at timestamptz
)`)
await db.exec(projectionSchema(['open']))
const old = { season: 1, ladder: { div: 3, points: 7, stars: 0, wins: 1, losses: 0 },
  squad: { slots: ['a','b','c','d','e'], coach: 'f' }, cards: { a: { level: 1 } } }
await sql`insert into card_accounts (id_hash,state,name) values ('failure',${sql.json(old)},'failure')`
await backfill(sql, { pause: 0 })

// Same fault-injection technique used by the submitted projection test, but
// inspect reads AFTER restoring the schema, without an unrelated future write.
await db.exec('alter table account_rivals add constraint review_fault check (points < 1000) not valid')
await sql`update card_accounts set state = ${sql.json({ ...old, ladder: { ...old.ladder, points: 5000 } })}, suspect = true where id_hash = 'failure'`
await db.exec('alter table account_rivals drop constraint review_fault')
const [account] = await sql`select suspect,state->'ladder'->>'points' as points from card_accounts where id_hash='failure'`
const status = await projectionComplete(sql)
const board = await boardTop(sql, 'open', '1')
const rivals = await rivalSample(sql, 80)
assert.equal(account.suspect, true)
assert.equal(account.points, '5000')
assert.equal(status.done, true)
assert.equal(board[0].points, 7)
assert.equal(rivals.length, 1)
results.push({ case: 'projection_failure', actual: { account, status, board, rivalCount: rivals.length },
  finding: 'Projection still considered ready after skipped write; flagged account remains on board and in rival pool.' })

// Inject a stale snapshot directly into the real backfill function, as the
// submitted test already does for a newer row. Here the newer write REMOVED
// a row, so ON CONFLICT DO NOTHING has no existing row to protect.
await sql`insert into card_accounts (id_hash,state,name) values ('removed',${sql.json(old)},'removed')`
await sql`update card_accounts set state = ${sql.json({ season: 1, cards: {} })} where id_hash='removed'`
assert.equal((await sql`select 1 from account_rivals where id_hash='removed'`).length, 0)
await sql`select account_project_v1('removed',${sql.json(old)},false,true)`
const resurrectedBoard = (await boardTop(sql, 'open', '1')).find(r => r.id_hash === 'removed')
const resurrectedRival = (await rivalSample(sql, 80)).find(r => r.id_hash === 'removed')
assert.ok(resurrectedBoard && resurrectedRival)
results.push({ case: 'backfill_stale_snapshot_after_delete', actual: { resurrectedBoard, resurrectedRival },
  finding: 'Old snapshot resurrects ladder and valid five removed by newer state. This is controlled snapshot injection, not real PG concurrency.' })
await db.close()

// Execute the actual runTurn initializer extracted from Dashboard, not a copy
// of its loop. Stub day calculation and browser callbacks to isolate lifecycle.
const path = new URL('../../src/ui/Dashboard.tsx', import.meta.url)
const source = await readFile(path, 'utf8')
const ast = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let initializer
function walk(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'runTurn') initializer = node.initializer.getText(ast)
  ts.forEachChild(node, walk)
}
walk(ast)
assert.ok(initializer)
let time = 0, commits = 0, saveCalls = 0
const mountedRef = { current: true }, saveTimer = { current: null }
const game = { day: 10, year: 2026 }
const env = {
  game, mountedRef, simDayRef: { current: null },
  performance: { now: () => time }, cycleDays: () => 7,
  windowOpen: () => false, windowEnd: () => 20,
  advanceDay: g => { g.day++; time += 60; return {} },
  stopsBeforeNextMatch: () => false, fmtDay: () => '',
  handleReports: () => { commits++; saveTimer.current = 1 }, setBusy: () => {},
  window: { setTimeout: cb => { // leave mode during the first yielded day
    mountedRef.current = false
    if (saveTimer.current != null) saveCalls++ // ManagerGame flush condition
    cb()
  } },
}
const js = ts.transpileModule(`const runTurn = ${initializer}; return runTurn;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
const runTurn = new Function(...Object.keys(env), js)(...Object.values(env))
await runTurn(true)
assert.equal(game.day, 11)
assert.equal(commits, 0)
assert.equal(saveCalls, 0)
results.push({ case: 'manager_unmount_during_yield', actual: { day: game.day, commits, saveCalls },
  finding: 'Completed day mutates state, then unmount return skips handleReports/commit; parent flush sees no pending timer. Callback harness, not full browser test.' })
console.log(JSON.stringify(results, null, 2))
await writeFile(new URL('./review-repro-results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n')
