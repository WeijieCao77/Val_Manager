/**
 * Manager-mode sheets follow the shapes pros run, and nothing exists before it shipped.
 *
 *   npx tsx scripts/check_map_comps.ts
 *
 * 2026-09-26, reported: AI fives and the player's own came out needing three or
 * four sentinels. The automatic sheet covered four jobs and gave the fifth man
 * his own role (and could steal a later job's man), so a squad built around
 * sentinels ran three of them; three seasons in, 1.0% of all sheets stacked a
 * role. Pros do it 12 times in 3034 comps (data/mapComps.json). Now shapes come
 * from that table. Historical careers also must not see agents or maps before
 * their release, and a release is announced in the version notice.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason } from '../src/engine/season'
import { activePool, poolFor, sheetFor, sheetShapeCost } from '../src/engine/match'
import { autoAgents, normalizeAgents, proShapes, sheetWarnings } from '../src/engine/agents'
import { AGENT_ROLE, MAPS } from '../src/engine/content'
import { AGENT_SINCE, agentAvailable, loadWorld } from '../src/engine/eras'
import { createManager } from '../src/engine/manager'
import { setCurrentRuleset } from '../src/engine/ruleset'
import type { GameState, Player, Role } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
setCurrentRuleset('vct-2026')
const most = (agents: string[]) => Math.max(...(['决斗者', '先锋', '控场', '哨卫'] as Role[]).map((r) => agents.filter((a) => AGENT_ROLE[a] === r).length))

// 1. the table the sheets draw from
const shapesOk = MAPS.every((m) => proShapes(m).every((s) => s.roles.length === 5
  && Math.max(...['决斗者', '先锋', '控场', '哨卫'].map((r) => s.roles.filter((x) => x === r).length)) <= 2
  && s.roles.includes('控场')))
check('每张图的候选阵型：同一位置最多两人，必有控场', shapesOk)
check('分离常见阵型有两控场零哨卫（职业 65%）', proShapes('Split')[0]?.key === '2-1-2-0', proShapes('Split')[0]?.key)

// 2. a season of sheets, every tier-one club, every pool map
const g = createNewGame(WORLD_TEAMS.find((t) => t.tier === 1)!.id, '检查', 11, createManager('检查', 30, 'expro'))
setupSeason(g)
let sheets = 0, stacked = 0, unreleased = 0
const shapes = new Map<string, number>()
for (let guard = 0; g.year === 2026 && guard < 400; guard++) {
  g.boardConfidence = 100
  if (g.day % 28 === 0) {
    for (const t of Object.values(g.teams)) {
      if (t.tier !== 1) continue
      for (const map of poolFor(g)) {
        const list = Object.values(sheetFor(g, t.id, map).agents)
        if (list.length !== 5) continue
        sheets++
        if (most(list) >= 3) stacked++
        if (list.some((a) => !agentAvailable(g, a))) unreleased++
        const key = (['决斗者', '先锋', '控场', '哨卫'] as Role[]).map((r) => list.filter((a) => AGENT_ROLE[a] === r).length).join('-')
        shapes.set(key, (shapes.get(key) ?? 0) + 1)
      }
    }
  }
  advanceDay(g, { autoResolveDrawDecisions: true })
}
const top = Math.max(...shapes.values()) / sheets
check(`一整季的阵容（${sheets} 套）没有同一位置三个以上`, sheets > 1000 && stacked === 0, `${stacked}`)
check('没有一套用了还没上线的英雄', unreleased === 0, `${unreleased}`)
check('阵型分布像职业比赛：最常见的一种不到一半', top < 0.5 && shapes.size >= 4, `${(top * 100).toFixed(1)}% · ${shapes.size} 种`)

// 3. the refill: a five that lost a man keeps its shape rather than growing a third sentinel
{
  const s = createNewGame(WORLD_TEAMS.find((t) => t.tier === 1)!.id, '检查', 5, createManager('检查', 30, 'expro'))
  const sentinels = Object.values(s.players).filter((p) => p.role === '哨卫').slice(0, 3)
  const others = Object.values(s.players).filter((p) => p.role === '控场').slice(0, 1)
    .concat(Object.values(s.players).filter((p) => p.role === '决斗者').slice(0, 1))
  const five: Player[] = [...sentinels, ...others]
  const auto = autoAgents(s, s.myTeam, five, 'Ascent')
  check('三个哨卫出身的五人，自动排阵也不排三哨卫', most(Object.values(auto)) <= 2, Object.values(auto).join('/'))
  // kept picks: two sentinels, a controller, a duelist; the new man is a sentinel too
  const kept = { [sentinels[0].id]: 'Cypher', [sentinels[1].id]: 'Killjoy', [others[0].id]: 'Omen', [others[1].id]: 'Jett' }
  const fixed = normalizeAgents(s, s.myTeam, five, 'Ascent', kept)
  check('换人后补位不会补出第三个哨卫', most(Object.values(fixed)) <= 2 && Object.keys(fixed).length === 5, Object.values(fixed).join('/'))
  check('手动排三哨卫：界面提醒，比赛里有代价',
    sheetWarnings('Ascent', ['Cypher', 'Killjoy', 'Sage', 'Omen', 'Jett']).some((w) => w.includes('3 个哨卫'))
      && sheetShapeCost(['Cypher', 'Killjoy', 'Sage', 'Omen', 'Jett']) > 0
      && sheetShapeCost(['Jett', 'Raze', 'Skye', 'Omen', 'Viper']) === 0)
}

// 4. a 2023 career: nothing from after January 2023, and the releases arrive and are announced
{
  const world = (await loadWorld(2023))!
  const h = createNewGame(world.teams.find((t) => t.tier === 1)!.id, '检查', 7, createManager('检查', 30, 'expro'), { world, year: 2023 })
  const later = Object.keys(AGENT_SINCE).filter((a) => !agentAvailable({ year: 2023, day: 0 }, a))
  const knows = Object.values(h.players).filter((p) => later.some((a) => (p.agentPro?.[a] ?? 0) > 0 || p.agentPool.includes(a)))
  check('2023 开档没有人会 2023 年 1 月以后才出的英雄', knows.length === 0, knows.slice(0, 3).map((p) => p.ign).join(','))
  setupSeason(h)
  const seen: string[] = []
  const coefSame: boolean[] = []
  for (let guard = 0; h.year === 2023 && guard < 400; guard++) {
    h.boardConfidence = 100
    const before = h.patch
    advanceDay(h, { autoResolveDrawDecisions: true })
    const now = h.patch
    if (now?.arrivals && now !== before) {
      seen.push(...now.arrivals.agents, ...now.arrivals.maps)
      coefSame.push(JSON.stringify(now.coef) === JSON.stringify(before?.coef ?? {}))
    }
  }
  check('2023 年里 Gekko、Deadlock、Iso、日落之城上线都进了版本公告',
    ['Gekko', 'Deadlock', 'Iso', 'Sunset'].every((x) => seen.includes(x)), seen.join(','))
  check('上线公告不改任何英雄强度', coefSame.length > 0 && coefSame.every(Boolean))
  check('2023 年的阵容里没有 Clove 之后的英雄', !Object.values(h.teams).some((t) => Object.values(sheetFor(h as GameState, t.id, 'Ascent').agents).some((a) => ['Clove', 'Vyse', 'Tejo', 'Waylay', 'Veto', 'Miks'].includes(a))))
}

// 5. the dealt pool never carries a map before it shipped
{
  let early = 0
  for (let seed = 0; seed < 500; seed++) for (const ph of [0, 1] as const) if (activePool(seed, ph, 2026).includes('Summit')) early++
  check('2026 年 6 月前的图池里没有 Summit', early === 0, `${early}`)
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
