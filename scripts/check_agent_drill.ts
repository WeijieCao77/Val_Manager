/**
 * 练英雄：一周最多五个人一起练。
 *
 *   npx tsx scripts/check_agent_drill.ts
 *
 * 「练英雄改成一周可以同时五个人练英雄，一个一个太慢了」。改动本身很小——
 * TeamDrill 从「一个人一个英雄」变成一张最多五行的表——但它碰到的是团队训练
 * 的结算路径，所以这里盯的是三件事：五个人真的都练到了、每个人是各自结算的
 * （被卖掉的那个不能把另外四个一起带走），以及老存档里那条单人计划还在。
 */
import { AGENT_DRILL_MAX, drillTick, pickAgentToLearn } from '../src/engine/training'
import { createNewGame } from '../src/engine/world'
import { setupSeason } from '../src/engine/season'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { Rng } from '../src/engine/rng'
import { importSave } from '../src/engine/save'
import type { AgentPick, GameState, Player, Role } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'EDG')!.id, '审计', 20260909)
  setupSeason(g)
  return g
}
const CORE: Role[] = ['决斗者', '先锋', '控场', '哨卫']
/** an agent this man does not have yet, off a role he does not cover */
const somethingNew = (p: Player): string => {
  const covered = p.roles?.length ? p.roles : [p.role]
  const want = CORE.find((r) => !covered.includes(r)) ?? CORE[0]
  return pickAgentToLearn(p, want)!
}
const pro = (p: Player, a: string) => p.agentPro?.[a] ?? 0
/** run the committed week to its settlement */
const settle = (g: GameState, notes: string[] = []) => {
  g.drillLock = g.day
  drillTick(g, new Rng(7), notes)
  return notes
}

// ---------------------------------------------------------------- 五个人一起练
{
  const g = mk()
  const five = squadOf(g, g.myTeam).slice(0, 5)
  check('这一队至少有五个人', five.length === 5, `${five.length} 人`)
  const picks: AgentPick[] = five.map((p) => ({ playerId: p.id, agent: somethingNew(p) }))
  const before = picks.map((x) => pro(g.players[x.playerId], x.agent))
  g.drill = { kind: 'agent', picks }
  settle(g)
  const after = picks.map((x) => pro(g.players[x.playerId], x.agent))
  check('五个人这一周都涨了熟练度',
    after.every((v, i) => v > before[i]),
    after.map((v, i) => `+${(v - before[i]).toFixed(1)}`).join(' '))
  check('五个人涨得一样多（每人的速度没变）',
    Math.max(...after.map((v, i) => v - before[i])) - Math.min(...after.map((v, i) => v - before[i])) < 4,
    after.map((v, i) => (v - before[i]).toFixed(1)).join(' / '))
  check('计划留在原地，下周接着练', g.drill.kind === 'agent' && g.drill.picks.length === 5)
}

// ---------------------------------------------------------------- 一个人一个英雄
{
  const g = mk()
  const p = squadOf(g, g.myTeam)[0]
  const a = somethingNew(p)
  g.drill = { kind: 'agent', picks: [{ playerId: p.id, agent: a }] }
  const b0 = pro(g.players[p.id], a)
  settle(g)
  const one = pro(g.players[p.id], a) - b0
  check('一个人一个英雄，一周一份', one > 0, `+${one.toFixed(1)}`)
  check('上限就是五个人', AGENT_DRILL_MAX === 5, `${AGENT_DRILL_MAX}`)
}

