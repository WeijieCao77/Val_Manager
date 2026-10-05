/**
 * 「编辑卡组/切换卡组之后又跳回之前那套」 (2026-10-05).
 *
 *   npx tsx scripts/check_squad_sync.ts
 *
 * Drives the real client module (src/engine/account.ts) against the real
 * routes, with a fetch that can hold a request before it reaches the server or
 * hold its reply after, so the races players hit are reproduced exactly:
 *
 *   1. A→B→C switched quickly: B's save reply lands after the tap on C. It used
 *      to put B back on screen (every reply's five was taken as the truth).
 *   2. An action tapped with the old five commits after the new five's save:
 *      its reply used to put the old five back, and the server kept it.
 *   3. A save refused because the revision moved under it — this tab's own
 *      action, or its page-hide beacon — used to be read as another device's
 *      choice: the five on screen was thrown away, with a 「别的设备」 toast.
 *   4. A reply overtaken by a newer one is not taken (coins do not go back).
 *   5. Still true: a five chosen on ANOTHER device wins a refused save, and a
 *      save that lands hands back the five as the server checked it.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../../pglite-sql.js'

const { CARD_SCHEMA, makeCardApi } = await import('../../cards-api.js')
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

// ---- a browser whose requests can be held ------------------------------------
const store = new Map<string, string>()
const g0 = globalThis as Record<string, unknown>
g0.window = globalThis
g0.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}
type Gate = { before?: Promise<void>; after?: Promise<void> }
const gates: { path: string; gate: Gate }[] = []
/** the next request to `path` waits on these */
const hold = (path: string, gate: Gate) => gates.push({ path, gate })
const route = async (path: string, body: string) => {
  const res: Res = { code: 0, body: {} }
  await routes.route({ body } as never, res as never, path, 'test')
  return res
}
g0.fetch = async (url: string, init?: { body?: string }) => {
  const path = String(url).replace(/^.*(\/api\/card\/\w+)$/, '$1')
  const i = gates.findIndex((x) => x.path === path)
  const gate = i >= 0 ? gates.splice(i, 1)[0].gate : {}
  await gate.before
  const res = await route(path, init?.body ?? '{}')
  await gate.after
  return { ok: res.code < 400, status: res.code, json: async () => res.body }
}
let beacons = 0
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { sendBeacon: (_u: string, blob: Blob) => { beacons++; void blob.text().then((t) => route('/api/card/save', t)); return true } },
})
const latch = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r }); return { p, open } }
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))

const account = await import('../../src/engine/account.ts')
const { act, createAccount, saveAccount, flushAccount, whenStale, loadAccount } = account
let staleToasts = 0
whenStale(() => { staleToasts++ })

const made = await createAccount('同步')
if (!made.ok) { console.log('FAIL account', made.why); process.exit(1) }
// enough coins for a collection to make three fives from
const { createHash } = await import('node:crypto')
await sql`update card_accounts set state = jsonb_set(state, '{coins}', '500000'), rev = rev + 1 where id_hash = ${createHash('sha256').update(made.state.id).digest('hex')}`
const loaded = await loadAccount(made.state.id)
if (!loaded.ok) { console.log('FAIL reload'); process.exit(1) }
const g = loaded.state
for (let i = 0; i < 12; i++) await act(g, 'open', { kind: 'scout', payWith: 'coins' })
const { cardById, personOf } = await import('../../src/engine/cards.ts')
const people = new Set<string>()
const owned = Object.keys(g.cards).filter((id) => {
  const c = cardById(id)
  if (!id.startsWith('p:') || !c) return false
  const who = personOf(c)
  if (people.has(who)) return false
  people.add(who)
  return true
})
check('夹具：卡够组三套不同的阵容', owned.length >= 7, `${owned.length}`)
const [A, B, C] = [owned.slice(0, 5), [...owned.slice(1, 5), owned[5]], [...owned.slice(2, 5), owned[5], owned[6]]]
const server = async () => (await route('/api/card/load', JSON.stringify({ id: g.id }))).body as { rev: number; state: { squad: { slots: string[] }; coins: number } }
const set = (five: string[]) => { g.squad = { slots: [...five], coach: g.squad.coach ?? null } }
const same = (x: (string | null)[], y: string[]) => JSON.stringify(x) === JSON.stringify(y)
set(A); await saveAccount(g, true); await tick()


// Old conflict response overtaken by this tab's newer action response.
const other = await server()
await route('/api/card/save', JSON.stringify({ id: g.id, client: { squad: { slots: B, coach: null } }, baseRev: other.rev }))
const late = latch()
hold('/api/card/save', { after: late.p })
set(A); const saving = saveAccount(g, true)
await tick(100)
set(C); void saveAccount(g, true)
await act(g, 'open', { kind: 'scout', payWith: 'coins' })
const newerRev = account.knownRev()
check('前置：新操作已经让客户端和服务端采用 C', same(g.squad.slots, C) && same((await server()).state.squad.slots, C))
late.open(); await saving
check('旧冲突回包不能覆盖更新回包的 C', same(g.squad.slots, C), `knownRev ${account.knownRev()} newerRev ${newerRev}; local ${g.squad.slots.join(',')}`)
await tick(900)
check('旧冲突回包不能把服务端也写回 B', same((await server()).state.squad.slots, C), (await server()).state.squad.slots.join(','))
console.log(bad ? `\n${bad} failures` : '\nall passed')
process.exit(bad ? 1 : 0)
