/**
 * 阵容风格三角：能不能当成一条数值轴，取什么系数，meta 会不会自己转起来。
 *
 *   npx tsx scripts/style_dynamics.ts [赛段数]
 *
 * Isaaa 的 Style Dynamics 指南把职业阵容归到一个石头剪刀布三角上：Aggro 用
 * 催化型道具砸开空间抢时间，Midrange 用高频+可再生道具换掉对面的贵道具、赢
 * 残局和下包后，Control 靠预铺点位控节奏。Aggro 克 Control，Midrange 克
 * Aggro，Control 克 Midrange。（指南第 14 页把 Control 那一行写反了，第 3、
 * 6、10 页和 FNATIC/LOUD 那个实例都是这个方向，这里按后者。）
 *
 * 这条轴跟引擎里已经有的那条是正交的：comp.ts 的 CompStyle 数的是位置
 * （双决斗/双哨卫/双控场），这里读的是道具怎么用。星礈是控场，但她的回收烟
 * 是拿来换道具的，所以偏 Midrange；海神+蝰蛇循环冷却封点才是 Control。同一
 * 个位置组合可以落在三角的不同角上，这正是「只能分辨双烟/双决斗」缺的那一维。
 *
 * 只出数，不碰比赛引擎。四个问题：
 *   1. 三角坐标认不认得出真实阵容
 *   2. 三项（版本 / 地图 / 克制）各取多少系数，才对得上合理的地图胜率差
 *   3. 押注型阵容和万金油阵容，各自吃到多少
 *   4. 让十二支俱乐部照这套规则每赛段重选，meta 会自己转，还是锁死在一个角
 *
 * 系数不写死。所有阈值都是先抽样出「真实能排出来的阵容」的分布，再按目标
 * 胜率反解——理论极值（纯快攻打纯控制）在五人阵容里根本排不出来，拿它标定
 * 会让实战中的克制项缩到 ±1%。这一版按 5%/95% 分位标定。
 */
import { AGENT_ROLE, MAPS, agentCn, mapCn } from '../src/engine/content'
import { Rng } from '../src/engine/rng'
import ABILITIES from '../src/data/abilities.json'
import PANEL from './survey_panel.json'

const SPLITS = Number(process.argv[2] ?? 24)
/**
 * `--panel` 用问卷回收的平均值替换我手填的两张表。
 *
 * 九份答卷，把每人的三项分数归一化成占比再平均，所以有人填 3/3/3、有人填
 * 1/1/1 不影响结果。见 scripts/survey_ingest.py。
 */
const USE_PANEL = process.argv.includes('--panel')
/** `--survey` prints the questionnaire instead of the analysis. */
const SURVEY_ONLY = process.argv.some((a) => a.startsWith('--survey'))
const console_log = console.log
if (SURVEY_ONLY) console.log = () => {}

// ---------------------------------------------------------------- 风格向量

/**
 * 每个英雄在三角上的点数：[Aggro, Midrange, Control]。
 *
 * 判据是指南第 7、11、15、17 页的道具分类，不是位置：
 *   催化型（一次性、开路、改节奏）→ Aggro。铁臂整套技能、雷兹震荡包、
 *     霓虹电网+冲刺、炼狱和铁臂的大招是指南点名的例子。
 *   高频 + 可再生（拿便宜道具换对面贵道具）→ Midrange。盖可能捡回三个
 *     技能所以是最纯的 Midrange，黑梦有可再生的缠绕，星礈回收烟 25 秒 CD。
 *   预铺 / 封锁（决定对面能走到哪）→ Control。海神高潮 + 蝰蛇毒墙循环冷却
 *     无限封点，幽影用偏执和暗影遮蔽拒止空间，哨卫的布置同理。
 *
 * 一个英雄可以同时占两个角——蝰蛇在 FNATIC 那套里是换道具的 Midrange 件，
 * 跟海神搭在一起就是 Control 件。所以这里是向量不是分类。
 *
 * 这张表是全脚本最该拿去给教练改的东西，改一个数下面所有结论都会跟着动。
 */
