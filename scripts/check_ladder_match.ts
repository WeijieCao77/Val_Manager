/**
 * Who the ladder puts across the net at 钻石 and above, on the real server.
 *
 *   npx tsx scripts/check_ladder_match.ts
 *
 * A rival within four points when there is one, the nearest within eight
 * when there is not, a club when nobody is that close; and a loss to a five
 * six or more above yours costs no star and half the 大师 points.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { newGacha, recordLadder, MASTER_LOSS, RIVAL_MERCY_GAP } from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import { squadRating } from '../src/engine/cards'
import { runAction } from '../src/engine/cardActions'

const { CARD_SCHEMA, makeCardApi } = await import('../cards-api.js')
let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const db = new PGlite(), sql = makeSql(db)
await db.exec(CARD_SCHEMA)
type Reply = { code: number; body: Record<string, any> }
const json = (res: Reply, code: number, body: Reply['body']) => { res.code = code; res.body = body }
const cards = makeCardApi(sql, { rateLimited: () => false, readBody: async (req: { body: string }) => req.body, json } as never)
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
async function call(path: string, body: unknown) {
  const out: Reply = { code: 0, body: { ok: false } }
  await cards.route({ method: 'POST', body: JSON.stringify(body) } as never, out as never, path, 'ladder-match-test')
  return out.body
}
const today = new Date().toISOString().slice(0, 10)
const sorted = CUP_TEAMS.slice().sort((a, b) => a.rating - b.rating)
const idOf = (i: number) => `VM-CVPM-CVPM-CVPM-CVPM-CV${'0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(i / 32)]}${'0123456789ABCDEFGHJKMNPQRSTVWXYZ'[i % 32]}`
async function account(i: number, team: typeof CUP_TEAMS[number], div = 4) {
  const id = idOf(i)
  await call('/api/card/claim', { id, name: `天梯${i}` })
  const g: GachaState = newGacha(id, `天梯${i}`, today)
  const ids = [...team.squad.slots, team.squad.coach].filter((x): x is string => !!x)
  g.cards = Object.fromEntries(ids.map((c) => [c, { id: c, level: 0, dupes: 0, seen: 1, got: today }]))
  g.squad = structuredClone(team.squad)
  g.ladder = { ...g.ladder, div, stars: 2, best: div }
  g.daily.staminaAt = Date.now()
  await sql`update card_accounts set state = ${sql.json(g)} where id_hash = ${hash(id)}`
  return { id, score: squadRating(team.squad) }
}

try {
  // a 钻石 pool spread from the bottom of the table to the top
  const pool = [] as { id: string; score: number }[]
  for (let i = 0; i < sorted.length; i += 3) pool.push(await account(i, sorted[i]))
  const mid = sorted[Math.floor(sorted.length / 2)]
  const me = await account(900, mid)
  cards.invalidate()
  const gaps: number[] = []
  const tags = new Set<string>()
  let clubs = 0
  for (let k = 0; k < 40; k++) {
    // a fresh match number each time: the pinned opponent is cleared by resetting the record
    await sql`update card_accounts set state = jsonb_set(state, '{ladder,pending}', 'null'::jsonb) where id_hash = ${hash(me.id)}`
    const r = await call('/api/card/act', { id: me.id, action: 'ladder_draw', args: {}, client: {} })
    const rival = r.result?.pending?.rival
    if (!rival) { clubs++; continue }
    tags.add(String(rival.tag).toUpperCase())
    gaps.push(Math.abs(squadRating(rival, (id: string) => rival.levels?.[id] ?? 0) - me.score))
  }
  check('池子里有接近的人时，抽到的都在 4 分以内', gaps.length > 0 && Math.max(...gaps) <= 4, `${gaps.length} 次真人，最大分差 ${Math.max(...gaps)}，${clubs} 次俱乐部`)
  check('抽到的不是自己，也不总是同一个人', !tags.has(`#${hash(me.id).slice(0, 4).toUpperCase()}`) && tags.size > 1, [...tags].join(' '))

  // nobody near: a five far above everybody in the pool
  await sql`delete from card_accounts where id_hash <> ${hash(me.id)}`
  const low = [] as { id: string; score: number }[]
  for (let i = 0; i < 6; i++) low.push(await account(100 + i, sorted[i]))
  cards.invalidate()
  await sql`update card_accounts set state = jsonb_set(state, '{ladder,pending}', 'null'::jsonb) where id_hash = ${hash(me.id)}`
  let r = await call('/api/card/act', { id: me.id, action: 'ladder_draw', args: {}, client: {} })
  check('8 分以内没有人：打俱乐部，不硬塞一个差很多的真人',
    !r.result?.pending?.rival && !!r.result?.pending?.club && me.score - Math.max(...low.map((x) => x.score)) > 8,
    `我 ${me.score}，池子最高 ${Math.max(...low.map((x) => x.score))}`)

  // one five 5–8 away: taken as the nearest
  await sql`delete from card_accounts where id_hash <> ${hash(me.id)}`
  const six = sorted.find((t) => { const d = squadRating(t.squad) - me.score; return d >= 5 && d <= 8 })!
  const near = await account(200, six)
  cards.invalidate()
  await sql`update card_accounts set state = jsonb_set(state, '{ladder,pending}', 'null'::jsonb) where id_hash = ${hash(me.id)}`
  r = await call('/api/card/act', { id: me.id, action: 'ladder_draw', args: {}, client: {} })
  check('4 分以内没有、8 分以内有：抽最近的那个', !!r.result?.pending?.rival, `对面 ${near.score}，我 ${me.score}`)

  // the mercy rule, on the rules themselves
  const g = newGacha('VM-CVPM-CVPM-CVPM-CVPM-CVZZ', '保护', today)
  g.ladder = { ...g.ladder, div: 4, stars: 2, best: 4 }
  let out = recordLadder(g, false, 90, 'open', true)
  check('强敌局输了不掉星', out.spared === true && g.ladder.stars === 2 && g.ladder.losses === 1 && out.coins === 30)
  out = recordLadder(g, false, 90, 'open', false)
  check('普通局输了照常掉星', !out.spared && g.ladder.stars === 1)
  g.ladder = { ...g.ladder, div: 5, stars: 0, points: 100, bestPoints: 100 }
  out = recordLadder(g, false, 90, 'open', true)
  check('大师强敌局只扣一半', out.spared === true && out.pointsDelta === -Math.ceil(MASTER_LOSS / 2), `${out.pointsDelta}`)
  out = recordLadder(g, false, 90, 'open', false)
  check('大师普通局照常扣', out.pointsDelta === -MASTER_LOSS)
  const before = g.ladder.points!
  out = recordLadder(g, true, 90, 'open', true)
  check('强敌局赢了照常加分，没有额外奖励', !out.spared && g.ladder.points! > before)

  // and through the action: the flag is set from the two fives, never from the client
  const strong = sorted[sorted.length - 1], weak = sorted[Math.floor(sorted.length / 3)]
  const a = newGacha('VM-CVPM-CVPM-CVPM-CVPM-CVZY', '动作', today)
  const ids = [...weak.squad.slots, weak.squad.coach].filter((x): x is string => !!x)
  a.cards = Object.fromEntries(ids.map((c) => [c, { id: c, level: 0, dupes: 0, seen: 1, got: today }])) as never
  a.squad = structuredClone(weak.squad)
  a.ladder = { ...a.ladder, div: 4, stars: 2, best: 4 }
  a.daily.staminaAt = Date.now()
  const rival = { name: '强敌', tag: '#0000', slots: strong.squad.slots, coach: strong.squad.coach, levels: {}, div: 4, points: 0 }
  let spared = 0, lost = 0
  for (let k = 0; k < 12; k++) {
    a.ladder.pending = undefined
    a.daily.stamina = 30
    const res = runAction(a, 'ladder', { mercy: false }, { now: Date.now(), today, seed: 1000 + k, rival })
    const o = (res as { result: { out: { win: boolean; spared?: boolean } } }).result.out
    if (!o.win) { lost++; if (o.spared) spared++ }
  }
  check(`分差 ${squadRating(strong.squad) - squadRating(weak.squad)} ≥ ${RIVAL_MERCY_GAP}：每一场输的都受保护，星没少`, lost > 0 && spared === lost && a.ladder.stars >= 2, `${spared}/${lost}`)
} catch (err) {
  console.error(err)
  bad++
}
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
