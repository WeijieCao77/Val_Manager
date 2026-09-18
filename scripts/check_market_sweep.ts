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
import { createHash } from 'node:crypto'
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

// ---- 2026-09-18: reading the shelf settles nothing -------------------------
// The rule this script was written for — "a crowd costs one sweep, not one
// each" — is superseded by a stronger one: a crowd costs NO sweep. Settlement
// left the request path for a bounded background settler (market-api.js
// settleDue). The two assertions that counted a shared sweep ("<= 2
// transactions", "a later visit runs its own: 2") described the old
// mechanism and would now fail by design; what replaces them is below.
const hashOf = (id: string) => createHash('sha256').update(id).digest('hex')
const SELLER = 'VM-SELL-0000-0000-0000-0001', BIDDER = 'VM-BIDS-0000-0000-0000-0002'
await real`insert into card_accounts (id_hash, name, state, created) values
  (${hashOf(SELLER)}, '卖家', ${JSON.stringify({ coins: 0, cards: {}, pulls: 99 })}, now() - interval '9 days'),
  (${hashOf(BIDDER)}, '买家', ${JSON.stringify({ coins: 0, cards: {}, pulls: 99 })}, now() - interval '9 days')`
// 1,000 auctions whose time is up — 600 with a bid standing, 400 without — and 40 still running
await real`insert into card_listings (seller_h, card_id, level, ask, ends, hours)
  select ${hashOf(SELLER)}, 'p:P1', 0, 100, now() - interval '1 minute', 24 from generate_series(1, 1000)`
await real`insert into card_offers (listing, buyer_h, price)
  select id, ${hashOf(BIDDER)}, 120 from card_listings where id % 5 < 3`
await real`insert into card_listings (seller_h, card_id, level, ask, ends, hours)
  select ${hashOf(SELLER)}, 'p:P2', 0, 100, now() + interval '3 hours', 24 from generate_series(1, 40)`

let statements = 0
const counted = Object.assign(
  (...args: unknown[]) => { statements++; return (spy as unknown as (...a: unknown[]) => unknown)(...args) },
  {
    json: spy.json, unsafe: spy.unsafe,
    // statements inside a transaction are counted too
    begin: (fn: (tx: unknown) => Promise<unknown>) => spy.begin((tx: any) => fn(Object.assign(
      (...args: unknown[]) => { statements++; return tx(...args) }, { json: tx.json ?? spy.json }))),
  },
)
const api2 = makeMarketApi(counted as never, {
  readBody: (req: { body: string }) => Promise.resolve(req.body),
  json: (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body },
  normalizeId, displayName, rateLimited: () => false, engine, timer: false,
} as never)
const browse2 = async (i: number) => {
  const res: Res = { code: 0, body: {} }
  await api2.route({ body: JSON.stringify({ id: `VM-TEST-0000-0000-0000-${String(i).padStart(4, '0')}` }), method: 'POST', headers: {} } as never,
    res as never, '/api/market/browse', `b${i}`)
  return res
}

begun = 0; statements = 0
const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => browse2(i)))
check('twenty shelf visits at once all answer', burst.every((r) => r.code === 200 && r.body.ok === true),
  burst.map((r) => r.code).join(','))
check('二十次浏览、一千个到期积压：一个结算事务都没开', begun === 0, `${begun} 个事务`)
check('每次浏览的语句数是常数，与积压无关', statements / 20 <= 8, `${(statements / 20).toFixed(1)} 条/次`)
check('到期的拍卖不在货架上，没到期的都在',
  (burst[0].body.listings as { ends: number }[]).length === 40 && burst[0].body.total === 40,
  `${(burst[0].body.listings as unknown[]).length} 张 / total ${burst[0].body.total}`)
const stillOpen = await real`select count(*)::int as n from card_listings where status = 'open' and ends <= now()`
check('浏览没有替全服结算任何一场', stillOpen[0].n === 1000, String(stillOpen[0].n))

// the settler: bounded batches, a constant number of statements a batch
begun = 0; statements = 0
const first = await api2.settleDue({ budgetMs: 0, batch: 50 })
// (the first tick of a process also runs the once-a-minute legacy chores: one more transaction, three statements)
check('结算一批 50 场：一个事务，外加每分钟一次的旧牌杂务', first === 50 && begun === 2, `${first} 场 / ${begun} 个事务`)
check('一批的语句数与场数无关（不再每场 8 条）', statements > 0 && statements <= 14, `${statements} 条 / 50 场`)
begun = 0; statements = 0
let rounds = 0
while ((await real`select 1 from card_listings where status = 'open' and ends <= now() limit 1`).length && rounds++ < 40) {
  await api2.settleDue({ budgetMs: 0, batch: 50 })
}
const closed = await real`
  select (count(*) filter (where status = 'sold'))::int as sold, (count(*) filter (where status = 'expired'))::int as unsold,
         (count(*) filter (where status = 'open' and ends <= now()))::int as due from card_listings`
