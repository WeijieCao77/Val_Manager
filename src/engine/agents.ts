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
import { AGENT_ROLE, AGENTS, MAP_META, agentCn, canonAgent, canonAgents } from './content'
import { agentAvailable } from './eras'
import COMPS from '../data/mapComps.json'
import { clamp, hashStr } from './rng'
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

/**
 * 列表里写他这个英雄练到多少。满了写「练满」；没满向下取整，免得 99.6 显示成
 * 100% 却还能再练。
 */
export function proLabel(p: Player, agent: string): string {
  const v = p.agentPro?.[agent] ?? 0
  return v >= 100 ? '练满' : `${Math.floor(v)}%`
}

/** 一组英雄按他的熟练度从高到低排，一样高的保持原来的顺序。 */
export function byPro(p: Player, agents: string[]): string[] {
  return agents.slice().sort((x, y) => (p.agentPro?.[y] ?? 0) - (p.agentPro?.[x] ?? 0))
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

/** 一个英雄打满这么多回合就算练满：十几张图的量。 */
export const FULL_ROUNDS = 300
/**
 * 或者占了他生涯这么大的比例。新人的总回合少，按绝对数他什么都不满，可他
 * 打了三成回合的那个英雄就是他的本命，理应是满的。
 */
export const FULL_SHARE = 0.35

/**
 * 打过多少回合，折成 0-100 的熟练度。
 *
 * 开平方：前面涨得快，后面慢——两张图就能把一个英雄用起来（≈30），真正
 * 练熟要一个赛季。`r` 是他在这个英雄上的 rating，`career` 是他生涯的：在
 * 这个英雄上打得比自己平时好就多给一点，差就少给一点，幅度有限，且只动
 * 没满的——打满的就是满的，数据再难看也不会把一个人的本命扣成生疏。
 */
export function proFromUse(rounds: number, total: number, r?: number, career?: number): number {
  if (!(rounds > 0)) return 0
  const depth = Math.max(rounds / FULL_ROUNDS, total > 0 ? rounds / total / FULL_SHARE : 0)
  let v = 100 * Math.sqrt(Math.min(1, depth))
  if (v < 100 && r != null && career != null) v *= clamp(1 + (r - career) * 0.5, 0.85, 1.15)
  return Math.round(clamp(v, 0, 100))
}

/**
 * 播下每个英雄的熟练度。
 *
 * 有生涯英雄表（vlr 全时段 / 号角）的人，按每个英雄打过的回合数分档：打得多
 * 的满，打得少的按 proFromUse 折算，没碰过的是零。这就是「用选手的生涯玩过
 * 哪些英雄、哪些玩的多、哪些少来判断」。他现在正在打的那几个（agentPool，
 * 本赛季用得最多的）无论如何是满的。
 *
 * 没有英雄表的人（青训、自由球员、只有一行名字的）退回老办法：记录在案的
 * 英雄给满，再把每个本职位置补到 POOL_PER_ROLE 个——补的是这个位置在现役图池
 * 里最常见的角色。数据少的选手不因此吃亏，「有些英雄他没练过」这件事对谁都
 * 成立。有表的人每个本职位置只保证一个满的：表说他会什么就是什么。
 *
 * 老存档还要把 rolePro 折进来：旧的「练位置」进度对那个位置的任何英雄都算数，
 * 所以按位置摊到该位置的全部英雄上——迁移只会给，不会拿走。
 */
export function seedAgentPro(p: Player, available: (agent: string) => boolean = () => true): Record<string, number> {
  const out: Record<string, number> = {}
  // 生涯表：键可能是 vlr 的 slug，先归一
  const use: [string, number][] = []
  for (const [a, n] of Object.entries(p.agentUse ?? {})) {
    const c = canonAgent(a)
    if (c && n > 0) use.push([c, n])
  }
  const total = use.reduce((s, [, n]) => s + n, 0)
  const rOf: Record<string, number> = {}
  for (const [a, r] of Object.entries(p.agentR ?? {})) { const c = canonAgent(a); if (c) rOf[c] = r }
  let rSum = 0, rW = 0
  for (const [a, n] of use) if (rOf[a] != null) { rSum += rOf[a] * n; rW += n }
  const career = rW > 0 ? rSum / rW : undefined
  for (const [a, n] of use) out[a] = Math.max(out[a] ?? 0, proFromUse(n, total, rOf[a], career))
  const hasTable = use.length > 0

  for (const a of canonAgents(p.agentPool ?? [])) out[a] = 100
  for (const [role, v] of Object.entries(p.rolePro ?? {})) {
    for (const a of AGENTS[role as Role] ?? []) {
      out[a] = Math.max(out[a] ?? 0, v ?? 0)
    }
  }
  // 补哪几个要因人而异——补同一份 meta 列表会让全世界的选手会的英雄一模一样，
  // 两支队伍排出完全相同的五人，阵容多样性和整个打法风格系统一起失效。用选手
  // id 起一个偏移，稳定且各人不同。
  const meta = new Set(Object.values(MAP_META).flat())
  const seed = hashStr(p.id ?? p.ign ?? '')
  for (const role of (p.roles?.length ? p.roles : [p.role])) {
    if (role === '自由人') continue
    // only what exists on the day he is seeded — an agent that ships later is learnt then
    const all = (AGENTS[role] ?? []).filter(available)
    const width = hasTable ? 1 : POOL_PER_ROLE
    let want = width - all.filter((a) => (out[a] ?? 0) >= 100).length
    if (want <= 0 || !all.length) continue
    // 有表的人先把这个位置上他最拿手的那个补满——他被记成这个位置就是因为它
    if (hasTable) {
      const best = all.filter((a) => (out[a] ?? 0) > 0).sort((x, y) => out[y] - out[x])[0]
      if (best) { out[best] = 100; want-- }
    }
    // 常见英雄排在前面，但从每个人自己的偏移开始取
    const ranked = all.slice().sort((x, y) => Number(meta.has(y)) - Number(meta.has(x)))
    for (let i = 0; i < ranked.length && want > 0; i++) {
      const a = ranked[(i + seed) % ranked.length]
      if ((out[a] ?? 0) >= 100) continue
      out[a] = 100
      want--
    }
  }
  for (const a of Object.keys(out)) if (!available(a)) delete out[a]
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

function legacyAutoAgents(
  state: GameState, teamId: string, five: Player[], map: string,
): Record<string, string> {
  // only agents that exist on the game date — a 2024 save has no Tejo
  const have = (a: string) => agentAvailable(state, a)
  const meta = (MAP_META[map] ?? []).filter(have)
  const AGENTS_NOW: Record<string, string[]> = Object.fromEntries(
    Object.entries(AGENTS).map(([r, list]) => [r, list.filter(have)]),
  )
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
    // 开瓦包借用的世界要逐字走老路径：卡牌天梯的平衡是按那条链调过的，
    // 换一个回退顺序就会挪动卡组强弱（check_leagues 抓到过 83%）。
    const agent = isArena(state)
      ? (onMap.find(known) ?? onMap[0] ?? (AGENTS_NOW[role] ?? []).find((a) => !used.has(a)))
      : (onMap.find(known)
        ?? (AGENTS_NOW[role] ?? []).find((a) => !used.has(a) && known(a))
        ?? onMap[0]
        ?? (AGENTS_NOW[role] ?? []).find((a) => !used.has(a)))
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
      // 中间这一层同样只在经理模式里加
      ?? (isArena(state) ? undefined
        : mine.flatMap((r) => AGENTS_NOW[r] ?? []).find((a) => !used.has(a) && knows(a)))
      ?? meta.find((a) => !used.has(a) && mine.includes(AGENT_ROLE[a]))
      ?? p.agentPool.find((a) => !used.has(a) && mine.includes(AGENT_ROLE[a]))
      ?? mine.flatMap((r) => AGENTS_NOW[r] ?? []).find((a) => !used.has(a))
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
  if (!isArena(state)) return normalizeProSheet(state, teamId, five, map, picks)
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

// ------------------------------------------------------- the pros' shapes

/**
 * 经理模式的自动排阵：照职业比赛在这张图上真实出现过的阵型来排。
 *
 * 旧的做法是「四个位置各一个，再给第五个人一个本职英雄」，一个位置没人时还会
 * 把后面那个位置的人抢走——于是一支三个哨卫出身的队会排出三哨卫零决斗，一支
 * 签满决斗的 AI 队会在六张图上都排三决斗零先锋（measure_comp_shapes.ts：
 * 三个赛季后 1.0% 的出场阵容同一位置三个以上）。职业比赛里 3034 套阵容只有 12
 * 套这样排（scripts/build_map_comps.py → data/mapComps.json）。
 *
 * 现在：候选阵型只取这张图上职业比赛占比 ≥3%、每个位置最多两人、至少一个
 * 控场的；先让每个人尽量打本位，本位都满足的前提下选更常见的阵型；同一位置
 * 里按这张图的出场率挑英雄，会的优先。开瓦包借用的世界仍走老路径（平衡按那
 * 条链调过）。
 */
interface CompData { comps: number; shapes: [string, number][]; picks: Record<string, [string, number][]> }
const MAP_COMPS = (COMPS as unknown as { maps: Record<string, CompData> }).maps
const SHAPE_ORDER: Role[] = ['决斗者', '先锋', '控场', '哨卫']
/** below this many comps a map's own shape table is noise; its pick order still counts */
const MIN_MAP_COMPS = 60
const MIN_SHAPE_SHARE = 0.03
const MIN_PICK_SHARE = 0.05
/** what one player off his job costs against a rarer shape: more than any shape gap (ln 0.4/0.03 ≈ 2.6) */
const OFF_JOB = 3

export interface ProShape { roles: Role[]; share: number; key: string }

/** a shape seen league-wide but not on this map counts for this much of its league share */
const ELSEWHERE = 0.25

/**
 * The shapes a five may take onto this map, most likely first — never 3 of a
 * role, always a controller. This map's own pro shapes at their share, then the
 * shapes pros run on any map at a quarter of theirs: a roster built for 2-1-1-1
 * keeps its jobs on Bind (where pros run it 2% of the time) instead of sending a
 * man off his role to copy the map's favourite.
 */
export function proShapes(map: string): ProShape[] {
  const ok = (key: string, share: number) => {
    const counts = key.split('-').map(Number)
    return share >= MIN_SHAPE_SHARE && counts.length === 4 && counts.every((c) => c <= 2) && counts[2] >= 1
  }
  const make = (key: string, share: number): ProShape => ({
    key, share, roles: SHAPE_ORDER.flatMap((r, i) => Array(Number(key.split('-')[i])).fill(r) as Role[]),
  })
  const own = MAP_COMPS[map]
  const out: ProShape[] = []
  if (own && own.comps >= MIN_MAP_COMPS) for (const [key, share] of own.shapes) if (ok(key, share)) out.push(make(key, share))
  const seen = new Set(out.map((x) => x.key))
  for (const [key, share] of MAP_COMPS['*']?.shapes ?? []) {
    if (seen.has(key) || !ok(key, share)) continue
    out.push(make(key, out.length ? share * ELSEWHERE : share))
  }
  return out.length ? out.sort((x, y) => y.share - x.share) : [make('2-1-1-1', 1)]
}

/** How common a sheet's shape is on this map in pro play (0 if pros never field it). */
export function proShapeShare(map: string, agents: string[]): number {
  const counts = SHAPE_ORDER.map((r) => agents.filter((a) => AGENT_ROLE[a] === r).length)
  const own = MAP_COMPS[map]
  const data = own && own.comps >= MIN_MAP_COMPS ? own : MAP_COMPS['*']
  return data?.shapes.find(([k]) => k === counts.join('-'))?.[1] ?? 0
}

/** The agents pros run on this map (≥5% of comps), with that share, most picked first. */
export function proPickShares(map: string): [string, number][] {
  const own = MAP_COMPS[map]
  if (!own) return []
  return SHAPE_ORDER.flatMap((r) => own.picks[r] ?? []).filter(([, sh]) => sh >= MIN_PICK_SHARE).sort((a, b) => b[1] - a[1])
}

/** 「两决斗 一先锋 两控场」 for a shape key like "2-1-2-0" */
export function shapeCn(key: string): string {
  const cn = ['决斗', '先锋', '控场', '哨卫']
  const num = ['零', '一', '两', '三', '四', '五']
  return key.split('-').map((c, i) => (Number(c) ? `${num[Number(c)]}${cn[i]}` : '')).filter(Boolean).join(' ')
}

/** The problems with a sheet worth saying out loud, measured against the pros on this map. */
export function sheetWarnings(map: string, agents: string[]): string[] {
  const out: string[] = []
  for (const r of SHAPE_ORDER) {
    const n = agents.filter((a) => AGENT_ROLE[a] === r).length
    if (n >= 3) out.push(`${n} 个${r}：职业比赛 3000 多套阵容里几乎没有这样排的`)
  }
  if (agents.length === 5 && !agents.some((a) => AGENT_ROLE[a] === '控场')) out.push('没有控场，没人封烟')
  if (!out.length && agents.length === 5 && proShapeShare(map, agents) < MIN_SHAPE_SHARE) out.push('这张图职业比赛很少这样排')
  return out
}

/** the shapes worth showing as 「职业常见」, top three */
export const commonShapes = (map: string): ProShape[] => proShapes(map).slice(0, 3)

/** This map's agents for a role, in pro pick-rate order, then the rest of the role. */
export function proPicks(map: string, role: Role): string[] {
  const rated = (MAP_COMPS[map]?.picks[role] ?? []).filter(([, s]) => s >= MIN_PICK_SHARE).map(([a]) => a)
  const meta = (MAP_META[map] ?? []).filter((a) => AGENT_ROLE[a] === role)
  const overall = (MAP_COMPS['*']?.picks[role] ?? []).map(([a]) => a)
  return [...new Set([...rated, ...meta, ...overall, ...(AGENTS[role] ?? [])])]
}

const jobCost = (p: Player, role: Role): number => {
  const covers = p.roles ?? [p.role]
  if (!covers.includes(role)) return OFF_JOB - Math.min(rolePeak(p, role), 100) / 100
  return role === p.role ? 0 : 0.15
}

/** the cheapest way to seat these players in these slots (5! at most), honouring fixed roles */
function seat(players: Player[], slots: Role[], fixed: Map<string, Role>): { cost: number; roles: Map<string, Role> } | null {
  let best: { cost: number; roles: Map<string, Role> } | null = null
  const used = slots.map(() => false)
  const cur = new Map<string, Role>()
  const walk = (i: number, cost: number) => {
    if (best && cost >= best.cost) return
    if (i === players.length) { best = { cost, roles: new Map(cur) }; return }
    const p = players[i]
    const tried = new Set<Role>()
    for (let k = 0; k < slots.length; k++) {
      if (used[k] || tried.has(slots[k])) continue
      tried.add(slots[k])
      const want = fixed.get(p.id)
      if (want && want !== slots[k]) continue
      used[k] = true; cur.set(p.id, slots[k])
      walk(i + 1, cost + (want ? 0 : jobCost(p, slots[k])))
      used[k] = false; cur.delete(p.id)
    }
  }
  walk(0, 0)
  return best
}

/**
 * A club's habit on a map this season: a fixed draw per (club, map, year), so the
 * shapes a league fields come out in the pros' proportions (argmax of ln share +
 * Gumbel noise samples a shape with probability ∝ its share) instead of every
 * club running the single most common one.
 */
const habit = (teamId: string, map: string, year: number, key: string): number => {
  const u = ((hashStr(`shape:${teamId}:${map}:${year}:${key}`) >>> 0) + 0.5) / 4294967296
  return -Math.log(-Math.log(u))
}

function proSheet(
  state: GameState, teamId: string, five: Player[], map: string, fixed: Record<string, string> = {},
): Record<string, string> {
  const have = (a: string) => agentAvailable(state, a)
  const fixedRole = new Map(Object.entries(fixed).map(([id, a]) => [id, AGENT_ROLE[a]]))
  // the shape: fit first — only the shapes that seat this five best are in the
  // running (a secondary role counts as a seat) — then the pros' frequency
  const fits = proShapes(map)
    .filter((shape) => shape.roles.length === five.length)
    .map((shape) => ({ shape, fit: seat(five, shape.roles, fixedRole) }))
    .filter((x): x is { shape: ProShape; fit: { cost: number; roles: Map<string, Role> } } => !!x.fit)
  const bestCost = Math.min(...fits.map((x) => x.fit.cost))
  let choice: { roles: Map<string, Role>; score: number } | null = null
  for (const { shape, fit } of fits) {
    if (fit.cost > bestCost + 0.5) continue
    const score = Math.log(shape.share) + habit(teamId, map, state.year, shape.key) - fit.cost
    if (!choice || score > choice.score) choice = { roles: fit.roles, score }
  }
  const roleOf = choice?.roles ?? new Map(five.map((p) => [p.id, fixedRole.get(p.id) ?? p.role]))

  const out: Record<string, string> = { ...fixed }
  const used = new Set(Object.values(fixed))
  // smokes first, then the rest; inside a role the man who knows the map's top pick best goes first
  const order = five
    .filter((p) => !fixed[p.id])
    .sort((x, y) => SHAPE_ORDER.indexOf(roleOf.get(y.id)!) - SHAPE_ORDER.indexOf(roleOf.get(x.id)!)
      || rolePeak(y, roleOf.get(y.id)!) - rolePeak(x, roleOf.get(x.id)!) || x.id.localeCompare(y.id))
  for (const p of order) {
    const role = roleOf.get(p.id)!
    const list = proPicks(map, role).filter((a) => have(a) && !used.has(a))
    const rated = new Set((MAP_COMPS[map]?.picks[role] ?? []).filter(([, sh]) => sh >= MIN_PICK_SHARE).map(([a]) => a))
    const knows = (a: string) => (p.agentPro?.[a] ?? 0) > 0
    // the map's usual picks he can play, then any agent of the job he knows, then the map's usual pick
    const agent = list.find((a) => rated.has(a) && knows(a))
      ?? list.find(knows)
      ?? list[0]
    if (agent) { out[p.id] = agent; used.add(agent) }
  }
  return out
}

/**
 * Keep what was chosen, fill the rest into the shape the kept picks leave room for —
 * the old refill re-covered all four jobs among the missing men alone, which is how a
 * five that lost a player to a transfer could come back with a third sentinel.
 */
function normalizeProSheet(
  state: GameState, teamId: string, five: Player[], map: string, picks: Record<string, string>,
): Record<string, string> {
  const kept: Record<string, string> = {}
  const used = new Set<string>()
  for (const p of five) {
    const want = picks[p.id]
    if (want && !used.has(want) && AGENT_ROLE[want]) { kept[p.id] = want; used.add(want) }
  }
  if (Object.keys(kept).length === five.length) return kept
  return proSheet(state, teamId, five, map, kept)
}

/** Fill a five automatically — the pros' shapes in manager mode, the old chain in the arena. */
export function autoAgents(
  state: GameState, teamId: string, five: Player[], map: string,
): Record<string, string> {
  return isArena(state) ? legacyAutoAgents(state, teamId, five, map) : proSheet(state, teamId, five, map)
}
