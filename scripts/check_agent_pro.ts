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
import { AGENTS, AGENT_ROLE, MAP_META, agentCn, canonAgent } from '../src/engine/content'
import { AGENT_DRILL, aiDrillFor, learnAgent, pickAgentToLearn } from '../src/engine/training'
import { WORLD_PLAYERS, createNewGame } from '../src/engine/world'
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
const played = new Set(Object.keys(WORLD_PLAYERS.find((w) => w.id === p.id)?.agentUse ?? {}).map((a) => canonAgent(a)))
const never = (AGENTS[(p.roles ?? [p.role])[0]] ?? []).find((a) => !p.agentPool.includes(a) && !played.has(a))!
check('没打过的英雄是零', (p.agentPro?.[never] ?? 0) === 0, agentCn(never))

// ------------------------------------------------------------ 按回合数分档
// 「所有选手的所有英雄都是0%熟练度」: a man who has played 400 rounds of Yoru
// knew it exactly as well as one who never touched it. The career table grades it.
{
  const veteran = {
    id: 'P-vet', ign: 'vet', role: '决斗者' as Role, roles: ['决斗者'] as Role[],
    agentPool: ['Jett'],
    agentUse: { jett: 3000, raze: 900, yoru: 300, neon: 75, phoenix: 24, omen: 150 },
    agentR: { jett: 1.2, raze: 1.2, yoru: 1.2, neon: 1.2, phoenix: 1.2, omen: 1.5 },
  } as unknown as Player
  const s = seedAgentPro(veteran)
  check('打满 300 回合的英雄是满的', s.Raze === 100 && s.Yoru === 100, `雷兹 ${s.Raze} 夜露 ${s.Yoru}`)
  check('打了几十回合的英雄在中间', s.Neon > 20 && s.Neon < 70 && s.Phoenix > 10 && s.Phoenix < s.Neon,
    `霓虹 ${s.Neon} 菲尼克斯 ${s.Phoenix}`)
  check('从没碰过的英雄是零', (s.Reyna ?? 0) === 0 && (s.Iso ?? 0) === 0)
  check('在别的位置上打过的英雄也算', s.Omen > 50 && s.Omen < 100, `幽影 ${s.Omen}`)
  const flat = seedAgentPro({ ...veteran, agentR: undefined } as unknown as Player)
  check('这个英雄上打得比自己平时好，多给一点，但有限',
    s.Omen > flat.Omen && s.Omen - flat.Omen <= Math.round(flat.Omen * 0.15) + 1, `${flat.Omen} → ${s.Omen}`)
  check('有表的人不再凭空补满三个 meta 英雄', Object.values(s).filter((v) => v >= 100).length === 3,
    Object.entries(s).filter(([, v]) => v >= 100).map(([a]) => agentCn(a)).join('、'))
  const rookie = {
    id: 'P-rk', ign: 'rk', role: '先锋' as Role, roles: ['先锋'] as Role[], agentPool: [],
    agentUse: { sova: 120, fade: 60, gekko: 20 },
  } as unknown as Player
  const r = seedAgentPro(rookie)
  check('新人总回合少，但占三成以上的本命是满的', r.Sova === 100, `猎枭 ${r.Sova}`)
  check('新人的第二英雄按比例也不低', r.Fade >= 60, `黑梦 ${r.Fade}`)
  const thin = { id: 'P-th', ign: 'th', role: '哨卫' as Role, roles: ['哨卫'] as Role[], agentPool: ['Cypher'] } as unknown as Player
  const t = seedAgentPro(thin)
  check('没有英雄表的人照旧补到三个', Object.values(t).filter((v) => v >= 100).length === 3)
  const tabled = Object.values(g.players).filter((x) => WORLD_PLAYERS.find((w) => w.id === x.id)?.agentUse)
  const mixed = tabled.filter((x) => {
    const vs = Object.values(x.agentPro ?? {})
    return vs.some((v) => v >= 100) && vs.some((v) => v > 0 && v < 100)
  })
  check('新开的档里有英雄表的人，绝大多数既有满的也有没满的英雄',
    tabled.length > 400 && mixed.length >= tabled.length * 0.9, `${mixed.length}/${tabled.length}`)
  check('存档里不带英雄表', Object.values(g.players).every((x) => !x.agentUse && !x.agentR))
}

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
