/**
 * A cosmetic save must not write over a value change that landed meanwhile.
 *
 *   npx tsx scripts/check_save_race.ts
 *
 * /api/card/save reads the account, merges the client's name/squad into it,
 * and writes the merged copy back. The write used to be guarded by the
 * client's baseRev rather than the rev it had read, so a client claiming
 * rev+1 matched the revision a pack opening or a market listing had just
 * produced and put the older copy back: coins spent on a pack returned, a
 * listed card stayed in the account as well as on the shelf (reproduced
 * 2026-09-24). This drives both races at the exact statement, fires the
 * unhooked version many times, and checks the ordinary saves still land.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
process.env.TRADE_DAYS = '0'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { ALL_CARDS } from '../src/engine/cards'

const { CARD_SCHEMA, makeCardApi, normalizeId } = await import('../cards-api.js')
const { makeMarketApi } = await import('../market-api.js')
const { displayName } = await import('../names.js')
const engine = await import('../src/engine/server')
let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const db = new PGlite(), sql = makeSql(db)
await db.exec(CARD_SCHEMA)
const hash = (id: string) => createHash('sha256').update(id).digest('hex')

// a sql that lets a rival request run to completion right after save's read
let race: (() => Promise<void>) | null = null
const racing = ((strings: TemplateStringsArray, ...vals: unknown[]) => {
  const p = (sql as any)(strings, ...vals)
  if (race && /^\s*select state, rev from card_accounts where id_hash = \?\s*$/.test(strings.join('?'))) {
    const go = race
    race = null
    return p.then(async (rows: unknown) => { await go(); return rows })
  }
  return p
}) as any
Object.assign(racing, { json: (sql as any).json, begin: (sql as any).begin?.bind(sql), unsafe: (sql as any).unsafe?.bind(sql) })

type Reply = { code: number; body: Record<string, any> }
const json = (res: Reply, code: number, body: Reply['body']) => { res.code = code; res.body = body }
const opts = { rateLimited: () => false, readBody: async (req: { body: string }) => req.body, json }
const saver = makeCardApi(racing, opts as never)
const cards = makeCardApi(sql, opts as never)
const market = makeMarketApi(sql, { ...opts, normalizeId, displayName, engine, timer: false } as never)
async function call(api: { route: Function }, path: string, body: unknown) {
  const out: Reply = { code: 0, body: { ok: false } }
  await api.route({ method: 'POST', body: JSON.stringify(body), headers: {} } as never, out as never, path, 'save-race')
  return out
}
const row = async (id: string) => (await sql`select state, rev from card_accounts where id_hash = ${hash(id)}`)[0] as { state: any; rev: number }

const MYTH = ALL_CARDS.find((c: any) => c.rarity === 'mythic' && c.kind === 'player')!.id
async function account(id: string, coins: number, held: Record<string, unknown>) {
  await call(cards, '/api/card/claim', { id, name: 'race' })
  await sql`update card_accounts set state = state || ${sql.json({ coins, cards: held, pulls: 500 })}::jsonb,
            created = now() - interval '10 days' where id_hash = ${hash(id)}`
}
const mythHeld = () => ({ [MYTH]: { id: MYTH, level: 0, dupes: 0, seen: 1 } })

try {
  // 1. a pack opens between save's read and its write
  const A = 'VM-SAVE-SAVE-SAVE-SAVE-SVA1'
  await account(A, 10000, {})
  const a0 = await row(A)
  let opened: Reply | null = null
  race = async () => { opened = await call(cards, '/api/card/act', { id: A, action: 'open', args: { kind: 'scout', payWith: 'coins' }, client: {} }) }
  const s1 = await call(saver, '/api/card/save', { id: A, baseRev: a0.rev + 1, client: { name: 'x' } })
  const a1 = await row(A)
  check('开包确实成功了', !!opened && (opened as Reply).body.ok === true)
  check('开包花掉的金币没有被存档盖回去', a1.state.coins === (opened as Reply | null)?.body.state?.coins && a1.state.coins < 10000, `库里 ${a1.state.coins}`)
  check('开出的卡还在', Object.keys(a1.state.cards).length > 0)
  check('抢跑的 save 被拒并拿到当前版本', s1.code === 409 && s1.body.rev === a1.rev, `code ${s1.code} rev ${s1.body.rev}/${a1.rev}`)

  // 2. a card is listed between save's read and its write
  const S = 'VM-SAVE-SAVE-SAVE-SAVE-SVS2'
  await account(S, 100, mythHeld())
  const r0 = await row(S)
  let listed: Reply | null = null
  race = async () => { listed = await call(market, '/api/market/list', { id: S, cardId: MYTH, ask: 5000 }) }
  const s2 = await call(saver, '/api/card/save', { id: S, baseRev: r0.rev + 1, client: { name: 'y' } })
  const r1 = await row(S)
  check('上架确实成功了', (listed as Reply | null)?.body.ok === true)
  check('上架的卡不会同时留在账号里', !r1.state.cards[MYTH])
  check('抢跑的 save 被拒', s2.code === 409, `code ${s2.code}`)

  // 3. no hook: a save claiming rev+1 fired together with a listing, many times
  let dup = 0, tries = 0
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  for (let i = 0; i < 24; i++) {
    const id = normalizeId('VM-SVRC-SVRC-SVRC-SVRC-SV' + B32[i >> 5] + B32[i & 31])!
    await account(id, 100, mythHeld())
    const before = await row(id)
    tries++
    const [l, s] = await Promise.all([
      call(market, '/api/market/list', { id, cardId: MYTH, ask: 5000 }),
      call(cards, '/api/card/save', { id, baseRev: before.rev + 1, client: { name: 'z' } }),
    ])
    const after = await row(id)
    if (l.body.ok && s.body.ok && after.state.cards[MYTH]) dup++
  }
  check('同时上架 + 存档，没有一次复制出卡', dup === 0, `${dup}/${tries}`)

  // 4. ordinary saves
  const C = 'VM-SAVE-SAVE-SAVE-SAVE-SVC3'
  await account(C, 500, {})
  const c0 = await row(C)
  const ok = await call(cards, '/api/card/save', { id: C, baseRev: c0.rev, client: { name: '新名字' } })
  const c1 = await row(C)
  check('版本对得上的存档照常写入', ok.code === 200 && ok.body.ok && c1.state.name === '新名字' && c1.rev === c0.rev + 1 && c1.state.coins === 500)
  const stale = await call(cards, '/api/card/save', { id: C, baseRev: c0.rev, client: { name: '旧标签页' } })
  check('旧版本的存档被拒，名字不变', stale.code === 409 && (await row(C)).state.name === '新名字')
  const ahead = await call(cards, '/api/card/save', { id: C, baseRev: c1.rev + 1, client: { name: '超前' } })
  check('声称更新版本的存档被拒', ahead.code === 409 && (await row(C)).rev === c1.rev)
  const none = await call(cards, '/api/card/save', { id: C, client: { name: '没有版本' } })
  check('没有版本号的存档被拒', none.code === 409 && (await row(C)).state.name === '新名字')
} finally {
  await db.close()
}
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
