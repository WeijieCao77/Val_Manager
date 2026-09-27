/**
 * 国家队杯 (ENC): five players and a coach of one nationality, one entry a day, no 体力, and the bracket is
 * OTHER PLAYERS' national fives (owner, 2026-09-27: 「国家杯也是玩家之间对战，不是打人机队伍」).
 *
 *   npx tsx scripts/check_enc.ts
 */
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { ENC_EMPTY, migrateGacha, newGacha, staminaNow } from '../src/engine/gacha'
import type { EncRival, GachaState } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import { BASE_PLAYER_CARDS, COACH_CARDS, squadRating } from '../src/engine/cards'
import { natCountry } from '../src/engine/nat'
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const byNat = (nat: string) => BASE_PLAYER_CARDS.filter((c) => natCountry(c.nat) === nat).sort((a, b) => b.rating - a.rating)
const coachOf = (nat: string) => COACH_CARDS.find((c) => !c.legend && natCountry(c.nat) === nat)!
const own = (g: GachaState, ids: string[]) => { for (const id of ids) g.cards[id] = { id, level: 0, dupes: 0, seen: 1, got: '2026-09-27' } }
const national = (id: string, nat: string, from = 0) => {
  const g = newGacha(id, `${nat}队`, '2026-09-20')
  const five = byNat(nat).slice(from, from + 5).map((c) => c.id)
  g.cards = {}
  own(g, [...five, coachOf(nat).id])
  g.squad = { slots: five, coach: coachOf(nat).id }
  return g
}
const rivalOf = (g: GachaState, nat: string, n: number): EncRival => ({
  id: `enc:${String(n).padStart(8, '0')}`, name: `玩家${n}`, tag: String(n).padStart(4, '0'), nat,
  slots: g.squad.slots, coach: g.squad.coach, levels: {}, score: squadRating(g.squad, () => 0), div: 0, points: 0,
})
const env = (today: string, n = 1, encPool?: EncRival[]) => ({ now: Date.parse(`${today}T06:00:00Z`) + n * 1000, today, seed: 7 + n, encPool })

// ---- the rules, in the engine
const kr = national('VM-TEST-ENC-KR', 'kr')
const empty = runAction(kr, 'enc_enter', {}, env('2026-09-28', 1, []))
check('池子里没人：报不了，说明原因，今天次数不扣', !empty.ok && empty.why === ENC_EMPTY && !kr.enc)
const pool = [
  rivalOf(national('a', 'cn'), 'cn', 1), rivalOf(national('b', 'us'), 'us', 2), rivalOf(national('c', 'br'), 'br', 3),
  rivalOf(national('d', 'jp'), 'jp', 4), rivalOf(national('e', 'kr', 5), 'kr', 5), rivalOf(national('f', 'tr'), 'tr', 6),
]
const stamina = staminaNow(kr, env('2026-09-28').now)
const entered = runAction(kr, 'enc_enter', {}, env('2026-09-28', 2, pool))
check('有别的玩家：报名成功', entered.ok && kr.enc?.nat === 'kr', entered.ok ? '' : entered.why)
check('不花体力', staminaNow(kr, env('2026-09-28').now) === stamina)
check('对手全是其他玩家的国家队，别国优先（这里不会碰到韩国）',
  !!kr.enc && kr.enc.path.every((id) => kr.enc!.rivals[id] && kr.enc!.rivals[id].nat !== 'kr' && id.startsWith('enc:')))
check('败者组的候补也记下了', !!kr.enc && Object.keys(kr.enc.rivals).length > kr.enc.path.length)
let n = 0
while (kr.enc && !kr.enc.done && n < 12) {
  const r = runAction(kr, 'enc_play', {}, env('2026-09-28', 10 + ++n))
  if (!r.ok) { check('打比赛', false, r.why); break }
}
check('一届打完', !!kr.enc?.done, `${n} 场`)
check('同一天不能再报', !runAction(kr, 'enc_enter', {}, env('2026-09-28', 30, pool)).ok)
check('第二天可以再报', runAction(kr, 'enc_enter', {}, env('2026-09-29', 31, pool)).ok && kr.enc?.day === '2026-09-29')
// a thin pool: fewer rounds, never the same side twice
const thin = national('VM-TEST-ENC-THIN', 'kr')
runAction(thin, 'enc_enter', {}, env('2026-09-28', 40, pool.slice(0, 2)))
check('池子只有两队：两轮，不重复', thin.enc?.path.length === 2 && new Set(thin.enc.path).size === 2)
// the rule: one nationality, all six
const mixed = national('VM-TEST-ENC-MIX', 'kr')
const cn = byNat('cn')[0]
own(mixed, [cn.id])
mixed.squad = { ...mixed.squad, slots: [...mixed.squad.slots.slice(0, 4), cn.id] }
const refused = runAction(mixed, 'enc_enter', {}, env('2026-09-28', 50, pool))
check('混了一个中国选手：不能报，说清楚有哪几国', !refused.ok && /同一国籍/.test(refused.why) && /中国/.test(refused.why) && /韩国/.test(refused.why))
mixed.squad = { ...national('x', 'kr').squad, coach: null }
check('没有教练：不能报', !runAction(mixed, 'enc_enter', {}, env('2026-09-28', 51, pool)).ok)

