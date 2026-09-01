/**
 * The same account on two domains, and the evening that disappeared.
 *
 *   npx tsx scripts/check_two_origins.ts
 *
 * Reported with screenshots: 大师 48 分 and three friend matches played on
 * val-manager-production.up.railway.app, then the account opened on
 * vctgames.com and the ladder back at 大师 0 / 35–10 with an empty friend
 * record — and the LEADERBOARD showing 35–10 too, so the server itself had
 * gone backwards. A stale save was accepted.
 *
 * The two domains are one service and one database, but they are two ORIGINS,
 * so each has its own localStorage and therefore its own mirror, its own
 * module state and its own idea of the current revision. Everything that
 * protects one device from another has to survive that, and this drives the
 * real client module twice — once per origin — against the real routes to find
 * out whether it does.
 *
 * Each origin is a separate import of engine/account.ts (the module keeps
 * `rev` in a closure, so two copies is the only honest way to model two tabs).
 */
import { PGlite } from '@electric-sql/pglite'
import { CARD_SCHEMA, makeCardApi } from '../cards-api.js'

const db = new PGlite()
const sql = Object.assign(
  async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const text = strings.reduce((q, part, i) => q + part + (i < vals.length ? `$${i + 1}` : ''), '')
    const r = await db.query(text, vals as never[])
    return Object.assign(r.rows as never[], { count: r.affectedRows ?? 0 })
  },
  { unsafe: async (q: string) => (await db.exec(q), []), json: (v: unknown) => JSON.stringify(v) },
)
await db.exec(CARD_SCHEMA)

interface Res { code: number; body: Record<string, unknown> }
const routes = makeCardApi(sql, {
  rateLimited: () => false,
  readBody: (req: { body: string }) => Promise.resolve(req.body),
  json: (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body },
} as never)

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const settle = () => new Promise((r) => setTimeout(r, 60))

// ---- two origins --------------------------------------------------------

type Store = Map<string, string>
const g = globalThis as Record<string, unknown>
g.window = globalThis
let store: Store = new Map()
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}
Object.defineProperty(globalThis, 'navigator', {
  configurable: true, value: {},   // no sendBeacon: every flush goes down fetch
})
g.fetch = async (url: string, init?: { body?: string }) => {
  const res: Res = { code: 0, body: {} }
  await routes.route({ body: init?.body ?? '{}' } as never, res as never,
    String(url).replace(/^.*(\/api\/card\/\w+)$/, '$1'), 'test')
  return { ok: res.code < 400, status: res.code, json: async () => res.body }
}

/** One origin: its own localStorage and its own copy of the client. */
async function openOrigin(name: string) {
  const mine: Store = new Map()
  // a fresh module instance — `rev` and the debounce timer are per-origin
  const mod = await import(`../src/engine/account.ts?origin=${name}`)
  const enter = () => { store = mine }
  return { name, store: mine, mod, enter }
}

const railway = await openOrigin('railway')
const vct = await openOrigin('vct')

const serverState = async (id: string) => {
  const res: Res = { code: 0, body: {} }
  await routes.route({ body: JSON.stringify({ id }) } as never, res as never, '/api/card/load', 'peek')
  return res.body.state as Record<string, unknown> | undefined
}
const serverWins = async (id: string) => {
  const st = await serverState(id) as { wins?: number; ladder?: { wins?: number } } | undefined
  return Number(st?.ladder?.wins ?? st?.wins ?? -1)
}

// ---- the evening, as reported -------------------------------------------

railway.enter()
const made = await railway.mod.createAccount('diandian')
const ID = made.state.id as string
const st = made.state as unknown as Record<string, unknown>
// the ladder record is where wins actually live — the same field the report's
// screenshots show as 35–10
st.ladder = { div: 5, points: 0, stars: 0, best: 5, wins: 35, losses: 10, streak: 0 }
st.log = []
railway.mod.saveAccount(made.state, true)
await settle()
check('开局：服务器上是 35 胜', (await serverWins(ID)) === 35)

// the account is opened on the other domain and played there too — this is
// what leaves a stale copy sitting in vctgames.com's own localStorage
vct.enter()
const onVct = await vct.mod.loadAccount(ID)
check('另一个域名读到的是同一个账号',
  onVct.ok && (onVct.state as { ladder?: { wins?: number } }).ladder?.wins === 35)
// he leaves that tab open and goes away: flushAccount is what a hidden tab does
vct.mod.flushAccount(onVct.state)
await settle()

