/**
 * The mirror is a display cache; the account is the server's.
 *
 *   npx tsx scripts/check_offline_save.ts
 *
 * This file used to prove the opposite — that a pack opened on a phone that
 * then lost its network could be recovered from localStorage and pushed up
 * later. That recovery was the door: anything a client could push up, an
 * edited client could push up. Now nothing of value happens without the
 * server, so there is nothing of value to recover. What the mirror still
 * carries across a dead network is the cosmetic side — a name typed, a five
 * rearranged — and that is what has to survive here.
 *
 * The real client module is driven against the real route handlers behind an
 * in-process Postgres, because the contract lives in how the two talk.
 */
process.env.ENGINE_FROM_SOURCE = '1'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
const { CARD_SCHEMA, makeCardApi } = await import('../cards-api.js')

// ---- a server -----------------------------------------------------------

const db = new PGlite()
const sql = makeSql(db)
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
Object.defineProperty(globalThis, 'navigator', {
  configurable: true, value: { sendBeacon: () => false },
})

const account = await import('../src/engine/account.ts')
const { act, createAccount, loadAccount, saveAccount, retryPending } = account

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const settle = () => new Promise((r) => setTimeout(r, 60))
const serverState = async (id: string) => {
  const res: Res = { code: 0, body: {} }
  await routes.route({ body: JSON.stringify({ id }) } as never, res as never, '/api/card/load', 'peek')
  return res.body.state as Record<string, unknown> & { cards: Record<string, unknown>; squad: { slots: (string | null)[] } } | undefined
}
const mirrorOf = (d: Store) =>
  JSON.parse([...d].find(([k]) => k.startsWith('valmanager:card:state:'))?.[1] ?? 'null') as
    { state: Record<string, unknown>; rev: number | null; dirty: boolean } | null

// ---- the evening, replayed ---------------------------------------------

use(phone)
const made = await createAccount('测试')
check('the account is built on the server', made.ok, made.ok ? '' : made.why)
if (!made.ok) process.exit(1)
const ID = made.state.id
const st = made.state
await settle()

// 18:20 — a pack. This one lands, on the server, before the reply.
const opened = await act(st, 'open', { kind: 'scout', payWith: 'pack' })
const first = Object.keys(st.cards)[0]
check('the pack is opened on the server', opened.ok && !!first, opened.ok ? '' : opened.why)
check('and the server holds the card', !!(await serverState(ID))?.cards[first])
check('the local copy is what the server sent back', st.pulls === 1 && (await serverState(ID))?.pulls === 1)

// 18:22 — the network goes. Nothing of value can happen now, and nothing
// pretends to.
net = 'down'
const refused = await act(st, 'open', { kind: 'scout', payWith: 'pack' })
check('offline, a pack cannot be opened', !refused.ok && refused.offline === true, refused.ok ? '' : refused.why)
check('and the local copy did not pretend it was', st.pulls === 1 && st.packs.scout === 2)

// what the player CAN do offline is arrange the five and rename
st.name = '离线改名'
st.squad.slots[0] = first
saveAccount(st, true)
await settle()
check('a save that fails does not reach the server', (await serverState(ID))?.name !== '离线改名')
check('the mirror keeps the cosmetic change', mirrorOf(phone)?.state.name === '离线改名')
check('the mirror is marked dirty', mirrorOf(phone)?.dirty === true)

// 20:30 — the network is back, the tab comes to the front
net = 'up'
retryPending(st)
await settle()
const srv = await serverState(ID)
check('the name is pushed up', srv?.name === '离线改名', String(srv?.name))
check('so is the five', srv?.squad.slots[0] === first)
check('the mirror is clean once the server has it', mirrorOf(phone)?.dirty === false)

// ---- a device that is merely behind -------------------------------------

use(desktop)
const d = await loadAccount(ID)
check('the desktop sees the server\'s account', d.ok && d.state.name === '离线改名' && d.state.pulls === 1)
if (d.ok) {
  d.state.name = '桌面改名'
  saveAccount(d.state, true)
  await settle()
}
use(phone)
const stalePhone = await loadAccount(ID)
check('the phone reads the newer name rather than pushing its own',
  stalePhone.ok && stalePhone.state.name === '桌面改名')

// ---- the mirror a tampered phone is holding ----------------------------
//
// A bare state, no envelope, written by hand: coins, cards and a record it
// never earned. Its cosmetic fields are taken, because they are its own to
// write; everything else is the server's.

const bare = JSON.parse(JSON.stringify((await serverState(ID))!)) as Record<string, unknown>
bare.id = ID
bare.coins = 4_242_424
bare.pulls = 900
bare.name = '篡改'
bare.cards = { ...(bare.cards as object), 'p:P1': { id: 'p:P1', level: 5, dupes: 9, seen: 9, got: '2026-01-01' } }
bare.ladder = { div: 5, points: 9999, stars: 0, best: 5, wins: 500, losses: 0, streak: 0 }
phone.set(`valmanager:card:state:${ID}`, JSON.stringify(bare))
const tampered = await loadAccount(ID)
await settle()
check('a tampered mirror does not become the account',
  tampered.ok && tampered.state.coins !== 4_242_424 && tampered.state.pulls === 1
  && !tampered.state.cards['p:P1'] && tampered.state.ladder.wins === 0)
check('the server was not touched by it either',
  (await serverState(ID))?.pulls === 1 && (await serverState(ID))?.coins !== 4_242_424)
check('but the name it carried is taken — that much is the player\'s to write',
  tampered.ok && tampered.state.name === '篡改')

// ---- a 429 is a failure, not a success ---------------------------------

use(desktop)
const r2 = await loadAccount(ID)
net = 'ratelimited'
if (r2.ok) r2.state.name = '限流'
const before = saves
if (r2.ok) saveAccount(r2.state, true)
await settle()
check('a 429 leaves the mirror dirty instead of passing as a save', mirrorOf(desktop)?.dirty === true)
check('and it is retried rather than dropped', saves > before, `${saves - before} attempt(s)`)
net = 'up'
if (r2.ok) retryPending(r2.state)
await settle()
check('once the limit lifts, the retry lands', (await serverState(ID))?.name === '限流')

// ---- the save is awaitable, which is what the leaderboard needs ---------
{
  use(desktop)
  const r3 = await loadAccount(ID)
  if (!r3.ok) process.exit(1)
  r3.state.name = '等它落地'
  const p = saveAccount(r3.state, true)
  check('saveAccount hands back something to wait on', typeof p?.then === 'function')
  await p
  check('and by the time it settles the server has the new state',
    (await serverState(ID))?.name === '等它落地')
  r3.state.name = '还没'
  await saveAccount(r3.state)
  check('the debounced form does not pretend the write has happened',
    (await serverState(ID))?.name === '等它落地')
  await settle()
}

// ---- opening the mode with no network at all ---------------------------
{
  net = 'down'
  use(phone)
  const off = await loadAccount(ID)
  check('offline, the mirror is shown read-only', off.ok && off.cloud === false && off.state.pulls === 1)
  net = 'up'
  const miss = await loadAccount('VM-1111-1111-1111-1111-1111')
  check('an id the server has never seen is a miss, not a local account', !miss.ok && miss.reason === 'missing')
}

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
