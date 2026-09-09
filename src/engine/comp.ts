/**
 * What a five IS, read off the agents it takes onto the map — and what that
 * shape does to the sliders, the timeout calls and the opponent.
 *
 * Until now the four tactical dials were the same four numbers for every
 * composition, and they nearly cancelled: aggression 100 was worth +1.4 on
 * attack and −0.75 on defence, which measured out at +0.4 points of map win
 * rate. The only setting that moved anything was 道具, and it moved the same
 * way for everybody, so the honest strategy was "drag everything right". That
 * is a dial with one correct position, which is not a decision. The group
 * chat said so: 「战术板的四个滑杆跟比赛胜负关系不大，阵容也跟胜负关系不大」.
 *
 * Real compositions have a shape, and the shape decides what the sliders can
 * buy. Pro data (thespike / rib / vlr composition tables, 2025 season):
 *
 *   双决斗 (2 duelists)     tempo and chaos — about 54% over the season,
 *                            58.8% in Pacific at 2026 Kickoff, lives on winning
 *                            duels; attack-leaning, thin on defence
 *   双控场 (2 controllers)  Omen + Viper was the dominant pair of 2025 —
 *                            methodical map control, pays on both sides, and
 *                            it is the utility budget that feeds it
 *   双哨卫 (2 sentinels)    setups and retakes — a defensive shape, slower,
 *                            punishes anyone who runs into it
 *   标准 (1D 2I 1C 1S)      the forgiving formula every map's default is
 *
 * So the engine reads the five's shape and scales the dials by it: 节奏 and
 * 侵略性 pay roughly double on a double-duelist five and cost double on a
 * double-sentinel one, 道具 is what a double-controller five is built on. And
 * the OPPONENT's shape decides what your dials run into — fast pace into a
 * double-sentinel setup is what loses the pistol, an aggressive defence
 * against two duelists gets run over.
 *
 * Nothing here is a number the manager cannot act on: every term is either
 * a slider, an agent pick, or the opponent's sheet.
 */
import { AGENT_ROLE } from './content'
import type { GameState, Role, Tactics } from './types'

export type CompStyle = 'rush' | 'hold' | 'control' | 'standard'

export interface CompShape {
  决斗者: number
  先锋: number
  控场: number
  哨卫: number
}

export function compShape(agents: Iterable<string>): CompShape {
  const s: CompShape = { 决斗者: 0, 先锋: 0, 控场: 0, 哨卫: 0 }
  for (const a of agents) {
    const r = AGENT_ROLE[a] as Role | undefined
    if (r && r in s) s[r as keyof CompShape]++
  }
  return s
}

/**
 * The doubled role names the style. A five is five agents over four jobs, so
 * at most one job is doubled while all four are covered; a five with a hole
 * can double two, and then the tempo shape wins — two duelists and two
 * controllers with no sentinel is the 2026 「蚊子」 Yoru comp, and it is
 * played as a rush.
 */
export function compStyle(agents: Iterable<string>): CompStyle {
  const s = compShape(agents)
  if (s.决斗者 >= 2) return 'rush'
  if (s.哨卫 >= 2) return 'hold'
  if (s.控场 >= 2) return 'control'
  return 'standard'
}

export const COMP_STYLE_CN: Record<CompStyle, {
  label: string
  blurb: string
  /** how to set the dials when this is OUR shape */
  advice: string
  /** how to set the dials when this is THEIR shape */
  counter: string
}> = {
  rush: {
    label: '双决斗',
    blurb: '两个突破手：节奏快、进攻硬，防守端薄。',
    advice: '节奏和侵略性往右拉，拉在左边等于白带两个决斗者。暂停时「强攻」更猛。',
    counter: '侵略性别拉高，激进的防守会被两个决斗者冲穿；中局应变拉高。',
  },
  hold: {
    label: '双哨卫',
    blurb: '两个守点位：防守端厚，节奏慢，进攻端要靠道具慢推。',
    advice: '节奏和侵略性往左拉，拉快了两个哨卫就是两个没枪的人。暂停时「稳守」更稳。',
    counter: '节奏放慢，冲两个哨卫的布置就是送；道具拉高慢慢拆。',
  },
  control: {
    label: '双控场',
    blurb: '两套烟：控图打法，攻防两端都受益，靠道具喂。',
    advice: '道具拉高，节奏和侵略性放中间。',
    counter: '道具拉高，节奏别太慢，等他们的烟铺开就晚了。',
  },
  standard: {
    label: '标准',
    blurb: '一决斗、双先锋、一控场、一哨卫，最不挑的公式。',
    advice: '滑杆按对手来调：对双哨卫放慢节奏，对双决斗别把侵略性拉满。',
    counter: '没有特别要针对的，按自己阵容的打法来。',
  },
}

