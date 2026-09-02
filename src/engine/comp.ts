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
    advice: '节奏和侵略性往右拉才吃得到红利；拉在左边等于白带两个决斗者。暂停时「强攻」在这套阵容上更猛。',
    counter: '别把侵略性拉高——激进的防守会被两个决斗者冲穿；中局应变拉高能把换血换回来。',
  },
  hold: {
    label: '双哨卫',
    blurb: '两个守点位：防守端厚，节奏慢，进攻端要靠道具慢推。',
    advice: '节奏和侵略性往左拉是它的正确用法；拉快了两个哨卫就是两个没枪的人。暂停时「稳守」在这套阵容上更稳。',
    counter: '节奏放慢——冲进两个哨卫的布置就是送手枪局；道具拉高慢慢拆。',
  },
  control: {
    label: '双控场',
    blurb: '两套烟：控图打法，攻防两端都受益，靠道具喂。',
    advice: '道具滑杆是这套阵容的命，拉高；节奏与侵略性放中间就行。',
    counter: '拼道具：道具拉高，节奏别太慢——等他们的烟铺开就晚了。',
  },
  standard: {
    label: '标准',
    blurb: '一决斗、双先锋、一控场、一哨卫——最不挑的公式。',
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
export function tacticEdge(
  t: Tactics, style: CompStyle, oppStyle: CompStyle, avgUtility: number,
): TacticEdge {
  const d = DIAL[style]
  const b = BASE[style]
  const pace = t.pace - 50
  const agg = t.aggression - 50
  const util = t.utility - 50

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
      matchupMid = (t.adaptability - 50) * 0.02
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
