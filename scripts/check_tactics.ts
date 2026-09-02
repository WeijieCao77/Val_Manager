/**
 * Do the four sliders, the composition and the plan for a map actually move
 * the result?
 *
 *   npx tsx scripts/check_tactics.ts [maps per setting]
 *
 * The complaint that started this: 「战术板的四个滑杆跟比赛胜负关系不大，
 * 阵容也跟胜负关系不大」. So the first thing this prints is the map win rate
 * of one club against the same opponents with nothing changed but the
 * sliders — that number is the honest answer to the complaint. Before the
 * retune (EDG v C9 on Ascent, 1500 maps): aggression 100 alone +0.4, pace
 * 100 alone +0.7, utility 100 alone +3.8, everything to the right +6.7 —
 * two dials that did nothing and one correct answer for the other two. The rest asserts the new mechanics: a five is recognised
 * as 双决斗 / 双控场 / 双哨卫, the sliders that suit that shape pay and the
 * ones that fight it cost, a timeout call lands harder on the comp built for
 * it, a comp played often becomes familiar and a fresh one is not, tactics
 * set for one map do not leak onto another, and the map drill can run two
 * maps in a week.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason } from '../src/engine/season'
import { buildLineup, MapSim, selectLineup, sheetFor, tacticsFor } from '../src/engine/match'
import { callBoost, compStyle, familiarity, FAM_BASE, FAM_DRILL, FAM_MATCH, FAM_SCRIM, learnComp, tacticEdge } from '../src/engine/comp'
import { makeScrim } from '../src/engine/season'
import { mapCn } from '../src/engine/content'
import { Rng } from '../src/engine/rng'
import type { GameState, Tactics } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}
;(globalThis as never as { fetch: unknown }).fetch = undefined

const N = Number(process.argv[2] ?? 2000)
let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

const fresh = (tag = 'EDG'): GameState => {
  const me = WORLD_TEAMS.find((t) => t.tag === tag)!
  const g = createNewGame(me.id, '审计', 20260902)
  setupSeason(g)
  return g
}

/** Map win rate of `mine` against `opp` on `map`, N maps, fixed seeds. */
function winRate(g: GameState, opp: string, map: string, n = N): number {
  let w = 0
  for (let i = 0; i < n; i++) {
    const A = buildLineup(g, g.myTeam, map)
    const B = buildLineup(g, opp, map)
    const sim = new MapSim(map, A, B, new Rng(1000 + i))
    sim.runOut()
    if (sim.a > sim.b) w++
  }
  return w / n
}

// an opponent close to us in rating, so the sliders are not drowned out
const g0 = fresh()
const mine = g0.teams[g0.myTeam]
const opp = Object.values(g0.teams)
  .filter((t) => t.id !== g0.myTeam && t.tier === 1)
  .sort((a, b) => Math.abs(a.rating - mine.rating) - Math.abs(b.rating - mine.rating))[0]
const MAP = 'Ascent'
console.log(`${mine.name}（${mine.rating}） vs ${opp.name}（${opp.rating}） @ ${MAP}，每档 ${N} 张图\n`)

const set = (g: GameState, t: Partial<Tactics>) => {
  g.teams[g.myTeam].tactics = { pace: 50, utility: 55, aggression: 50, adaptability: 50, ...t }
}

// ---- 1. the sliders on their own, whatever the comp
{
  const rows: [string, Partial<Tactics>][] = [
    ['默认 50/55/50/50', {}],
    ['全部拉满', { pace: 100, utility: 100, aggression: 100, adaptability: 100 }],
    ['全部拉到底', { pace: 0, utility: 0, aggression: 0, adaptability: 0 }],
    ['只有侵略性 100', { aggression: 100 }],
    ['只有节奏 100', { pace: 100 }],
    ['只有道具 100', { utility: 100 }],
  ]
  console.log('滑杆单独的效果（默认英雄组合）：')
  const g = fresh()
  const base = (() => { set(g, {}); return winRate(g, opp.id, MAP) })()
  for (const [label, t] of rows) {
    set(g, t)
    const w = winRate(g, opp.id, MAP)
    console.log(`  ${label.padEnd(16)} ${pct(w)}  (${w - base >= 0 ? '+' : ''}${((w - base) * 100).toFixed(1)})`)
  }
}