/**
 * How much each dial is worth, per style. 1 = the plain rate.
 *
 * Measured on equal clubs, 1500 maps a setting: at 1.9 the gap between
 * sliders set with the shape and against it was 18 points of map win rate
 * for 双决斗 and 20 for 双控场, which turns the dial into the match. At these
 * values it is about ten — the same order as map comfort, which is where a
 * decision the manager makes every match should sit.
 */
const DIAL: Record<CompStyle, { paceAtk: number; paceDef: number; aggAtk: number; aggDef: number; util: number }> = {
  rush:     { paceAtk: 1.35, paceDef: 0.8, aggAtk: 1.35, aggDef: 0.8, util: 0.9 },
  // the plain rates lean attack (0.035 v 0.022), so a defensive shape needs
  // more weight on its defence side than a tempo shape needs on attack, or
  // sliding left on two sentinels nets out to nothing
  hold:     { paceAtk: 0.5, paceDef: 2.2, aggAtk: 0.5, aggDef: 2.2, util: 1.0 },
  control:  { paceAtk: 1.0, paceDef: 1.0, aggAtk: 1.0, aggDef: 1.0, util: 1.2 },
  standard: { paceAtk: 1.0, paceDef: 1.0, aggAtk: 1.0, aggDef: 1.0, util: 1.0 },
}

/** The shape's own worth before any dial is touched. */
const BASE: Record<CompStyle, { atk: number; def: number; mid: number }> = {
  rush:     { atk: 1.3, def: -0.9, mid: 0 },
  hold:     { atk: -0.8, def: 1.4, mid: 0 },
  control:  { atk: 0.5, def: 0.5, mid: 0.9 },
  standard: { atk: 0, def: 0, mid: 0 },
}

export interface TacticEdge {
  /** the shape itself, before dials */
  styleAtk: number
  styleDef: number
  styleMid: number
  /** 节奏 + 侵略性, scaled by the shape */
  tacticsAtk: number
  tacticsDef: number
  /** 道具, scaled by the shape and by how good the five is at it */
  utility: number
  /** what our dials do against THEIR shape */
  matchupAtk: number
  matchupDef: number
  matchupMid: number
}

/**
 * Everything the sliders and the two shapes are worth on this map.
 *
 * `avgUtility` is the five's mean 道具 attribute — a full utility budget in
 * the hands of people who cannot use it is smoke on the wrong side.
 */
/**
 * What a dial is worth was set against a round curve of 17 strength points
 * per step; the curve is 30 now (ROUND_SENS in match.ts — a rating gap
 * decides a map less completely), and the same edge in points moves a round
 * by that much less. The dials are scaled back up so that what the sliders
 * are worth in map points did not quietly halve with it: 顺着打 against
 * 逆着打 on the same five had fallen from over six map points to three or
 * four, which is the bar check_tactics holds. Only the dials — the shape's
 * own worth and the matchups at neutral dials stay as they were, so an AI
 * club, whose dials are always neutral, plays exactly as before.
 */
export const DIAL_SCALE = 30 / 17

