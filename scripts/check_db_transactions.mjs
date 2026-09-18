import assert from 'node:assert/strict'
import { safeTransactions } from '../db-transactions.js'
function fixture({ fail = null, aborted = false, reserveFails = false } = {}) {
  const calls = []
  const connection = { unsafe: async command => {
    calls.push(command)
    if (command === fail) throw new Error(`failed ${command}`)
    return { command: command === 'COMMIT' && aborted ? 'ROLLBACK' : command }
  }, release: () => calls.push('release') }
  const pool = safeTransactions({ reserve: async () => {
    calls.push('reserve')
    if (reserveFails) throw new Error('cannot reserve')
    return connection
  } })
  return { pool, calls }
}
{
  const { pool, calls } = fixture()
  assert.equal(await pool.begin(async tx => { await tx.unsafe('SELECT fixture'); return 42 }), 42)
  assert.deepEqual(calls, ['reserve', 'BEGIN', 'SELECT fixture', 'COMMIT', 'release'])
}
{
  const { pool, calls } = fixture()
  await assert.rejects(pool.begin(async () => { throw new Error('callback failed') }), /callback failed/)
  assert.deepEqual(calls, ['reserve', 'BEGIN', 'ROLLBACK', 'release'])
}
for (const command of ['BEGIN', 'COMMIT']) {
  const { pool, calls } = fixture({ fail: command })
  await assert.rejects(pool.begin(async () => 42), new RegExp(`failed ${command}`))
  assert.equal(calls.filter(x => x === 'release').length, 1)
  assert.equal(calls.filter(x => x === 'BEGIN').length, 1) // no blind retry
}
{
  const { pool, calls } = fixture({ aborted: true })
  await assert.rejects(pool.begin(async () => 42), /aborted/)
  assert.equal(calls.at(-1), 'release')
}
{
  const { pool, calls } = fixture({ reserveFails: true })
  await assert.rejects(pool.begin(() => assert.fail('callback must not run')), /cannot reserve/)
  assert.deepEqual(calls, ['reserve'])
}
{
  const { pool, calls } = fixture()
  assert.deepEqual(await pool.begin(() => [Promise.resolve(1), Promise.resolve(2)]), [1, 2])
  assert.equal(calls.at(-1), 'release')
}
const pglite = { begin: () => 'native' }
assert.equal(safeTransactions(pglite), pglite)
assert.equal(pglite.begin(), 'native')
console.log('safeTransactions: success, rollback, failed BEGIN/COMMIT, aborted transaction, reservation failure, array callback and PGlite compatibility passed')
