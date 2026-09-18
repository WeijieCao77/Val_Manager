/**
 * Reserve before BEGIN rather than relying on postgres.js's pipelined
 * onexecute hook: backpressure or a full pipeline may skip that hook.
 * All project transactions use begin(callback); no new connections are added.
 * Callbacks must await their queries and propagate failures. Unknown COMMIT
 * outcomes are returned as errors, never automatically replayed.
 */
export function safeTransactions(pool) {
  if (!pool?.reserve) return pool // PGlite already serializes its transactions.
  pool.begin = async (callback) => {
    if (typeof callback !== 'function') throw new TypeError('begin requires a transaction callback')
    const connection = await pool.reserve()
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
      connection.release()
    }
  }
  return pool
}
