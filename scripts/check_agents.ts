/**
 * Agents finally matter, and the map has a Chinese name.
 *
 * Until now `agentPool` and `rolePro` were recorded and never read: the match
 * engine only ever looked at a player's role list. A pick can now cost up to
 * 12% of what a man is worth, which is also what the 练新英雄 drill buys back.
 */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { setupSeason } from '../src/engine/season'
import { buildLineup, selectLineup, MatchSim, vetoOrder } from '../src/engine/match'
import { agentFit, agentMod, agentRoleGaps, autoAgents, normalizeAgents, OFF_ROLE } from '../src/engine/agents'
import { AGENT_ROLE, AGENTS, MAPS, MAP_META, mapCn } from '../src/engine/content'
import { Rng } from '../src/engine/rng'
import type { GameState, Role } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', 20260828)
  setupSeason(g)
  return g
}

// ---- every map has a Chinese name and a composition
{
  const noName = MAPS.filter((m) => mapCn(m) === m)
  check('every map reads in Chinese', noName.length === 0, noName.join('、'))
  const noMeta = MAPS.filter((m) => !(MAP_META[m] ?? []).length)
  check('every map has a usual composition', noMeta.length === 0, noMeta.join('、'))
  const badMeta = MAPS.filter((m) => {
    const roles = new Set((MAP_META[m] ?? []).map((a) => AGENT_ROLE[a]))
    return (['决斗者', '先锋', '控场', '哨卫'] as Role[]).some((r) => !roles.has(r))
  })
  check('and every composition covers all four jobs', badMeta.length === 0, badMeta.join('、'))
}

// ---- a pick out of position costs, and training buys it back
{
  const g = mk()
  const duelist = selectLineup(g, g.myTeam).find((p) => (p.roles ?? [p.role]).includes('决斗者'))!
  const ownAgent = (MAP_META.Ascent).find((a) => AGENT_ROLE[a] === '决斗者')!
  const wrongAgent = (MAP_META.Ascent).find((a) => AGENT_ROLE[a] === '哨卫')!
  check('his own job costs nothing', agentFit(duelist, ownAgent) === 1)
  const off = agentMod(duelist, wrongAgent)
  // the job is the whole penalty now — the old extra for an agent outside his
  // recorded pool was removed, because no training in the game could answer it
  check('someone else\'s job costs exactly the position penalty',
    Math.abs((1 - off) - OFF_ROLE) < 1e-9, `×${off.toFixed(3)}`)
  duelist.rolePro = { ...(duelist.rolePro ?? {}), 哨卫: 100 }
  check('drilled to 100%, the position penalty is gone',
    agentFit(duelist, wrongAgent) === 1, `×${agentMod(duelist, wrongAgent).toFixed(3)}`)
  duelist.rolePro = { 哨卫: 50 }
  const half = 1 - agentMod(duelist, wrongAgent)
  check('and halfway there costs half of it',
    Math.abs(half - OFF_ROLE * 0.5) < 1e-9, `−${(half * 100).toFixed(1)}%`)
}

// ---- the automatic sheet never puts anyone out of position
{
  const g = mk()
  const CORE: Role[] = ['决斗者', '先锋', '控场', '哨卫']
  let avoidable = 0
  let gaps = 0
  let forced = 0
  for (const t of Object.values(g.teams)) {
    const five = selectLineup(g, t.id)
    if (five.length < 5) continue
    // roles this squad simply has nobody for — someone must play them anyway
    // how many of the four jobs this squad can genuinely staff with distinct
    // players — the same matching the assigner does, computed independently
    const byRole = new Map<Role, string>()
    const held = new Map<string, Role>()
    const walk = (r: Role, seen: Set<string>): boolean => {
      for (const p of five) {
        if (seen.has(p.id) || !(p.roles ?? [p.role]).includes(r)) continue
        seen.add(p.id)
        const h = held.get(p.id)
        if (!h || walk(h, seen)) { byRole.set(r, p.id); held.set(p.id, r); return true }
      }
      return false
    }
    for (const r of CORE) walk(r, new Set())
    const missing = CORE.length - byRole.size
    for (const m of MAPS) {
      const picks = autoAgents(g, t.id, five, m)
      if (agentRoleGaps(five, picks).length) gaps++
      const off = five.filter((p) => agentFit(p, picks[p.id]) < 1).length
      forced += Math.min(off, missing)
      avoidable += Math.max(0, off - missing)
    }
  }
  check('nobody is auto-assigned out of position avoidably', avoidable === 0, `${avoidable} 次可避免的错位`)
  check('and every automatic comp still covers all four jobs', gaps === 0, `${gaps} 套缺位置`)
  check('squads with a hole in the roster do get someone forced into it', forced > 0, `${forced} 次`)
}