const STYLE: Record<string, [number, number, number]> = {
  // 决斗者
  Jett: [3, 0, 0], Raze: [2, 1, 0], Phoenix: [2, 1, 0], Reyna: [3, 0, 0],
  Yoru: [2, 1, 0], Neon: [3, 0, 0], Iso: [2, 0, 1], Waylay: [3, 0, 0],
  // 先锋
  // 钛狐原本给的是 [1,2,0]，错了。他四个技能（导弹、眩晕、无人机、大招）全是
  // 一次性的开路/位移道具，没有一个能再生，按指南自己的判据就是催化型。是
  // 「铁夜壶 = 铁臂+夜露+钛狐」这条把它抓出来的：这套的俗称说明它是抓人和
  // 开局的阵容，而按旧分类它算出来落在三角正中心，克制项恒为零。
  Sova: [0, 2, 1], Breach: [3, 0, 0], Skye: [1, 2, 0], 'KAY/O': [1, 2, 0],
  Fade: [1, 2, 0], Gekko: [0, 3, 0], Tejo: [2, 1, 0],
  // 控场
  Brimstone: [1, 0, 2], Viper: [0, 1, 2], Omen: [0, 1, 2], Astra: [0, 2, 1],
  Harbor: [0, 0, 3], Clove: [0, 1, 2], Miks: [0, 1, 2],
  // 哨卫
  Sage: [0, 1, 2], Cypher: [0, 0, 3], Killjoy: [0, 0, 3], Chamber: [0, 1, 2],
  Deadlock: [0, 0, 3], Vyse: [0, 0, 3], Veto: [0, 0, 3],
}

type Mix = [number, number, number]
const NAMES = ['快攻', '消耗', '控制'] as const

if (USE_PANEL) {
  const byCn = new Map(Object.keys(STYLE).map((a) => [agentCn(a), a]))
  for (const [cn, v] of Object.entries(PANEL.agents as Record<string, number[]>)) {
    const en = byCn.get(cn)
    // 占比 ×3，跟手填表同一个量纲（一个英雄总分 3）
    if (en) STYLE[en] = [v[0] * 3, v[1] * 3, v[2] * 3]
  }
}

function mix(five: readonly string[]): Mix {
  const s: Mix = [0, 0, 0]
  for (const a of five) {
    const v = STYLE[a]
    if (!v) continue
    s[0] += v[0]; s[1] += v[1]; s[2] += v[2]
  }
  const t = s[0] + s[1] + s[2] || 1
  return [s[0] / t, s[1] / t, s[2] / t]
}

/** 0 = 三边平衡（万金油），1 = 押死一个角。 */
const purity = (m: Mix): number => (Math.max(...m) - 1 / 3) / (2 / 3)
/** 主轴。三边差不到五个点就是没有主轴，不能靠 indexOf 随便挑一个。 */
const dominant = (m: Mix): string =>
  Math.max(...m) - Math.min(...m) < 0.05 ? '均衡' : NAMES[m.indexOf(Math.max(...m))]

/**
 * 克制项，双线性型。RPS[i][j] = 我是 i、对面是 j 时我的收益。
 * 顺序 (快攻, 消耗, 控制)：快攻克控制，消耗克快攻，控制克消耗。
 *
 * 用矩阵而不是查表，是因为真实阵容几乎都是混合的。反对称，所以镜像自动归零，
 * 两边都平衡也自动归零——指南说 Ascent 默认阵容「永远不被克也吃不到红利」，
 * 这个式子直接就是那句话。
 */
const RPS = [[0, -1, 1], [1, 0, -1], [-1, 1, 0]]
function counter(u: Mix, v: Mix): number {
  let e = 0
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) e += u[i] * RPS[i][j] * v[j]
  return e
}

// ---------------------------------------------------------------- 地图需求

/**
 * 每张图「想让你干什么」——指南第 18 页那三步里的第一步。
 *
 * 这些数是我按地图结构估的，不是查来的，是第二张该给教练改的表：
 *   大图、长回防、长视野（微风、森寒）→ 控制
 *   三点图、防守方被摊开（隐世、莲华）→ 快攻
 *   进攻方两头出生、节奏快（裂变）→ 快攻
 *   中路为王、长 default（深海、天枢）→ 消耗
 *   窄口高低差多、回防短（霓虹町）→ 控制/快攻 各半
 *   亚海：三边平衡，所以它的默认阵容两年没人动
 */
const MAP_DEMAND: Record<string, Mix> = {
  Ascent: [0.33, 0.34, 0.33], Bind: [0.42, 0.33, 0.25], Breeze: [0.18, 0.27, 0.55],
  Corrode: [0.30, 0.38, 0.32], Fracture: [0.50, 0.28, 0.22], Haven: [0.42, 0.33, 0.25],
  Icebox: [0.22, 0.28, 0.50], Lotus: [0.36, 0.42, 0.22], Pearl: [0.20, 0.50, 0.30],
  Split: [0.38, 0.20, 0.42], Summit: [0.28, 0.44, 0.28], Sunset: [0.30, 0.38, 0.32],
  Abyss: [0.45, 0.22, 0.33],
}

if (USE_PANEL) {
  const byCn = new Map(MAPS.map((m) => [mapCn(m), m]))
  for (const [cn, v] of Object.entries(PANEL.maps as Record<string, number[]>)) {
    const en = byCn.get(cn)
    if (en) MAP_DEMAND[en] = [v[0], v[1], v[2]]
  }
}

