/**
 * Reserve before BEGIN rather than relying on postgres.js's pipelined
 * onexecute hook: backpressure or a full pipeline may skip that hook.
 * All project transactions use begin(callback); no new connections are added.
 * Callbacks must await their queries and propagate failures. Unknown COMMIT
 * outcomes are returned as errors, never automatically replayed.
 */
/** How long transactions waited for a connection and how long they kept it: the last KEEP of each, in ms. */
const KEEP = 500
const pct = (values) => {
  const v = values.slice().sort((a, b) => a - b)
  const at = (p) => (v.length ? Math.round(v[Math.min(v.length - 1, Math.floor(v.length * p))] * 10) / 10 : null)
  return { n: v.length, p50: at(0.5), p95: at(0.95), max: at(1) }
}

export function safeTransactions(pool) {
  if (!pool?.reserve) return pool // PGlite already serializes its transactions.
  const wait = [], held = []
  let waiting = 0
  pool.txStats = () => ({ waiting, wait: pct(wait), held: pct(held) })
  pool.begin = async (callback) => {
    if (typeof callback !== 'function') throw new TypeError('begin requires a transaction callback')
    const asked = performance.now()
    waiting++
    let connection
    try { connection = await pool.reserve() } finally { waiting-- }
    const granted = performance.now()
    wait.push(granted - asked)
    if (wait.length > KEEP) wait.shift()
    try {
      await connection.unsafe('BEGIN')
      const work = callback(connection)
      const result = await (Array.isArray(work) ? Promise.all(work) : work)
      const commit = await connection.unsafe('COMMIT')
      // PostgreSQL returns ROLLBACK for COMMIT after a swallowed query error.
      if (commit.command === 'ROLLBACK') throw new Error('Transaction was aborted before commit')
      return result
    } catch (error) {
      try { await connection.unsafe('ROLLBACK') } catch { /* retain original/unknown outcome */ }
      throw error
    } finally {
      held.push(performance.now() - granted)
      if (held.length > KEEP) held.shift()
      connection.release()
    }
  }
  return pool
}
