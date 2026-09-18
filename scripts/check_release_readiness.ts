/** Readiness must inspect actual release columns and valid global uniqueness, not schema marks alone. */
process.env.ENGINE_FROM_SOURCE = '1'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { SCHEMAS } from '../db-schema.js'
import { releaseFeatures, REQUIRED_COLUMNS, REQUIRED_UNIQUE } from '../release-readiness.js'
const db = new PGlite()
const sql = makeSql(db)
const ready = async (connection = sql) => Object.values(await releaseFeatures(connection)).every(Boolean)
let checked = 0
const restored = Symbol('rollback fixture')
async function rollbackFixture(run: (tx: typeof sql) => Promise<void>) {
  try {
    await sql.begin(async (tx: typeof sql) => { await run(tx); throw restored })
  } catch (error) { if (error !== restored) throw error }
  assert.equal(await ready(), true, 'fixture rollback must restore ready state')
}
try {
  for (const schema of SCHEMAS) await db.exec(schema)
  assert.equal(await ready(), true, 'full real schema must be ready')
  checked++
  // Exercise every required column, including whatever new archival columns this release declares.
  for (const qualified of new Set(Object.values(REQUIRED_COLUMNS).flat())) {
    const [table, column] = qualified.split('.')
    assert.match(table, /^\w+$/); assert.match(column, /^\w+$/)
    await rollbackFixture(async tx => {
      await tx.unsafe(`alter table "${table}" drop column "${column}" cascade`)
      assert.equal(await ready(tx), false, `missing ${qualified} must fail readiness`)
    })
    checked++
  }
  for (const [feature, [table, keys]] of Object.entries(REQUIRED_UNIQUE)) {
    await rollbackFixture(async tx => {
      const constraints = await tx.unsafe(`select conname from pg_constraint where conrelid = 'public.${table}'::regclass and contype in ('p','u')`)
      assert(constraints.length > 0, `${table} fixture must have a real primary/unique constraint`)
      for (const row of constraints) await tx.unsafe(`alter table "${table}" drop constraint "${row.conname}" cascade`)
      let features = await releaseFeatures(tx)
      assert.equal(features[feature], false, `missing ${feature} must fail readiness`)
      assert.equal(Object.values(features).every(Boolean), false)
      // Same columns but only some rows: cannot protect ON CONFLICT or global deduplication.
      await tx.unsafe(`create unique index readiness_partial_fixture on "${table}" (${keys.split(',').map(k => `"${k}"`).join(',')}) where ${keys.split(',')[0]} is not null`)
      features = await releaseFeatures(tx)
      assert.equal(features[feature], false, `${feature}: partial unique index must not pass`)
    })
    checked++
  }
  await rollbackFixture(async tx => {
    await tx.unsafe('drop table open_cup_payouts cascade')
    assert.equal(await ready(tx), false, 'missing payout table must fail readiness')
  })
  checked++
  // Catalog failure must reject, never return an empty feature map interpreted as ready.
  await assert.rejects(releaseFeatures({ unsafe: async () => { throw new Error('catalog unavailable') } }), /catalog unavailable/)
  checked++
  console.log(`release readiness: ${checked} actual-schema, missing-column, uniqueness and failure fixtures passed`)
} finally { await db.close() }
