/**
 * The subset of postgres.js used by the server, over an in-process PGlite.
 * Templates bind values, sql(rows, ...columns) builds a parameterized bulk
 * insert, and begin keeps all callback queries on the same transaction.
 */
const FRAGMENT = Symbol('pglite SQL fragment')
const quoted = (name) => {
  if (typeof name !== 'string' || !name.length || name.includes('\0')) throw new Error('Invalid SQL identifier')
  return `"${name.replaceAll('"', '""')}"`
}

/**
 * Parameters the server types as json/jsonb are JSON.stringify'd, whatever they are — postgres.js does exactly
 * this (types.js serializers[114/3802]), so a string that was stringified by hand is stored as a JSON *string*.
 * PGlite's own serializer passes strings through, which hid that in every local test until the 国家队杯 pool
 * went out with its fives as strings (2026-09-27: rivals with no cards, every map 13–0).
 */
const AS_POSTGRES_JS = { 114: (x) => JSON.stringify(x), 3802: (x) => JSON.stringify(x) }

export function makeSql(db) {
  const run = (strings, ...vals) => {
    if (!Array.isArray(strings) || !Object.hasOwn(strings, 'raw')) {
      // postgres.js builders are synchronous fragments, never independent
      // database queries. Treating this call as a tag started an unhandled
      // "[object Object]" query and inserted its Promise as $1 in analytics.
      if (typeof strings === 'string' && !vals.length) {
        return { [FRAGMENT]: true, identifier: quoted(strings) }
      }
      if (!Array.isArray(strings) || !strings.length || !vals.length
        || !strings.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
        throw new Error('Expected rows and column names for SQL insert')
      }
      return { [FRAGMENT]: true, columns: vals.map(quoted), rows: strings.map((row) => vals.map((key) => row[key] ?? null)) }
    }
    const params = []
    const bind = (value) => { params.push(value); return `$${params.length}` }
    const interpolate = (value) => {
      if (!value?.[FRAGMENT]) return bind(value)
      if (value.identifier) return value.identifier
      return `(${value.columns.join(', ')}) values ${value.rows.map((row) => `(${row.map(bind).join(', ')})`).join(', ')}`
    }
    const text = strings.reduce((q, part, i) => q + part + (i < vals.length ? interpolate(vals[i]) : ''), '')
    return db.query(text, params, { serializers: AS_POSTGRES_JS }).then((r) => Object.assign(r.rows, { count: r.affectedRows ?? 0 }))
  }
  return Object.assign(run, {
    unsafe: async (q) => {
      const results = await db.exec(q)
      const r = results.at(-1)
      return Object.assign(r?.rows ?? [], { count: r?.affectedRows ?? 0 })
    },
    // postgres.js: sql.json(v) hands the value over and the json serializer encodes it once
    json: (v) => v,
    // a PGlite Transaction has query/exec but no transaction of its own, so
    // a nested begin simply runs inside the one already open
    begin: (fn) => (typeof db.transaction === 'function'
      ? db.transaction((t) => fn(makeSql(t)))
      : fn(makeSql(db))),
  })
}