// ---- now the evening on railway -----------------------------------------
railway.enter()
;(st.ladder as { wins: number; points: number }).wins = 37
;(st.ladder as { wins: number; points: number }).points = 48
st.friends = [{ code: 'aaaa1111', name: '胡兴旺', tag: '#EAED', wins: 1, losses: 0, at: '2026-09-01' }]
railway.mod.saveAccount(made.state, true)
await settle()
check('railway 上打到 37 胜，还有一条好友战绩',
  (await serverWins(ID)) === 37
  && ((await serverState(ID))?.friends as unknown[])?.length === 1)

// ---- he clicks back to the vctgames tab that was left open --------------
//
// It never reloads: the tab is still holding the 35-win state from before, and
// coming back to the front is exactly when retryPending fires.
vct.enter()
let staleShown: Record<string, unknown> | null = null
vct.mod.whenStale((fresh: Record<string, unknown>) => { staleShown = fresh })
vct.mod.retryPending(onVct.state)
await settle()

const after = await serverWins(ID)
console.log(`\n切回旧标签页之后，服务器上是 ${after} 胜`)
check('旧标签页不能把服务器写回去', after === 37, `${after} 胜（应为 37）`)
check('好友战绩还在',
  ((await serverState(ID))?.friends as unknown[])?.length === 1,
  JSON.stringify((await serverState(ID))?.friends))
const shownWins = (staleShown as { ladder?: { wins?: number } } | null)?.ladder?.wins
check('旧标签页自己被拉到最新进度', shownWins === 37,
  staleShown ? String(shownWins) : '没收到 stale 回调')

// ---- and the same tab saving again afterwards ---------------------------
//
// Having been told it was stale, it must not then be allowed to write the copy
// it was holding — the adoption has to reach the object the tab is using.
vct.mod.saveAccount(onVct.state, true)
await settle()
check('被告知落后之后，它再存一次也不会覆盖', (await serverWins(ID)) === 37,
  `${await serverWins(ID)} 胜`)

// ---- a client that never learned a revision -----------------------------
//
// baseRev travels with every save and the server compares it against the row.
// A null one used to mean "write anyway", which is a door with no lock on it.
{
  const res: Res = { code: 0, body: {} }
  await routes.route({
    body: JSON.stringify({ id: ID, name: 'x', state: { wins: 1, cards: {} } }),
  } as never, res as never, '/api/card/save', 'test')
  const now = await serverWins(ID)
  check('没带版本号的存档不能覆盖别人的进度', now === 37,
    `写完之后是 ${now} 胜，返回 ${res.code}`)
}

// ---- the things that legitimately go DOWN ------------------------------
//
// The invariant is only safe if every term it measures is genuinely monotonic.
// Two were not, and each would have refused an ordinary save from an ordinary
// player rather than a stale one from a forgotten tab.
{
  const { progressOf } = await import('../progress.js')
  // a player coming back after a week: the check-in resets his streak to 1
  const before = { pulls: 40, ladder: { wins: 3, losses: 1 }, cards: { a: 1 }, daily: { streak: 7 } }
  const after = { ...before, daily: { streak: 1 } }
  check('断签把连签清成 1，不能算成「进度倒退」',
    progressOf(after) >= progressOf(before),
    `${progressOf(before)} → ${progressOf(after)}`)

  // the friend list is capped: the twenty-fifth friend pushes the oldest out
  const full = {
    pulls: 40, cards: { a: 1 },
    friends: Array.from({ length: 24 }, (_, i) => ({ code: `c${i}`, wins: 5, losses: 5 })),
  }
  const rolled = {
    ...full,
    friends: [{ code: 'new', wins: 1, losses: 0 }, ...full.friends.slice(0, 23)],
  }
  check('好友列表满了之后挤掉最老的一条，也不能算倒退',
    progressOf(rolled) >= progressOf(full),
    `${progressOf(full)} → ${progressOf(rolled)}`)

  // and the things that must count
  check('多开一个包算进度', progressOf({ pulls: 2 }) > progressOf({ pulls: 1 }))
  check('多打一场天梯算进度',
    progressOf({ ladder: { wins: 1, losses: 1 } }) > progressOf({ ladder: { wins: 1, losses: 0 } }))
  // Cards deliberately do NOT count any more: listing one on the trading post
  // puts it in escrow and takes it off your side, and selling the 彩卡 you do
  // not want in order to keep opening packs is the point of that market.
  // Counting them would make every such sale look like a rollback.
  check(progressOf({ cards: { a: 1, b: 1 } }) === progressOf({ cards: { a: 1 } }),
    '卡的张数不算进度——挂牌卖卡会让它变少，那不是倒退')
  check(progressOf({ pulls: 2, cards: {} }) > progressOf({ pulls: 1, cards: { a: 1, b: 1, c: 1 } }),
    '抽卡次数才是主心骨：开得多的那份更新，哪怕卡更少')
  check('多一个好友战绩算进度',
    progressOf({ friends: [{}, {}] }) > progressOf({ friends: [{}] }))
  check('金币不算进度——花掉了不等于倒退',
    progressOf({ coins: 1 }) === progressOf({ coins: 99999 }))
}