export function tacticEdge(
  t: Tactics, style: CompStyle, oppStyle: CompStyle, avgUtility: number,
): TacticEdge {
  const d = DIAL[style]
  const b = BASE[style]
  const pace = (t.pace - 50) * DIAL_SCALE
  const agg = (t.aggression - 50) * DIAL_SCALE
  const util = (t.utility - 50) * DIAL_SCALE

  const tacticsAtk = pace * 0.035 * d.paceAtk + agg * 0.028 * d.aggAtk
  const tacticsDef = -pace * 0.022 * d.paceDef - agg * 0.015 * d.aggDef
  const utility = util * 0.02 * d.util * (0.5 + avgUtility / 130)

  // Their shape decides what ours runs into. Each of these is about one map
  // comfort point at the extreme — enough that the right dial against the
  // right opponent is worth a week of 跑图, not enough to beat a better five.
  let matchupAtk = 0
  let matchupDef = 0
  let matchupMid = 0
  switch (oppStyle) {
    case 'hold':
      // running fast into setups is how you lose the pistol
      matchupAtk = -pace * 0.03 + util * 0.015
      break
    case 'rush':
      // an aggressive defence against two duelists gets run over; a reader
      // of the game gets the trades back
      matchupDef = -agg * 0.03
      matchupMid = (t.adaptability - 50) * DIAL_SCALE * 0.02
      break
    case 'control':
      // a smoke war: the side with more utility, and the side that does not
      // wait for the smokes to bloom
      matchupAtk = util * 0.02 + pace * 0.015
      matchupDef = util * 0.01
      break
    default:
      break
  }
  return {
    styleAtk: b.atk, styleDef: b.def, styleMid: b.mid,
    tacticsAtk, tacticsDef, utility,
    matchupAtk, matchupDef, matchupMid,
  }
}

/**
 * A timeout call lands harder on the five built for it.
 *
 * 强攻 on a double-duelist five is the comp doing what it is for; on a
 * double-sentinel five it is two people who cannot rush being told to. The
 * multiplier is the same in both directions, so the manager who picked the
 * shape and then calls against it feels it.
 */
export function callBoost(kind: 'rush' | 'steady', style: CompStyle): number {
  if (kind === 'rush') return style === 'rush' ? 1.4 : style === 'hold' ? 0.7 : 1
  return style === 'hold' ? 1.4 : style === 'rush' ? 0.7 : 1
}

// ---------------------------------------------------------------- familiarity

/**
 * How well the club knows the five agents it is taking onto a map.
 *
 * Map comfort says how well the squad knows Ascent; this says how well they
 * know THIS Ascent — the five characters and the executes that go with them.
 * It grows every time the same sheet is played on the map, in a scrim, a
 * fixture or a week of 跑图, and it is lost in proportion when the sheet
 * changes: swap one agent and four fifths carries over, rebuild the five and
 * you start from nothing.
 *
 * Only the managed club is tracked. Every other club runs its map default
 * every week, which is what a practised comp is, so they sit at the neutral
 * point: a fresh comp of ours is behind them, a drilled one is ahead.
 */
export const FAM_BASE = 50
export const FAM_MAX = 100

/** What one settled week of 跑图, one fixture map and one scrim map teach. */
export const FAM_DRILL = 12
export const FAM_MATCH = 8
export const FAM_SCRIM = 6

export const compKey = (agents: Record<string, string>): string =>
  Object.values(agents).slice().sort().join('|')

const overlap = (a: string, b: string): number => {
  const bs = b.split('|')
  let n = 0
  for (const x of a.split('|')) {
    const i = bs.indexOf(x)
    if (i >= 0) { n++; bs.splice(i, 1) }
  }
  return n / 5
}

export function familiarity(
  state: GameState, teamId: string, map: string, agents: Record<string, string>,
): number {
  if (teamId !== state.myTeam) return FAM_BASE
  const cur = state.compPro?.[map]
  if (!cur) return FAM_BASE
  const key = compKey(agents)
  if (cur.key === key) return cur.value
  return cur.value * overlap(cur.key, key)
}

/** The strength a familiarity value is worth, either way from neutral. */
export const famBonus = (fam: number): number => (fam - FAM_BASE) * 0.06

/** Bank practice on a sheet. Returns the value after, for the digest. */
export function learnComp(
  state: GameState, map: string, agents: Record<string, string>, amount: number,
): number {
  const key = compKey(agents)
  if (!key) return FAM_BASE
  const from = familiarity(state, state.myTeam, map, agents)
  const value = Math.min(FAM_MAX, from + amount)
  state.compPro = { ...(state.compPro ?? {}), [map]: { key, value } }
  return value
}

