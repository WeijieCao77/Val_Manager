/**
 * An old account's first load must not write over what happened meanwhile.
 *
 *   npx tsx scripts/check_load_race.ts
 *
 * A save with no 体力 anchor is migrated on load and written back. That write
 * used to be unconditional: read 1,000 coins, a trade settles to 777 and moves
 * the revision, the load writes its older copy — 1,000 again, revision
 * unchanged (reproduced 2026-09-18). It is a compare-and-swap on the revision
 * now; this drives the race on purpose, at the exact statement, and then
 * checks the ordinary cases still behave.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { newGacha } from '../src/engine/gacha'

const { CARD_SCHEMA, makeCardApi } = await import('../cards-api.js')
let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const db = new PGlite(), sql = makeSql(db)
await db.exec(CARD_SCHEMA)
const hash = (id: string) => createHash('sha256').update(id).digest('hex')

// a sql that lets a rival write slip in just before load's write-back
let race: (() => Promise<void>) | null = null
const racing = ((strings: TemplateStringsArray, ...vals: unknown[]) => {
  const text = strings.join('?')
  if (race && /update card_accounts set state/.test(text)) {
    const go = race
    race = null
    return go().then(() => (sql as any)(strings, ...vals))
  }
  return (sql as any)(strings, ...vals)
}) as any
Object.assign(racing, { json: (sql as any).json, begin: (sql as any).begin?.bind(sql), unsafe: (sql as any).unsafe?.bind(sql) })

type Reply = { code: number; body: Record<string, any> }
const json = (res: Reply, code: number, body: Reply['body']) => { res.code = code; res.body = body }
const cards = makeCardApi(racing, { rateLimited: () => false, readBody: async (req: { body: string }) => req.body, json } as never)
async function call(path: string, body: unknown) {
  const out: Reply = { code: 0, body: { ok: false } }
  await cards.route({ method: 'POST', body: JSON.stringify(body) } as never, out as never, path, 'load-race')
  return out.body
}
const row = async (id: string) => (await sql`select state, rev from card_accounts where id_hash = ${hash(id)}`)[0] as { state: any; rev: number }

const today = new Date().toISOString().slice(0, 10)
async function oldAccount(id: string) {
  await call('/api/card/claim', { id, name: '旧账号' })
  const g = newGacha(id, '旧账号', today)
  g.coins = 1000
  delete (g.daily as { staminaAt?: number }).staminaAt
  await sql`update card_accounts set state = ${sql.json(g)}, rev = 1 where id_hash = ${hash(id)}`
}

try {
  // 1. the race, at the statement where it used to be lost
  const A = 'VM-CVPM-CVPM-CVPM-CVPM-CVA1'
  await oldAccount(A)
  race = async () => {
    await sql`update card_accounts set state = jsonb_set(state, '{coins}', '777'), rev = rev + 1 where id_hash = ${hash(A)}`
  }
  const reply = await call('/api/card/load', { id: A })
  const after = await row(A)
  check('并发交易后的金币没有被旧快照盖回去', after.state.coins === 777, `库里 ${after.state.coins}`)
  check('迁移还是做了：体力锚点已写入', Number(after.state.daily?.staminaAt) > 0)
  check('版本只升不停：交易 +1，迁移写回 +1', after.rev === 3, `rev ${after.rev}`)
  check('load 回给客户端的是实际版本和实际金币', reply.ok && reply.rev === after.rev && reply.state.coins === 777,
    `reply rev ${reply.rev} coins ${reply.state?.coins}`)

  // 2. no race: one write, one revision
  const B = 'VM-CVPM-CVPM-CVPM-CVPM-CVB2'
  await oldAccount(B)
  const r2 = await call('/api/card/load', { id: B })
  const b = await row(B)
  check('没有并发时：写回一次，版本 +1，回复与库一致', b.rev === 2 && r2.rev === 2 && r2.state.coins === 1000 && Number(b.state.daily.staminaAt) > 0)

  // 3. already migrated: load writes no state and leaves the revision alone
  const r3 = await call('/api/card/load', { id: B })
  const b3 = await row(B)
  check('已迁移的账号：load 不再写 state，版本不动', r3.rev === 2 && b3.rev === 2 && b3.state.daily.staminaAt === b.state.daily.staminaAt)

  // 4. a cosmetic save from another tab in the gap (it does not set the anchor): the retry still lands
  const C = 'VM-CVPM-CVPM-CVPM-CVPM-CVC3'
  await oldAccount(C)
  race = async () => {
    await sql`update card_accounts set state = jsonb_set(state, '{name}', '"改名"'), rev = rev + 1 where id_hash = ${hash(C)}`
  }
  const r4 = await call('/api/card/load', { id: C })
  const c = await row(C)
  check('间隙里的改名保住了，迁移在新版本上重做', c.state.name === '改名' && Number(c.state.daily.staminaAt) > 0 && c.rev === 3 && r4.rev === 3)
} finally {
  await db.close()
}
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
