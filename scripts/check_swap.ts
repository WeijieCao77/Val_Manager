/**
 * 换卡: like for like, one 体力 a side, and nobody left holding nothing.
 *
 *   npx tsx scripts/check_swap.ts
 *
 * Driven against the real card and market APIs behind an in-process
 * Postgres. What has to hold:
 *
 *   - a silver only ever swaps for a silver; the server says so, whatever
 *     the client asks
 *   - the proposer's card leaves the SERVER's copy of their account when the
 *     offer is made, and a point of 体力 with it; the friend's leaves when
 *     they accept, with their own point
 *   - both cards arrive through the inbox, at the level they left with
 *   - declined, cancelled and expired swaps send the escrowed card home
 *   - a friend who has since lost the card cannot accept; the proposer's
 *     card goes home at once rather than in three days
 *   - the alt gate applies to both sides, and you cannot swap with yourself
 *   - the friend-cards lookup hands out ids and levels and nothing else
 */
process.env.ENGINE_FROM_SOURCE = '1'
import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { ALL_CARDS } from '../src/engine/cards'
import { STAMINA_COST, STAMINA_MAX } from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'

const { CARD_SCHEMA, makeCardApi, normalizeId, battleCode } = await import('../cards-api.js')
const { makeMarketApi, TRADE_PULLS } = await import('../market-api.js')
const { displayName } = await import('../names.js')
const engine = await import('../src/engine/server.ts')

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

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const hashOf = (id: string) => createHash('sha256').update(id).digest('hex')

interface Res { code: number; body: Record<string, unknown> }
const json = (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body }
const readBody = (req: { body: string }) => Promise.resolve(req.body)
const cards = makeCardApi(sql, { rateLimited: () => false, readBody, json } as never)
const market = makeMarketApi(sql, { readBody, json, normalizeId, displayName, rateLimited: () => false, engine } as never)
async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res: Res = { code: 0, body: {} }
  const api = path.startsWith('/api/market/') ? market : cards
  await api.route({ body: JSON.stringify(body), method: 'POST' } as never, res as never, path, 't')
  return res.body
}
const stored = async (id: string): Promise<GachaState> =>
  (await sql`select state from card_accounts where id_hash = ${hashOf(id)}` as unknown as { state: GachaState }[])[0].state
const inbox = async (id: string) =>
  ((await call('/api/card/act', { id, action: 'mail_take', args: {}, client: {} })).result as
    { mail: { kind: string; cardId: string | null; level: number }[] }).mail
const patch = async (id: string, path: string, value: unknown) =>
  sql`update card_accounts set state = jsonb_set(state, ${`{${path}}`}::text[], ${JSON.stringify(value)}::jsonb) where id_hash = ${hashOf(id)}`

const A = 'VM-AAAA-AAAA-AAAA-AAAA-AAAA'
const B = 'VM-BBBB-BBBB-BBBB-BBBB-BBBB'
const codeOf = (id: string) => battleCode(hashOf(id))

const silver = ALL_CARDS.filter((c) => c.rarity === 'silver' && c.kind === 'player').map((c) => c.id)
const gold = ALL_CARDS.filter((c) => c.rarity === 'gold' && c.kind === 'player').map((c) => c.id)
const owned = (id: string, level = 0, dupes = 0) => ({ id, level, dupes, seen: 1 + dupes, got: '2026-09-01' })

await call('/api/card/claim', { id: A, name: '甲' })
await call('/api/card/claim', { id: B, name: '乙' })
// both have played enough to trade, the way real accounts would
for (const id of [A, B]) await patch(id, 'pulls', TRADE_PULLS + 5)
await patch(A, 'cards', { [silver[0]]: owned(silver[0], 2), [silver[1]]: owned(silver[1], 0, 1), [gold[0]]: owned(gold[0]) })
await patch(B, 'cards', { [silver[2]]: owned(silver[2], 3), [gold[1]]: owned(gold[1]) })

// ---- like for like -----------------------------------------------------
console.log('同等级：')
let r = await call('/api/market/swap', { id: A, code: codeOf(B), giveId: silver[0], wantId: gold[1] })
check('银卡换金卡：拒绝', r.rarity === true, JSON.stringify(r))
r = await call('/api/market/swap', { id: A, code: codeOf(B), giveId: gold[0], wantId: silver[2] })
check('金卡换银卡：也拒绝', r.rarity === true, JSON.stringify(r))
r = await call('/api/market/swap', { id: A, code: codeOf(A), giveId: silver[0], wantId: silver[0] })
check('不能和自己换', r.self === true, JSON.stringify(r))
r = await call('/api/market/swap', { id: A, code: codeOf(B), giveId: silver[0], wantId: silver[1] })
check('对方没有的卡换不了', r.theyLack === true, JSON.stringify(r))
r = await call('/api/market/swap', { id: A, code: codeOf(B), giveId: gold[1], wantId: silver[2] })
check('自己没有的卡换不了', r.notOwned === true || r.rarity === true, JSON.stringify(r))
r = await call('/api/market/swap', { id: A, code: '00000000', giveId: silver[0], wantId: silver[2] })
check('没人用的对战码', r.missing === true, JSON.stringify(r))