// ---- a real returning player is not locked out -------------------------
{
  const st2 = onVct.state as unknown as Record<string, unknown>
  st2.ladder = { div: 5, points: 48, stars: 0, best: 5, wins: 37, losses: 10, streak: 0 }
  st2.pulls = 1
  st2.daily = { streak: 7, claimed: null, questDay: null, picked: [], progress: {}, taken: [] }
  vct.mod.saveAccount(onVct.state, true)
  await settle()
  const kept = (await serverState(ID)) as { daily?: { streak?: number } }
  check('连签 7 天的存档存得进去', kept?.daily?.streak === 7, JSON.stringify(kept?.daily?.streak))
  // now he misses a day and checks in again: streak 7 → 1, and one more pull
  ;(st2.daily as { streak: number }).streak = 1
  st2.pulls = 2
  vct.mod.saveAccount(onVct.state, true)
  await settle()
  const back = (await serverState(ID)) as { daily?: { streak?: number } }
  check('隔了一周回来，连签清零也照样存得进去', back?.daily?.streak === 1,
    JSON.stringify(back?.daily?.streak))
}

// ---- recovering an evening that was already lost ------------------------
//
// The incident happened before the fix shipped, so the server is holding the
// clobbered copy. The device that actually played it still has the real one in
// its own localStorage, and opening that device has to hand it back rather
// than politely adopting the wreckage.
{
  const played = await openOrigin('played')
  played.enter()
  const acc = await played.mod.createAccount('受害者')
  const RID = acc.state.id as string
  const rs = acc.state as unknown as Record<string, unknown>
  rs.pulls = 30
  rs.ladder = { div: 5, points: 48, stars: 0, best: 5, wins: 37, losses: 10, streak: 3 }
  rs.friends = [
    { code: 'a1', name: '胡兴旺', tag: '#EAED', wins: 1, losses: 0, at: '2026-09-01' },
    { code: 'a2', name: '冷水鱼', tag: '#6C19', wins: 1, losses: 0, at: '2026-09-01' },
  ]
  played.mod.saveAccount(acc.state, true)
  await settle()
  check('这台设备打到了 37 胜、大师 48 分、两条好友战绩',
    (await serverWins(RID)) === 37)

  // the clobber, by hand, exactly as the bug produced it
  await sql`update card_accounts set state = ${sql.json({
    pulls: 30, cards: {},
    ladder: { div: 5, points: 0, stars: 0, best: 5, wins: 35, losses: 10, streak: 0 },
    friends: [],
    daily: { claimed: null, streak: 1, questDay: null, picked: [], progress: {}, taken: [] },
  })}, rev = rev + 1 where id_hash = (select id_hash from card_accounts order by created desc limit 1)`
  check('服务器被一个旧标签页覆盖成了 35 胜、大师 0、没有好友战绩',
    (await serverWins(RID)) === 35)

  // he opens the machine he actually played on
  played.enter()
  const back = await played.mod.loadAccount(RID)
  await settle()
  const st3 = back.state as { ladder?: { wins?: number; points?: number }; friends?: unknown[] }
  check('在真正打过的那台设备上重新打开，进度回来了', st3?.ladder?.wins === 37,
    String(st3?.ladder?.wins))
  check('大师分也回来了', st3?.ladder?.points === 48, String(st3?.ladder?.points))
  check('两条好友战绩都回来了', st3?.friends?.length === 2, String(st3?.friends?.length))
  check('并且推回了服务器', (await serverWins(RID)) === 37, `${await serverWins(RID)} 胜`)
  check('界面会告诉他这件事发生过', back.recovered === true, String(back.recovered))
}

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
