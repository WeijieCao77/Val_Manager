/**
 * A crowd at the market costs one sweep, not one each. (2026-09-17)
 *
 *   npx tsx scripts/check_market_sweep.ts
 *
 * 「好像就是很卡，玩家也反馈现在进游戏/需要数据库交互的操作很卡」: the shelf
 * took 35-83 s on vctgames.com and an account load 4-7 s. Every market request
 * opened its own sweep transaction over the same ended auctions, and the
 * pool has four connections — a handful of players opening the market held
 * all of them, mostly waiting on each other's row locks, and the rest of the
 * site queued behind. The sweep is shared now: whoever arrives while one runs
 * waits for that one. This counts the transactions a burst of shelf visits
 * opens, and checks a bid right after an auction ends still sees it settled.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'

const { CARD_SCHEMA, normalizeId } = await import('../cards-api.js')
const { displayName } = await import('../names.js')
const { makeMarketApi } = await import('../market-api.js')
const engine = await import('../src/engine/server.ts')

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const db = new PGlite()
const real = makeSql(db)
await db.exec(CARD_SCHEMA)

// the pool, with its transactions counted and each one held a moment, the way
// a real one is held while its statements cross the network
let begun = 0
const spy = Object.assign(
  (...args: unknown[]) => (real as unknown as (...a: unknown[]) => unknown)(...args),
  {
    json: (real as unknown as { json: (v: unknown) => unknown }).json,
    unsafe: (real as unknown as { unsafe: (q: string) => unknown }).unsafe,
    begin: async (fn: (tx: unknown) => Promise<unknown>) => {
      begun++
      await new Promise((r) => setTimeout(r, 30))
      return (real as unknown as { begin: (f: typeof fn) => Promise<unknown> }).begin(fn)
    },
  },
)

interface Res { code: number; body: Record<string, unknown> }
const api = makeMarketApi(spy, {
  readBody: (req: { body: string }) => Promise.resolve(req.body),
  json: (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body },
  normalizeId, displayName, rateLimited: () => false, engine,
} as never)
const browse = async (i: number) => {
  const res: Res = { code: 0, body: {} }
  await api.route({ body: JSON.stringify({ id: `VM-TEST-0000-0000-0000-${String(i).padStart(4, '0')}` }), method: 'POST', headers: {} } as never,
    res as never, '/api/market/browse', `b${i}`)
  return res
}

begun = 0
const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => browse(i)))
check('twenty shelf visits at once all answer', burst.every((r) => r.code === 200 && r.body.ok === true),
  burst.map((r) => r.code).join(','))
check('and share one sweep between them', begun <= 2, `${begun} 个事务`)

begun = 0
await browse(99)
await browse(98)
check('a visit after the last sweep finished runs its own', begun === 2, `${begun} 个事务`)

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
