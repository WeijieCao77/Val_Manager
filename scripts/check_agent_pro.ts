/**
 * 熟练度从「位置」搬到「英雄」之后的契约。
 *
 *   npx tsx scripts/check_agent_pro.ts
 *
 * 这条改动的由来是「康康玩得好决斗但玩不好夜露」：位置是错误的粒度。它当初
 * 被砍掉过一次（agents.ts 里那句 "a cost the player cannot answer is not a
 * decision"），因为那时候训练只能练位置、管理者没有办法消除这个代价。所以这
 * 里最要紧的一条是：每一份惩罚都必须能被练掉。
 */
import { agentFit, agentMod, rolePeak, seedAgentPro, IN_ROLE, OFF_ROLE } from '../src/engine/agents'
import { AGENTS, AGENT_ROLE, MAP_META, agentCn } from '../src/engine/content'
import { AGENT_DRILL, aiDrillFor, learnAgent, pickAgentToLearn } from '../src/engine/training'
import { createNewGame } from '../src/engine/world'
import { setupSeason } from '../src/engine/season'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import type { GameState, Player, Role } from '../src/engine/types'

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

const g = mk()
const squad = squadOf(g, g.myTeam)
const p = squad[0]

// ---------------------------------------------------------------- 播种
check('新开的档每个人都有英雄熟练度', Object.values(g.players).every((x) => !!x.agentPro))
check('他真正打过的英雄是满的',
  p.agentPool.length > 0 && p.agentPool.every((a) => (p.agentPro?.[a] ?? 0) === 100),
  p.agentPool.map(agentCn).join('、'))
const never = (AGENTS[(p.roles ?? [p.role])[0]] ?? []).find((a) => !p.agentPool.includes(a))!
check('没打过的英雄是零', (p.agentPro?.[never] ?? 0) === 0, agentCn(never))

// ------------------------------------------------------------ 老档迁移
{
  const old = {
    agentPool: ['Jett', 'Raze'], role: '决斗者' as Role, roles: ['决斗者'] as Role[],
    rolePro: { 控场: 70 },
  } as unknown as Player
  const seeded = seedAgentPro(old)
  check('迁移：常用英雄给满', seeded.Jett === 100 && seeded.Raze === 100)
  check('迁移：练了一半的位置摊到该位置每个英雄上',
    (AGENTS['控场'] ?? []).every((a) => seeded[a] === 70), `幽影 ${seeded.Omen}`)
  check('迁移只会给，不会拿走', Object.values(seeded).every((v) => v >= 0))
}

// -------------------------------------------------- 惩罚必须能被练掉
{
  const q = squadOf(mk(), g.myTeam)[0]
  const mine = (q.roles ?? [q.role])[0]
  const unknownOwn = (AGENTS[mine] ?? []).find((a) => !(q.agentPro?.[a] ?? 0))!
  const otherRole = (['决斗者', '先锋', '控场', '哨卫'] as Role[]).find((r) => !(q.roles ?? [q.role]).includes(r))!
  const unknownOff = (AGENTS[otherRole] ?? []).find((a) => !(q.agentPro?.[a] ?? 0))!
  const lossOwn = 1 - agentMod(q, unknownOwn)
  const lossOff = 1 - agentMod(q, unknownOff)
  check('本职里没练过的英雄，代价是错位的三分之一',
    Math.abs(lossOwn - OFF_ROLE * (1 - IN_ROLE)) < 1e-9, `−${(lossOwn * 100).toFixed(1)}%`)
  check('完全不是他的位置，代价是满的', Math.abs(lossOff - OFF_ROLE) < 1e-9, `−${(lossOff * 100).toFixed(1)}%`)
  check('两者有区别', lossOwn < lossOff)

  learnAgent(q, unknownOwn, 100)
  check('练满本职的那个英雄，代价归零', agentMod(q, unknownOwn) === 1)
  const sibling = (AGENTS[mine] ?? []).find((a) => a !== unknownOwn && !(q.agentPro?.[a] ?? 0))
  if (sibling) {
    check('但同位置的下一个英雄仍然生疏 —— 练的是角色不是位置',
      agentMod(q, sibling) < 1, `${agentCn(sibling)} ×${agentMod(q, sibling).toFixed(3)}`)
  }
  const got = learnAgent(q, unknownOff, 100)
  check('练满一个别的位置的英雄，就此兼任那个位置', got?.newRole === otherRole, String(got?.newRole))
  check('兼任之后他上那个英雄没有惩罚', agentMod(q, unknownOff) === 1)
  check('并被标成 flex', q.flex === true)
}

// ------------------------------------------------------------ 训练速度
{
  const q = squadOf(mk(), g.myTeam)[0]
  const target = (AGENTS['哨卫'] ?? []).find((a) => !(q.agentPro?.[a] ?? 0))!
  let weeks = 0
  while ((q.agentPro?.[target] ?? 0) < 100 && weeks < 200) { learnAgent(q, target, AGENT_DRILL); weeks++ }
  check('专练一个英雄，一个赛季上下练得满', weeks >= 15 && weeks <= 40, `${weeks} 周`)
  check('练满之后不会再涨', learnAgent(q, target, 50) === null)
}

// -------------------------------------------------------- AI 补位置缺口
{
  const g2 = mk()
  const club = Object.values(g2.teams).find((t) => t.id !== g2.myTeam)!
  for (const x of squadOf(g2, club.id)) {
    x.roles = ['决斗者', '先锋', '控场']; x.role = '决斗者'; x.agentPro = {}
  }
  const d = aiDrillFor(g2, club)
  check('AI 缺哨卫时会挑一个哨卫英雄去练',
    d.kind === 'agent' && AGENT_ROLE[d.picks[0].agent] === '哨卫', JSON.stringify(d))
  const learner = squadOf(g2, club.id)[0]
  const pick = pickAgentToLearn(learner, '哨卫')
  check('挑的是现役地图常用的那个',
    !!pick && Object.values(MAP_META).flat().includes(pick), pick ? agentCn(pick) : 'none')
}

// -------------------------------------------------------- rolePeak
{
  const q = squadOf(mk(), g.myTeam)[0]
  q.agentPro = { Killjoy: 40, Cypher: 75 }
  check('rolePeak 取这个位置上他最拿手的那个', rolePeak(q, '哨卫') === 75, String(rolePeak(q, '哨卫')))
  check('没碰过的位置是零', rolePeak(q, '控场') === 0)
}

// -------------------------------------------------------- 自由人不受罚
{
  const free = { role: '自由人' as Role, roles: ['自由人'] as Role[], agentPool: [], agentPro: {} } as unknown as Player
  check('自由人（vlr 没记录位置）照旧什么都能打', agentFit(free, 'Omen') === 1)
}

console.log(bad ? `\n${bad} 项不通过` : '\n全部通过')
process.exit(bad ? 1 : 0)