// ---- 2. a five is recognised by the agents it takes onto the map
const sheet = (g: GameState, agents: string[], map = MAP) => {
  const five = selectLineup(g, g.myTeam)
  g.mapAgents = { ...(g.mapAgents ?? {}), [map]: Object.fromEntries(five.map((p, i) => [p.id, agents[i]])) }
}
const RUSH = ['Jett', 'Raze', 'Sova', 'Omen', 'Killjoy']
const HOLD = ['Jett', 'Sova', 'Omen', 'Killjoy', 'Cypher']
const CTRL = ['Jett', 'Sova', 'Omen', 'Viper', 'Killjoy']
const STD = ['Jett', 'Sova', 'KAY/O', 'Omen', 'Killjoy']
{
  console.log('\n识别阵容：')
  const g = fresh()
  for (const [label, agents, want] of [['双决斗', RUSH, 'rush'], ['双哨卫', HOLD, 'hold'], ['双控场', CTRL, 'control'], ['标准', STD, 'standard']] as const) {
    sheet(g, agents as unknown as string[])
    const got = sheetFor(g, g.myTeam, MAP).style
    check(`${label} → ${want}`, got === want, `识别为 ${got}`)
  }
  check('对手这张图的默认组合能被识别', compStyle(Object.values(sheetFor(g, opp.id, MAP).agents)) !== undefined,
    compStyle(Object.values(sheetFor(g, opp.id, MAP).agents)))
}

// ---- 3. the sliders that suit the shape pay; the ones that fight it cost
{
  console.log('\n同一套阵容，滑杆顺着打 / 中立 / 逆着打：')
  const g = fresh()
  const cases: [string, string[], Partial<Tactics>, Partial<Tactics>][] = [
    ['双决斗', RUSH, { pace: 90, aggression: 90 }, { pace: 10, aggression: 10 }],
    ['双哨卫', HOLD, { pace: 10, aggression: 10 }, { pace: 90, aggression: 90 }],
    ['双控场', CTRL, { utility: 95 }, { utility: 10 }],
  ]
  for (const [label, agents, fit, fight] of cases) {
    sheet(g, agents)
    set(g, {}); const mid = winRate(g, opp.id, MAP)
    set(g, fit); const good = winRate(g, opp.id, MAP)
    set(g, fight); const badW = winRate(g, opp.id, MAP)
    console.log(`  ${label}  顺 ${pct(good)}  中 ${pct(mid)}  逆 ${pct(badW)}`)
    check(`${label}：顺着打 > 中立 > 逆着打`, good > mid && mid > badW)
    check(`${label}：顺逆之差够大（≥ 6 分）`, good - badW >= 0.06, `${((good - badW) * 100).toFixed(1)} 分`)
  }
  // and "everything to the right" is no longer the answer for every shape
  sheet(g, HOLD)
  set(g, { pace: 100, utility: 100, aggression: 100, adaptability: 100 }); const allMax = winRate(g, opp.id, MAP)
  set(g, { pace: 0, utility: 100, aggression: 0, adaptability: 100 }); const slow = winRate(g, opp.id, MAP)
  check('双哨卫阵容全部拉满反而比慢打差', slow > allMax, `慢打 ${pct(slow)} vs 全满 ${pct(allMax)}`)
}

// ---- 4. what our dials run into: the opponent's shape (unit, on the edge itself)
{
  console.log('\n针对对手：')
  const t = (x: Partial<Tactics>): Tactics => ({ pace: 50, utility: 55, aggression: 50, adaptability: 50, ...x })
  const fast = tacticEdge(t({ pace: 100 }), 'standard', 'hold', 65)
  const slow = tacticEdge(t({ pace: 0 }), 'standard', 'hold', 65)
  check('对双哨卫快节奏吃亏、慢节奏占便宜', fast.matchupAtk < 0 && slow.matchupAtk > 0,
    `快 ${fast.matchupAtk.toFixed(2)} / 慢 ${slow.matchupAtk.toFixed(2)}`)
  const aggro = tacticEdge(t({ aggression: 100 }), 'standard', 'rush', 65)
  check('对双决斗激进防守被冲穿', aggro.matchupDef < -1, `${aggro.matchupDef.toFixed(2)}`)
  const util = tacticEdge(t({ utility: 100 }), 'standard', 'control', 65)
  check('对双控场道具拉满有利', util.matchupAtk > 0 && util.matchupDef > 0)
  const none = tacticEdge(t({ pace: 100, aggression: 100, utility: 100 }), 'standard', 'standard', 65)
  check('对标准阵容没有针对项', none.matchupAtk === 0 && none.matchupDef === 0)
}

