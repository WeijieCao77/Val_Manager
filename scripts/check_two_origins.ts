/**
 * The same account on two domains, and the evening that can no longer
 * disappear.
 *
 *   npx tsx scripts/check_two_origins.ts
 *
 * The incident: 大师 48 分 and three friendlies played on one domain, then
 * the account opened on the other and the ladder back at 35–10 — a tab left
 * open on the first domain had beaconed its hour-old copy over the evening.
 *
 * Two domains are one service and one database but two ORIGINS, so each has
 * its own localStorage, its own copy of the client module and its own idea of
 * the current revision. This drives the real client twice — once per origin —
 * against the real routes. The record is the server's now, so a stale tab
 * has nothing of value to overwrite; what it can still send is a five and a
 * friend list, and those are guarded by the revision.
 */
process.env.ENGINE_FROM_SOURCE = '1'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
const { CARD_SCHEMA, makeCardApi } = await import('../cards-api.js')

const db = new PGlite()
const sql = makeSql(db)
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
  const path = String(url)
  if (path.endsWith('/day')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, today: '2026-09-02', now: Date.now(), cloud: true }) }
  }
  await routes.route({ body: init?.body ?? '{}' } as never, res as never,
    path.replace(/^.*(\/api\/card\/\w+)$/, '$1'), 'test')
  return { ok: res.code < 400, status: res.code, json: async () => res.body }
}

/** One origin: its own localStorage and its own copy of the client. */
async function openOrigin(name: string) {
  const mine: Store = new Map()
  const mod = await import(`../src/engine/account.ts?origin=${name}`)
  const enter = () => { store = mine }
  return { name, store: mine, mod, enter }
}

const railway = await openOrigin('railway')
const vct = await openOrigin('vct')

const serverState = async (id: string) => {
  const res: Res = { code: 0, body: {} }
  await routes.route({ body: JSON.stringify({ id }) } as never, res as never, '/api/card/load', 'peek')
  return res.body.state as { pulls: number; friends: unknown[]; name: string; squad: { slots: (string | null)[] } } | undefined
}

// ---- the evening, as it goes now ----------------------------------------

railway.enter()
const made = await railway.mod.createAccount('diandian')
check('账号在服务器上建好', made.ok)
if (!made.ok) process.exit(1)
const ID = made.state.id as string
const st = made.state
// two packs on railway, on the server
await railway.mod.act(st, 'open', { kind: 'scout', payWith: 'pack' })
await railway.mod.act(st, 'open', { kind: 'scout', payWith: 'pack' })
check('开局：服务器上是 2 抽', (await serverState(ID))?.pulls === 2)

// the account is opened on the other domain too — this is what leaves a stale
// copy sitting in vctgames.com's own localStorage
vct.enter()
const onVct = await vct.mod.loadAccount(ID)
check('另一个域名读到的是同一个账号', onVct.ok && onVct.state.pulls === 2)
vct.mod.flushAccount(onVct.state)
await settle()

// ---- now the evening on railway -----------------------------------------
railway.enter()
await railway.mod.act(st, 'open', { kind: 'scout', payWith: 'pack' })
st.friends = [{ code: 'aaaa1111', name: '胡兴旺', tag: '#EAED', wins: 1, losses: 0, at: '2026-09-01' }]
st.squad.slots[0] = Object.keys(st.cards)[0]
await railway.mod.saveAccount(st, true)
await settle()
check('railway 上开到 3 抽，还有一条好友战绩和一个首发',
  (await serverState(ID))?.pulls === 3 && (await serverState(ID))?.friends.length === 1
  && !!(await serverState(ID))?.squad.slots[0])

// ---- he clicks back to the vctgames tab that was left open --------------
vct.enter()
let staleShown: Record<string, unknown> | null = null
vct.mod.whenStale((fresh: Record<string, unknown>) => { staleShown = fresh })
vct.mod.retryPending(onVct.state)
await settle()

const after = await serverState(ID)
check('旧标签页不能把好友战绩和首发写回去', after?.friends.length === 1 && !!after?.squad.slots[0],
  JSON.stringify({ friends: after?.friends.length, first: after?.squad.slots[0] }))
check('抽数当然也不会动——它从来不由客户端写', after?.pulls === 3)
const shownPulls = (staleShown as { pulls?: number } | null)?.pulls
check('旧标签页自己被拉到最新进度', shownPulls === 3, staleShown ? String(shownPulls) : '没收到 stale 回调')

// having been told it was stale, saving again must not overwrite either
await vct.mod.saveAccount(onVct.state, true)
await settle()
check('被告知落后之后，它再存一次也不会覆盖', (await serverState(ID))?.friends.length === 1)

// ---- a client that never learned a revision -----------------------------
{
  const res: Res = { code: 0, body: {} }
  await routes.route({
    body: JSON.stringify({ id: ID, name: 'x', client: { friends: [], squad: { slots: [null, null, null, null, null], coach: null } } }),
  } as never, res as never, '/api/card/save', 'test')
  check('没带版本号的存档不能覆盖别人的进度',
    res.code === 409 && (await serverState(ID))?.friends.length === 1, `返回 ${res.code}`)
}

// ---- the stale tab tries to write VALUE, with the right revision --------
//
// The revision only guards the cosmetic fields. Value is guarded by not
// being read at all: a save built on the current revision that says 999
// pulls and a 大师 record leaves the server's numbers exactly where they were.
{
  vct.enter()
  const fresh = await vct.mod.loadAccount(ID)
  if (fresh.ok) {
    fresh.state.pulls = 999
    fresh.state.coins = 9_999_999
    fresh.state.ladder = { div: 5, points: 4800, stars: 0, best: 5, wins: 370, losses: 10, streak: 0 }
    await vct.mod.saveAccount(fresh.state, true)
    await settle()
  }
  const now = await serverState(ID) as unknown as { pulls: number; coins: number; ladder: { wins: number } }
  check('版本号对得上也一样：抽数、金币、战绩都不由存档决定',
    now.pulls === 3 && now.coins !== 9_999_999 && now.ladder.wins === 0,
    JSON.stringify({ pulls: now.pulls, coins: now.coins, wins: now.ladder.wins }))
}

// ---- and the machine that actually played still sees the truth ---------
//
// The old recovery path — a device with MORE play pushing it back over the
// server — is gone, and this is the test that it stays gone. A mirror
// claiming 37 wins is a mirror; the account says what the server says.
{
  const played = await openOrigin('played')
  played.enter()
  const acc = await played.mod.createAccount('受害者')
  if (!acc.ok) process.exit(1)
  const RID = acc.state.id as string
  const rs = JSON.parse(JSON.stringify(acc.state)) as Record<string, unknown>
  rs.pulls = 30
  rs.ladder = { div: 5, points: 48, stars: 0, best: 5, wins: 37, losses: 10, streak: 3 }
  played.store.set(`valmanager:card:state:${RID}`, JSON.stringify({ state: rs, rev: 1, dirty: true }))
  const back = await played.mod.loadAccount(RID)
  await settle()
  check('本机镜像说 37 胜，账号说 0 胜——听账号的',
    back.ok && back.state.ladder.wins === 0 && back.state.pulls === 0)
  check('服务器也没有被那份镜像推动', (await serverState(RID))?.pulls === 0)
}

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
