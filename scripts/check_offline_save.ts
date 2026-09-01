/**
 * The save that does not land, and the copy that survives it.
 *
 * A player won a ladder match on a phone, claimed the quest it finished,
 * opened the 试训包 it paid for, and put the phone down. An hour later the
 * desktop showed the quest undone and the pack gone. The match had saved;
 * nothing after it had.
 *
 * Three separate things made that possible and each is checked here:
 *   - a failed save was swallowed under "the next save will retry", when the
 *     failed save was the last thing the session did;
 *   - a non-2xx reply was read for a field it does not carry and treated as
 *     success;
 *   - and the next load wrote the server's older state over the local mirror,
 *     which was the only remaining copy — turning a lost hour into a lost hour
 *     forever.
 *
 * The real client module is driven against a real Postgres through the real
 * route handlers, because the bug lived in how the two talk to each other.
 *
 *   npx tsx scripts/check_offline_save.ts
 */
import { PGlite } from '@electric-sql/pglite'
import { CARD_SCHEMA, makeCardApi } from '../cards-api.js'

// ---- a server -----------------------------------------------------------

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

// ---- a browser ----------------------------------------------------------

type Store = Map<string, string>
const phone: Store = new Map()
const desktop: Store = new Map()
let device = phone
const use = (d: Store) => { device = d }

const g = globalThis as Record<string, unknown>
g.window = globalThis
g.localStorage = {
  getItem: (k: string) => device.get(k) ?? null,
  setItem: (k: string, v: string) => void device.set(k, v),
  removeItem: (k: string) => void device.delete(k),
}

/** The network, and the ability to take it away. */
let net: 'up' | 'down' | 'ratelimited' = 'up'
let saves = 0
g.fetch = async (url: string, init?: { body?: string }) => {
  if (net === 'down') throw new Error('offline')
  const path = String(url)
  if (path.endsWith('/day')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, today: '2026-08-28', now: Date.now(), cloud: true }) }
  }
  if (path.endsWith('/save')) {
    saves++
    if (net === 'ratelimited') return { ok: false, status: 429, json: async () => ({ ok: false, why: 'rate' }) }
  }
  const res: Res = { code: 0, body: {} }
  await routes.route({ body: init?.body ?? '{}' } as never, res as never,
    path.replace(/^.*(\/api\/card\/\w+)$/, '$1'), 'test')
  return { ok: res.code < 400, status: res.code, json: async () => res.body }
}
// Node's navigator is getter-only, and the beacon has to be refused anyway:
// this is the phone that could not send one.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true, value: { sendBeacon: () => false },
})

const account = await import('../src/engine/account.ts')
const { createAccount, loadAccount, saveAccount, retryPending, knownRev } = account

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const settle = () => new Promise((r) => setTimeout(r, 60))
const serverState = async (id: string) => {
  const res: Res = { code: 0, body: {} }
  await routes.route({ body: JSON.stringify({ id }) } as never, res as never, '/api/card/load', 'peek')
  return res.body.state as Record<string, unknown> | undefined
}
const mirrorOf = (d: Store, id: string) =>
  JSON.parse([...d].find(([k]) => k.startsWith('valmanager:card:state:'))?.[1] ?? 'null') as
    { state: Record<string, unknown>; rev: number | null; dirty: boolean } | null

// ---- the evening, replayed ---------------------------------------------

use(phone)
const made = await createAccount('测试')
const ID = made.state.id
const st = made.state as unknown as Record<string, unknown>
st.log = []
await settle()

// 18:20 — the ladder win. This one lands.
;(st.log as unknown[]).push({ at: '2026-08-28T10:20:50.000Z', text: '天梯 钻石：胜，+290 金币' })
st.coins = 1000
saveAccount(made.state, true)
await settle()
check('the ladder win reaches the server', (await serverState(ID))?.coins === 1000)
const revAfterWin = knownRev()

// 18:22 — the quest reward and the pack it paid for. The phone is going away.
net = 'down'
;(st.log as unknown[]).push({ at: '2026-08-28T10:22:10.000Z', text: '试训包：抽到 brawk（金卡）' })
st.coins = 900
;(made.state.cards as Record<string, number>).brawk = 1
saveAccount(made.state, true)
await settle()

check('a save that fails does not reach the server', (await serverState(ID))?.coins === 1000)
check('the mirror keeps the pack anyway', !!mirrorOf(phone, ID)?.state.cards?.['brawk' as never])
check('the mirror is marked dirty', mirrorOf(phone, ID)?.dirty === true)
check('the mirror still names the revision it was built on', mirrorOf(phone, ID)?.rev === revAfterWin)