// ============================================================ 打法风格三角

/**
 * 阵容的第二条轴：不是「谁上场」，是「道具怎么用」。
 *
 * comp.ts 上半部分数的是位置（双决斗 / 双哨卫 / 双控场），那条轴回答的是队形。
 * 这条轴来自 Isaaa 的 Style Dynamics 指南，回答的是打法，两条正交：星礈是控场，
 * 但她的回收烟是拿来换对面道具的；海神加蝰蛇循环冷却封点才是控制。同一个位置
 * 组合可以落在三角的不同角上。
 *
 *   快攻 Aggro     一次性的催化型道具砸开空间，趁道具还在的窗口内打完回合
 *   消耗 Midrange  高频 + 可再生道具，拿便宜的换对面贵的，赢残局和下包后
 *   控制 Control   预铺点位、封锁空间，决定对面能走到哪
 *
 * 快攻克控制，消耗克快攻，控制克消耗。（指南第 14 页把这行写反了，第 3、6、
 * 10 页和 FNATIC 输给 LOUD 那个实例都是这个方向。）
 *
 * 系数是 scripts/style_dynamics.ts 标定的：三项先各自归一化到 [-1,1]，分母取
 * 八千套抽样阵容的 5%/95% 分位——理论极值（纯快攻打纯控制）在五人阵容里根本
 * 排不出来，拿它标定会让克制项在实战中缩到 ±1%。
 */
export type StyleAxis = 0 | 1 | 2
export const STYLE_CN = ['快攻', '消耗', '控制'] as const
export type StyleMix = [number, number, number]

/**
 * 每个英雄在三角上的点数，总分 3。
 *
 * 判据是道具性质，见 src/data/abilities.json（valorant-api 的技能表 +
 * Fandom 的充能与冷却，由 scripts/fetch_agent_abilities.py 抓取）：
 * 一次性的开路/位移道具算快攻，免费且冷却 ≥15 秒的可再生道具算消耗，
 * 预铺封锁算控制。2 秒那种使用窗口不算再生。
 */
export const AGENT_STYLE: Record<string, StyleMix> = {
  Jett: [3, 0, 0], Raze: [2, 1, 0], Phoenix: [2, 1, 0], Reyna: [3, 0, 0],
  Yoru: [2, 1, 0], Neon: [3, 0, 0], Iso: [2, 0, 1], Waylay: [3, 0, 0],
  // 钛狐四个技能全是一次性的开路道具，没有一个能再生。他原本被归到消耗，是
  // 「铁夜壶 = 铁臂+夜露+钛狐」这条把错误抓出来的：这套的俗称说明它是抓人和
  // 开局的阵容，而按旧分类它落在三角正中心，克制项恒为零。
  Sova: [0, 2, 1], Breach: [3, 0, 0], Skye: [1, 2, 0], 'KAY/O': [1, 2, 0],
  Fade: [1, 2, 0], Gekko: [0, 3, 0], Tejo: [2, 1, 0],
  Brimstone: [1, 0, 2], Viper: [0, 1, 2], Omen: [0, 1, 2], Astra: [0, 2, 1],
  Harbor: [0, 0, 3], Clove: [0, 1, 2], Miks: [0, 1, 2],
  Sage: [0, 1, 2], Cypher: [0, 0, 3], Killjoy: [0, 0, 3], Chamber: [0, 1, 2],
  Deadlock: [0, 0, 3], Vyse: [0, 0, 3], Veto: [0, 0, 3],
}

/**
 * 每张图想让你怎么打。
 *
 * 这组数来自九位教练/复盘从业者的问卷（scripts/survey_ingest.py）。问卷的地图
 * 那半跟原先手填的表几乎完全一致——微风岛屿差 0.01、森寒冬港 0.02、亚海 0.03，
 * 十三张里十二张差距小于 0.15——所以直接采用他们的平均值。英雄那半没有采用：
 * 在国内语境里「控制」是控图，是每套阵容都在做的事，不是区分维度，换上去会让
 * 八套阵容里七套都读成控制。
 */