// ---- 5. a timeout call lands harder on the comp built for it
{
  console.log('\n暂停：')
  check('双决斗喊强攻更猛', callBoost('rush', 'rush') > 1 && callBoost('rush', 'hold') < 1,
    `×${callBoost('rush', 'rush')} / ×${callBoost('rush', 'hold')}`)
  check('双哨卫喊稳守更稳', callBoost('steady', 'hold') > 1 && callBoost('steady', 'rush') < 1)
  check('标准阵容不变', callBoost('rush', 'standard') === 1 && callBoost('steady', 'standard') === 1)
}

// ---- 6. a sheet played often becomes familiar; a fresh one is not
{
  console.log('\n阵容熟练度：')
  const g = fresh()
  const five = selectLineup(g, g.myTeam)
  const mk = (agents: string[]) => Object.fromEntries(five.map((p, i) => [p.id, agents[i]]))
  check('没练过任何阵容时是中立值', familiarity(g, g.myTeam, MAP, mk(STD)) === FAM_BASE)
  check('AI 球队永远是中立值', familiarity(g, opp.id, MAP, mk(STD)) === FAM_BASE)
  learnComp(g, MAP, mk(STD), FAM_MATCH)
  check('打一张图 +8', familiarity(g, g.myTeam, MAP, mk(STD)) === FAM_BASE + FAM_MATCH)
  for (let i = 0; i < 20; i++) learnComp(g, MAP, mk(STD), FAM_MATCH)
  check('封顶 100', familiarity(g, g.myTeam, MAP, mk(STD)) === 100)
  const swapped = ['Jett', 'Sova', 'Breach', 'Omen', 'Killjoy']
  check('换一个英雄剩五分之四', Math.abs(familiarity(g, g.myTeam, MAP, mk(swapped)) - 80) < 1e-9,
    `${familiarity(g, g.myTeam, MAP, mk(swapped))}`)
  check('全换等于从零开始', familiarity(g, g.myTeam, MAP, mk(['Raze', 'Skye', 'Brimstone', 'Cypher', 'Gekko'])) === 0)
  check('别的图不受影响', familiarity(g, g.myTeam, 'Bind', mk(STD)) === FAM_BASE)
  // and it reaches the match
  g.mapAgents = { [MAP]: mk(STD) }
  const strong = buildLineup(g, g.myTeam, MAP).edge.familiarity ?? 0
  g.mapAgents = { [MAP]: mk(['Raze', 'Skye', 'Brimstone', 'Cypher', 'Gekko']) }
  const fresh0 = buildLineup(g, g.myTeam, MAP).edge.familiarity ?? 0
  check('练熟的阵容进比赛是加分，新搭的是扣分', strong > 2.5 && fresh0 < -2.5,
    `熟 ${strong.toFixed(1)} / 新 ${fresh0.toFixed(1)}`)
}

