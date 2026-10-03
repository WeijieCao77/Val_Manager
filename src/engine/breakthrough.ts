import { coachOr } from './roster'
import { Rng, clamp, hashStr } from './rng'
import type { Fixture, GameState, MatchResult, Player } from './types'

/**
 * 潜力突破: how a player at his ceiling gets past it.
 *
 * A potential is a projection, and the group's complaint was that it read
 * as a wall: 「有潜力值上限，喜欢的选手练满了就不好玩了」. This is the way
 * through, and it is meant to be earned, not bought:
 *
 * - 契机 fills only while he is at (or a point off) his ceiling, and only
 *   from official matches he actually played for us — a win is worth five
 *   times a defeat, a series MVP more than a win, and a knockout or an
 *   international stage multiplies it. Training does not fill it, and
 *   neither do scrims. A starter on a club that wins gets one bar a season;
 *   a man on the bench never does.
 * - A full bar opens a 突破特训: three weeks in which he does not train
 *   normally and tires faster, for a fee priced on his wage. At the end it
 *   works or it does not; the odds are fixed and shown before you commit —
 *   youth, the head coach's 培养, the facilities and his morale move them,
 *   and every breakthrough already made makes the next one harder.
 * - Success raises his potential by two. Failure keeps a little of the bar
 *   and costs morale. One attempt a season, three successes a career, never
 *   past 99 — and he still ages, so a raised ceiling is something to train
 *   up to, not a number handed over.
 *
 * Our club only: the AI's growth bands are measured without it
 * (scripts/check_ai_growth.ts), and this is a manager's decision.
 */
export const BREAK = {
  /** the bar */
  full: 100,
  /** per official series played: won / lost */
  win: 3,
  loss: 2,
  /** the series MVP, on top */
  mvp: 4,
  /** a knockout series, and a Masters or Champions one */
  knockout: 1.25,
  international: 1.5,
  /** how far below his ceiling the bar starts to fill */
  near: 1,
  campDays: 21,
  /** potential gained */
  gain: 2,
  /** the odds, in percent: where they start and the band they stay in */
  baseChance: 40,
  minChance: 10,
  maxChance: 65,
  /** successes in a career */
  maxTimes: 3,
  /** what a failed camp leaves on the bar */
  keepOnFail: 40,
  /** the fee, as a share of a season's wage, and its floor */
  feeShare: 0.25,
  feeMin: 20000,
} as const

export const inCamp = (p: Player, day: number): boolean => (p.breakUntil ?? 0) > day

/** Whether his bar can fill at all right now. */
export function sparkOpen(p: Player): boolean {
  return (p.breakDone ?? 0) < BREAK.maxTimes && p.potential < 99 &&
    p.potential - p.overall <= BREAK.near && !(p.breakUntil)
}

/** What one official series adds to the bar, before the cap. */
export function sparkFor(won: boolean, mvp: boolean, knockout: boolean, international: boolean): number {
  const mult = international ? BREAK.international : knockout ? BREAK.knockout : 1
  return ((won ? BREAK.win : BREAK.loss) + (mvp ? BREAK.mvp : 0)) * mult
}

/** After an official series: the bar fills for our men who played it. */
export function sparkAfterMatch(state: GameState, f: Fixture, result: MatchResult, knockout: boolean): void {
  const isA = f.teamA === state.myTeam
  if (!isA && f.teamB !== state.myTeam) return
  const played = (isA ? result.lineups?.a : result.lineups?.b) ?? []
  const won = (result.mapsWonA > result.mapsWonB) === isA
  const international = f.stage === 'masters1' || f.stage === 'masters2' || f.stage === 'champions'
  for (const id of played) {
    const p = state.players[id]
    if (!p || p.teamId !== state.myTeam || !sparkOpen(p)) continue
    const add = sparkFor(won, result.mvp === id, knockout, international)
    p.breakSpark = Math.round(clamp((p.breakSpark ?? 0) + add, 0, BREAK.full) * 10) / 10
  }
}

export const breakFee = (p: Player): number =>
  Math.max(BREAK.feeMin, Math.round((p.salary * BREAK.feeShare) / 1000) * 1000)