export const MAP_WANT: Record<string, StyleMix> = {
  Ascent: [0.36, 0.31, 0.33], Bind: [0.29, 0.41, 0.30], Breeze: [0.17, 0.28, 0.55],
  Corrode: [0.27, 0.33, 0.40], Fracture: [0.54, 0.20, 0.26], Haven: [0.34, 0.32, 0.34],
  Icebox: [0.24, 0.26, 0.50], Lotus: [0.36, 0.28, 0.36], Pearl: [0.23, 0.38, 0.38],
  Split: [0.39, 0.16, 0.45], Summit: [0.25, 0.36, 0.39], Sunset: [0.34, 0.30, 0.36],
  Abyss: [0.47, 0.23, 0.29],
}

const CENTRE: StyleMix = [1 / 3, 1 / 3, 1 / 3]

/** 五个人的点数加总归一化，得到阵容在三角上的坐标。 */
export function styleMix(agents: Iterable<string>): StyleMix {
  const s: StyleMix = [0, 0, 0]
  for (const a of agents) {
    const v = AGENT_STYLE[a]
    if (!v) continue
    s[0] += v[0]; s[1] += v[1]; s[2] += v[2]
  }
  const t = s[0] + s[1] + s[2]
  return t ? [s[0] / t, s[1] / t, s[2] / t] : CENTRE
}

/** 0 = 三边平衡（万金油），1 = 押死一个角。 */
export const stylePurity = (m: StyleMix): number => (Math.max(...m) - 1 / 3) / (2 / 3)

/** 主轴。三边差不到五个点就是没有主轴，不能随便挑一个。 */
export const styleName = (m: StyleMix): string =>
  Math.max(...m) - Math.min(...m) < 0.05 ? '均衡' : STYLE_CN[m.indexOf(Math.max(...m)) as StyleAxis]

/**
 * 克制项，双线性型。反对称，所以镜像自动归零、两边都平衡也自动归零——指南说
 * 亚海默认阵容「永远不被克也吃不到红利」，这个式子直接就是那句话。
 */
const RPS = [[0, -1, 1], [1, 0, -1], [-1, 1, 0]]
export function styleCounter(u: StyleMix, v: StyleMix): number {
  let e = 0
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) e += u[i] * RPS[i][j] * v[j]
  return e
}

/**
 * 阵容跟这张图的契合度，用点积而不是距离。
 *
 * 用 L1 距离的那一版让万金油阵容在十三张图上全部排第一——单纯形的质心离谁都
 * 近，那是距离的性质不是设计。点积奖励的是「往这张图要的方向压」。
 */
export const styleAlign = (m: StyleMix, map: string): number => {
  const d = MAP_WANT[map] ?? CENTRE
  return m[0] * d[0] + m[1] * d[1] + m[2] * d[2]
}

/**
 * 归一化用的常数，由 scripts/style_dynamics.ts 对八千套合法五人阵容抽样得出。
 * 契合度用全局尺度而不是按图各自拉满：需求越平的图（亚海 36/31/33），阵容
 * 选择就越不重要，这是这张表该有的性质。
 */
const ALIGN_MID = 1 / 3
const ALIGN_SPAN = 0.075
const COUNTER_HALF = 0.30
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x))

export const alignN = (m: StyleMix, map: string): number =>
  clamp1((2 * (styleAlign(m, map) - ALIGN_MID)) / ALIGN_SPAN)
export const counterN = (u: StyleMix, v: StyleMix): number =>
  clamp1(styleCounter(u, v) / COUNTER_HALF)

/**
 * 三项各值多少回合强度点。
 *
 * 教练给的优先级是 版本之子 > 阵容合适 > 阵容强，所以三项的极差按这个顺序
 * 递减：全员版本之子打全员逆版本 64%、这张图最合适打最不合适 60%、克制方打
 * 被克方 57%（一张图的胜率）。参照物是 comp.ts 的滑杆——顺着打对逆着打约十个
 * 地图胜率点，跟地图熟悉度同量级。
 *
 * 克制项定得最小是有依据的：指南里 FNATIC 靠它打赢了当时所有主流阵容，但它
 * 没救下对 LOUD 那场。它是加成，不是胜负手。
 */
export const STYLE_K = { version: 2.05, map: 1.45, counter: 1.01 }

