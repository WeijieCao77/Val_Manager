/**
 * The five on the phone and the five on the desktop are the same five.
 *
 *   npx tsx scripts/check_cross_device.ts
 *
 * The report (2026-09-08): 「手机端和网页端的开瓦包卡组配置不互通不同步」.
 * Two things were wrong, and this drives the real client module on two
 * fake devices against the real routes to show both, and then that they
 * are gone.
 *
 *   1. A device that had an unsent cosmetic edit — a five rearranged and the
 *      tab closed before the debounced save fired, which is every phone tab
 *      that gets swiped away — kept it in its mirror as "dirty". On its next
 *      open, days later, that dirty mirror was laid over the server's account
 *      and pushed up, regardless of what any other device had done since. So
 *      the desktop's new five was overwritten by the phone's old one the
 *      moment the phone was opened. Now the mirror's edit is only kept when
 *      the server is still at the revision the mirror was built on; if the
 *      account moved on somewhere else, the server's copy wins.
 *
 *   2. A tab left open never re-read the account. Set the five on the phone,
 *      go back to the desktop tab, and it still showed the old five until a
 *      reload — and editing it there then collided with the phone's. Now a
 *      tab coming to the front re-reads the account and takes the newer copy.
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

// ---- two browsers, one module ------------------------------------------
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
let net: 'up' | 'down' = 'up'
g.fetch = async (url: string, init?: { body?: string }) => {
  if (net === 'down') throw new Error('offline')
  const path = String(url)
  const res: Res = { code: 0, body: {} }
  await routes.route({ body: init?.body ?? '{}' } as never, res as never,
    path.replace(/^.*(\/api\/card\/\w+)$/, '$1'), 'test')
  return { ok: res.code < 400, status: res.code, json: async () => res.body }
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { sendBeacon: () => false } })

const account = await import('../src/engine/account.ts')
const { act, createAccount, loadAccount, saveAccount, refreshAccount, knownRev } = account

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const settle = () => new Promise((r) => setTimeout(r, 60))
const serverSquad = async (id: string): Promise<(string | null)[]> => {
  const res: Res = { code: 0, body: {} }
  await routes.route({ body: JSON.stringify({ id }) } as never, res as never, '/api/card/load', 'peek')
  return (res.body.state as { squad: { slots: (string | null)[] } }).squad.slots
}
const mirrorOf = (d: Store) =>
  JSON.parse([...d].find(([k]) => k.startsWith('valmanager:card:state:'))?.[1] ?? 'null') as
    { state: { squad: { slots: (string | null)[] } }; rev: number | null; dirty: boolean } | null

// The module keeps one revision counter, and here one module serves two
// devices. A real device's counter is whatever its own last read said, so
// each switch restores the counter that device last saw.
const revSeen = new Map<Store, number | null>()
const leave = () => { revSeen.set(device, knownRev()) }
const openOn = async (d: Store, id: string) => {
  leave(); use(d)
  const r = await loadAccount(id)
  if (!r.ok) throw new Error(`load failed on a device: ${r.reason}`)
  return r.state
}

// ---- a collection to arrange ------------------------------------------
use(phone)
const made = await createAccount('双机')
if (!made.ok) { console.log('FAIL account', made.why); process.exit(1) }
const ID = made.state.id
const p = made.state
for (let i = 0; i < 6; i++) await act(p, 'open', { kind: 'scout', payWith: 'coins' })
const owned = Object.keys(p.cards)
check('enough cards to tell two fives apart', owned.length >= 3, `${owned.length} cards`)
const [A, B, C] = owned

// ---- 1. the phone's stale unsent five must not overwrite the desktop's ---

// Sunday, phone: A in seat one, saved and confirmed
p.squad.slots[0] = A
await saveAccount(p, true); await settle()
check('the phone lands its five', (await serverSquad(ID))[0] === A)

// the phone then rearranges once more and is swiped away before the save
// goes out — the mirror holds it, dirty, at the revision the phone last saw
net = 'down'
p.squad.slots[0] = C
await saveAccount(p, true); await settle()
net = 'up'
check('the swipe-away leaves a dirty mirror on the phone', mirrorOf(phone)?.dirty === true && mirrorOf(phone)?.state.squad.slots[0] === C)

// Monday, desktop: the five is set to B and confirmed
const d = await openOn(desktop, ID)
d.squad.slots[0] = B
await saveAccount(d, true); await settle()
check('the desktop sets its own five', (await serverSquad(ID))[0] === B)

// Tuesday, the phone is opened
const p2 = await openOn(phone, ID)
await settle()
check('the phone shows the five the desktop chose', p2.squad.slots[0] === B, `phone shows ${p2.squad.slots[0]}, B is ${B}`)
check('and the server still holds it', (await serverSquad(ID))[0] === B, `server holds ${(await serverSquad(ID))[0]}`)
check('the phone\'s mirror is clean and current', mirrorOf(phone)?.dirty === false && mirrorOf(phone)?.state.squad.slots[0] === B)

// an unsent edit made when nothing else has moved is still delivered
net = 'down'
p2.squad.slots[1] = C
await saveAccount(p2, true); await settle()
net = 'up'
const p3 = await openOn(phone, ID)
await settle()
check('an unsent edit on an account nobody else touched is still pushed up', (await serverSquad(ID))[1] === C && p3.squad.slots[1] === C)

// ---- 2. a tab left open picks up the other device's five ----------------

const d2 = await openOn(desktop, ID)
check('the desktop tab opens on the current five', d2.squad.slots[0] === B && d2.squad.slots[1] === C)

// the phone changes it while the desktop tab sits in the background
const p4 = await openOn(phone, ID)
p4.squad.slots[0] = A
await saveAccount(p4, true); await settle()

// the desktop tab comes to the front
leave(); use(desktop)
const changed = await refreshAccount(d2)
check('coming to the front re-reads the account', changed === true)
check('and the desktop now shows the phone\'s five', d2.squad.slots[0] === A, `desktop shows ${d2.squad.slots[0]}`)
check('a second look with nothing new changes nothing', (await refreshAccount(d2)) === false)

// a desktop with an unsent edit of its own keeps it for the save path, which
// resolves the collision the way it always has (the server says stale, the
// tab takes the newer copy)
net = 'down'
d2.squad.slots[2] = B
await saveAccount(d2, true); await settle()
net = 'up'
check('a tab holding unsent work is not re-read from under it', (await refreshAccount(d2)) === false && d2.squad.slots[2] === B)

console.log(bad ? `\n${bad} FAILED` : '\nall held')
process.exit(bad ? 1 : 0)
