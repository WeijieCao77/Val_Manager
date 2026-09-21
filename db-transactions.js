/**
 * Reserve before BEGIN rather than relying on postgres.js's pipelined
 * onexecute hook: backpressure or a full pipeline may skip that hook.
 * All project transactions use begin(callback); no new connections are added.
 * Callbacks must await their queries and propagate failures. Unknown COMMIT
 * outcomes are returned as errors, never automatically replayed.
 */
/** How long transactions waited for a connection and how long they kept it: the last KEEP of each, in ms. */
const KEEP = 500
/**
 * How long a transaction may wait for a connection before it gives up.
 *
 * 2026-09-21: a cup's clock stopped for an hour and a half with nothing in the
 * log. `reserve()` has no deadline of its own — a caller that is never handed a
 * connection waits for ever — and the pass that was waiting on it was the
 * tournament's only clock. A transaction that has not started after half a
 * minute has already failed as far as anybody watching is concerned, so it is
 * better to say so: the caller retries, the log names the pool, and a stall
 * that used to be invisible is a line anybody can find.
 */
const RESERVE_MS = 30_000

/** A connection or an error — never a wait without end. A reservation that arrives late is handed straight back. */
function reserveWithin(pool, name) {
  const asked = pool.reserve()
  let bell = null
  const rang = new Promise((_, reject) => {
    bell = setTimeout(() => reject(new Error(`${name}: 等了 ${Math.round(RESERVE_MS / 1000)} 秒也没拿到数据库连接`)), RESERVE_MS)
    bell.unref?.()
  })
  return Promise.race([asked, rang]).then(
    (connection) => { clearTimeout(bell); return connection },
    (error) => {
      clearTimeout(bell)
      void asked.then((connection) => connection.release(), () => {})
      throw error
    },
  )
}
const pct = (values) => {
  const v = values.slice().sort((a, b) => a - b)
  const at = (p) => (v.length ? Math.round(v[Math.min(v.length - 1, Math.floor(v.length * p))] * 10) / 10 : null)
  return { n: v.length, p50: at(0.5), p95: at(0.95), max: at(1) }
}

export function safeTransactions(pool, name = 'db') {
  if (!pool?.reserve) return pool // PGlite already serializes its transactions.
  const wait = [], held = []
  let waiting = 0
  let gaveUp = 0
  pool.txStats = () => ({ waiting, gaveUp, wait: pct(wait), held: pct(held) })
  pool.begin = async (callback) => {
    if (typeof callback !== 'function') throw new TypeError('begin requires a transaction callback')
    const asked = performance.now()
    waiting++
    let connection
    try { connection = await reserveWithin(pool, name) } catch (error) {
      gaveUp++
      console.warn('db: transaction gave up —', error.message)
      throw error
    } finally { waiting-- }
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
