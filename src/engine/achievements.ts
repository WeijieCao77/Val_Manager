/**
 * Twenty-five things worth having done, kept for the account rather than the save.
 *
 * Endings are a verdict on one career: you get exactly one, at the end, and it
 * asks what the ten years added up to. Achievements are the opposite shape —
 * they are small, they unlock the moment they happen, and they accumulate
 * across every career the account ever plays. Losing your job in 2029 does not
 * take them away.
 *
 * Same rule as endings, for the same reason: every condition is a question
 * asked of the save's own state, never a flag written when something happened.
 * A save carried over from an older version answers them the same as one
 * played from the start, and there is no event to miss — the check runs every
 * day, so anything true for even one day is caught.
 *
 * The cost of that rule is that a few genuinely momentary things — a 13-0, an
 * overtime map — are only visible while the fixture that holds them is still
 * in the save. That is fine: the daily check sees the match the day it is
 * played, which is the day it matters.
 */
import { isImport } from './imports'
import { squadOf } from './world'
import type { GameState, Player } from './types'

export interface Achievement {
  key: string
  title: string
  /** what it takes; shown whether or not it is unlocked */
  brief: string
  group: '赛场' | '养成' | '阵容' | '经营' | '生涯'
  /** the rare ones, shown differently — nothing else turns on this */
  hard?: boolean
  test: (s: GameState, f: Facts) => boolean
}

export interface Facts {
  squad: Player[]
  worldYears: number[]
  regionYears: number[]
  seasons: number
  imports: number
  /** prospects (youth-pool arrivals) currently on our books */
  prospects: Player[]
  /** our own maps this season that finished 13-0 our way */
  perfectMaps: number
  /** our own maps that went to overtime and came home */
  overtimeWins: number
  /** series we won by the last map — 2-1 or 3-2 */
  deciders: number
  clubs: number
}

const isWorld = (t: string) => /Masters|Champions/i.test(t) && !/Challengers/i.test(t)
const isRegional = (t: string) => /VCT|Challengers|Kickoff|Stage/i.test(t)

export function factsOf(state: GameState): Facts {
  const squad = squadOf(state, state.myTeam)
  const me = state.teams[state.myTeam]

  let perfectMaps = 0
  let overtimeWins = 0
  let deciders = 0
  for (const f of state.fixtures ?? []) {
    if (!f.played || !f.result) continue
    const usA = f.teamA === state.myTeam
    const usB = f.teamB === state.myTeam
    if (!usA && !usB) continue
    // scrims are practice; they do not count for anything here
    if (f.scrim) continue
    for (const m of f.result.maps ?? []) {
      const ours = usA ? m.scoreA : m.scoreB
      const theirs = usA ? m.scoreB : m.scoreA
      if (ours > theirs) {
        if (theirs === 0 && ours >= 13) perfectMaps++
        // a map only passes 13 by going to overtime
        if (ours > 13) overtimeWins++
      }
    }
    const ourMaps = usA ? f.result.mapsWonA : f.result.mapsWonB
    const theirMaps = usA ? f.result.mapsWonB : f.result.mapsWonA
    if (f.bo > 1 && ourMaps > theirMaps && theirMaps === ourMaps - 1) deciders++
  }

  return {
    squad,
    worldYears: (state.honours ?? []).filter((h) => isWorld(h.title)).map((h) => h.year),
    regionYears: (state.honours ?? []).filter((h) => isRegional(h.title)).map((h) => h.year),
    seasons: state.year - 2026 + 1,
    imports: me ? squad.filter((p) => isImport(p, me)).length : 0,
    prospects: squad.filter((p) => p.id.startsWith('Y')),
    perfectMaps,
    overtimeWins,
    deciders,
    clubs: new Set((state.tenures ?? []).map((t) => t.teamId)).size || 1,
  }
}

/** Two years in a row present in a list. */
const backToBack = (years: number[]): boolean => {
  const set = new Set(years)
  return [...set].some((y) => set.has(y + 1))
}