// 20:00 — the desktop. It can only show what the server has, and that is the
// symptom the player reported: the quest undone, the pack missing.
net = 'up'
use(desktop)
const onDesktop = await loadAccount(ID)
check('the desktop sees the older state — the reported symptom',
  onDesktop.ok && onDesktop.state.coins === 1000 && !onDesktop.state.cards.brawk)
check('and it is not told anything was recovered', onDesktop.ok && !onDesktop.recovered)

// 20:30 — the phone comes back. This is where the pack used to die for good.
use(phone)
const back = await loadAccount(ID)
check('the phone is given its own copy back', back.ok && !!back.state.cards.brawk)
check('and is told so, so the player can be told', back.ok && back.recovered === true)
await settle()
check('the recovered pack is pushed up to the server',
  !!(await serverState(ID))?.cards?.['brawk' as never])
check('the mirror is clean once the server has it', mirrorOf(phone, ID)?.dirty === false)

// ---- and it must not work in the other direction ------------------------

use(desktop)
const d = await loadAccount(ID)
;(d.state as unknown as Record<string, unknown>).coins = 5000
saveAccount(d.state, true)
await settle()
use(phone)
const stalePhone = await loadAccount(ID)
check('a phone that is merely behind does not clobber the desktop',
  stalePhone.ok && stalePhone.state.coins === 5000 && !stalePhone.recovered)

// ---- the mirror the player's phone is actually holding ------------------
// Written by the old code: a bare state, no envelope, no revision.

const bare = JSON.parse(JSON.stringify((await serverState(ID))!)) as Record<string, unknown>
bare.id = ID
bare.coins = 4242
bare.log = [{ at: '2026-08-29T01:00:00.000Z', text: '试训包：抽到 someone（金卡）' }]
phone.set(`valmanager:card:state:${ID}`, JSON.stringify(bare))
const legacy = await loadAccount(ID)
check('a legacy mirror with newer play is recovered', legacy.ok && legacy.state.coins === 4242 && !!legacy.recovered)
await settle()

const behind = JSON.parse(JSON.stringify(bare)) as Record<string, unknown>
behind.coins = 11
behind.log = [{ at: '2026-01-01T00:00:00.000Z', text: '很久以前' }]
phone.set(`valmanager:card:state:${ID}`, JSON.stringify(behind))
const old = await loadAccount(ID)
check('a legacy mirror with nothing new is ignored', old.ok && old.state.coins === 4242 && !old.recovered)

// ---- a 429 is a failure, not a success ---------------------------------

use(desktop)
const r2 = await loadAccount(ID)
net = 'ratelimited'
;(r2.state as unknown as Record<string, unknown>).coins = 7777
const before = saves
saveAccount(r2.state, true)
await settle()
check('a 429 leaves the mirror dirty instead of passing as a save',
  mirrorOf(desktop, ID)?.dirty === true)
check('and it is retried rather than dropped', saves > before, `${saves - before} attempt(s)`)
net = 'up'
retryPending(r2.state)
await settle()
check('once the limit lifts, the retry lands', (await serverState(ID))?.coins === 7777)

// ---- the save is awaitable, which is what the leaderboard needs ---------
//
// 「排行榜不会实时更新」: the board reads the accounts table, and this account
// only reaches that table when its save lands. The ladder refetched the moment
// a match ended, raced its own write, and printed the row from before the
// match — 段位 said 大师 48 while your own row said 大师 20. Nothing was stale
// on the server. So saveAccount returns a promise, and the fix is only real if
// the server has actually been written by the time it settles.
{
  use(desktop)
  const r3 = await loadAccount(ID)
  ;(r3.state as unknown as Record<string, unknown>).coins = 31337
  const p = saveAccount(r3.state, true)
  check('saveAccount hands back something to wait on', typeof p?.then === 'function')
  await p
  check('and by the time it settles the server has the new state',
    (await serverState(ID))?.coins === 31337, JSON.stringify((await serverState(ID))?.coins))

  // the debounced form resolves immediately and does NOT promise a write —
  // only the immediate form is what a read-back may wait on
  ;(r3.state as unknown as Record<string, unknown>).coins = 4141
  await saveAccount(r3.state)
  check('the debounced form does not pretend the write has happened',
    (await serverState(ID))?.coins === 31337)
  await settle()
}

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
