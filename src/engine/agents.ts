/**
 * Which agent each player is on, and what it costs to be on the wrong one.
 *
 * Agents were decoration until now: `agentPool` recorded what a real player
 * actually plays and the 练新英雄 drill grew `rolePro`, but nothing in the
 * match ever read either. This is the layer that makes the pick matter.
 *
 * A player is judged on the JOB, not the character model. Put a duelist on a
 * controller and the site does not get smoked — that is the −12% he plays at.
 * Being on an agent he has actually played, rather than merely one from his
 * own role, is worth a little on top.
 */
import { AGENT_ROLE, AGENTS, MAP_META, agentCn } from './content'
import { hashStr } from './rng'
import { isArena } from './types'
import type { GameState, Player, Role } from './types'

/**
 * 本职范围内，一个从没碰过的英雄仍然打得动，只是不如他的常用英雄。
 * 1 - IN_ROLE 就是这份差距在 OFF_ROLE 里占的比例。
 */
export const IN_ROLE = 2 / 3

/** How far off his job an agent puts a player: 1 = right at home, 0 = lost. */
export function agentFit(p: Player, agent: string | undefined): number {
  if (!agent) return 1
  const need = AGENT_ROLE[agent]
  if (!need) return 1
  const covers = p.roles ?? [p.role]
  // 自由人 in this data means "vlr never recorded a position", not "has none".
  // Everything else in the engine treats such a player as able to plug any
  // hole — autoStarters, the composition score — and the house rule is that
  // missing data is never a penalty. He plays anything without complaint.
  if (covers.includes('自由人')) return 1
  // 这个英雄本人练到哪了。练满就是练满，哪怕不是他的位置——一个决斗者把幽影
  // 练到 100，他上幽影就没有惩罚，这正是「代价必须能被消除」的意思。
  const pro = p.agentPro?.[agent] ?? 0
  // 本职的英雄有个地板：会打这个位置，就不至于完全不会用这个角色
  const floor = covers.includes(need) ? IN_ROLE : 0
  return Math.min(1, Math.max(floor, pro / 100))
}

/** 这个位置上他最拿手的英雄练到了多少——自动排阵和 AI 选人靠它挑人。 */
export function rolePeak(p: Player, role: Role): number {
  let best = 0
  for (const [a, v] of Object.entries(p.agentPro ?? {})) {
    if (AGENT_ROLE[a] === role && v > best) best = v
  }
  return best
}

/**
 * 一个职业选手在自己的位置上会几个英雄。
 *
 * 这个数字必须是常数，不能是「vlr 记录了几个」。`agentPool` 的大小是数据覆盖
 * 的产物：名将有七八个英雄在案，冷门赛区的选手可能只有一个。按记录数量播种，
 * 弱队就会平白多吃一堆生疏惩罚——这正是这个文件开头那条家规禁止的事（missing
 * data is never a penalty），也确实把最强俱乐部对场上其他队的胜率从 68% 推到
 * 了 76%，check_club_balance 抓到了。
 */
export const POOL_PER_ROLE = 3

/**
 * 从 agentPool 播下每个英雄的熟练度。
 *
 * 记录在案的英雄他是真会，给满。然后每个他覆盖的位置补到 POOL_PER_ROLE 个，
 * 补的是这个位置在现役图池里最常见的角色——数据少的选手不因此吃亏，而「有些
 * 英雄他没练过」这件事对谁都成立。
 *
 * 老存档还要把 rolePro 折进来：旧的「练位置」进度对那个位置的任何英雄都算数，
 * 所以按位置摊到该位置的全部英雄上——迁移只会给，不会拿走。
 */
