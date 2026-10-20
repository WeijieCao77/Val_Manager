/**
 * 洛杉矶征途: the road is VALORANT Champions 2023's, it costs nothing, and it pays two 洛杉矶包 once — apart from
 * 首尔征途's and 曼谷征途's.
 *
 *   npx tsx scripts/check_losangeles_route.ts
 *
 * Drives the real actions (runAction, the function the server runs) with fixed seeds, so every match here is
 * played by the production engine on the event's seven maps. check_seoul_route.ts covers the shared rules.
 */
import assert from 'node:assert/strict'
import { mergeClientFields, migrateGacha, newGacha, SERVER_KEYS } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import type { ActEnv } from '../src/engine/cardActions'
import { LOS_ANGELES_TEAMS } from '../src/engine/losangeles2023'
import { LOS_ANGELES_FIVES, LOS_ANGELES_POOL, LOS_ANGELES_ROUTES, cleanLosAngelesRoute } from '../src/engine/losAngelesRoute'
import { cleanBangkokRoute } from '../src/engine/bangkokRoute'
import type { RouteOutcome } from '../src/engine/eventRoute'
import { cardById, isPlayerCard, personOf } from '../src/engine/cards'
import type { ArenaResult } from '../src/engine/arena'

let n = 0
const ok = (what: string, cond: boolean, detail = '') => { n++; assert(cond, `${what} ${detail}`); console.log(`ok   ${what}${detail ? `  — ${detail}` : ''}`) }
const R = LOS_ANGELES_ROUTES

// ---- the roads are the bracket as played
ok('16 条路，34 场系列赛各在两条路上', Object.keys(R).length === 16 && Object.values(R).reduce((k, r) => k + r.length, 0) === 68)
ok('EG 冠军之路：FPX → FUT → EDG → DRX → PRX → LOUD → PRX', R.EG.map((s) => s.opp).join() === 'FPX,FUT,EDG,DRX,PRX,LOUD,PRX',
  R.EG.map((s) => `${s.stage} ${s.opp} ${s.won}:${s.lost}`).join(' / '))
ok('EG 只输了胜者组决赛', R.EG.filter((s) => s.won < s.lost).map((s) => s.stage).join() === '胜者组决赛')
const gf = R.EG[R.EG.length - 1]
ok('总决赛 BO5 3:1 赢 PRX', gf.stage === '总决赛' && gf.bo === 5 && gf.won === 3 && gf.lost === 1)
ok('败者组决赛 BO5', R.EG[5].stage === '败者组决赛' && R.EG[5].bo === 5)
ok('小组赛名字带组别', R.EG[0].stage === '小组赛 B 组首轮' && R.EG[1].stage === '小组赛 B 组胜者组')
ok('ZETA 两场就结束（0-2 出局）', R.ZETA.length === 2 && R.ZETA.every((s) => s.won < s.lost))
let mirrored = true
for (const [tag, road] of Object.entries(R)) {
  for (const st of road) {
    const other = R[st.opp].find((x) => x.series === st.series)
    mirrored &&= !!other && other.opp === tag && other.won === st.lost && other.lost === st.won && other.bo === st.bo
  }
}
ok('每场系列赛两边看是同一个结果', mirrored)
ok('除了冠军，每条路都结束在当年输掉的一场', LOS_ANGELES_TEAMS.filter((t) => { const last = R[t.tag][R[t.tag].length - 1]; return last.won < last.lost }).length === 15)
ok('图池是当届七张', LOS_ANGELES_POOL.join() === 'Ascent,Bind,Fracture,Haven,Lotus,Pearl,Split', LOS_ANGELES_POOL.join('/'))
let fives = true
for (const t of LOS_ANGELES_TEAMS) {
  const f = LOS_ANGELES_FIVES[t.tag]
  const cards = f.slots.map((id) => cardById(id!))
  fives &&= f.coach === null && cards.every((c) => c && isPlayerCard(c) && c.event === 'los-angeles-2023' && c.clubTag === t.tag)
    && new Set(cards.map((c) => personOf(c!))).size === 5
}
ok('每队五个人，都是自己的洛杉矶卡，没有教练', fives)

// ---- the actions
let tick = 0
const env = (): ActEnv => { tick++; return { now: 1_792_000_000_000 + tick * 60_000, today: '2026-10-25', seed: 70_000 + tick * 7919 } }
const route = (g: { losAngelesRoute?: unknown }) => cleanLosAngelesRoute(g.losAngelesRoute)

