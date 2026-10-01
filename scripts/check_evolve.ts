/**
 * 进修 (engine/evolve.ts): a +5 player card, one attribute, five spare copies eaten.
 *
 *   npx tsx scripts/check_evolve.ts          rules, the +0…+5 identity, the server paths
 *   npx tsx scripts/check_evolve.ts 600      and what a trained five is worth, over 600 BO3
 */
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { migrateGacha, newGacha, playLevelOf, registerCupSquad } from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import {
  BASE_PLAYER_CARDS, EVO_LEVEL_ROOM, LEVEL_GAIN, MAX_LEVEL, squadPaper,
} from '../src/engine/cards'
import type { PlayerCard } from '../src/engine/cards'
import { EVO_FEED, EVO_STEPS, evoRating, playLevel } from '../src/engine/evolve'
import { escrowCard } from '../src/engine/inbox'
import { playRivalMatch } from '../src/engine/arena'
import { ROLE_WEIGHT } from '../src/engine/player'
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const env = (n = 1) => ({ now: Date.parse('2026-09-28T06:00:00Z') + n * 1000, today: '2026-09-28', seed: 7 + n })
const byRole = (role: string) => BASE_PLAYER_CARDS.filter((c) => c.role === role).sort((a, b) => b.rating - a.rating)
const own = (g: GachaState, id: string, level = 0, dupes = 0) => {
  g.cards[id] = { id, level, dupes, seen: 1 + dupes, got: '2026-09-20' }
}

// ---- the rules
const duel = byRole('决斗者')
const target = duel[3] // a strong duelist, not at 99 aim
const g = newGacha('VM-TEST-EVO-0001', '进修', '2026-09-20')
g.cards = {}
own(g, target.id, 4)
const golds = duel.filter((c) => c.id !== target.id && c.attrs.aim >= 88).slice(0, 3)
const bronzeDuel = duel.filter((c) => c.rarity === 'bronze').slice(0, 2)
const offRole = BASE_PLAYER_CARDS.find((c) => !c.roles.includes('决斗者') && c.attrs.aim < 80)!
const offRoleAim = BASE_PLAYER_CARDS.find((c) => !c.roles.includes('决斗者') && c.attrs.aim >= 85)!
for (const c of [...golds, ...bronzeDuel, offRole, offRoleAim]) own(g, c.id, 0, 12)
const five = (ids: string[]) => ids.slice(0, EVO_FEED)
const goldFeed = five([golds[0].id, golds[0].id, golds[1].id, golds[1].id, golds[2].id])

const notMax = runAction(g, 'evolve', { cardId: target.id, attr: 'aim', feed: goldFeed }, env(1))
check('+4 的卡不能进修', !notMax.ok && /\+5/.test(notMax.why), notMax.ok ? '' : notMax.why)
g.cards[target.id].level = MAX_LEVEL
check('没进修过：比赛等级就是 +5（整数）', playLevelOf(g, target.id) === MAX_LEVEL)
const four = runAction(g, 'evolve', { cardId: target.id, attr: 'aim', feed: goldFeed.slice(0, 4) }, env(2))
check('只放 4 张：不行', !four.ok)
const wrong = runAction(g, 'evolve', { cardId: target.id, attr: 'aim', feed: [...goldFeed.slice(0, 4), offRole.id] }, env(3))
check('混进一张不同位置、枪法也不到 80 的：不行，说出是哪张', !wrong.ok && wrong.why.includes(offRole.ign), wrong.ok ? '' : wrong.why)
const notAttr = runAction(g, 'evolve', { cardId: target.id, attr: 'luck', feed: goldFeed }, env(4))
check('不存在的能力：不行', !notAttr.ok)
g.cards[golds[2].id].dupes = 0
const noDupes = runAction(g, 'evolve', { cardId: target.id, attr: 'aim', feed: goldFeed }, env(5))
check('重复卡不够：不行', !noDupes.ok && /重复卡不够/.test(noDupes.why))
g.cards[golds[2].id].dupes = 12