/** The odds of a camp working, in percent, and what moved them. */
export function breakChance(state: GameState, p: Player): { pct: number; parts: { label: string; v: number }[] } {
  const team = state.teams[state.myTeam]
  const parts: { label: string; v: number }[] = []
  const age = p.age <= 21 ? 15 : p.age <= 24 ? 5 : p.age <= 27 ? 0 : p.age <= 29 ? -10 : -20
  if (age) parts.push({ label: `${p.age} 岁`, v: age })
  const done = -15 * (p.breakDone ?? 0)
  if (done) parts.push({ label: `已突破 ${p.breakDone} 次`, v: done })
  const coach = team ? Math.round((coachOr(team, 'development') - 55) / 3) : 0
  if (coach) parts.push({ label: '主教练培养', v: coach })
  const fac = team ? Math.round((team.facilities - 55) / 6) : 0
  if (fac) parts.push({ label: '训练设施', v: fac })
  const mood = Math.round((p.morale - 70) / 5)
  if (mood) parts.push({ label: '士气', v: mood })
  const pct = clamp(BREAK.baseChance + parts.reduce((s, x) => s + x.v, 0), BREAK.minChance, BREAK.maxChance)
  return { pct, parts }
}

/** Why he cannot start a camp today, or null. */
export function breakBlock(state: GameState, pid: string): string | null {
  const p = state.players[pid]
  if (!p || p.teamId !== state.myTeam) return '他不是我们的人。'
  if (inCamp(p, state.day)) return `特训中，还有 ${(p.breakUntil ?? 0) - state.day} 天。`
  if ((p.breakDone ?? 0) >= BREAK.maxTimes) return `已经突破 ${BREAK.maxTimes} 次，到头了。`
  if (p.potential >= 99) return '潜力已经 99。'
  if (p.breakYear === state.year) return '这个赛季已经试过了，明年再来。'
  if ((p.breakSpark ?? 0) < BREAK.full) return `突破契机还差 ${Math.ceil(BREAK.full - (p.breakSpark ?? 0))}。`
  if (p.injuredUntil > state.day) return '伤还没好。'
  if (state.finances.balance < breakFee(p)) return '资金不足。'
  return null
}

export function startBreak(state: GameState, pid: string): string | null {
  if (breakBlock(state, pid)) return null
  const p = state.players[pid]
  const fee = breakFee(p)
  state.finances.balance -= fee
  state.finances.log.push({ day: state.day, label: `突破特训 · ${p.ign}`, amount: -fee })
  p.breakChance = breakChance(state, p).pct
  p.breakUntil = state.day + BREAK.campDays
  p.breakYear = state.year
  p.breakSpark = 0
  return `${p.ign} 开始突破特训，${BREAK.campDays} 天后见分晓（成功率 ${p.breakChance}%）。`
}

/** Daily: camps that have run their three weeks end, one way or the other. */
export function settleBreaks(state: GameState, notes: string[]): void {
  for (const p of Object.values(state.players)) {
    if (!p.breakUntil || p.breakUntil > state.day) continue
    const until = p.breakUntil
    const chance = p.breakChance ?? 50
    p.breakUntil = undefined
    p.breakChance = undefined
    // he left during the camp: it ends with him, nothing gained
    if (p.teamId !== state.myTeam) continue
    // fixed by the seed and the day it ends, so reloading does not reroll it
    const rng = new Rng(hashStr(`break:${state.seed}:${p.id}:${until}`))
    if (rng.next() * 100 < chance) {
      const before = p.potential
      p.potential = clamp(p.potential + BREAK.gain, p.potential, 99)
      p.breakDone = (p.breakDone ?? 0) + 1
      p.morale = clamp(p.morale + 5, 0, 100)
      const line = `💥 ${p.ign} 突破成功！潜力上限提高 ${p.potential - before}（第 ${p.breakDone} 次突破）。`
      notes.push(line)
      state.news.push({ day: state.day, kind: 'club', important: true, text: line })
    } else {
      p.breakSpark = BREAK.keepOnFail
      p.morale = clamp(p.morale - 6, 0, 100)
      const line = `😣 ${p.ign} 突破失败，契机保留 ${BREAK.keepOnFail}，下赛季可以再试。`
      notes.push(line)
      state.news.push({ day: state.day, kind: 'club', important: true, text: line })
    }
  }
}