const g = newGacha('LA-ROUTE', '征途测试', '2026-10-25')
ok('没出发不能打', runAction(g, 'la_play', {}, env()).ok === false)
const before = { stamina: g.daily.stamina, coins: g.coins, cards: JSON.stringify(g.cards), ladder: JSON.stringify(g.ladder), bkk: JSON.stringify(cleanBangkokRoute(g.bangkokRoute)) }
ok('不存在的队、原型上的键都出发不了', runAction(g, 'la_start', { team: 'XYZ' }, env()).ok === false
  && runAction(g, 'la_start', { team: 'constructor' }, env()).ok === false)
runAction(g, 'la_start', { team: 'ZETA' }, env()); runAction(g, 'la_start', { team: 'ZETA' }, env())
ok('连点两次出发只算一趟', route(g).records.ZETA.runs === 1)

function drive(team: string): { played: number; lost: number } {
  let played = 0, lost = 0
  while (route(g).run) {
    const stage = route(g).run!.stage
    const packs = g.packs.losangeles2023 ?? 0
    const r = runAction(g, 'la_play', {}, env())
    assert(r.ok, 'a road in progress always plays')
    const { res, out } = r.result as { res: ArenaResult; out: RouteOutcome }
    const st = R[team][stage]
    played++
    if (!res.win) lost++
    assert.equal(Math.max(res.mapsWon, res.mapsLost), Math.ceil(st.bo / 2), `BO${st.bo}`)
    for (const m of res.result.maps) assert(LOS_ANGELES_POOL.includes(m.map), `${m.map} is not a Los Angeles map`)
    assert.equal(out.rewrote, res.win && st.won < st.lost)
    assert.equal(out.losses, lost)
    assert.equal((g.packs.losangeles2023 ?? 0) - packs, out.packs)
    assert(played < 400)
  }
  return { played, lost }
}
const zeta = drive('ZETA')
ok('第一次赢一场、第一次打通，各一个洛杉矶包', g.packs.losangeles2023 === 2, `打了 ${zeta.played} 场，输 ${zeta.lost} 场`)
const rec = route(g).records.ZETA
ok('纪录：打通一次、最少输的场数、每场都记下', rec.clears === 1 && rec.best === zeta.lost && rec.legs.length === zeta.played)
ok('不花体力、不动金币、收藏和天梯', g.daily.stamina === before.stamina && g.coins === before.coins
  && JSON.stringify(g.cards) === before.cards && JSON.stringify(g.ladder) === before.ladder)
ok('曼谷征途的奖励和纪录一点不动', JSON.stringify(cleanBangkokRoute(g.bangkokRoute)) === before.bkk && !g.packs.bangkok2025)
runAction(g, 'la_start', { team: 'KRÜ' }, env()); drive('KRÜ')
ok('两个洛杉矶包是整个账号的，只发一次', g.packs.losangeles2023 === 2)
runAction(g, 'la_start', { team: 'EG' }, env()); runAction(g, 'la_play', {}, env())
runAction(g, 'la_start', { team: 'PRX' }, env())
ok('中途换队：新路从头开始，旧路打过的场次留着', route(g).run?.team === 'PRX' && route(g).run?.stage === 0 && route(g).records.EG.legs.length === 1)
ok('放弃这一趟', runAction(g, 'la_quit', {}, env()).ok && route(g).run === null && runAction(g, 'la_play', {}, env()).ok === false)

// ---- the server owns it
const forged = JSON.parse(JSON.stringify(g))
forged.losAngelesRoute = { run: null, records: {}, firstWin: false, firstClear: false }
const merged = mergeClientFields(JSON.parse(JSON.stringify(g)), forged)
ok('存档只能服务器写：客户端拿不回首胜奖励', (SERVER_KEYS as readonly string[]).includes('losAngelesRoute') && route(merged).firstWin === true)
const reloaded = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
ok('存档来回一趟不变', JSON.stringify(route(reloaded)) === JSON.stringify(route(g)))
const broken = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
;(broken as { losAngelesRoute?: unknown }).losAngelesRoute = { run: { team: 'EG', stage: 99, losses: -3 }, records: 'x', firstWin: 'yes' }
ok('手改坏的存档被丢掉，不会被拿来打', JSON.stringify(route(broken)) === JSON.stringify({ run: null, records: {}, firstWin: false, firstClear: false })
  && runAction(broken, 'la_play', {}, env()).ok === false)
const empty = newGacha('LA-EMPTY', '空账号', '2026-10-25')
empty.cards = {}
empty.squad = { slots: [null, null, null, null, null], coach: null }
ok('一张卡都没有的账号也能打（用的是当届五人）', runAction(empty, 'la_start', { team: 'EG' }, env()).ok && runAction(empty, 'la_play', {}, env()).ok)

console.log(`\n全部通过（${n} 项，${tick} 次动作）`)