const aimBefore = target.attrs.aim
const dupesBefore = goldFeed.map((id) => g.cards[id].dupes)
const r1 = runAction(g, 'evolve', { cardId: target.id, attr: 'aim', feed: goldFeed }, env(6))
const e1 = g.cards[target.id].evo
check('五张金卡枪法都 88 以上：枪法 +3', r1.ok && (r1.result as { gain: number }).gain === Math.min(3, 99 - aimBefore) && e1?.add.aim === Math.min(3, 99 - aimBefore), JSON.stringify(e1))
check('吃掉的正好是那五张重复卡', golds[0].id in g.cards && g.cards[golds[0].id].dupes === dupesBefore[0] - 2 && g.cards[golds[2].id].dupes === dupesBefore[4] - 1)
check('收藏里的卡本身没动', golds.every((c) => !!g.cards[c.id]))
const pl = playLevelOf(g, target.id)
check('比赛等级 = +5 加进修（枪法 +3 × 决斗者权重 0.28 ÷ 1.5）', Math.abs(pl - (MAX_LEVEL + (3 * ROLE_WEIGHT.决斗者.aim) / LEVEL_GAIN)) < 1e-9, pl.toFixed(4))
const bronzeFeed = five([bronzeDuel[0].id, bronzeDuel[0].id, bronzeDuel[1].id, bronzeDuel[1].id, bronzeDuel[1].id])
const r2 = runAction(g, 'evolve', { cardId: target.id, attr: 'clutch', feed: bronzeFeed }, env(7))
check('五张铜卡同位置（残局平均 < 78）：+1', r2.ok && (r2.result as { gain: number }).gain === 1, r2.ok ? JSON.stringify(r2.result) : r2.why)
const r3 = runAction(g, 'evolve', { cardId: target.id, attr: 'aim', feed: five([offRoleAim.id, offRoleAim.id, offRoleAim.id, offRoleAim.id, offRoleAim.id]) }, env(8))
check('不同位置但枪法 80 以上：可以用', r3.ok, r3.ok ? '' : r3.why)
for (let i = 0; i < 5; i++) runAction(g, 'evolve', { cardId: target.id, attr: 'reaction', feed: goldFeed }, env(9 + i))
check(`最多进修 ${EVO_STEPS} 次`, g.cards[target.id].evo?.n === EVO_STEPS)
const over = runAction(g, 'evolve', { cardId: target.id, attr: 'reaction', feed: goldFeed }, env(20))
check('第六次：不行', !over.ok && /满了/.test(over.why))
const worth = evoRating(target, g.cards[target.id].evo)
check('进修的比赛等级不超过上限', playLevelOf(g, target.id) <= MAX_LEVEL + EVO_LEVEL_ROOM && worth / LEVEL_GAIN <= EVO_LEVEL_ROOM, worth.toFixed(2))

// ---- 99 is a ceiling
// the best aim among duelists that are not in the feed: a card cannot be fed to itself
const high = BASE_PLAYER_CARDS.filter((c) => c.role === '决斗者' && !golds.includes(c)).sort((a, b) => b.attrs.aim - a.attrs.aim)[0]
const h = newGacha('VM-TEST-EVO-0002', '满', '2026-09-20')
h.cards = {}
own(h, high.id, MAX_LEVEL)
for (const c of golds) own(h, c.id, 0, 12)
const room = 99 - high.attrs.aim
const hr = runAction(h, 'evolve', { cardId: high.id, attr: 'aim', feed: goldFeed }, env(30))
check(`枪法 ${high.attrs.aim} 的卡：最多加到 99`, room === 0 ? !hr.ok : hr.ok && (hr.result as { gain: number }).gain === Math.min(3, room), `${high.ign} ${high.attrs.aim}`)

// ---- the stored shape
const junk = newGacha('VM-TEST-EVO-0003', 'x', '2026-09-20')
junk.cards = {}
own(junk, target.id, MAX_LEVEL)
;(junk.cards[target.id] as unknown as { evo: unknown }).evo = { n: 99, add: { aim: 'NaN', igl: 5, hax: 40 } }
own(junk, duel[5].id, MAX_LEVEL)
;(junk.cards[duel[5].id] as unknown as { evo: unknown }).evo = 'lots'
const clean = migrateGacha(structuredClone(junk), 'VM-TEST-EVO-0003')
check('读档：进修次数不超过 5，坏字段丢掉', clean.cards[target.id].evo?.n === EVO_STEPS && JSON.stringify(clean.cards[target.id].evo?.add) === '{"igl":5}')
check('读档：不是对象的进修整个丢掉', !clean.cards[duel[5].id].evo)
check('没进修的卡：playLevel 就是等级', [0, 1, 2, 3, 4, 5].every((lv) => playLevel(target.id, { level: lv }) === lv))
const reg = registerCupSquad({ slots: [target.id, null, null, null, null], coach: null }, (id) => playLevelOf(g, id))
check('杯赛报名记下带进修的等级', Math.abs(reg.levels[target.id] - playLevelOf(g, target.id)) < 1e-12)

// ---- the market: an evolved card itself never leaves; its duplicates do
const m = newGacha('VM-TEST-EVO-0004', 'm', '2026-09-20')
m.cards = {}
own(m, target.id, MAX_LEVEL, 1)
m.cards[target.id].evo = { n: 1, add: { aim: 2 } }
const e1st = escrowCard(m, target.id)
check('进修过的卡：先挂出去的是重复卡', e1st.ok && e1st.level === 0 && !!m.cards[target.id]?.evo)
const e2nd = escrowCard(m, target.id)
check('进修过的卡本身：挂不出去', !e2nd.ok && !!m.cards[target.id]?.evo)