// ---------------------------------------------------------------- 版本

/**
 * 一个版本。
 *
 * 教练给的节奏：一年一次大型更新（系统性，休赛期），中间以国际赛为分界线做
 * 中小型更新。所以这里的「换版本」挂在赛事结束上，不挂在日期上。
 *
 * `coef` 是每个英雄的版本系数，−1 到 +1。它不改英雄的三角坐标——改的是他现在
 * 值不值得上。版本之子定义为 +0.8，五个人全是版本之子就把归一化项打满。
 */
export interface Patch {
  /** 生效那天 */
  since: number
  name: string
  /** 英雄 → 版本系数 [-1, 1]，没有的就是 0 */
  coef: Record<string, number>
  /** 加强了谁、削弱了谁，给收件箱用 */
  buffed: string[]
  nerfed: string[]
  big: boolean
}

/** 版本之子的门槛。也是归一化的分母：五个人全是版本之子刚好打满。 */
export const DARLING = 0.8

/** 一套五人相对这个版本站在哪。−1 全逆版本，+1 全版本之子。 */
export function versionN(agents: Iterable<string>, patch: Patch | undefined): number {
  if (!patch) return 0
  let sum = 0, n = 0
  for (const a of agents) { sum += patch.coef[a] ?? 0; n++ }
  return n ? clamp1(sum / n / DARLING) : 0
}

/** 这个版本里最强势的几个英雄。 */
export const darlings = (patch: Patch | undefined, n = 3): string[] =>
  Object.entries(patch?.coef ?? {})
    .filter(([, v]) => v >= DARLING * 0.55)
    .sort((a, b) => b[1] - a[1]).slice(0, n).map(([a]) => a)

/**
 * 滚一个新版本。
 *
 * 旧系数先往回衰减——没有英雄永远是版本之子，这也是逆版本会自己解除的原因。
 * 大改动的英雄多、幅度大；国际赛之间的小改只动三四个。
 *
 * `pick` 传的是当前可选的英雄池，所以还没进游戏的英雄不会被改动。
 */
export function rollPatch(
  prev: Patch | undefined, pool: readonly string[], day: number, name: string,
  big: boolean, rng: { norm(m: number, sd: number): number; int(a: number, b: number): number },
): Patch {
  const coef: Record<string, number> = {}
  for (const [a, v] of Object.entries(prev?.coef ?? {})) {
    const decayed = v * (big ? 0.6 : 0.82)
    if (Math.abs(decayed) > 0.05) coef[a] = decayed
  }
  const buffed: string[] = []
  const nerfed: string[] = []
  const touched = new Set<string>()
  for (let i = 0; i < (big ? 9 : 3); i++) {
    const a = pool[rng.int(0, pool.length - 1)]
    if (!a || touched.has(a)) continue
    touched.add(a)
    const before = coef[a] ?? 0
    const after = clamp1(before + rng.norm(0, big ? 0.6 : 0.35))
    coef[a] = after
    if (after - before > 0.15) buffed.push(a)
    else if (before - after > 0.15) nerfed.push(a)
  }
  return { since: day, name, coef, buffed, nerfed, big }
}

/**
 * 打法风格给这场比赛的全部加成，我方视角的回合强度差。
 *
 * 三项都归一化到 [-1,1] 之后乘各自的系数，所以它们可以直接比大小，也就守得住
 * 「版本之子 > 阵容合适 > 阵容强」这个优先级。
 */
export function styleEdge(
  mine: Iterable<string>, theirs: Iterable<string>, map: string, patch: Patch | undefined,
): { total: number; version: number; map: number; counter: number; mix: StyleMix; foe: StyleMix } {
  const a = Array.from(mine)
  const b = Array.from(theirs)
  const u = styleMix(a)
  const v = styleMix(b)
  const version = STYLE_K.version * (versionN(a, patch) - versionN(b, patch))
  const mapFit = STYLE_K.map * (alignN(u, map) - alignN(v, map))
  const counter = 2 * STYLE_K.counter * counterN(u, v)
  return { total: version + mapFit + counter, version, map: mapFit, counter, mix: u, foe: v }
}