/**
 * 阵容跟这张图的契合度，用点积而不是距离。
 *
 * 第一版用的是 L1 距离，结果万金油阵容在每张图上都排第一——单纯形的质心离
 * 谁都近，这是距离的性质，不是设计。点积奖励的是「往这张图要的方向压」，
 * 于是压对角的阵容 > 平衡阵容 > 压错角的阵容，这才是指南里说的「先问这张
 * 图想让你干什么」。
 */
const align = (m: Mix, map: string): number => {
  const d = MAP_DEMAND[map] ?? [1 / 3, 1 / 3, 1 / 3]
  return m[0] * d[0] + m[1] * d[1] + m[2] * d[2]
}

// ------------------------------------------------------- 强度点 → 地图胜率

/**
 * 一个强度点值多少地图胜率，按引擎自己的曲线算，好让这里的系数跟 comp.ts
 * 的滑杆、地图熟悉度是同一套单位。
 *
 * match.ts: 每回合 p = logistic(diff / 30)，13 回合制，12-12 进加时两局
 * 定胜负。下面是精确 DP，不是抽样。
 */
const ROUND_SENS = 30
function mapWin(diff: number): number {
  const p = 1 / (1 + Math.exp(-diff / ROUND_SENS))
  const q = 1 - p
  const ot = (p * p) / (p * p + q * q)
  const W = Array.from({ length: 14 }, () => new Array(14).fill(0))
  for (let a = 12; a >= 0; a--) {
    for (let b = 12; b >= 0; b--) {
      if (a === 12 && b === 12) { W[a][b] = ot; continue }
      W[a][b] = p * (a === 12 ? 1 : W[a + 1][b]) + q * (b === 12 ? 0 : W[a][b + 1])
    }
  }
  return W[0][0]
}

/** 反解：要 `target` 的地图胜率，回合强度差得给多少。 */
function solveDiff(target: number): number {
  let lo = 0, hi = 40
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2
    if (mapWin(m) < target) lo = m; else hi = m
  }
  return (lo + hi) / 2
}

// ------------------------------------------------------------ 合法五人阵容

const POOL = Object.keys(STYLE).filter((a) => AGENT_ROLE[a])

/** 五个人：互不相同，盖到至少三个位置，任一位置不超过两个。 */
function candidate(rng: Rng): string[] {
  for (;;) {
    const five: string[] = []
    while (five.length < 5) {
      const a = POOL[rng.int(0, POOL.length - 1)]
      if (!five.includes(a)) five.push(a)
    }
    const n: Record<string, number> = {}
    for (const a of five) n[AGENT_ROLE[a]] = (n[AGENT_ROLE[a]] ?? 0) + 1
    if (Object.keys(n).length >= 3 && Math.max(...Object.values(n)) <= 2) return five
  }
}

/** 抽样出「真实排得出来的阵容」，所有标定都以这个分布为准。 */
const SAMPLE = (() => {
  const rng = new Rng(20260909)
  return Array.from({ length: 8000 }, () => mix(candidate(rng)))
})()
const q = (xs: number[], p: number) => {
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}

// ------------------------------------------------------------------ 系数

/**
 * 三项各值多少。教练给的优先级是 版本之子 > 阵容合适 > 阵容强，所以三项的
 * 极差按这个顺序递减。
 *
 * 三项先各自归一化到 [-1, 1]——归一化的分母取自上面那 8000 套抽样，也就是
 * 「真实排得出来的阵容」的 5%/95% 分位，不是理论极值。这样三个系数是同一个
 * 单位（每单位归一化项值多少回合强度点），可以直接比大小，极差就是 2k。
 *
 * 参照物：comp.ts 里一个值得管理者每场去调的滑杆，顺着打对逆着打约十个地图
 * 胜率点，跟地图熟悉度同量级。克制项定得比它小——指南里 FNATIC 靠它打赢了
 * 当时所有主流阵容，但它没救下对 LOUD 那场，它是加成不是胜负手。
 */
const TARGET = { version: 0.64, map: 0.60, counter: 0.57 }

/**
 * 版本系数每个英雄 ∈[-1,1]。分母取 0.8：一个「版本之子」定义为 +0.8，五个
 * 全是版本之子刚好把归一化项打满。取 0.62 的那版在四个版本之子时就截断了，
 * 第五个白拿，这不该是设计。
 */
const VER_SPAN = 0.8
const verN = (five: readonly string[], ver: Record<string, number>): number =>
  Math.max(-1, Math.min(1, five.reduce((s, a) => s + (ver[a] ?? 0), 0) / 5 / VER_SPAN))

