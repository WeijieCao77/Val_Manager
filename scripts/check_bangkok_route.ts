/**
 * 曼谷征途: the road is Masters Bangkok 2025's, it costs nothing, and it pays
 * two 曼谷包 once — apart from 首尔征途's two 首尔包.
 *
 *   npx tsx scripts/check_bangkok_route.ts
 *
 * Drives the real actions (runAction, the function the server runs) with fixed
 * seeds, so every match here is played by the production engine on the event's
 * seven maps. check_seoul_route.ts covers the shared rules on Seoul's roads.
 */
import assert from 'node:assert/strict'
import { mergeClientFields, migrateGacha, newGacha, SERVER_KEYS } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import type { ActEnv } from '../src/engine/cardActions'
import { BANGKOK_TEAMS } from '../src/engine/bangkok2025'
import { BANGKOK_FIVES, BANGKOK_POOL, BANGKOK_ROUTES, cleanBangkokRoute } from '../src/engine/bangkokRoute'
import { cleanRoute } from '../src/engine/seoulRoute'
import type { RouteOutcome } from '../src/engine/eventRoute'
import { cardById, isPlayerCard, personOf } from '../src/engine/cards'
import type { ArenaResult } from '../src/engine/arena'

let n = 0
const ok = (what: string, cond: boolean, detail = '') => { n++; assert(cond, `${what} ${detail}`); console.log(`ok   ${what}${detail ? `  — ${detail}` : ''}`) }

// ---- the roads are the bracket as played
ok('8 条路，16 场系列赛各在两条路上', Object.keys(BANGKOK_ROUTES).length === 8
  && Object.values(BANGKOK_ROUTES).reduce((k, r) => k + r.length, 0) === 32)
ok('T1 冠军之路：VIT → TE → DRX → EDG → VIT → EDG → G2', BANGKOK_ROUTES.T1.map((s) => s.opp).join() === 'VIT,TE,DRX,EDG,VIT,EDG,G2',
  BANGKOK_ROUTES.T1.map((s) => `${s.stage} ${s.opp} ${s.won}:${s.lost}`).join(' / '))
ok('T1 首轮输给 VIT、胜者组半决赛输给 EDG', BANGKOK_ROUTES.T1[0].won < BANGKOK_ROUTES.T1[0].lost && BANGKOK_ROUTES.T1[3].won < BANGKOK_ROUTES.T1[3].lost)
const gf = BANGKOK_ROUTES.T1.at(-1)!
ok('总决赛 BO5 3:2 赢 G2', gf.stage === '总决赛' && gf.bo === 5 && gf.won === 3 && gf.lost === 2)
ok('败者组决赛 BO5', BANGKOK_ROUTES.T1[5].stage === '败者组决赛' && BANGKOK_ROUTES.T1[5].bo === 5)
ok('瑞士轮的名字带战绩', BANGKOK_ROUTES.T1[1].stage === '瑞士轮第 2 轮（0-1）' && BANGKOK_ROUTES.T1[0].stage === '瑞士轮第 1 轮')
ok('SEN 两场就结束（0-2 出局）', BANGKOK_ROUTES.SEN.length === 2 && BANGKOK_ROUTES.SEN.every((s) => s.won < s.lost))
let mirrored = true
for (const [tag, road] of Object.entries(BANGKOK_ROUTES)) {
  for (const st of road) {
    const other = BANGKOK_ROUTES[st.opp].find((x) => x.series === st.series)
    mirrored &&= !!other && other.opp === tag && other.won === st.lost && other.lost === st.won && other.bo === st.bo
  }
}
ok('每场系列赛两边看是同一个结果', mirrored)
ok('除了冠军，每条路都结束在当年输掉的一场', BANGKOK_TEAMS.filter((t) => { const last = BANGKOK_ROUTES[t.tag].at(-1)!; return last.won < last.lost }).length === 7)
ok('图池是当届七张', BANGKOK_POOL.join() === 'Abyss,Bind,Fracture,Haven,Lotus,Pearl,Split', BANGKOK_POOL.join('/'))
let fives = true
for (const t of BANGKOK_TEAMS) {
  const f = BANGKOK_FIVES[t.tag]
  const cards = f.slots.map((id) => cardById(id!))
  fives &&= f.coach === null && cards.every((c) => c && isPlayerCard(c) && c.event === 'bangkok-2025' && c.clubTag === t.tag)
    && new Set(cards.map((c) => personOf(c!))).size === 5
}
ok('每队五个人，都是自己的曼谷卡，没有教练', fives)
ok('T1 上场的是出场最多的五人（carpe 只打了 2 图，不上）', !BANGKOK_FIVES.T1.slots.includes('b25:31207'))

// ---- the actions
let tick = 0
const env = (): ActEnv => { tick++; return { now: 1_790_800_000_000 + tick * 60_000, today: '2026-10-05', seed: 50_000 + tick * 7919 } }
const route = (g: { bangkokRoute?: unknown }) => cleanBangkokRoute(g.bangkokRoute)

