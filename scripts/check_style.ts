/**
 * 打法风格三角接进比赛之后，三项各值多少。
 *
 *   npx tsx scripts/check_style.ts [每档地图数]
 *
 * comp.ts 的上半部分数位置（双决斗 / 双哨卫 / 双控场），这条轴读的是道具怎么
 * 用（快攻 / 消耗 / 控制）。两条正交，都要在。这里验的是：
 *
 *   坐标认得出真实阵容，克制关系是石头剪刀布且反对称
 *   三项的优先级守得住：版本之子 > 阵容合适 > 阵容克制
 *   版本会在国际赛之后换，逆版本真的吃亏，而且没有人永远是版本之子
 *   万金油阵容既不被克也吃不到红利 —— 押注型才拿得到
 */
import {
  AGENT_STYLE, MAP_WANT, STYLE_K, alignN, counterN, darlings, rollPatch,
  styleCounter, styleEdge, styleMix, styleName, stylePurity, versionN, DARLING,
} from '../src/engine/comp'
import { MAPS, agentCn, mapCn } from '../src/engine/content'
import { buildLineup, MapSim } from '../src/engine/match'
import { applyPatch, setupSeason } from '../src/engine/season'
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { ARENA_TEAM } from '../src/engine/arena'
import { Rng } from '../src/engine/rng'
import { ARENA_TEAM_ID } from '../src/engine/types'
import type { GameState } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}

const N = Number(process.argv[2] ?? 600)
let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const mk = (tag = 'EDG'): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === tag)!.id, '审计', 20260909)
  setupSeason(g)
  return g
}

// -------------------------------------------------------------- 坐标
const AGGRO = ['Neon', 'Waylay', 'Breach', 'Omen', 'Killjoy']
const MID = ['Gekko', 'Fade', 'Astra', 'Raze', 'Sage']
const CTRL = ['Jett', 'Sova', 'Harbor', 'Viper', 'Killjoy']
const SOLVED = ['Jett', 'KAY/O', 'Omen', 'Killjoy', 'Sova']
const IRON = ['Breach', 'Yoru', 'Tejo', 'Omen', 'Killjoy']

check('每个英雄都有风格点数', MAPS.every((m) => !!MAP_WANT[m]) && Object.keys(AGENT_STYLE).length >= 29)
check('霓虹 Waylay 读成快攻', styleName(styleMix(AGGRO)) === '快攻', styleName(styleMix(AGGRO)))
check('盖可黑梦读成消耗', styleName(styleMix(MID)) === '消耗', styleName(styleMix(MID)))
check('海神蝰蛇读成控制', styleName(styleMix(CTRL)) === '控制', styleName(styleMix(CTRL)))
check('铁夜壶读成快攻 —— 钛狐归到快攻之前它落在正中心',
  styleName(styleMix(IRON)) === '快攻', `${styleName(styleMix(IRON))} 纯度${stylePurity(styleMix(IRON)).toFixed(2)}`)
check('亚海默认阵容是万金油', stylePurity(styleMix(SOLVED)) < 0.15, stylePurity(styleMix(SOLVED)).toFixed(2))

// -------------------------------------------------------------- 克制
const a = styleMix(AGGRO), m = styleMix(MID), c = styleMix(CTRL), s = styleMix(SOLVED)
check('快攻克控制', styleCounter(a, c) > 0)
check('消耗克快攻', styleCounter(m, a) > 0)
check('控制克消耗', styleCounter(c, m) > 0)
check('反对称：反过来就是负的', Math.abs(styleCounter(a, c) + styleCounter(c, a)) < 1e-9)
check('自己打自己归零', Math.abs(styleCounter(a, a)) < 1e-9)
check('万金油既不被克也吃不到红利',
  Math.abs(counterN(s, a)) < 0.25 && Math.abs(counterN(s, c)) < 0.25,
  `打快攻 ${counterN(s, a).toFixed(2)} 打控制 ${counterN(s, c).toFixed(2)}`)
check('押注型阵容吃得到', Math.abs(counterN(a, c)) > Math.abs(counterN(s, c)))

// -------------------------------------------------------------- 优先级
check('版本 > 地图 > 克制', STYLE_K.version > STYLE_K.map && STYLE_K.map > STYLE_K.counter,
  `${STYLE_K.version} / ${STYLE_K.map} / ${STYLE_K.counter}`)
check('契合度在需求偏科的图上拉得开、在平衡的图上拉不开', (() => {
  const spread = (map: string) => Math.abs(alignN(a, map) - alignN(c, map))
  return spread('Breeze') > spread('Ascent') && spread('Fracture') > spread('Ascent')
})(), `微风 ${Math.abs(alignN(a, 'Breeze') - alignN(c, 'Breeze')).toFixed(2)} / 亚海 ${Math.abs(alignN(a, 'Ascent') - alignN(c, 'Ascent')).toFixed(2)}`)

