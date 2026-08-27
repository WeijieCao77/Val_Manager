/**
 * The card account endpoints, against a real Postgres.
 *
 * These four routes are the only place this game writes anything to a server
 * on a player's behalf, and the id they take IS the password — so the parts
 * worth getting wrong are exactly the parts worth testing: that a claim cannot
 * silently take over somebody else's collection, that the raw id never reaches
 * the table, that a mistyped id still resolves, and that a save dated in the
 * future is refused rather than freezing that account's streak.
 *
 *   npx tsx scripts/check_cards_api.ts
 */
import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { CARD_SCHEMA, makeCardApi, normalizeId, serverDay, vetState } from '../cards-api.js'

const db = new PGlite()
const sql = Object.assign(
  async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const text = strings.reduce((q, part, i) => q + part + (i < vals.length ? `$${i + 1}` : ''), '')
    const r = await db.query(text, vals as never[])
    return Object.assign(r.rows as never[], { count: r.affectedRows ?? 0 })
  },
  {
    unsafe: async (q: string) => (await db.exec(q), []),
    json: (v: unknown) => JSON.stringify(v),
  },
)
await db.exec(CARD_SCHEMA)

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

// ---- the harness the routes expect ------------------------------------

const rateHits = new Map<string, number>()
const rateLimited = (key: string, max = 60) => {
  const n = (rateHits.get(key) ?? 0) + 1
  rateHits.set(key, n)
  return n > max
}
const readBody = (req: { body: string }, limit: number) =>
  new Promise<string>((resolve, reject) => {
    if (req.body.length > limit) { reject(new Error('too large')); return }
    resolve(req.body)
  })

interface Res { code: number; body: Record<string, unknown> }
const json = (res: Res, code: number, body: Record<string, unknown>) => {
  res.code = code
  res.body = body
}

const api = makeCardApi(sql, { rateLimited, readBody, json } as never)

async function call(path: string, body: unknown, bucket = 'test'): Promise<Res> {
  const res: Res = { code: 0, body: {} }
  const req = { body: JSON.stringify(body), method: 'POST' }
  await api.route(req as never, res as never, path, bucket)
  return res
}

// ---- id handling ------------------------------------------------------

const ID = 'VM-ABCD-EFGH-JKMN-PQRS-TVWX'
check('id round-trips', normalizeId(ID) === ID)
check('id accepts lowercase and spaces', normalizeId('vm abcd efgh jkmn pqrs tvwx') === ID)
check('id accepts no separators', normalizeId('VMABCDEFGHJKMNPQRSTVWX') === ID)
check('O/I/L/U read as 0/1/1/V',
  normalizeId('VM-0O0O-1I1L-UUUU-2222-3333') === 'VM-0000-1111-VVVV-2222-3333')
check('short id refused', normalizeId('VM-ABCD') === null)
check('junk refused', normalizeId('') === null)

// ---- claim / load / save ---------------------------------------------

const state = { version: 1, id: ID, coins: 3000, cards: {}, daily: { claimed: null } }

let r = await call('/api/card/claim', { id: ID, name: '点点', state })
check('claim creates the account', r.code === 200 && r.body.ok === true, `code ${r.code}`)

r = await call('/api/card/claim', { id: ID, name: 'someone else', state: { ...state, coins: 9 } })
check('a second claim on the same id is refused, not an overwrite',
  r.code === 409 && r.body.taken === true, `code ${r.code}`)

r = await call('/api/card/load', { id: ID })
check('load returns what was claimed',
  r.body.ok === true && (r.body.state as { coins: number }).coins === 3000)
check('load carries the server date', typeof r.body.today === 'string' && r.body.today === serverDay())

r = await call('/api/card/save', { id: ID, state: { ...state, coins: 4200 } })
check('save bumps the revision', r.body.ok === true && r.body.rev === 2, `rev ${r.body.rev}`)

r = await call('/api/card/load', { id: 'vm abcd efgh jkmn pqrs tvwx' })
check('a sloppily typed id still finds the account',
  r.body.ok === true && (r.body.state as { coins: number }).coins === 4200)

r = await call('/api/card/load', { id: 'VM-1111-1111-1111-1111-1111' })
check('an unknown id is a miss, not an error', r.code === 200 && r.body.missing === true)

r = await call('/api/card/load', { id: 'nonsense' })
check('a malformed id is rejected', r.body.bad === true)

// ---- what the table actually holds ------------------------------------

const rows = await sql`select id_hash, rev, name from card_accounts`
check('one row per account', rows.length === 1, `${rows.length} rows`)
check('the id itself is never stored, only its hash',
  (rows[0] as { id_hash: string }).id_hash === createHash('sha256').update(ID).digest('hex'))
const dump = JSON.stringify(await sql`select * from card_accounts`)
check('the raw id appears nowhere in the table', !dump.includes(ID))

// ---- the two things that would break the server ------------------------

const future = new Date()
future.setFullYear(future.getFullYear() + 1)
check('a check-in dated in the future is refused',
  vetState({ daily: { claimed: future.toISOString().slice(0, 10) } }, serverDay()) === null)
check('a past check-in is fine',
  vetState({ daily: { claimed: '2020-01-01' } }, serverDay()) !== null)
check('an oversized save is refused',
  vetState({ blob: 'x'.repeat(600 * 1024) }, serverDay()) === null)
check('a non-object save is refused', vetState([1, 2, 3], serverDay()) === null)

r = await call('/api/card/save', { id: ID, state: { daily: { claimed: '2099-01-01' } } })
check('the save route refuses it too', r.code === 400 && r.body.why === 'state')

r = await call('/api/card/load', { id: ID })
check('the refused save did not land',
  (r.body.state as { coins: number }).coins === 4200)

// ---- brute force ------------------------------------------------------

rateHits.clear()
let limited = 0
for (let i = 0; i < 60; i++) {
  const g = await call('/api/card/load', { id: 'VM-2222-2222-2222-2222-2222' }, 'attacker')
  if (g.code === 429) limited++
}
check('guessing gets rate limited', limited >= 15, `${limited}/60 refused`)

// ---- no database ------------------------------------------------------

const offlineApi = makeCardApi(null, { rateLimited, readBody, json } as never)
const res: Res = { code: 0, body: {} }
await offlineApi.route({ body: '{}', method: 'POST' } as never, res as never, '/api/card/load', 'x')
check('without a database the route says so instead of throwing',
  res.body.offline === true && typeof res.body.today === 'string')

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