// ---------------------------------------------------------------- 各算各的
{
  const g = mk()
  const five = squadOf(g, g.myTeam).slice(0, 5)
  const picks: AgentPick[] = five.map((p) => ({ playerId: p.id, agent: somethingNew(p) }))
  g.drill = { kind: 'agent', picks }
  // 第一个人被卖了，第二个人伤停
  g.players[five[0].id].teamId = 'gone'
  g.players[five[1].id].injuredUntil = g.day + 10
  const before = picks.map((x) => pro(g.players[x.playerId], x.agent))
  const notes = settle(g)
  const after = picks.map((x) => pro(g.players[x.playerId], x.agent))
  check('被卖掉的那个不练了', after[0] === before[0])
  check('伤停的那个这周也不练', after[1] === before[1])
  check('剩下三个照练不误', after.slice(2).every((v, i) => v > before[i + 2]),
    after.slice(2).map((v, i) => `+${(v - before[i + 2]).toFixed(1)}`).join(' '))
  check('走掉的人从计划里剔除，伤停的人留着',
    g.drill.kind === 'agent' && g.drill.picks.length === 4
    && !g.drill.picks.some((x) => x.playerId === five[0].id)
    && g.drill.picks.some((x) => x.playerId === five[1].id),
    g.drill.kind === 'agent' ? `${g.drill.picks.length} 人` : g.drill.kind)
  check('两条提醒都写给了经理',
    notes.some((n) => n.includes('不在队中')) && notes.some((n) => n.includes('伤停')),
    notes.join(' | '))
}

// ---------------------------------------------------------------- 练满了就下车
{
  const g = mk()
  const two = squadOf(g, g.myTeam).slice(0, 2)
  const a0 = somethingNew(two[0]), a1 = somethingNew(two[1])
  // 第一个人差一点就满
  two[0].agentPro = { ...two[0].agentPro, [a0]: 99.5 }
  g.drill = { kind: 'agent', picks: [{ playerId: two[0].id, agent: a0 }, { playerId: two[1].id, agent: a1 }] }
  const notes = settle(g)
  check('练满的人报喜', notes.some((n) => n.includes('练满了')), notes.join(' | '))
  check('练满的人从计划里下车，另一个还在',
    g.drill.kind === 'agent' && g.drill.picks.length === 1 && g.drill.picks[0].playerId === two[1].id,
    g.drill.kind === 'agent' ? JSON.stringify(g.drill.picks) : g.drill.kind)
}
{
  const g = mk()
  const p = squadOf(g, g.myTeam)[0]
  const a = somethingNew(p)
  p.agentPro = { ...p.agentPro, [a]: 99.5 }
  g.drill = { kind: 'agent', picks: [{ playerId: p.id, agent: a }] }
  settle(g)
  check('最后一个人练满了，训练位就空出来', g.drill.kind === 'none', g.drill.kind)
}

// ---------------------------------------------------------------- 老存档
{
  const g = mk()
  const p = squadOf(g, g.myTeam)[0]
  const a = somethingNew(p)
  // 改动之前存的那份计划：playerId + agent，没有 picks
  const old = JSON.parse(JSON.stringify(g)) as GameState
  ;(old as { drill?: unknown }).drill = { kind: 'agent', playerId: p.id, agent: a }
  old.drillLock = old.day + 3
  const file = JSON.stringify({ format: 'VAL_MANAGER_SAVE', version: 1, state: old })
  const back = importSave(file)
  check('老存档读回来是一张单人的表',
    back.drill?.kind === 'agent' && back.drill.picks.length === 1
    && back.drill.picks[0].playerId === p.id && back.drill.picks[0].agent === a,
    JSON.stringify(back.drill))
  const b0 = pro(back.players[p.id], a)
  settle(back)
  check('并且照样练得动', pro(back.players[p.id], a) > b0)
}
{
  // 连人带英雄都缺的那种残档：不能带着一张空表进结算
  const g = mk()
  const broken = JSON.parse(JSON.stringify(g)) as GameState
  ;(broken as { drill?: unknown }).drill = { kind: 'agent' }
  const back = importSave(JSON.stringify({ format: 'VAL_MANAGER_SAVE', version: 1, state: broken }))
  check('缺胳膊少腿的那条计划直接作废', back.drill?.kind === 'none', JSON.stringify(back.drill))
}

console.log(bad ? `\n${bad} 条不过` : '\n全部通过')
process.exit(bad ? 1 : 0)
