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

const account = await import('../src/engine/account.ts')
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
const { cardById, personOf } = await import('../src/engine/cards.ts')
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

// ---- 1. A→B→C quickly: B's reply lands after C -------------------------------
{
  const late = latch()
  hold('/api/card/save', { after: late.p })
  set(B); const first = saveAccount(g, true)
  await tick()
  set(C); void saveAccount(g, true)        // waits for the first: it is in flight
  late.open(); await first; await tick(600)
  check('1. 换到 C 后，B 的回包不会把画面拉回 B', same(g.squad.slots, C), g.squad.slots.join(','))
  check('1. 服务器最终是 C', same((await server()).state.squad.slots, C))
}

// ---- 2. an action tapped with the old five commits after the new five's save --
{
  set(A); await saveAccount(g, true); await tick()
  const go = latch()
  hold('/api/card/act', { before: go.p })      // the action has not reached the server yet
  const acting = act(g, 'open', { kind: 'scout', payWith: 'coins' })   // carries A
  await tick()
  set(B); await saveAccount(g, true); await tick()  // B lands first
  check('2. 前置：B 先存上了', same((await server()).state.squad.slots, B))
  go.open(); await acting; await tick(1500)   // the action lands with A; its reply comes back
  check('2. 旧阵容的操作回包不会把画面拉回 A', same(g.squad.slots, B), g.squad.slots.join(','))
  check('2. 服务器被旧操作写回 A 之后又补存成 B', same((await server()).state.squad.slots, B), (await server()).state.squad.slots.join(','))
}

// ---- 3. a refused save whose five is this tab's own ---------------------------
{
  staleToasts = 0
  // the revision moves under the save: an action commits between the save being sent and arriving
  const go = latch()
  hold('/api/card/save', { before: go.p })
  set(C); const saving = saveAccount(g, true)
  await tick()
  await act(g, 'open', { kind: 'scout', payWith: 'coins' })   // carries C, moves the revision
  set(A); void saveAccount(g, true)                            // and another switch while all this happens
  go.open(); await saving; await tick(800)
  check('3. 自己的操作挪动了版本：保存被拒后不当成别的设备，画面保持 A', same(g.squad.slots, A) && staleToasts === 0,
    `${g.squad.slots.join(',')} · 提示 ${staleToasts} 次`)
  check('3. 重发后服务器是 A', same((await server()).state.squad.slots, A))
  // the page-hide beacon moves the revision too, and its reply never comes
  set(B); flushAccount(g); await tick()
  set(C); await saveAccount(g, true); await tick(800)
  check('3. 切后台的 beacon 之后再换阵容：不跳回、不误报', same(g.squad.slots, C) && staleToasts === 0 && beacons === 1,
    `${g.squad.slots.join(',')} · 提示 ${staleToasts}`)
  check('3. 服务器是 C', same((await server()).state.squad.slots, C))
}

// ---- 4. a reply overtaken by a newer one is not taken --------------------------
{
  const slow = latch()
  hold('/api/card/act', { after: slow.p })
  const first = act(g, 'open', { kind: 'scout', payWith: 'coins' })
  await tick()
  await act(g, 'open', { kind: 'scout', payWith: 'coins' })
  const coins = g.coins
  slow.open(); await first
  check('4. 先发后到的旧回包不把金币改回去', g.coins === coins && g.coins === (await server()).state.coins, `${g.coins} vs ${coins}`)
}

// ---- 5. another device still wins; a landed save hands back the checked five ---
{
  staleToasts = 0
  const other = (await server())
  // another device puts B up on the current revision
  await route('/api/card/save', JSON.stringify({ id: g.id, client: { squad: { slots: B, coach: g.squad.coach ?? null } }, baseRev: other.rev }))
  await tick()
  set(A); void saveAccount(g, true); await tick(600)
  check('5. 别的设备换了阵容：保存被拒时采用对方的（原规则不变）', same(g.squad.slots, B) && staleToasts === 1, `${g.squad.slots.join(',')} · 提示 ${staleToasts}`)
  // a seat naming a card this account does not own comes back emptied
  set([...B.slice(0, 4), 'p:NOT_OWNED']); await saveAccount(g, true); await tick()
  check('5. 精简回包：服务器校验后的阵容回到画面', g.squad.slots[4] === null && (await server()).state.squad.slots[4] === null, String(g.squad.slots[4]))
  // and a reload shows what the server holds
  const again = await loadAccount(g.id)
  check('5. 刷新后与服务器一致', again.ok && same(again.state.squad.slots.slice(0, 4) as string[], B.slice(0, 4)))
}

// ---- 6. a refusal overtaken by a newer reply changes nothing (Codex's third recheck) --
// Another device saves B; this tab's save of A is refused with B, but that reply is late:
// meanwhile this tab switched to C and an action carrying C landed on a newer revision.
{
  staleToasts = 0
  set(A); await saveAccount(g, true); await tick(300)
  const other = await server()
  await route('/api/card/save', JSON.stringify({ id: g.id, client: { squad: { slots: B, coach: g.squad.coach ?? null } }, baseRev: other.rev }))
  const late = latch()
  hold('/api/card/save', { after: late.p })
  set(A); const saving = saveAccount(g, true)
  await tick(100)
  set(C); void saveAccount(g, true)
  await act(g, 'open', { kind: 'scout', payWith: 'coins' })
  check('6. 前置：新操作让两边都是 C', same(g.squad.slots, C) && same((await server()).state.squad.slots, C))
  late.open(); await saving
  check('6. 迟到的旧冲突回包不把画面改回 B、不弹“别的设备”', same(g.squad.slots, C) && staleToasts === 0, `${g.squad.slots.join(',')} · 提示 ${staleToasts}`)
  await tick(900)
  check('6. 也不会经排队的保存把服务器写回 B', same((await server()).state.squad.slots, C), (await server()).state.squad.slots.join(','))
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