export function seedAgentPro(p: Player): Record<string, number> {
  const out: Record<string, number> = {}
  for (const a of p.agentPool ?? []) out[a] = 100
  for (const [role, v] of Object.entries(p.rolePro ?? {})) {
    for (const a of AGENTS[role as Role] ?? []) {
      out[a] = Math.max(out[a] ?? 0, v ?? 0)
    }
  }
  // 每个本职位置补齐到同样的宽度。补哪几个要因人而异——补同一份 meta 列表
  // 会让全世界的选手会的英雄一模一样，两支队伍排出完全相同的五人，阵容多样性
  // 和整个打法风格系统一起失效。用选手 id 起一个偏移，稳定且各人不同。
  const meta = new Set(Object.values(MAP_META).flat())
  const seed = hashStr(p.id ?? p.ign ?? '')
  for (const role of (p.roles?.length ? p.roles : [p.role])) {
    if (role === '自由人') continue
    const all = AGENTS[role] ?? []
    const want = POOL_PER_ROLE - all.filter((a) => (out[a] ?? 0) >= 100).length
    if (want <= 0 || !all.length) continue
    // 常见英雄排在前面，但从每个人自己的偏移开始取
    const ranked = all.slice().sort((x, y) => Number(meta.has(y)) - Number(meta.has(x)))
    let added = 0
    for (let i = 0; i < ranked.length && added < want; i++) {
      const a = ranked[(i + seed) % ranked.length]
      if ((out[a] ?? 0) >= 100) continue
      out[a] = 100
      added++
    }
  }
  return out
}

/** What playing out of position costs a player, at worst. */
export const OFF_ROLE = 0.12

/**
 * The multiplier a player's rating takes for the agent he is on.
 *
 * The JOB is the whole of it. There was also a −3% for a character outside his
 * recorded pool, and it had to go: `agentPool` is scraped from what vlr
 * happened to record, the training screen drills POSITIONS rather than
 * individual agents, and so a manager had no way at all to remove that
 * penalty — monk on Omen was worse than monk on Brimstone with nothing he
 * could ever do about it. A cost the player cannot answer is not a decision.
 */
export function agentMod(p: Player, agent: string | undefined): number {
  return 1 - (1 - agentFit(p, agent)) * OFF_ROLE
}

/** Is this agent one the manager should be warned about for this player? */
export function agentWarn(p: Player, agent: string): string | null {
  const fit = agentFit(p, agent)
  if (fit >= 1) return null
  const loss = Math.round((1 - agentMod(p, agent)) * 100)
  const need = AGENT_ROLE[agent]
  const pro = Math.round(p.agentPro?.[agent] ?? 0)
  const covers = (p.roles ?? [p.role]).includes(need)
  if (pro > 0) return `${p.ign} 的${agentCn(agent)}只练到 ${pro}%，大约 −${loss}%`
  return covers
    ? `${p.ign} 没练过${agentCn(agent)}，大约 −${loss}%`
    : `${p.ign} 不是${need}，也没练过${agentCn(agent)}，大约 −${loss}%`
}

/**
 * Fill a five automatically: the map's usual agents, handed to whoever can
 * actually play them.
 *
 * Role first, meta order second. A lineup built this way never carries an
 * out-of-position pick unless the five itself has a hole in it.
 */
/**
 * Assign the four jobs to four different players, covering as many as the
 * squad actually can.
 *
 * Greedy in a fixed order is not good enough: if one man is the only
 * controller AND the only sentinel, taking him for the first leaves the second
 * to somebody who cannot play it, while a different assignment would have
 * covered both. This is the standard augmenting-path matching — four roles
 * against five players is tiny, and it is the difference between an automatic
 * sheet that is optimal and one that merely looks reasonable.
 */
function matchRoles(five: Player[], roles: Role[]): Map<Role, Player> {
  const covers = (p: Player) => p.roles ?? [p.role]
  const byRole = new Map<Role, Player>()
  const takenBy = new Map<string, Role>()

  const tryAssign = (role: Role, seen: Set<string>): boolean => {
    for (const p of five) {
      if (seen.has(p.id) || !covers(p).includes(role)) continue
      seen.add(p.id)
      const holder = takenBy.get(p.id)
      if (!holder || tryAssign(holder, seen)) {
        byRole.set(role, p)
        takenBy.set(p.id, role)
        return true
      }
    }
    return false
  }
  for (const r of roles) tryAssign(r, new Set())
  return byRole
}