/**
 * 契合度的归一化。
 *
 * 分母必须是全局的，不能每张图各自拉满。按图归一化的那版让亚海也出现了 60%
 * 的差距，但亚海的需求本来就是三边平衡——它「已经被解开」正是因为在它上面
 * 排什么阵容都差不多。用统一尺度之后，需求越平的图，阵容选择越不重要，这是
 * 这张表该有的性质。
 */
const A_MID: Record<string, number> = {}
for (const mp of MAPS) A_MID[mp] = q(SAMPLE.map((m) => align(m, mp)), 0.5)
const A_SPAN = MAPS
  .map((mp) => { const xs = SAMPLE.map((m) => align(m, mp)); return q(xs, 0.95) - q(xs, 0.05) })
  .reduce((a, b) => a + b, 0) / MAPS.length
const alignN = (m: Mix, map: string): number =>
  Math.max(-1, Math.min(1, (2 * (align(m, map) - A_MID[map])) / A_SPAN))

/** 克制项：随机两套真实阵容对上，counter 落在哪。 */
const CTR_HALF = (() => {
  const rng = new Rng(7)
  const xs = Array.from({ length: 20000 }, () =>
    counter(SAMPLE[rng.int(0, SAMPLE.length - 1)], SAMPLE[rng.int(0, SAMPLE.length - 1)]))
  return q(xs, 0.95)
})()
const ctrN = (u: Mix, v: Mix): number =>
  Math.max(-1, Math.min(1, counter(u, v) / CTR_HALF))

const VER_K = solveDiff(TARGET.version) / 2
const MAP_K = solveDiff(TARGET.map) / 2
const CTR_K = solveDiff(TARGET.counter) / 2

/** 一场对局的全部风格加成，我方视角的回合强度差。 */
const styleEdge = (
  me: readonly string[], them: readonly string[], map: string, ver: Record<string, number>,
): number => {
  const u = mix(me), v = mix(them)
  return VER_K * (verN(me, ver) - verN(them, ver))
    + MAP_K * (alignN(u, map) - alignN(v, map))
    + 2 * CTR_K * ctrN(u, v)
}

// ------------------------------------------------------------- 已知的阵容

/** 五人名单里只有 FNATIC 那套是指南上写明的，其余是按俗称拼的，等教练核对。 */
const LIB: Record<string, string[]> = {
  'FNATIC 莲华（指南实例）': ['Viper', 'Astra', 'Fade', 'Raze', 'Killjoy'],
  '亚海默认（两年没动）': ['Jett', 'KAY/O', 'Omen', 'Killjoy', 'Sova'],
  '双烟（幽影+蝰蛇）': ['Jett', 'Sova', 'Omen', 'Viper', 'Cypher'],
  '海神蝰蛇封点': ['Jett', 'Sova', 'Harbor', 'Viper', 'Killjoy'],
  '双决斗+斯凯': ['Jett', 'Raze', 'Skye', 'Omen', 'Killjoy'],
  '霓虹 Waylay': ['Neon', 'Waylay', 'Breach', 'Omen', 'Killjoy'],
  '铁夜壶（铁臂+夜露+钛狐）': ['Breach', 'Yoru', 'Tejo', 'Omen', 'Killjoy'],
  '纯消耗（盖可+黑梦）': ['Gekko', 'Fade', 'Astra', 'Raze', 'Sage'],
}

