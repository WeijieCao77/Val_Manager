// Second review: warm-cache recovery and failed-save dirty flag.
// node --import tsx docs/performance-audit-2026-10-05/recheck-repro.mjs
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
import { makeSql } from '../../pglite-sql.js'
import { projectionSchema, backfill, projectionClean } from '../../account-projection.js'
process.env.ENGINE_FROM_SOURCE = '1'
const { CARD_SCHEMA, BOARDS, engine, serverDay, makeCardApi } = await import('../../cards-api.js')
const db = new PGlite(), sql = makeSql(db)
await db.exec(CARD_SCHEMA)
await db.exec(projectionSchema(BOARDS))
const state = { season: engine.seasonOf(serverDay()), ladder: { div: 3, points: 7, stars: 0, wins: 1, losses: 0 },
  squad: { slots: ['a','b','c','d','e'], coach: 'f' }, cards: { a: { level: 1 } } }
await sql`insert into card_accounts (id_hash,state,name,ladder_at) values (${'a'.repeat(64)},${sql.json(state)},'review',now())`
await backfill(sql, { pause: 0 })
const api = makeCardApi(sql, {
  rateLimited: () => false, readBody: req => Promise.resolve(req.body),
  json: (res, code, body) => { res.code = code; res.body = body }, slow: sql,
})
async function route(path, body = {}) {
  const res = {}
  await api.route({ method: 'POST', body: JSON.stringify(body) }, res, path, 'review')
  assert.equal(res.code, 200)
  return res.body
}
const results = []
const realNow = Date.now
let now = realNow()
Date.now = () => now
try {
  await route('/api/card/top') // warm same API instance, including clean status
  const warm = await route('/api/card/rivals', { div: 3 })
  assert.equal(warm.rivals.length, 1)
  await db.exec('alter table account_rivals add constraint review_fault check (points < 1000) not valid')
  await sql`update card_accounts set state = ${sql.json({ ...state, ladder: { ...state.ladder, points: 5000 } })}, suspect=true where id_hash=${'a'.repeat(64)}`
  await db.exec('alter table account_rivals drop constraint review_fault')
  assert.equal(await projectionClean(sql), false)
  now += 6000 // beyond clean-status TTL, inside rival cache TTL
  const pending = await route('/api/card/rivals', { div: 3 })
  const dirtyAfterRival = !(await projectionClean(sql))
  assert.equal(pending.rivals.length, 1)
  assert.equal(dirtyAfterRival, true)
  const board = await route('/api/card/top') // forces detection and repair
  assert.equal(board.rows.length, 0)
  for (let i=0; i<100 && !(await projectionClean(sql)); i++) await new Promise(r => setTimeout(r, 20))
  assert.equal(await projectionClean(sql), true)
  const after = await route('/api/card/rivals', { div: 3 })
  assert.equal(after.rivals.length, 1)
  results.push({ case: 'warm_rival_cache_after_failure_and_repair', pendingRivals: pending.rivals.length,
    dirtyAfterRival, repaired: true, rivalsAfterRepair: after.rivals.length,
    expected: 'Flagged account excluded while dirty and after repair; cached rivals bypass health check and survive repair.' })
} finally { Date.now = realNow; await db.close() }

// Execute actual saveNow callback with a transient storage failure, then
// simulate later flush after storage is usable. No copied save implementation.
const source = await readFile(new URL('../../src/ManagerGame.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('ManagerGame.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let fn
function walk(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'saveNow') fn = node.initializer.arguments[0].getText(ast)
  ts.forEachChild(node, walk)
}
walk(ast)
assert.ok(fn)
const dirtyRef = { current: true }, saveTimer = { current: null }
let attempts = 0, fail = true
const env = { dirtyRef, saveTimer, gameRef: { current: { day: 11, year: 2026 } },
  autosave: () => { attempts++; if (fail) throw new Error('temporary storage failure'); return 'ok' },
  setSaveWarn: () => {}, sizeSentRef: { current: true }, warnedSaveRef: { current: true },
  track: () => {}, packState: () => '{}', window: { clearTimeout: () => {} },
}
const js = ts.transpileModule(`const saveNow = ${fn}; return saveNow;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
const saveNow = new Function(...Object.keys(env), js)(...Object.values(env))
saveNow()
assert.equal(dirtyRef.current, false)
fail = false
if (saveTimer.current != null || dirtyRef.current) saveNow()
assert.equal(attempts, 1)
results.push({ case: 'failed_save_drops_dirty_flag', attempts, dirtyAfterFailure: dirtyRef.current,
  expected: 'Keep dirty flag until successful persistence, so later visibility/unmount flush can retry.' })
console.log(JSON.stringify(results, null, 2))
await writeFile(new URL('./recheck-repro-results.json', import.meta.url), JSON.stringify(results, null, 2)+'\n')