// ---- the offer: escrow and a point of 体力 ------------------------------
console.log('\n发起：')
const a0 = await stored(A)
r = await call('/api/market/swap', { id: A, code: codeOf(B), giveId: silver[0], wantId: silver[2] })
check('银卡换银卡：发出去了', r.ok === true && typeof r.id === 'string', JSON.stringify(r).slice(0, 80))
const SW = String(r.id)
const a1 = await stored(A)
check('卡从服务器的账号里拿走了（唯一一张，带着 +2）', !a1.cards[silver[0]])
check(`扣了 ${STAMINA_COST.swap} 点体力`, a1.daily.stamina === a0.daily.stamina - STAMINA_COST.swap, `${a0.daily.stamina} → ${a1.daily.stamina}`)
check('回复带着更新后的账号', !!(r.state as GachaState)?.cards)
const row = (await sql`select give_level, status from card_swaps where id = ${SW}::bigint` as unknown as { give_level: number; status: string }[])[0]
check('托管的等级就是账号里的等级', row.give_level === 2 && row.status === 'open', JSON.stringify(row))
const bm = await inbox(B)
check('对方收到「有人想换」的通知', bm.some((m) => m.kind === 'swap_offer'), JSON.stringify(bm.map((m) => m.kind)))
r = await call('/api/market/swap', { id: A, code: codeOf(B), giveId: silver[0], wantId: silver[2] })
check('同一张卡不能再发一次——它已经不在手里', r.notOwned === true, JSON.stringify(r))