// ---- 7. it is earned by playing: scrims, fixtures and the drill all bank it
{
  const g = fresh()
  sheet(g, STD)
  const before = familiarity(g, g.myTeam, MAP, sheetFor(g, g.myTeam, MAP).agents)
  // a scrim tomorrow on the map
  const o = Object.values(g.teams).find((t) => t.id !== g.myTeam && t.tier === 1)!
  makeScrim(g, o.id, g.day + 1, MAP, 'first13')
  advanceDay(g, { autoScrims: true }); advanceDay(g, { autoScrims: true })
  const afterScrim = familiarity(g, g.myTeam, MAP, sheetFor(g, g.myTeam, MAP).agents)
  check('训练赛按预案阵容打，并且练到了它', Math.abs(afterScrim - before - FAM_SCRIM) < 1e-9,
    `${before} → ${afterScrim}`)
  // a sheet made for a scrim is thrown away with it, like any other match's
  g.agentPicks = { [MAP]: sheetFor(g, g.myTeam, MAP).agents }
  const o2 = Object.values(g.teams).find((t) => t.id !== g.myTeam && t.id !== o.id && t.tier === 1)!
  makeScrim(g, o2.id, g.day + 1, MAP, 'first13')
  advanceDay(g, { autoScrims: true }); advanceDay(g, { autoScrims: true })
  check('训练赛打完，赛前临时表也清掉了', g.agentPicks === undefined, JSON.stringify(g.agentPicks ?? null))
  const afterScrim2 = familiarity(g, g.myTeam, MAP, sheetFor(g, g.myTeam, MAP).agents)
  // a settled week of 跑图 on the map
  g.drill = { kind: 'map', map: MAP }
  g.drillLock = g.day + 7
  for (let i = 0; i < 8 && g.drillLock != null; i++) advanceDay(g, { autoScrims: true })
  const afterDrill = familiarity(g, g.myTeam, MAP, sheetFor(g, g.myTeam, MAP).agents)
  check('跑图一周练的是这张图的预案阵容', Math.abs(afterDrill - afterScrim2 - FAM_DRILL) < 1e-9,
    `${afterScrim2} → ${afterDrill}`)
}

// ---- 8. tactics set for one map stay on that map
{
  console.log('\n分图战术：')
  const g = fresh()
  g.mapTactics = { [MAP]: { pace: 100, utility: 100, aggression: 100, adaptability: 100 } }
  check('有专用设置的图读专用', tacticsFor(g, g.myTeam, MAP).pace === 100)
  check('没设的图读通用', tacticsFor(g, g.myTeam, 'Bind').pace === 50)
  check('AI 球队不读我们的分图设置', tacticsFor(g, opp.id, MAP).pace === 50)
  const a = buildLineup(g, g.myTeam, MAP).edge.tacticsAtk
  const b = buildLineup(g, g.myTeam, 'Bind').edge.tacticsAtk
  check('进比赛的确实是各图各的', a > 2 && Math.abs(b) < 1e-9, `${MAP} ${a.toFixed(2)} / Bind ${b.toFixed(2)}`)
}

// ---- 9. the map drill runs two maps in a week, each at the full rate
{
  console.log('\n跑图两张：')
  const one = fresh(); const two = fresh()
  for (const g of [one, two]) for (const p of selectLineup(g, g.myTeam)) g.training[p.id] = 'rest'
  const m1 = 'Ascent', m2 = 'Bind'
  one.drill = { kind: 'map', map: m1 }; one.drillLock = one.day + 7
  two.drill = { kind: 'map', map: m1, map2: m2 }; two.drillLock = two.day + 7
  const b1 = { a: one.teams[one.myTeam].mapPrefs[m1] ?? 50, b: one.teams[one.myTeam].mapPrefs[m2] ?? 50 }
  const b2 = { a: two.teams[two.myTeam].mapPrefs[m1] ?? 50, b: two.teams[two.myTeam].mapPrefs[m2] ?? 50 }
  for (let i = 0; i < 8; i++) { advanceDay(one, { autoScrims: true }); advanceDay(two, { autoScrims: true }) }
  const d1 = { a: (one.teams[one.myTeam].mapPrefs[m1] ?? 50) - b1.a, b: (one.teams[one.myTeam].mapPrefs[m2] ?? 50) - b1.b }
  const d2 = { a: (two.teams[two.myTeam].mapPrefs[m1] ?? 50) - b2.a, b: (two.teams[two.myTeam].mapPrefs[m2] ?? 50) - b2.b }
  console.log(`  单图 ${mapCn(m1)} +${d1.a.toFixed(2)} ${mapCn(m2)} +${d1.b.toFixed(2)}；双图 ${mapCn(m1)} +${d2.a.toFixed(2)} ${mapCn(m2)} +${d2.b.toFixed(2)}`)
  check('第二张图也涨了', d2.b > 1.5, `+${d2.b.toFixed(2)}`)
  check('第一张图没有因为多练一张而变慢', Math.abs(d2.a - d1.a) < 0.01 * 100, `${d1.a.toFixed(2)} vs ${d2.a.toFixed(2)}`)
  check('单图时第二张图不动', Math.abs(d1.b) < 1.2, `+${d1.b.toFixed(2)}`)
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
