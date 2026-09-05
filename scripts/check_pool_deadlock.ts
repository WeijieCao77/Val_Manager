/**
 * A transaction never asks the pool for a second connection.
 *
 *   npx tsx scripts/check_pool_deadlock.ts
 *
 * 2026-09-05, 「网页卡了」: the card page sat on 正在读取卡牌账号 for everyone,
 * Postgres idle, the process alive, every database request hanging until
 * the service was restarted. The ladder match ran in a transaction — one of
 * the pool's four connections — and then fetched its rival THROUGH THE POOL,
 * which needed a second. Four matches at once held all four and each waited
 * for a fifth; everything after them queued behind the deadlock forever.
 *
 * So the rule is asserted rather than remembered: while any transaction is
 * open, a call on the pool itself is an error. The proxy below throws on
 * exactly that, and a ladder draw at a division that wants a real rival —
 * the call that deadlocked — has to complete without tripping it.
 */
process.env.ENGINE_FROM_SOURCE = '1'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
const { CARD_SCHEMA, makeCardApi, normalizeId } = await import('../cards-api.js')
void normalizeId

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const db = new PGlite()
const real = makeSql(db)
await db.exec(CARD_SCHEMA)

// the pool, watched: a tagged-template call while a transaction is open is
// the bug, wherever it comes from
let open = 0
let poolUsedInTx = 0
const spy = Object.assign(
  (...args: unknown[]) => {
    if (open > 0) { poolUsedInTx++; throw new Error('pool used inside a transaction') }
    return (real as unknown as (...a: unknown[]) => unknown)(...args)
  },
  {
    json: (real as unknown as { json: (v: unknown) => unknown }).json,
    unsafe: (real as unknown as { unsafe: (q: string) => unknown }).unsafe,
    begin: async (fn: (tx: unknown) => Promise<unknown>) => {
      open++
      try { return await (real as unknown as { begin: (f: typeof fn) => Promise<unknown> }).begin(fn) } finally { open-- }
    },
  },
)

interface Res { code: number; body: Record<string, unknown> }
const json = (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body }
const readBody = (req: { body: string }) => Promise.resolve(req.body)
const api = makeCardApi(spy, { rateLimited: () => false, readBody, json } as never)
const call = async (path: string, body: unknown): Promise<Res> => {
  const res: Res = { code: 0, body: {} }
  await api.route({ body: JSON.stringify(body), method: 'POST' } as never, res as never, path, 't')
  return res
}

const A = 'VM-AAAA-AAAA-AAAA-AAAA-AAAA'
const claimed = await call('/api/card/claim', { id: A, name: '甲', state: {} })
check('an account is created', claimed.body.ok === true, JSON.stringify(claimed.body).slice(0, 100))
// a division that wants a real opponent: the server draws one from the table
await real`update card_accounts set state = jsonb_set(state, '{ladder,div}', '5') where id_hash = ${(await import('node:crypto')).createHash('sha256').update(A).digest('hex')}`
// and some real fives to draw from
const five = (n: string) => [`${n}a`, `${n}b`, `${n}c`, `${n}d`, `${n}e`]
const withCards = (ids: string[]) => Object.fromEntries(ids.map((id, i) => [id, { id, level: i, dupes: 0, seen: 1, got: '2026-09-01' }]))
for (const [id, name, ids] of [['VM-1111-1111-1111-1111-1111', '阿伟', five('x')], ['VM-2222-2222-2222-2222-2222', '阿强', five('y')]] as [string, string, string[]][]) {
  await real`insert into card_accounts (id_hash, name, state) values (
    ${(await import('node:crypto')).createHash('sha256').update(id).digest('hex')}, ${name},
    ${JSON.stringify({ ladder: { div: 5, points: 1200, stars: 0, wins: 3, losses: 1 }, squad: { slots: ids, coach: null }, cards: withCards(ids) })})`
}
api.invalidate()

const draw = await call('/api/card/act', { id: A, action: 'ladder_draw', args: {}, client: {} })
const pending = (draw.body.result as { pending?: { rival?: unknown; club?: string } } | undefined)?.pending
check('a ladder draw at division 5 completes', draw.code === 200 && draw.body.ok === true, JSON.stringify(draw.body).slice(0, 160))
check('and it drew a real player\'s five', !!pending?.rival, JSON.stringify(pending).slice(0, 120))
check('without ever touching the pool from inside its transaction', poolUsedInTx === 0, `${poolUsedInTx} call(s)`)

// the guard itself is live: a pool call inside a transaction is caught
let caught = false
try { await spy.begin(async () => { (spy as unknown as (...a: unknown[]) => unknown)`select 1`; }) } catch { caught = true }
check('the watch would have caught the old code', caught && poolUsedInTx === 1)

// the board and the rival list answer from the cache within their window
const t0 = await call('/api/card/top', {})
const t1 = await call('/api/card/top', {})
check('the board reads the same twice inside its cache window', JSON.stringify(t0.body) === JSON.stringify(t1.body))
const r0 = await call('/api/card/rivals', { div: 5, id: A })
const list = (r0.body.rivals as { name: string }[]) ?? []
check('rivals still exclude the asker and list the others', r0.code === 200 && list.length === 2 && !list.some((x) => x.name === '甲'), list.map((x) => x.name).join(' '))

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