// ------------------------------------------------------------------ 输出

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0)))
const bar = (m: Mix) => m.map((x) => Math.round(x * 100).toString().padStart(3)).join(' ')
const h = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m\n${'─'.repeat(72)}`)

console.log(USE_PANEL ? '\x1b[33m【用问卷回收的平均值跑】\x1b[0m' : '\x1b[2m【用我手填的表跑，加 --panel 换成问卷的】\x1b[0m')
h('1. 三角认不认得出真实阵容')
console.log(pad('阵容', 28) + '快攻  消耗  控制   主轴   纯度')
for (const [name, five] of Object.entries(LIB)) {
  const m = mix(five)
  console.log(pad(name, 28) + `${bar(m)}   ${pad(dominant(m), 6)} ${purity(m).toFixed(2)}`)
}
console.log(`\n抽样 8000 套合法五人阵容，纯度中位数 ${q(SAMPLE.map(purity), 0.5).toFixed(2)}，95% 分位 ${q(SAMPLE.map(purity), 0.95).toFixed(2)}。`)
console.log('纯快攻打纯控制在五人阵容里排不出来，所以标定不能用理论极值。')
for (const [name, five] of Object.entries(LIB)) {
  if (purity(mix(five)) < 0.03) {
    console.log(`\n\x1b[33m注意\x1b[0m ${name} 落在正中心，纯度 0，克制项对它恒为零 —— ` +
      `${five.map(agentCn).join('/')} 这五个人是我按俗称拼的，多半拼错了，等教练核对。`)
  }
}

h('1b. 手填的分类，对得上真实技能数据吗')
console.log('技能数据来自 scripts/fetch_agent_abilities.py（valorant-api 的描述 + Fandom 的充能和冷却）。')
console.log('判据：免费且冷却 ≥15 秒 = 真·可再生（消耗的本钱）；≤5 秒的是使用窗口，不算。\n')
type Abil = { slot: string; name: string; uses: number | null; cost: number | null; cooldown: number | null }
const BOOK = ABILITIES as Record<string, { role: string | null; abilities: Abil[] }>
const RECHARGE_MIN = 15

/** 真·可再生技能数：回合内免费回来的那些。 */
const rechargeable = (a: string): Abil[] =>
  (BOOK[a]?.abilities ?? []).filter((x) =>
    x.slot !== 'Ultimate' && x.cooldown !== null && x.cooldown >= RECHARGE_MIN)
/** 一个回合能买到的技能总充能数。 */
const charges = (a: string): number =>
  (BOOK[a]?.abilities ?? []).reduce((s, x) => s + (x.slot === 'Ultimate' ? 0 : (x.uses ?? 0)), 0)

console.log(pad('特工', 12) + pad('我填的 A/M/C', 16) + pad('可再生', 8) + pad('充能', 6) + '不一致的地方')
let clash = 0
for (const a of Object.keys(STYLE).sort()) {
  if (!BOOK[a]) { console.log(pad(agentCn(a), 12) + '（技能数据里没有这个特工）'); continue }
  const r = rechargeable(a).length, ch = charges(a)
  const [av, mv, cv] = STYLE[a]
  // 「充能多」单独看会误报：芮娜六个充能全是自我增益，炼狱五个是烟，都不是
  // 能拿去换对面道具的东西。所以只有在他同时有可再生技能时才算道具量大。
  const note = r >= 2 && mv === 0 ? `${r} 个可再生技能，却一分消耗都没给`
    : r === 0 && mv >= 2 ? '一个可再生技能都没有，却给了 2 分消耗'
    : r >= 1 && ch >= 5 && mv === 0 ? `${ch} 个充能 + ${r} 个可再生，却一分消耗都没给`
    : ''
  if (note) clash++
  console.log(pad(agentCn(a), 12) + pad(`${av}/${mv}/${cv}`, 16) +
    pad(String(r), 8) + pad(String(ch), 6) + (note ? `\x1b[33m${note}\x1b[0m` : ''))
}
console.log(`\n${clash} 个特工的手填分类跟技能数据对不上，这几个是该拿去问教练的。`)

h('2. 三项系数，按教练的优先级排下来')
console.log(`版本  ±${VER_K.toFixed(2)} 强度点   全员版本之子 打 全员逆版本   → ${pct(mapWin(2 * VER_K))}`)
console.log(`地图  ±${MAP_K.toFixed(2)} 强度点   这张图最合适 打 最不合适     → ${pct(mapWin(2 * MAP_K))}`)
console.log(`克制  ±${CTR_K.toFixed(2)} 强度点   克制方 打 被克方             → ${pct(mapWin(2 * CTR_K))}`)
console.log(`\n三项都归一化到 [-1,1]（分母取真实阵容的 5%/95% 分位），所以系数可直接比大小。`)
console.log(`参照：comp.ts 一个滑杆顺着打/逆着打约 10 点，地图熟悉度同量级。`)

h('3. 克制项：谁打谁舒服')
const keys = Object.keys(LIB)
console.log('（行打列，单位是地图胜率；· 是自己打自己）')
console.log(pad('', 26) + keys.map((_, i) => String(i + 1).padStart(7)).join(''))
keys.forEach((k, i) => {
  const row = keys.map((k2) => k === k2 ? '      ·'
    : pct(mapWin(2 * CTR_K * ctrN(mix(LIB[k]), mix(LIB[k2])))).padStart(7)).join('')
  console.log(pad(`${i + 1}. ${k}`, 26) + row)
})
const solved = mix(LIB['亚海默认（两年没动）'])
const worstVsSolved = Math.max(...keys.map((k) => Math.abs(ctrN(mix(LIB[k]), solved))))
console.log(`\n万金油（亚海默认）最多被谁吃到：${pct(mapWin(2 * CTR_K * worstVsSolved))} — 它也一次都吃不到别人。`)

h('4. 各张图上谁最合适')
console.log(pad('', 10) + pad('这张图要', 16) + pad('最合适', 30) + pad('最不合适', 30) + '差')
for (const map of MAPS) {
  const ranked = keys.map((k) => ({ k, a: alignN(mix(LIB[k]), map) })).sort((a, b) => b.a - a.a)
  const best = ranked[0], worst = ranked[ranked.length - 1]
  console.log(pad(map, 10) + pad(bar(MAP_DEMAND[map]), 16) +
    pad(best.k, 30) + pad(worst.k, 30) +
    pct(mapWin(MAP_K * (best.a - worst.a))))
}

h('5. meta 会自己转吗')
console.log('十二支俱乐部，每张图各持一套阵容，每个赛段照「版本之子 > 阵容合适 > 阵容强」重选。')
console.log('侦查有一个赛段的延迟：克制项算的是上赛段这张图上的分布，不是本赛段的。\n')

const CLUBS = 12
const ACTIVE = MAPS.slice(0, 7)

/** 一张图上，场上十二支队伍的平均三角坐标。 */
const field = (fives: string[][]): Mix => {
  const s: Mix = [0, 0, 0]
  for (const f of fives) { const m = mix(f); s[0] += m[0]; s[1] += m[1]; s[2] += m[2] }
  return [s[0] / fives.length, s[1] / fives.length, s[2] / fives.length]
}

function run(patches: boolean, seed: number) {
  const rng = new Rng(seed)
  const base = Array.from({ length: CLUBS }, () => rng.norm(0, 3))
  const ver: Record<string, number> = {}
  for (const a of POOL) ver[a] = 0
  // club -> map -> five
  let held = Array.from({ length: CLUBS }, () =>
    Object.fromEntries(ACTIVE.map((mp) => [mp, candidate(rng)])) as Record<string, string[]>)
  let scouted = Object.fromEntries(
    ACTIVE.map((mp) => [mp, field(held.map((h2) => h2[mp]))])) as Record<string, Mix>
  const lead: Record<string, string[]> = Object.fromEntries(ACTIVE.map((mp) => [mp, []]))
  const overall: Mix[] = []
  const darlings: string[][] = []

  for (let split = 0; split < SPLITS; split++) {
    if (patches) {
      // 每四个赛段一次休赛期大改，中间是国际赛之间的中小改
      const big = split % 4 === 0
      for (const a of POOL) ver[a] *= 0.82           // 没有英雄永远是版本之子
      for (let i = 0; i < (big ? 9 : 3); i++) {
        const a = POOL[rng.int(0, POOL.length - 1)]
        ver[a] = Math.max(-1, Math.min(1, ver[a] + rng.norm(0, big ? 0.6 : 0.35)))
      }
    }
    darlings.push(Object.entries(ver).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .filter(([, v]) => v > 0.25).map(([a]) => agentCn(a)))

    held = held.map((cur) => {
      const next: Record<string, string[]> = {}
      for (const mp of ACTIVE) {
        let best = cur[mp], bestScore = -Infinity
        for (let t = 0; t < 300; t++) {
          const f = t === 0 ? cur[mp] : candidate(rng)
          const m = mix(f)
          const s = VER_K * verN(f, ver) + MAP_K * alignN(m, mp) + CTR_K * ctrN(m, scouted[mp])
          if (s > bestScore) { bestScore = s; best = f }
        }
        next[mp] = best
      }
      return next
    })

    for (let i = 0; i < CLUBS; i++) for (let j = i + 1; j < CLUBS; j++) {
      const mp = ACTIVE[rng.int(0, ACTIVE.length - 1)]
      rng.chance(mapWin(base[i] - base[j] + styleEdge(held[i][mp], held[j][mp], mp, ver)))
    }

    scouted = Object.fromEntries(
      ACTIVE.map((mp) => [mp, field(held.map((h2) => h2[mp]))])) as Record<string, Mix>
    for (const mp of ACTIVE) lead[mp].push(dominant(scouted[mp]))
    overall.push(field(ACTIVE.flatMap((mp) => held.map((h2) => h2[mp]))))
  }
  return { lead, overall, darlings }
}

for (const patches of [false, true]) {
  console.log(`\x1b[1m${patches ? '开版本更新' : '不开版本更新（只有三角和地图在起作用）'}\x1b[0m`)
  const { lead, overall, darlings } = run(patches, patches ? 4242 : 909)
  console.log(pad('赛段', 6) + pad('全联赛 快攻/消耗/控制', 24) +
    ACTIVE.map((mp) => pad(mp, 10)).join('') + (patches ? '版本之子' : ''))
  overall.forEach((m, i) => {
    if (i % 3 !== 0 && i !== overall.length - 1) return
    console.log(pad(String(i + 1), 6) + pad(bar(m), 24) +
      ACTIVE.map((mp) => pad(lead[mp][i], 10)).join('') +
      (patches ? darlings[i].join(' ') : ''))
  })
  const flips = ACTIVE.map((mp) => lead[mp].filter((x, i) => i && x !== lead[mp][i - 1]).length)
  const uniq = ACTIVE.map((mp) => new Set(lead[mp]).size)
  console.log(`→ ${SPLITS} 个赛段里，每张图主流风格平均换了 ` +
    `${(flips.reduce((a, b) => a + b, 0) / ACTIVE.length).toFixed(1)} 次，` +
    `平均出现过 ${(uniq.reduce((a, b) => a + b, 0) / ACTIVE.length).toFixed(1)} 种风格`)
  console.log('   ' + ACTIVE.map((mp, i) =>
    `${mp} ${flips[i]}次/${uniq[i]}种`).join('   ') + '\n')
}

h('6. 逆版本吃多少亏')
console.log('五个人里有几个是版本之子（版本系数 +0.8），对手全中性：\n')
const verTable: Record<string, number> = {}
for (const a of POOL) verTable[a] = 0
const neutral = ['Jett', 'Sova', 'Omen', 'Killjoy', 'Skye']
for (let n = -5; n <= 5; n++) {
  const five = neutral.slice()
  const v: Record<string, number> = { ...verTable }
  for (let i = 0; i < Math.abs(n); i++) v[five[i]] = n > 0 ? 0.8 : -0.8
  const label = n === 0 ? '全中性' : n > 0 ? `${n} 个版本之子` : `${-n} 个逆版本`
  console.log(pad(label, 16) + pct(mapWin(VER_K * (verN(five, v) - verN(five, verTable)))))
}
console.log('\n一套三年前的老体系（全员 −0.8）打当季版本答案（全员 +0.8）：' +
  pct(mapWin(2 * VER_K)) + ' — 差得动，但一支强队仍打得赢。')

// ------------------------------------------------------- 问卷星导入文本

/**
 * 把两张待核对的表导成问卷星的「从文本创建问卷」格式。
 *
 *   npx tsx scripts/style_dynamics.ts --survey        （按位置分组，一个英雄点一格）
 *   npx tsx scripts/style_dynamics.ts --survey-num    （按位置×三项分组，0-3 刻度）
 *   npx tsx scripts/style_dynamics.ts --survey-agent  （一个英雄一题，三项一次填完）
 *
 * 格式取自问卷星帮助中心 help.aspx?catid=58 的示例图：
 *   「N、标题」后面跟 A./B./C. 选项 = 单选题
 *   「N、标题」后面什么都不跟       = 填空题
 *   「N.标题[矩阵量表题]」+ 一行刻度 + A./B./C. 行 = 矩阵
 *
 * 刻度行在官方示例里是「1 2 3 4 5」。默认版把刻度换成中文档位，一个英雄点一
 * 下就行（29 个英雄 29 次点击）；如果问卷星不认非数字刻度，用 --survey-num
 * 出数字版，那个跟官方示例逐字一致，只是要点三遍。
 */
const SURVEY_COLS = ['快攻', '消耗', '控制', '两者兼有', '说不清']
const AXES = ['快攻', '消耗', '控制'] as const
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
type SurveyMode = 'compact' | 'numeric' | 'agent'

/** 一个英雄的技能小抄：中文技能名、充能、真·再生的冷却。 */
function kitLabel(a: string): string {
  const kit = (BOOK[a]?.abilities ?? [])
    .filter((x) => x.slot !== 'Ultimate')
    .map((x) => {
      const cn = (x as Abil & { cn?: string }).cn ?? x.name
      const mult = x.uses && x.uses > 1 ? `×${x.uses}` : ''
      const cd = x.cooldown && x.cooldown >= RECHARGE_MIN ? ` ${x.cooldown}秒↻` : ''
      return cn + mult + cd
    }).join('、')
  return `${kit}｜可再生${rechargeable(a).length} 充能${charges(a)}`
}

function survey(mode: SurveyMode): string {
  const numeric = mode === 'numeric'
  const out: string[] = []
  let n = 0
  const q = (title: string, scale?: string[], rows?: string[], opts?: string[]) => {
    n++
    out.push(scale ? `${n}.${title}[矩阵量表题]` : `${n}、${title}`)
    if (scale) out.push(scale.join(' '))
    for (const [i, r] of (rows ?? opts ?? []).entries()) out.push(`${LETTERS[i]}.${r}`)
    out.push('')
  }

  q('这份问卷是给一个 VALORANT 经理游戏用的。我把阵容归到「快攻 / 消耗 / 控制」' +
    '三角上（快攻克控制、控制克消耗、消耗克快攻），下面想请你核对我给每个英雄的' +
    '归类。判据是道具性质不是位置：一次性的开路道具算快攻，免费再生的道具算消耗，' +
    '预铺封锁算控制。' +
    (mode === 'agent'
      ? '每个英雄给三个分：0 分是完全不沾，3 分是纯粹靠这个，三项加起来通常是 3 分。'
      : '') +
    '填不完可以只填有把握的。你的称呼或昵称是？')

  for (const role of ['决斗者', '先锋', '控场', '哨卫'] as const) {
    const list = Object.keys(STYLE).filter((a) => AGENT_ROLE[a] === role)
    const label = (a: string) => `${agentCn(a)}（${kitLabel(a)}）`
    if (mode === 'agent') {
      // 一个英雄一道题：技能摆在题干上，三个数一次给完
      for (const a of list) {
        q(`【${role}】${agentCn(a)} —— ${kitLabel(a)}`, ['0', '1', '2', '3'], [...AXES])
      }
    } else if (numeric) {
      for (const [i, k] of (['快攻', '消耗', '控制'] as const).entries()) {
        q(`${role}——每个英雄的「${k}」占几分？0 分是完全不沾，3 分是纯粹靠这个。` +
          `一个英雄三项加起来通常是 3 分。（↻ 表示这个技能免费再生，秒数是冷却）`,
          ['0', '1', '2', '3'], list.map(label))
        void i; void k
      }
    } else {
      q(`${role}——这几个英雄各自主要属于哪一类？` +
        `（↻ 表示这个技能免费再生，秒数是冷却；两者兼有指说不出主次）`,
        SURVEY_COLS, list.map(label))
    }
  }

  const mapRows = MAPS.map((m) => {
    const d = MAP_DEMAND[m]
    return `${mapCn(m)} ${m}（我填的：快攻${Math.round(d[0] * 100)} 消耗${Math.round(d[1] * 100)} 控制${Math.round(d[2] * 100)}）`
  })
  if (mode === 'agent') {
    for (const m of MAPS) {
      const d = MAP_DEMAND[m]
      q(`【地图】${mapCn(m)} ${m} —— 这张图上哪种打法吃香？` +
        `（我填的是 快攻${Math.round(d[0] * 100)} 消耗${Math.round(d[1] * 100)} 控制${Math.round(d[2] * 100)}）`,
        ['0', '1', '2', '3'], [...AXES])
    }
  } else if (numeric) {
    for (const k of AXES) {
      q(`这张图上「${k}」打法吃不吃香？0 分是完全不吃香，3 分是这张图就该这么打。`,
        ['0', '1', '2', '3'], mapRows)
    }
  } else {
    q('每张图最吃香的是哪种打法？填「这张图上什么打法吃香」，不是「现在职业队在这张图上玩什么」。',
      SURVEY_COLS, mapRows)
  }

  q('零和奇乐算不算「消耗」？我把两个哨卫都填成了纯控制，但零的战术监控 15 秒免费回来、' +
    '奇乐的自动哨兵 20 秒、哨戒炮台 60 秒。按「可再生道具 = 消耗打法的本钱」这条判据，' +
    '他俩该分一点消耗。但直觉上哨卫的布置是控制不是换道具。你怎么看？')
  q('三角之外还缺一条轴吗？有没有哪套强势阵容，光靠快攻/消耗/控制三个数根本描述不了？')
  q('「逆版本」在真实的队伍身上是多大的差距？我现在给的是：一套三年前的老体系打当季版本答案，' +
    '输 36:64。这个偏大还是偏小？职业队一般是每个版本重练体系，还是靠拿手图硬顶？')
  q('同一套阵容，换个人为什么就打不出来？游戏里选手有属性（枪法、进攻、指挥、配合），' +
    '想知道一套体系卡的是哪一项——是决斗位不够能开枪，还是没人会看图？')
  // 原来这里问的是模拟器的内部输出（「24 个赛段全程控制一次没变」），教练
  // 没有我的模拟器，没法拿实战经验去验证它。改成问他本来就知道的事。
  q('有的图好像不管版本怎么改，主流打法都还是那一套（我的印象是微风岛屿一直得控图）；' +
    '有的图每换一个版本，大家排的阵容就变一次。这个区别在你看来真实存在吗？' +
    '如果存在，哪几张图属于「怎么变都还是那样」，哪几张属于「每个版本都在翻」？')

  return out.join('\n')
}

if (SURVEY_ONLY) {
  const mode: SurveyMode = process.argv.includes('--survey-agent') ? 'agent'
    : process.argv.includes('--survey-num') ? 'numeric' : 'compact'
  console_log(survey(mode))
}