// a bracket left from the half hour ENC was played against AI national teams: no rivals, an AI path, ease
const stale = national('VM-TEST-ENC-OLD', 'kr')
;(stale as unknown as { enc: unknown }).enc = {
  path: ['enc-us', 'enc-br', 'enc-cn'], round: 0, legs: [], done: false, won: false, entry: 0, double: true, ease: -4,
  day: '2026-09-27', nat: 'kr', registration: { squad: stale.squad, levels: {} },
}
const healed = migrateGacha(structuredClone(stale), 'VM-TEST-ENC-OLD')
check('旧版人机国家队杯（没有对手资料）：读档时清掉', !healed.enc)
check('清掉以后当天还能报名', runAction(healed, 'enc_enter', {}, env('2026-09-27', 60, pool)).ok && healed.enc?.day === '2026-09-27'
  && !!healed.enc.rivals[healed.enc.path[0]])
check('然后打得了', runAction(healed, 'enc_play', {}, env('2026-09-27', 61)).ok)

// ---- through the server: the first entrant is kept for the second to meet
const { CARD_SCHEMA, makeCardApi } = await import('../cards-api.js')
const db = new PGlite()
const sql = makeSql(db)
await db.exec(CARD_SCHEMA)
interface Res { code: number; body: Record<string, any> }
const api = makeCardApi(sql, {
  rateLimited: () => false,
  readBody: (req: { body: string }) => Promise.resolve(req.body),
  json: (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body },
} as never)
const call = async (path: string, body: unknown): Promise<Res> => {
  const res: Res = { code: 0, body: {} }
  await api.route({ body: JSON.stringify(body), method: 'POST' } as never, res as never, path, 'test')
  return res
}
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
const put = async (id: string, g: GachaState) => {
  await sql`insert into card_accounts (id_hash, name, state, created, seen, verified)
    values (${hash(id)}, ${g.name}, ${sql.json({ ...g, id })}, now() - interval '9 days', now(), now())`
}
const A = 'VM-1111-2222-3333-4444-5555', B = 'VM-2222-3333-4444-5555-6666', C = 'VM-3333-4444-5555-6666-7777'
await put(A, national(A, 'cn'))
// B already fields six Brazilians and never entered: the server's scan finds him
await put(B, national(B, 'br'))
await put(C, national(C, 'us'))
const first = await call('/api/card/act', { id: A, action: 'enc_enter' })
check('第一个报名的人碰到服务器找到的巴西玩家', first.body.ok === true && first.body.state?.enc?.path?.includes(`enc:${hash(B).slice(0, 8)}`), JSON.stringify(first.body).slice(0, 200))
await new Promise((r) => setTimeout(r, 200))
const kept = await sql`select id_hash, nat, score from enc_entries order by id_hash` as unknown as { id_hash: string; nat: string }[]
check('报名的人和扫到的人都进了池子', kept.some((r) => r.id_hash === hash(A) && r.nat === 'cn') && kept.some((r) => r.id_hash === hash(B) && r.nat === 'br'))
const second = await call('/api/card/act', { id: C, action: 'enc_enter' })
const path: string[] = second.body.state?.enc?.path ?? []
check('第二个人的对手里有第一个人（真人，不是人机）', second.body.ok === true && path.includes(`enc:${hash(A).slice(0, 8)}`), JSON.stringify(path))
check('不会碰到自己', !path.includes(`enc:${hash(C).slice(0, 8)}`))
const played = await call('/api/card/act', { id: C, action: 'enc_play' })
check('打得了', played.body.ok === true && typeof played.body.result?.res?.win === 'boolean', JSON.stringify(played.body).slice(0, 160))
await db.close()

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