const g = newGacha('BKK-ROUTE', '征途测试', '2026-10-05')
ok('没出发不能打', runAction(g, 'bangkok_play', {}, env()).ok === false)
const before = { stamina: g.daily.stamina, coins: g.coins, cards: JSON.stringify(g.cards), ladder: JSON.stringify(g.ladder), seoul: JSON.stringify(cleanRoute(g.seoulRoute)) }
ok('不存在的队、原型上的键都出发不了', runAction(g, 'bangkok_start', { team: 'XYZ' }, env()).ok === false
  && runAction(g, 'bangkok_start', { team: 'constructor' }, env()).ok === false)
runAction(g, 'bangkok_start', { team: 'SEN' }, env()); runAction(g, 'bangkok_start', { team: 'SEN' }, env())
ok('连点两次出发只算一趟', route(g).records.SEN.runs === 1)

function drive(team: string): { played: number; lost: number; outs: RouteOutcome[] } {
  let played = 0, lost = 0
  const outs: RouteOutcome[] = []
  while (route(g).run) {
    const stage = route(g).run!.stage
    const packs = g.packs.bangkok2025 ?? 0
    const r = runAction(g, 'bangkok_play', {}, env())
    assert(r.ok, 'a road in progress always plays')
    const { res, out } = r.result as { res: ArenaResult; out: RouteOutcome }
    const st = BANGKOK_ROUTES[team][stage]
    played++
    if (!res.win) lost++
    outs.push(out)
    assert.equal(Math.max(res.mapsWon, res.mapsLost), Math.ceil(st.bo / 2), `BO${st.bo}`)
    for (const m of res.result.maps) assert(BANGKOK_POOL.includes(m.map), `${m.map} is not a Bangkok map`)
    assert.equal(out.rewrote, res.win && st.won < st.lost)
    assert.equal(out.losses, lost)
    assert.equal((g.packs.bangkok2025 ?? 0) - packs, out.packs)
    assert(played < 400)
  }
  return { played, lost, outs }
}
const sen = drive('SEN')
ok('第一次赢一场、第一次打通，各一个曼谷包', g.packs.bangkok2025 === 2, `打了 ${sen.played} 场，输 ${sen.lost} 场`)
const rec = route(g).records.SEN
ok('纪录：打通一次、最少输的场数、每场都记下', rec.clears === 1 && rec.best === sen.lost && rec.legs.length === sen.played)
ok('不花体力、不动金币、收藏和天梯', g.daily.stamina === before.stamina && g.coins === before.coins
  && JSON.stringify(g.cards) === before.cards && JSON.stringify(g.ladder) === before.ladder)
ok('首尔征途的奖励和纪录一点不动', JSON.stringify(cleanRoute(g.seoulRoute)) === before.seoul && !g.packs.seoul2024)
runAction(g, 'bangkok_start', { team: 'TE' }, env()); drive('TE')
ok('两个曼谷包是整个账号的，只发一次', g.packs.bangkok2025 === 2)
runAction(g, 'bangkok_start', { team: 'T1' }, env()); runAction(g, 'bangkok_play', {}, env())
runAction(g, 'bangkok_start', { team: 'G2' }, env())
ok('中途换队：新路从头开始，旧路打过的场次留着', route(g).run?.team === 'G2' && route(g).run?.stage === 0 && route(g).records.T1.legs.length === 1)
ok('放弃这一趟', runAction(g, 'bangkok_quit', {}, env()).ok && route(g).run === null && runAction(g, 'bangkok_play', {}, env()).ok === false)

// ---- the server owns it
const forged = JSON.parse(JSON.stringify(g))
forged.bangkokRoute = { run: null, records: {}, firstWin: false, firstClear: false }
const merged = mergeClientFields(JSON.parse(JSON.stringify(g)), forged)
ok('存档只能服务器写：客户端拿不回首胜奖励', (SERVER_KEYS as readonly string[]).includes('bangkokRoute') && route(merged).firstWin === true)
const reloaded = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
ok('存档来回一趟不变', JSON.stringify(route(reloaded)) === JSON.stringify(route(g)))
const broken = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
;(broken as { bangkokRoute?: unknown }).bangkokRoute = { run: { team: 'T1', stage: 99, losses: -3 }, records: 'x', firstWin: 'yes' }
ok('手改坏的存档被丢掉，不会被拿来打', JSON.stringify(route(broken)) === JSON.stringify({ run: null, records: {}, firstWin: false, firstClear: false })
  && runAction(broken, 'bangkok_play', {}, env()).ok === false)
const empty = newGacha('BKK-EMPTY', '空账号', '2026-10-05')
empty.cards = {}
empty.squad = { slots: [null, null, null, null, null], coach: null }
ok('一张卡都没有的账号也能打（用的是当届五人）', runAction(empty, 'bangkok_start', { team: 'T1' }, env()).ok && runAction(empty, 'bangkok_play', {}, env()).ok)

console.log(`\n全部通过（${n} 项，${tick} 次动作）`)