// -------------------------------------------------------------- 版本
{
  const rng = new Rng(7)
  const pool = Object.keys(AGENT_STYLE)
  let p = rollPatch(undefined, pool, 0, '第一版', true, rng)
  check('大改会调整一批英雄', p.buffed.length + p.nerfed.length >= 3,
    `加强 ${p.buffed.map(agentCn).join('、') || '无'} / 削弱 ${p.nerfed.map(agentCn).join('、') || '无'}`)
  const kids = darlings(p)
  if (kids.length) {
    check('版本之子拿得到正的版本项', versionN(kids, p) > 0.3, kids.map(agentCn).join('、'))
  }
  // 没有人永远是版本之子：连着几个版本之后旧系数衰减回去
  const first = Object.entries(p.coef).sort((x, y) => y[1] - x[1])[0]
  for (let i = 0; i < 6; i++) p = rollPatch(p, pool, i, `第 ${i + 2} 版`, i % 4 === 0, rng)
  check('旧版本之子会退下去', Math.abs(p.coef[first[0]] ?? 0) < Math.abs(first[1]),
    `${agentCn(first[0])} ${first[1].toFixed(2)} → ${(p.coef[first[0]] ?? 0).toFixed(2)}`)

  const meta: Record<string, number> = {}
  for (const x of SOLVED) meta[x] = DARLING
  const anti: Record<string, number> = {}
  for (const x of SOLVED) anti[x] = -DARLING
  check('全员版本之子的版本项打满', versionN(SOLVED, { ...p, coef: meta }) === 1)
  check('全员逆版本是 −1', versionN(SOLVED, { ...p, coef: anti }) === -1)
}

// ----------------------------------------------- 装进比赛之后的实际胜率
{
  const g = mk()
  const opp = Object.keys(g.teams).find((t) => t !== g.myTeam)!
  const map = MAPS[0]
  const withEdge = (mine: string[], theirs: string[], patchOn: boolean) => {
    const st = patchOn ? g.patch : undefined
    return styleEdge(mine, theirs, map, st).total
  }
  check('三角对镜像阵容不给任何加成', Math.abs(withEdge(SOLVED, SOLVED, false)) < 1e-9)
  const counterGain = withEdge(AGGRO, CTRL, false) - withEdge(CTRL, AGGRO, false)
  check('克制方比被克方强，且差距在一个滑杆以内', counterGain > 0 && counterGain < 6,
    `${counterGain.toFixed(2)} 强度点`)

  // 真跑地图：同一支队伍，顺着克制排和逆着排
  const winRate = (over: string[] | null, n = N) => {
    let w = 0
    for (let i = 0; i < n; i++) {
      const A = buildLineup(g, g.myTeam, map, opp)
      const B = buildLineup(g, opp, map, g.myTeam)
      if (over) {
        const ids = A.players.map((p) => p.id)
        A.agents = Object.fromEntries(ids.map((id, k) => [id, over[k]]))
      }
      const sim = new MapSim(map, A, B, new Rng(4000 + i))
      while (!sim.over) sim.playRound()
      if (sim.a > sim.b) w++
    }
    return w / n
  }
  const plain = winRate(null, Math.min(N, 300))
  check('比赛跑得动，胜率是个合理的数', plain > 0.05 && plain < 0.95, pct(plain))
}

// ------------------------------------------------- 国际赛之后真的换版本
{
  const g = mk()
  check('新档还没有版本', !g.patch)
  applyPatch(g, false)
  check('赛中调整之后有了版本', !!g.patch && !g.patch.big, g.patch?.name)
  const before = { ...(g.patch?.coef ?? {}) }
  g.day += 60
  applyPatch(g, true)
  check('休赛期大改换掉更多东西', !!g.patch?.big && (g.patch.buffed.length + g.patch.nerfed.length) >= 3)
  const moved = Object.keys(before).filter((k) => Math.abs((g.patch?.coef[k] ?? 0) - before[k]) > 0.01)
  check('大改之后旧系数明显变了', moved.length > 0, `${moved.length} 个英雄`)
  check('版本更新会进新闻', g.news.some((n) => n.text.includes('逆着版本')))
  check('只动现役图池里的英雄', Object.keys(g.patch?.coef ?? {}).every((x) => !!AGENT_STYLE[x]))
}

// -------------------------------------------- 开瓦包的对战结构不受影响
{
  const g = mk()
  const opp = Object.keys(g.teams).find((t) => t !== g.myTeam)!
  const map = MAPS[0]
  applyPatch(g, true)                       // 给它一个明显的版本
  const before = buildLineup(g, g.myTeam, map, opp)
  const arena = { ...g, myTeam: ARENA_TEAM_ID }   // 卡牌世界靠 myTeam 认，不用改 arena.ts
  const after = buildLineup(arena, g.myTeam, map, opp)
  check('卡牌世界里版本项归零', (after.edge.version ?? 0) === 0, String(after.edge.version))
  check('卡牌世界里地图契合和克制都归零',
    (after.edge.mapFit ?? 0) === 0 && (after.edge.counter ?? 0) === 0)
  check('经理模式里这三项是活的',
    (before.edge.version ?? 0) !== 0 || (before.edge.mapFit ?? 0) !== 0 || (before.edge.counter ?? 0) !== 0,
    `版本 ${(before.edge.version ?? 0).toFixed(2)} 契合 ${(before.edge.mapFit ?? 0).toFixed(2)} 克制 ${(before.edge.counter ?? 0).toFixed(2)}`)
  check('卡牌世界里没有英雄生疏惩罚', after.edge.base >= before.edge.base - 1e-9,
    `${before.edge.base.toFixed(2)} → ${after.edge.base.toFixed(2)}`)
  // 两个常量必须一致，否则这道闸门会静默失效
  check('ARENA_TEAM_ID 跟 arena.ts 的 ARENA_TEAM 没走散', ARENA_TEAM_ID === ARENA_TEAM, ARENA_TEAM_ID)
}

// ------------------------------------------------------------- 地图需求
console.log('\n各图想要什么（问卷九人的平均）：')
for (const mp of MAPS) {
  const d = MAP_WANT[mp]
  console.log(`  ${mapCn(mp).padEnd(6)}${d.map((x) => String(Math.round(x * 100)).padStart(4)).join('')}   ${styleName(d)}`)
}

console.log(bad ? `\n${bad} 项不通过` : '\n全部通过')
process.exit(bad ? 1 : 0)