// ---- what it is worth: a five at +5, against itself after five 进修 each, every one spent greedily on the attribute
// that adds most with room left under 99 (a top card's best attributes are near 99 already, so it spreads)
type K = keyof PlayerCard['attrs']
const greedy = (c: PlayerCard, gain = 3): Partial<Record<K, number>> => {
  const add: Partial<Record<K, number>> = {}
  for (let step = 0; step < EVO_STEPS; step++) {
    const pick = (Object.keys(ROLE_WEIGHT[c.role]) as K[])
      .map((k) => ({ k, g: Math.min(gain, 99 - c.attrs[k] - (add[k] ?? 0)) }))
      .sort((a, b) => b.g * ROLE_WEIGHT[c.role][b.k] - a.g * ROLE_WEIGHT[c.role][a.k])[0]
    if (pick.g > 0) add[pick.k] = (add[pick.k] ?? 0) + pick.g
  }
  return add
}
const N = Number(process.argv[2]) || 0
const measure = (label: string, squadIds: PlayerCard[], gain: number) => {
  const squad = { slots: squadIds.map((c) => c.id), coach: null }
  const base = (id: string) => (squad.slots.includes(id) ? MAX_LEVEL : 0)
  const trained = Object.fromEntries(squadIds.map((c) => [c.id, playLevel(c.id, { level: MAX_LEVEL, evo: { n: EVO_STEPS, add: greedy(c, gain) } })]))
  const tLevel = (id: string) => trained[id] ?? 0
  const paperGain = squadPaper(squad, tLevel).score - squadPaper(squad, base).score
  let line = `${label}（每次 +${gain}）：阵容分 +${paperGain.toFixed(2)}，战力 +${Math.round(paperGain * 500)}`
  if (N) {
    let w = 0
    const rival = { name: 'B', tag: '#0', slots: squad.slots, coach: null, levels: Object.fromEntries(squad.slots.map((id) => [id, MAX_LEVEL])), div: 0, points: 0 }
    for (let i = 0; i < N; i++) if (playRivalMatch(squad, tLevel, rival, 3, 1000 + i, undefined, true).win) w++
    line += `，对没进修的自己 ${N} 场 BO3 赢 ${(100 * w / N).toFixed(1)}%`
  }
  console.log(line)
  return paperGain
}
console.log('\n满进修（5 次）的五人，对比同一套只到 +5：')
const roles = ['决斗者', '先锋', '控场', '哨卫', '决斗者']
const topFive = roles.map((r, i) => byRole(r)[i >= 4 ? 1 : 0] as PlayerCard)
const midFive = roles.map((r, i) => byRole(r).filter((c) => c.rating <= 84)[i >= 4 ? 1 : 0] as PlayerCard)
console.log(`  顶级：${topFive.map((c) => `${c.ign} ${c.rating}`).join(' · ')}`)
console.log(`  中游：${midFive.map((c) => `${c.ign} ${c.rating}`).join(' · ')}`)
for (const gain of [3, 1]) {
  measure('  顶级', topFive, gain)
  measure('  中游', midFive, gain)
}

// ---- through the server: the action, and the five a friend meets
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
const A = 'VM-1111-2222-3333-4444-5555'
const s = newGacha(A, '进修服', '2026-09-20')
s.cards = {}
for (const c of golds) own(s, c.id, 0, 12)
// the gold duelists may be in the five too: they keep their spare copies and go to +5
for (const c of topFive) if (s.cards[c.id]) s.cards[c.id].level = MAX_LEVEL; else own(s, c.id, MAX_LEVEL)
s.squad = { slots: topFive.map((c) => c.id), coach: null }
const squadIds = topFive
await sql`insert into card_accounts (id_hash, name, state, created, seen, verified)
  values (${hash(A)}, ${s.name}, ${sql.json({ ...s, id: A })}, now() - interval '9 days', now(), now())`
const acted = await call('/api/card/act', { id: A, action: 'evolve', args: { cardId: squadIds[0].id, attr: 'aim', feed: goldFeed } })
check('服务器上进修成功', acted.body.ok === true && acted.body.state?.cards?.[squadIds[0].id]?.evo?.n === 1, JSON.stringify(acted.body).slice(0, 160))
const forged = await call('/api/card/save', { id: A, rev: acted.body.rev, client: { cards: { [squadIds[1].id]: { level: 5, evo: { n: 5, add: { aim: 15 } } } } } })
const after = await call('/api/card/load', { id: A })
check('客户端存档写不进进修', !after.body.state?.cards?.[squadIds[1].id]?.evo, JSON.stringify(forged.body).slice(0, 80))
const friend = await call('/api/card/friend', { code: hash(A).slice(0, 8) })
const lv = friend.body.friend?.levels?.[squadIds[0].id]
check('好友/天梯对手看到的是带进修的等级', typeof lv === 'number' && lv > MAX_LEVEL && Math.abs(lv - playLevel(squadIds[0].id, acted.body.state.cards[squadIds[0].id])) < 1e-9, String(lv))
await db.close()

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