export const ACHIEVEMENTS: Achievement[] = [
  // ------------------------------------------------------------------ 赛场
  {
    key: 'firstTitle', group: '赛场', title: '开张',
    brief: '拿下第一座奖杯',
    test: (s) => (s.honours ?? []).length >= 1,
  },
  {
    key: 'worldTitle', group: '赛场', title: '世界第一',
    brief: '拿下一次 Masters 或 Champions',
    test: (_s, f) => f.worldYears.length > 0,
  },
  {
    key: 'sweep', group: '赛场', title: '大满贯',
    brief: '同一年拿下赛区冠军和世界冠军',
    hard: true,
    test: (_s, f) => f.worldYears.some((y) => f.regionYears.includes(y)),
  },
  {
    key: 'backToBack', group: '赛场', title: '卫冕',
    brief: '连续两年拿下世界冠军',
    hard: true,
    test: (_s, f) => backToBack(f.worldYears),
  },
  {
    // deliberately not 'promoted': endings and achievements share one key
    // namespace on the profile, and there is an ending by that name
    key: 'climbed', group: '赛场', title: '升上来了',
    brief: '带队从次级联赛升入 VCT',
    test: (s) => (s.honours ?? []).some((h) => /晋级/.test(h.title)),
  },
  {
    key: 'perfect', group: '赛场', title: '十三比零',
    brief: '在一张图上 13:0 零封对手',
    hard: true,
    test: (_s, f) => f.perfectMaps > 0,
  },
  {
    key: 'overtime', group: '赛场', title: '加时局',
    brief: '赢下一张打进加时的地图',
    test: (_s, f) => f.overtimeWins > 0,
  },
  {
    key: 'decider', group: '赛场', title: '决胜图',
    brief: '在最后一张图上拿下系列赛',
    test: (_s, f) => f.deciders > 0,
  },
  {
    key: 'tenTitles', group: '赛场', title: '陈列柜',
    brief: '生涯累计十座奖杯',
    hard: true,
    test: (s) => (s.honours ?? []).length >= 10,
  },

  // ------------------------------------------------------------------ 养成
  {
    key: 'firstProspect', group: '养成', title: '第一个青训',
    brief: '签下一名从青训池进入职业圈的选手',
    test: (_s, f) => f.prospects.length > 0,
  },
  {
    key: 'prospectStar', group: '养成', title: '点石成金',
    brief: '把一名青训选手练到 85 以上',
    hard: true,
    test: (_s, f) => f.prospects.some((p) => p.overall >= 85),
  },
  {
    key: 'academy3', group: '养成', title: '自家出品',
    brief: '同时拥有三名青训出身的选手',
    test: (_s, f) => f.prospects.length >= 3,
  },
  {
    key: 'teenStar', group: '养成', title: '少年成名',
    brief: '把一名 20 岁及以下的选手练到 80 以上',
    hard: true,
    test: (_s, f) => f.squad.some(
      (p) => p.age <= 20 && p.overall >= 80 && (p.arrivedOverall ?? p.overall) < 75),
  },
  {
    key: 'veteran', group: '养成', title: '老而弥坚',
    brief: '让一名 30 岁以上、能力 80 以上的选手仍然首发',
    test: (s, f) => {
      const starters = new Set(s.teams[s.myTeam]?.starters ?? [])
      return f.squad.some((p) => p.age >= 30 && p.overall >= 80 && starters.has(p.id))
    },
  },
  {
    key: 'ceiling', group: '养成', title: '天花板',
    brief: '把一名选手从 85 以下练到 90 以上',
    hard: true,
    test: (_s, f) => f.squad.some(
      (p) => p.overall >= 90 && (p.arrivedOverall ?? p.overall) <= 85),
  },
  {
    key: 'mvpMachine', group: '养成', title: 'MVP 收割机',
    brief: '一名选手生涯累计 20 次 MVP',
    hard: true,
    test: (_s, f) => f.squad.some((p) => (p.career?.mvps ?? 0) >= 20),
  },

  // ------------------------------------------------------------------ 阵容
  {
    key: 'noImports', group: '阵容', title: '全本土',
    brief: '一套五人以上的阵容里没有一名外援',
    test: (_s, f) => f.squad.length >= 5 && f.imports === 0,
  },
  {
    // 「满编」 was here and was free: a top club starts with seven men. What
    // is not free is having replaced most of them.
    key: 'rebuilt', group: '阵容', title: '大换血',
    brief: '阵容里有五人不是你接手时的那批',
    test: (s, f) => {
      const inherited = new Set(s.startingSquad ?? [])
      return f.squad.filter((p) => !inherited.has(p.id)).length >= 5
    },
  },
  {
    key: 'keptCore', group: '阵容', title: '老班底',
    brief: '接手五年之后，当初的三名队员还在队里',
    hard: true,
    test: (s, f) => {
      if (f.seasons < 5) return false
      const here = new Set(f.squad.map((p) => p.id))
      return (s.startingSquad ?? []).filter((id) => here.has(id)).length >= 3
    },
  },
  {
    key: 'staffed', group: '阵容', title: '幕后班底',
    brief: '同时雇佣四名以上教练组成员',
    test: (s) => (s.staff ?? []).length >= 4,
  },

  // ------------------------------------------------------------------ 经营
  {
    key: 'rich', group: '经营', title: '家底',
    brief: '账面资金超过 2000 万',
    test: (s) => (s.finances?.balance ?? 0) >= 20_000_000,
  },
  {
    key: 'bigDeal', group: '经营', title: '大生意',
    brief: '单笔进账超过 100 万',
    test: (s) => (s.finances?.log ?? []).some((e) => e.amount >= 1_000_000),
  },
  {
    // Not "one big deal": a pitched sponsor is priced off sponsorWorth, which
    // tops out near $500K, while the deals a club is holding on day one run to
    // $1.8M. Any single-deal threshold is therefore either free on arrival or
    // impossible to reach by playing. The board a manager can actually move is
    // the total — start at $2.0M–4.0M, and a full slate at high reputation is
    // worth $5M–6.5M.
    key: 'topSponsor', group: '经营', title: '商业版图',
    brief: '赞助总收入达到每赛季 450 万',
    hard: true,
    test: (s) => (s.teams[s.myTeam]?.sponsors ?? [])
      .reduce((n, sp) => n + sp.perSeason, 0) >= 4_500_000,
  },

  // ------------------------------------------------------------------ 生涯
  {
    key: 'trusted', group: '生涯', title: '一言九鼎',
    brief: '把董事会信任度做到 95 以上',
    test: (s) => (s.boardConfidence ?? 0) >= 95,
  },
  {
    key: 'threeClubs', group: '生涯', title: '三朝元老',
    brief: '一段生涯里执教过三家俱乐部',
    test: (_s, f) => f.clubs >= 3,
  },
]

export const ACHIEVEMENT_COUNT = ACHIEVEMENTS.length

/** Every achievement this save currently satisfies. */
export function earnedNow(state: GameState): string[] {
  const f = factsOf(state)
  const out: string[] = []
  for (const a of ACHIEVEMENTS) {
    try {
      if (a.test(state, f)) out.push(a.key)
    } catch { /* a malformed save must not take the game down over a badge */ }
  }
  return out
}

export const achievementBy = (key: string): Achievement | undefined =>
  ACHIEVEMENTS.find((a) => a.key === key)
