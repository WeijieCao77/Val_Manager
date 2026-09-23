/**
 * 难度 — how hard the rest of the world pushes back.
 *
 * The group, 2026-09-23: 「把数值练满了后期就无脑玩了」. Measured with
 * scripts/measure_late_game.ts, a stand-in manager who never touched a slider
 * won 89% of his series and a Masters or Champions every season; with the
 * five trained out he won 99% and every trophy of every year. Nothing in the
 * world answered a club that strong.
 *
 * Every knob the difficulty turns lives in this one table, so a check can
 * read the same numbers the engine plays with. 普通 is what every save
 * without a choice runs — the old saves too — and it is already harder than
 * the game was: opponents study tape at every level (engine/scouting.ts).
 * 困难 and 职业 add a stronger world and a flatter top of the rating curve.
 *
 * A career can move UP a level from the 存档 page at any time, never down:
 * a level you can drop before a final is not a level.
 */
import type { GameState } from './types'

export type Difficulty = 'normal' | 'hard' | 'pro'

export interface DifficultySpec {
  label: string
  blurb: string
  /** the most strength points a fully prepared opponent adds against us */
  prepMax: number
  /**
   * Above this weighted player rating, each further point is worth `topSlope`
   * of a point. Both sides, every club — a flatter top of the curve, so a
   * five of 99s is a favourite, not a certainty. `topSlope` 1 turns it off.
   */
  topKnee: number
  topSlope: number
  /** what an AI club trains an attribute up to */
  aiPolishStop: number
  /** the ceiling on `state.rivalry` wherever the world reads it */
  rivalryCap: number
  /** how well an AI club knows its usual sheet on a map (neutral is 50) */
  aiFamiliarity: number
  /** weekly grievance from a pay demand left unanswered */
  payGrievance: number
}

export const DIFFICULTY: Record<Difficulty, DifficultySpec> = {
  normal: {
    label: '普通',
    blurb: '对手会研究你的比赛录像。',
    prepMax: 6, topKnee: 90, topSlope: 0.6,
    aiPolishStop: 97, rivalryCap: 2, aiFamiliarity: 50, payGrievance: 2,
  },
  hard: {
    label: '困难',
    blurb: 'AI 练得更满、打得更熟，顶尖数值的收益变小。',
    prepMax: 8, topKnee: 88, topSlope: 0.5,
    aiPolishStop: 99, rivalryCap: 3, aiFamiliarity: 62, payGrievance: 3,
  },
  pro: {
    label: '职业',
    blurb: '全世界都在针对你。练满也不保证赢。',
    prepMax: 10, topKnee: 86, topSlope: 0.4,
    aiPolishStop: 99, rivalryCap: 4, aiFamiliarity: 70, payGrievance: 4,
  },
}

export const DIFFICULTY_ORDER: Difficulty[] = ['normal', 'hard', 'pro']

export const difficultyOf = (state: Pick<GameState, 'difficulty'>): Difficulty =>
  state.difficulty && DIFFICULTY[state.difficulty] ? state.difficulty : 'normal'

export const spec = (state: Pick<GameState, 'difficulty'>): DifficultySpec => DIFFICULTY[difficultyOf(state)]

/** The provocation a title leaves, read through this career's ceiling. */
export const rivalryOf = (state: Pick<GameState, 'difficulty' | 'rivalry'>): number =>
  Math.min(Math.max(state.rivalry ?? 0, 0), spec(state).rivalryCap)

/** The flatter top of the rating curve. Identity at 普通. */
export function flattenTop(state: Pick<GameState, 'difficulty'>, base: number): number {
  const { topKnee, topSlope } = spec(state)
  return base <= topKnee ? base : topKnee + (base - topKnee) * topSlope
}

/** A career may go up a level, never down. Returns the refusal, or null. */
export function raiseDifficulty(state: GameState, to: Difficulty): string | null {
  const from = DIFFICULTY_ORDER.indexOf(difficultyOf(state))
  const next = DIFFICULTY_ORDER.indexOf(to)
  if (next < 0) return '没有这个难度。'
  if (next <= from) return '难度只能往上调。'
  state.difficulty = to
  state.news.push({ day: state.day, kind: 'club', important: true, text: `难度调到「${DIFFICULTY[to].label}」。` })
  return null
}