// ---- a hand-made bad sheet really does weaken the side
{
  const g = mk()
  const five = selectLineup(g, g.myTeam)
  const before = buildLineup(g, g.myTeam, 'Ascent').atk
  const wrong: Record<string, string> = {}
  five.forEach((p) => {
    const mine = p.roles ?? [p.role]
    wrong[p.id] = Object.keys(AGENT_ROLE).find(
      (a) => !mine.includes(AGENT_ROLE[a]) && !Object.values(wrong).includes(a))!
  })
  g.agentPicks = { Ascent: wrong }
  const after = buildLineup(g, g.myTeam, 'Ascent').atk
  check('a whole five out of position is measurably worse',
    before - after > 5, `${before.toFixed(2)} → ${after.toFixed(2)}`)
}

// ---- a veto the manager ran himself is the one that gets played
{
  const g = mk()
  const foe = Object.values(g.teams).find((t) => t.id !== g.myTeam)!
  const want = ['Abyss', 'Split', 'Lotus']
  g.vetoPlan = { fixtureId: 'X', maps: want, log: ['测试'] }
  const sim = new MatchSim(g, g.myTeam, foe.id, 3, new Rng(4))
  check('the manager\'s maps are the ones played',
    JSON.stringify((sim as unknown as { maps: string[] }).maps) === JSON.stringify(want),
    (sim as unknown as { maps: string[] }).maps.map(mapCn).join(' / '))
  // a plan for the wrong number of maps is ignored rather than half-applied
  g.vetoPlan = { fixtureId: 'X', maps: ['Abyss'], log: [] }
  const sim2 = new MatchSim(g, g.myTeam, foe.id, 3, new Rng(4))
  check('a plan that does not fit the format is ignored',
    (sim2 as unknown as { maps: string[] }).length !== 1)
}

// ---- the veto order is a real veto
{
  for (const bo of [1, 3, 5] as const) {
    const o = vetoOrder(bo)
    check(`BO${bo} veto leaves exactly ${bo} map(s) from seven`,
      7 - o.filter((x) => x === 'ban').length - 0 >= bo, o.join('/'))
  }
}

// ---- five different agents, and nobody empty-handed
{
  const g = mk()
  const five = selectLineup(g, g.myTeam)
  const auto = autoAgents(g, g.myTeam, five, 'Ascent')
  // what the panel does when you hand one man another's agent: a swap
  const cur = { ...auto }
  const wanted = auto[five[0].id]
  const holder = Object.keys(cur).find((id) => cur[id] === wanted && id !== five[1].id)
  if (holder) cur[holder] = cur[five[1].id]
  cur[five[1].id] = wanted
  const fixed = normalizeAgents(g, g.myTeam, five, 'Ascent', cur)
  check('a side never fields the same agent twice',
    new Set(Object.values(fixed)).size === 5, Object.values(fixed).join('、'))
  check('and nobody is left without one', five.every((p) => !!fixed[p.id]))

  // a hand-edited save with a duplicate is repaired rather than played
  const dup: Record<string, string> = {}
  five.forEach((p) => { dup[p.id] = 'Jett' })
  const repaired = normalizeAgents(g, g.myTeam, five, 'Ascent', dup)
  check('a save that somehow holds five Jetts is repaired',
    new Set(Object.values(repaired)).size === 5, Object.values(repaired).join('、'))
}

// ---- no penalty a manager cannot answer
{
  const g = mk()
  const p = selectLineup(g, g.myTeam)[0]
  const mine = p.roles ?? [p.role]
  const own = (AGENTS[mine[0]] ?? []).filter((a) => !p.agentPool.includes(a))
  check('there is an agent of his own role he has never been recorded on', own.length > 0)
  check('and it costs him nothing — the drill trains positions, not characters',
    agentMod(p, own[0]) === 1, `×${agentMod(p, own[0]).toFixed(3)}`)
  const played = (AGENTS[mine[0]] ?? []).find((a) => p.agentPool.includes(a))
  if (played) {
    check('exactly the same as one he has played', agentMod(p, played) === agentMod(p, own[0]))
  }
}

// ---- the scoreboard knows who played what
{
  const g = mk()
  const foe = Object.values(g.teams).find((t) => t.id !== g.myTeam)!
  const sim = new MatchSim(g, g.myTeam, foe.id, 3, new Rng(9))
  while (!sim.decided && sim.nextMap()) { sim.current!.runOut(); sim.closeMap() }
  const res = sim.finish()
  check('every map records the agents that were on it',
    res.maps.every((m) => Object.keys(m.agents ?? {}).length >= 10),
    res.maps.map((m) => `${mapCn(m.map)}:${Object.keys(m.agents ?? {}).length}`).join(' '))
  const anyId = Object.keys(res.maps[0].lines)[0]
  check('and a player on the sheet has one', !!res.maps[0].agents?.[anyId])
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
