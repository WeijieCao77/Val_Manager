/**
 * A postgres.js-shaped `sql` over an in-process PGlite.
 *
 * The server and the check scripts run the real card and market code
 * against a database that lives in the process. It has to answer the way
 * postgres.js answers — a tagged template, `.json`, `.unsafe` — and, since
 * the market moves cards and coins in several statements, `.begin` too: a
 * callback gets a `sql` bound to one transaction, and a throw inside it
 * rolls everything back. Without that the shim would pass tests the
 * production driver could fail, or the other way round.
 */
export function makeSql(db) {
  const run = async (strings, ...vals) => {
    const text = strings.reduce((q, part, i) => q + part + (i < vals.length ? `$${i + 1}` : ''), '')
    const r = await db.query(text, vals)
    return Object.assign(r.rows, { count: r.affectedRows ?? 0 })
  }
  return Object.assign(run, {
    unsafe: async (q) => (await db.exec(q), []),
    json: (v) => JSON.stringify(v),
    // a PGlite Transaction has query/exec but no transaction of its own, so
    // a nested begin simply runs inside the one already open
    begin: (fn) => (typeof db.transaction === 'function'
      ? db.transaction((t) => fn(makeSql(t)))
      : fn(makeSql(db))),
  })
}