// ---- the friend's list ------------------------------------------------
const q = await call('/api/market/swaps', { id: B })
const inb = q.inbound as { id: string; give: string; want: string; giveLevel: number; who: string }[]
check('对方在列表里看到这个交换', inb.length === 1 && inb[0].give === silver[0] && inb[0].giveLevel === 2 && inb[0].want === silver[2], JSON.stringify(inb))
check('名字过滤过、没有账号信息', /甲 #/.test(inb[0].who) && !JSON.stringify(q).includes('VM-') && !JSON.stringify(q).includes('id_hash'))
const mine = await call('/api/market/swaps', { id: A })
check('自己那边列在「我发出的」里', (mine.outbound as unknown[]).length === 1)

// ---- accept: their card leaves, both arrive by mail ---------------------
console.log('\n接受：')
await patch(B, 'daily', { ...(await stored(B)).daily, stamina: 0, staminaAt: Date.now() })
r = await call('/api/market/swap_answer', { id: B, swap: SW, accept: true })
check('对方没体力接受不了', r.stamina === true, JSON.stringify(r))
await patch(B, 'daily', { ...(await stored(B)).daily, stamina: STAMINA_MAX, staminaAt: Date.now() })
const b0 = await stored(B)
r = await call('/api/market/swap_answer', { id: B, swap: SW, accept: true })
check('接受成功', r.ok === true, JSON.stringify(r).slice(0, 80))
const b1 = await stored(B)
check('对方的卡从他账号里拿走了', !b1.cards[silver[2]])
check(`对方也扣了 ${STAMINA_COST.swap} 点`, b1.daily.stamina === b0.daily.stamina - STAMINA_COST.swap, `${b0.daily.stamina} → ${b1.daily.stamina}`)
const am = await inbox(A)
const bm2 = await inbox(B)
check('我收到他的卡，带着他的 +3', am.some((m) => m.kind === 'swap_in' && m.cardId === silver[2] && m.level === 3), JSON.stringify(am))
check('他收到我的卡，带着我的 +2', bm2.some((m) => m.kind === 'swap_in' && m.cardId === silver[0] && m.level === 2), JSON.stringify(bm2))
check('两边账号里都有了对方的卡', !!(await stored(A)).cards[silver[2]] && !!(await stored(B)).cards[silver[0]])
check('并且等级到位', (await stored(A)).cards[silver[2]].level === 3 && (await stored(B)).cards[silver[0]].level === 2)
r = await call('/api/market/swap_answer', { id: B, swap: SW, accept: true })
check('成交过的不能再接受一次', r.gone === true)

// ---- decline, cancel, expire: the card goes home ------------------------
console.log('\n退回：')
// a spare goes out at +0 and comes back as a spare
r = await call('/api/market/swap', { id: A, code: codeOf(B), giveId: silver[1], wantId: silver[0] })
check('用重复卡发起：走的是多余那张', r.ok === true && (await stored(A)).cards[silver[1]]?.dupes === 0)
r = await call('/api/market/swap_answer', { id: B, swap: String(r.id), accept: false })
check('对方拒绝', r.ok === true && r.declined === true)
let back = await inbox(A)
check('卡退回来了', back.some((m) => m.kind === 'swap_back' && m.cardId === silver[1]), JSON.stringify(back))
check('退回之后重复数恢复', (await stored(A)).cards[silver[1]]?.dupes === 1)

r = await call('/api/market/swap', { id: A, code: codeOf(B), giveId: silver[1], wantId: silver[0] })
const CANCEL = String(r.id)
r = await call('/api/market/swap_cancel', { id: B, swap: CANCEL })
check('别人撤不了你的交换', r.gone === true)
r = await call('/api/market/swap_cancel', { id: A, swap: CANCEL })
check('自己可以撤回', r.ok === true)
back = await inbox(A)
check('撤回后卡退回', back.some((m) => m.kind === 'swap_back' && m.cardId === silver[1]))

r = await call('/api/market/swap', { id: A, code: codeOf(B), giveId: silver[1], wantId: silver[0] })
const OLD = String(r.id)
await sql`update card_swaps set made = now() - interval '4 days' where id = ${OLD}::bigint`
await call('/api/market/swaps', { id: B })   // any read sweeps
const st = (await sql`select status from card_swaps where id = ${OLD}::bigint` as unknown as { status: string }[])[0]
check('三天没答复自动撤回', st.status === 'expired', st.status)
back = await inbox(A)
check('过期的卡也退回', back.some((m) => m.kind === 'swap_back' && m.cardId === silver[1]))

// ---- the friend no longer holds the card --------------------------------
r = await call('/api/market/swap', { id: A, code: codeOf(B), giveId: silver[1], wantId: silver[0] })
const LOST = String(r.id)
await patch(B, 'cards', { [gold[1]]: owned(gold[1]) })   // he sold it meanwhile
r = await call('/api/market/swap_answer', { id: B, swap: LOST, accept: true })
check('对方已经没有那张卡：接受失败', r.notOwned === true, JSON.stringify(r))
check('交换当场作废', (await sql`select status from card_swaps where id = ${LOST}::bigint` as unknown as { status: string }[])[0].status === 'declined')
back = await inbox(A)
check('我的卡马上退回，不用等三天', back.some((m) => m.kind === 'swap_back' && m.cardId === silver[1]))

// ---- the alt gate -------------------------------------------------------
console.log('\n门槛：')
const N = 'VM-NEWW-NEWW-NEWW-NEWW-NEWW'
await call('/api/card/claim', { id: N, name: '新号' })
await patch(N, 'cards', { [silver[3]]: owned(silver[3]) })
r = await call('/api/market/swap', { id: N, code: codeOf(A), giveId: silver[3], wantId: silver[2] })
check('新号不能发起', r.newbie === true, JSON.stringify(r))
r = await call('/api/market/swap', { id: A, code: codeOf(N), giveId: silver[2], wantId: silver[3] })
check('也不能和新号换', r.theyNew === true, JSON.stringify(r))

// ---- the friend-cards lookup ---------------------------------------------
const fc = await call('/api/card/friend_cards', { code: codeOf(B) })
check('按对战码能看到对方有哪些卡', fc.ok === true && Array.isArray(fc.cards) && (fc.cards as unknown[]).length >= 1)
check('只有卡的编号和等级，没有账号', !JSON.stringify(fc).includes('VM-') && !JSON.stringify(fc).includes('coins') && !JSON.stringify(fc).includes('id_hash'))
check('没人用过的码是 missing', (await call('/api/card/friend_cards', { code: '00000000' })).missing === true)

// ---- nothing stranded ----------------------------------------------------
{
  const open = await sql`select count(*)::int as n from card_swaps where status = 'open'`
  const lost = await sql`
    select s.id from card_swaps s
    where s.status in ('declined', 'cancelled', 'expired')
      and not exists (select 1 from card_mail m where m.kind = 'swap_back' and m.to_h = s.from_h and m.card_id = s.give_id)`
  check(`每一个没成的交换都把卡退了（还挂着 ${open[0].n} 个）`, lost.length === 0, JSON.stringify(lost))
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