check('追完积压：600 场成交、400 场流拍、无遗留', closed[0].sold === 600 && closed[0].unsold === 400 && closed[0].due === 0, JSON.stringify(closed[0]))
check('追赶全程每批一个事务', begun === rounds, `${begun} 个事务 / ${rounds} 批`)
const mailed = await real`
  select (count(*) filter (where kind = 'bought'))::int as bought, (count(*) filter (where kind = 'sold'))::int as sold,
         (count(*) filter (where kind = 'unsold'))::int as unsold, coalesce(sum(coins) filter (where kind = 'sold'), 0)::int as coins
    from card_mail`
check('每场成交一封到货、一封货款，每场流拍一封退卡，金额对',
  mailed[0].bought === 600 && mailed[0].sold === 600 && mailed[0].unsold === 400 && mailed[0].coins === 600 * 120, JSON.stringify(mailed[0]))
const offers = await real`select status, count(*)::int as n from card_offers group by status`
check('成交的出价都记为已接受，没有悬空的', offers.length === 1 && offers[0].status === 'accepted' && offers[0].n === 600, JSON.stringify(offers))

// two settlers at once (a deploy overlaps containers): no listing settled twice
await real`insert into card_listings (seller_h, card_id, level, ask, ends, hours)
  select ${hashOf(SELLER)}, 'p:P3', 0, 100, now() - interval '1 minute', 24 from generate_series(1, 120)`
const api3 = makeMarketApi(counted as never, {
  readBody: (req: { body: string }) => Promise.resolve(req.body),
  json: (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body },
  normalizeId, displayName, rateLimited: () => false, engine, timer: false,
} as never)
const [x, y] = await Promise.all([api2.settleDue({ budgetMs: 5000 }), api3.settleDue({ budgetMs: 5000 })])
const dupMail = await real`select count(*)::int as n from card_mail where kind = 'unsold' and card_id = 'p:P3'`
check('两个进程同时结算：120 场各结一次', (x as number) + (y as number) === 120 && dupMail[0].n === 120, `${x} + ${y}，退卡信 ${dupMail[0].n}`)

// a row that cannot be settled does not hold the others back
await real`insert into card_listings (seller_h, card_id, level, ask, ends, hours)
  select ${hashOf(SELLER)}, 'p:P4', 0, 100, now() - interval '1 minute', 24 from generate_series(1, 5)`
const poison = (await real`select id from card_listings where card_id = 'p:P4' order by id limit 1`)[0].id
let poisoned = 0
const sick = Object.assign(
  (strings: TemplateStringsArray, ...vals: unknown[]) => (real as any)(strings, ...vals),
  {
    json: (real as any).json, unsafe: (real as any).unsafe,
    begin: (fn: (tx: unknown) => Promise<unknown>) => (real as any).begin((tx: any) => {
      const wrapped = Object.assign((st: TemplateStringsArray, ...v: unknown[]) => {
        const out = tx(st, ...v)
        if (/insert into card_mail/.test(st.join('?')) && v.map(String).join(' ').includes(`"listing":"${poison}"`)) {
          poisoned++
          return Promise.resolve(out).then(() => { throw new Error('这一行坏了') })
        }
        return out
      }, { json: tx.json ?? (real as any).json })
      return fn(wrapped)
    }),
  },
)
const api4 = makeMarketApi(sick as never, {
  readBody: (req: { body: string }) => Promise.resolve(req.body),
  json: (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body },
  normalizeId, displayName, rateLimited: () => false, engine, timer: false,
} as never)
// Fault isolation needs a positive retry budget; zero explicitly skips retries.
const healed = await api4.settleDue({ budgetMs: 5000 })
const left = await real`select id from card_listings where card_id = 'p:P4' and status = 'open'`
check('一行结算失败：其余四场照常结，坏的那场原样留着下次再试',
  healed === 4 && left.length === 1 && String(left[0].id) === String(poison) && poisoned >= 2, `${healed} 场，剩 ${left.length}`)
check('失败那场没有留下半笔：没有退卡信', (await real`select count(*)::int as n from card_mail where body->>'listing' = ${String(poison)}`)[0].n === 0)
const later = await api2.settleDue({ budgetMs: 0 })
check('故障过去后下一轮补上', later === 1 && (await real`select count(*)::int as n from card_mail where body->>'listing' = ${String(poison)}`)[0].n === 1)

// a bid on an auction whose time is up is refused by the bid itself — it never needed the sweep for that
await real`update card_accounts set state = jsonb_set(state, '{coins}', '5000') where id_hash = ${hashOf(BIDDER)}`
await real`insert into card_listings (seller_h, card_id, level, ask, ends, hours) values (${hashOf(SELLER)}, 'p:P5', 0, 100, now() - interval '2 seconds', 24)`
const late = (await real`select id from card_listings where card_id = 'p:P5'`)[0].id
const res: Res = { code: 0, body: {} }
await api2.route({ body: JSON.stringify({ id: BIDDER, listing: String(late), price: 150 }), method: 'POST', headers: {} } as never, res as never, '/api/market/offer', 'late')
const bidderCoins = (await real`select (state->>'coins')::int as c from card_accounts where id_hash = ${hashOf(BIDDER)}`)[0].c
check('到期未结的拍卖不能再出价，金币不动', res.body.ok === false && res.body.gone === true && bidderCoins === 5000, JSON.stringify(res.body))

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