export function autoAgents(
  state: GameState, teamId: string, five: Player[], map: string,
): Record<string, string> {
  const meta = MAP_META[map] ?? []
  const out: Record<string, string> = {}
  const used = new Set<string>()
  const taken = new Set<string>()
  const covers = (p: Player) => p.roles ?? [p.role]

  // Cover the four jobs first, then fill. A comp is a set of jobs, not a
  // ranking, so who plays what is decided by matching before any agent is
  // handed out.
  const CORE: Role[] = ['控场', '哨卫', '先锋', '决斗者']
  const matched = matchRoles(five, CORE)

  for (const role of CORE) {
    const man = matched.get(role)
      // nobody whose job it is: the one furthest into learning it, and failing
      // that whoever is left. A side always has someone on smokes, even when
      // the roster has no controller — that is what the −12% is for.
      ?? five.filter((p) => !taken.has(p.id))
        .sort((x, y) => rolePeak(y, role) - rolePeak(x, role))[0]
    if (!man || taken.has(man.id)) continue
    // 地图的常规选择仍然是主序 —— 熟练度只在「这张图这个位置的几个常见英雄」
    // 之间决定先后。让熟练度压过图池的那一版，会把各队推到双决斗/双哨卫这类
    // 偏门阵型上，而阵型在 tacticEdge 里的基础加减很大，强弱队的差距被放大到
    // 一对 100%（check_club_balance 抓到的就是这个）。
    //
    // 中间那一层仍然保留：图上这个位置他一个都不会时，宁可给他一个本位置会的，
    // 也不要塞一个他不会的 —— 自动排阵造成的惩罚是没有人能消除的。
    // 开瓦包借用的世界不读英雄熟练度：卡是按槽位排的，强弱只应由卡本身决定
    const known = (a: string) => isArena(state)
      ? man.agentPool.includes(a)
      : (man.agentPro?.[a] ?? 0) > 0
    const onMap = meta.filter((a) => !used.has(a) && AGENT_ROLE[a] === role)
    const agent = onMap.find(known)
      ?? (AGENTS[role] ?? []).find((a) => !used.has(a) && known(a))
      ?? onMap[0]
      ?? (AGENTS[role] ?? []).find((a) => !used.has(a))
    if (!agent) continue
    out[man.id] = agent
    used.add(agent)
    taken.add(man.id)
  }

  // and the fifth, on whatever suits him best out of what the map plays
  for (const p of five) {
    if (taken.has(p.id)) continue
    const mine = covers(p)
    const knows = (a: string) => isArena(state)
      ? p.agentPool.includes(a)
      : (p.agentPro?.[a] ?? 0) > 0
    const pick =
      meta.find((a) => !used.has(a) && mine.includes(AGENT_ROLE[a]) && knows(a))
      ?? mine.flatMap((r) => AGENTS[r] ?? []).find((a) => !used.has(a) && knows(a))
      ?? meta.find((a) => !used.has(a) && mine.includes(AGENT_ROLE[a]))
      ?? p.agentPool.find((a) => !used.has(a) && mine.includes(AGENT_ROLE[a]))
      ?? mine.flatMap((r) => AGENTS[r] ?? []).find((a) => !used.has(a))
      ?? meta.find((a) => !used.has(a))
    if (pick) { out[p.id] = pick; used.add(pick); taken.add(p.id) }
  }
  void teamId
  return out
}

/**
 * A sheet with nobody missing and nobody doubled.
 *
 * The pre-match screen swaps rather than overwrites, so it cannot produce
 * either — but a hand-edited save, or a five that changed after the sheet was
 * made, can. Anyone left without an agent is given one his role can play.
 */
export function normalizeAgents(
  state: GameState, teamId: string, five: Player[], map: string,
  picks: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  const used = new Set<string>()
  for (const p of five) {
    const want = picks[p.id]
    if (want && !used.has(want)) { out[p.id] = want; used.add(want) }
  }
  const missing = five.filter((p) => !out[p.id])
  if (!missing.length) return out
  const fallback = autoAgents(state, teamId, missing, map)
  for (const p of missing) {
    const covers = p.roles ?? [p.role]
    const pick = (!used.has(fallback[p.id]) ? fallback[p.id] : undefined)
      ?? covers.flatMap((r) => AGENTS[r] ?? []).find((a) => !used.has(a))
      ?? (MAP_META[map] ?? []).find((a) => !used.has(a))
    if (pick) { out[p.id] = pick; used.add(pick) }
  }
  return out
}

/** The roles a five is missing once every agent is assigned. */
export const agentRoleGaps = (five: Player[], picks: Record<string, string>): Role[] => {
  const have = new Set(five.map((p) => AGENT_ROLE[picks[p.id]]).filter(Boolean))
  return (['决斗者', '先锋', '控场', '哨卫'] as Role[]).filter((r) => !have.has(r))
}
