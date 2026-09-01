/**
 * The small stuff: forty-two things worth having done.
 *
 * Endings are a verdict on a decade and you get two per career. Achievements
 * are the opposite shape — each one is a single afternoon, they unlock the
 * moment they happen, and they stay on the account forever. Being sacked in
 * 2029 does not take any of them away.
 *
 * They come in two kinds, because two different questions are worth asking:
 *
 *   局内 — something you did inside one career. Read off the save.
 *   生涯 — something true of everything you have ever played. Read off the
 *          account's own record, which is the only place a total across
 *          careers can live.
 *
 * The 局内 rule is the same one the endings follow: every condition is a
 * question asked of the save's state, never a flag written when something
 * happened. The check runs after every turn, so anything true for even one day
 * is caught, and a save imported from an older version answers the same as one
 * played from the start.
 *
 * A handful of things no snapshot can answer — how many players passed through
 * over ten years, what the manager was paid across a decade — are counted in
 * `state.tally` at the moment they happen, because that is the only moment
 * they are knowable: a squad shows who is here now, and finances.log keeps
 * only the last 200 lines.
 */
import { CHAMPIONS, FINAL_YEAR, INTL_TITLES, MASTERS_1, MASTERS_2 } from './endings'
import { isImport } from './imports'
import { squadOf } from './roster'
import { WORLD_TEAMS } from './teams'
import type { GameState, Player } from './types'
import type { CareerRecord } from './profile'

export type AchScope = 'run' | 'life'
export type AchGroup = '冠军' | '赛场' | '养成' | '阵容' | '经营' | '生涯' | '收藏'

export interface Achievement {
  key: string
  title: string
  /** what it takes; shown whether or not it is unlocked */
  brief: string
  scope: AchScope
  group: AchGroup
  /** the rare ones, shown differently — nothing else turns on this */
  hard?: boolean
  /** 局内: asked of one save. Only defined for scope 'run'. */
  test?: (s: GameState, f: Facts) => boolean
  /** 生涯: asked of the account's record. Only defined for scope 'life'. */
  lifeTest?: (r: CareerRecord, unlocked: { endings: string[]; achievements: string[] }) => boolean
}

// ----------------------------------------------------------------- the save

// Imported rather than restated: this file had its own copy of the three
// titles, with the same wrong spelling of Champions, so 「冠军赛冠军」 and
// 「全冠之年」 were unreachable for the same reason the endings were.
const isIntl = (t: string) => (INTL_TITLES as readonly string[]).includes(t)
const isMasters = (t: string) => t === MASTERS_1 || t === MASTERS_2
const isChampions = (t: string) => t === CHAMPIONS
const isRegional = (t: string) => /Kickoff$/.test(t) || /^VCT .+ · Stage \d$/.test(t)

export interface Facts {
  squad: Player[]
  honours: { year: number; title: string }[]
  imports: number
  /** our own maps that finished 13-0 our way */
  perfectMaps: number
  /** our own maps that went to overtime and came home */
  overtimeWins: number
  /** series won on the last map — 2-1 or 3-2 */
  deciders: number
  /** series won without dropping a map, in a best-of-three or longer */
  sweeps: number
  /** years in which all three international events came home */
  perfectYears: number
  /** years in which every tier-1 regional trophy came home */
  regionalSweeps: number
  clubs: number
  seasons: number
}

export function factsOf(state: GameState): Facts {
  const squad = squadOf(state, state.myTeam)
  const me = state.teams[state.myTeam]
  const honours = state.honours ?? []

  let perfectMaps = 0
  let overtimeWins = 0
  let deciders = 0
  let sweeps = 0
  for (const f of state.fixtures ?? []) {
    if (!f.played || !f.result || f.scrim) continue
    const usA = f.teamA === state.myTeam
    const usB = f.teamB === state.myTeam
    if (!usA && !usB) continue
    for (const m of f.result.maps ?? []) {
      const ours = usA ? m.scoreA : m.scoreB
      const theirs = usA ? m.scoreB : m.scoreA
      if (ours <= theirs) continue
      if (theirs === 0 && ours >= 13) perfectMaps++
      // a map only goes past 13 by going to overtime
      if (ours > 13) overtimeWins++
    }
    const ourMaps = usA ? f.result.mapsWonA : f.result.mapsWonB
    const theirMaps = usA ? f.result.mapsWonB : f.result.mapsWonA
    if (f.bo > 1 && ourMaps > theirMaps) {
      if (theirMaps === ourMaps - 1) deciders++
      if (theirMaps === 0) sweeps++
    }
  }

  // a perfect international year: Masters I, Masters II and Champions
  const intlBy = new Map<number, Set<string>>()
  const regBy = new Map<number, Set<string>>()
  for (const h of honours) {
    if (isIntl(h.title)) {
      if (!intlBy.has(h.year)) intlBy.set(h.year, new Set())
      intlBy.get(h.year)!.add(h.title)
    }
    if (isRegional(h.title)) {
      if (!regBy.has(h.year)) regBy.set(h.year, new Set())
      regBy.get(h.year)!.add(h.title)
    }
  }

  return {
    squad,
    honours,
    imports: me ? squad.filter((p) => isImport(p, me)).length : 0,
    perfectMaps, overtimeWins, deciders, sweeps,
    perfectYears: [...intlBy.values()].filter((got) => INTL_TITLES.every((t) => got.has(t))).length,
    // Kickoff plus both Stages is every tier-1 trophy the region has to give
    regionalSweeps: [...regBy.values()].filter((got) => got.size >= 3).length,
    clubs: new Set((state.tenures ?? []).map((t) => t.teamId)).size || 1,
    seasons: state.year - 2026 + 1,
  }
}

const tally = (s: GameState) => s.tally ?? { signed: 0, hired: 0, earned: 0, commercial: 0 }
const won = (f: Facts, pred: (t: string) => boolean) => f.honours.some((h) => pred(h.title))

/** Regions the account has ever managed in, from the clubs it has held. */
export function regionsManaged(clubs: string[]): string[] {
  const byId = new Map(WORLD_TEAMS.map((t) => [t.id, t.region as string]))
  return [...new Set(clubs.map((id) => byId.get(id)).filter((r): r is string => !!r))]
}

export const ACHIEVEMENTS: Achievement[] = [
  // =================================================================== 冠军
  {
    key: 'firstTitle', scope: 'run', group: '冠军', title: '开张',
    brief: '拿下第一座奖杯',
    test: (_s, f) => f.honours.length >= 1,
  },
  {
    key: 'firstRegional', scope: 'run', group: '冠军', title: '赛区冠军',
    brief: '第一次拿下 Kickoff 或某个赛段的赛区冠军',
    test: (_s, f) => won(f, isRegional),
  },
  {
    key: 'firstChallengers', scope: 'run', group: '冠军', title: '次级联赛冠军',
    brief: '第一次拿下 Challengers 赛段冠军',
    test: (_s, f) => won(f, (t) => /^Challengers /.test(t)),
  },
  {
    key: 'firstAscension', scope: 'run', group: '冠军', title: '晋升赛冠军',
    brief: '第一次通过 Ascension 升入 VCT',
    test: (_s, f) => won(f, (t) => /^晋级 VCT/.test(t)),
  },
  {
    key: 'firstMasters', scope: 'run', group: '冠军', title: '大师赛冠军',
    brief: '第一次拿下 Masters',
    test: (_s, f) => won(f, isMasters),
  },
  {
    key: 'firstChampions', scope: 'run', group: '冠军', title: '冠军赛冠军',
    brief: '第一次拿下 Champions',
    hard: true,
    test: (_s, f) => won(f, isChampions),
  },
  {
    key: 'regionalSweep', scope: 'run', group: '冠军', title: '赛区全扫',
    brief: '同一年拿下 Kickoff、Stage 1 和 Stage 2',
    hard: true,
    test: (_s, f) => f.regionalSweeps > 0,
  },
  {
    // not 'perfectYear': endings and achievements share one key namespace on
    // the profile, and there is an ending by that name
    key: 'perfectSeason', scope: 'run', group: '冠军', title: '全冠之年',
    brief: '同一年拿下两站大师赛和冠军赛',
    hard: true,
    test: (_s, f) => f.perfectYears > 0,
  },
  {
    // Also one of the three keys that unlock free team choice on the account —
    // see freeTeamChoice in profile.ts. Checked every turn, so a save holding
    // the streak right now unlocks it without waiting for the career to end.
    key: 'threepeat', scope: 'run', group: '冠军', title: '三连霸',
    brief: '连续三年拿下 Champions——冠军记在你个人名下，中途换队也算',
    hard: true,
    test: (_s, f) => {
      const years = [...new Set(f.honours.filter((h) => isChampions(h.title)).map((h) => h.year))]
        .sort((a, b) => a - b)
      let run = 0
      let prev: number | null = null
      for (const y of years) {
        run = prev !== null && y === prev + 1 ? run + 1 : 1
        if (run >= 3) return true
        prev = y
      }
      return false
    },
  },
  {
    key: 'tenTitles', scope: 'run', group: '冠军', title: '陈列柜',
    brief: '单段生涯累计十座奖杯',
    test: (_s, f) => f.honours.length >= 10,
  },
  {
    key: 'twentyTitles', scope: 'run', group: '冠军', title: '柜子不够用了',
    brief: '单段生涯累计二十座奖杯',
    hard: true,
    test: (_s, f) => f.honours.length >= 20,
  },

  // =================================================================== 赛场
  {
    key: 'perfect', scope: 'run', group: '赛场', title: '十三比零',
    brief: '在一张图上 13:0 零封对手',
    hard: true,
    test: (_s, f) => f.perfectMaps > 0,
  },
  {
    key: 'overtime', scope: 'run', group: '赛场', title: '加时局',
    brief: '赢下一张打进加时的地图',
    test: (_s, f) => f.overtimeWins > 0,
  },
  {
    key: 'decider', scope: 'run', group: '赛场', title: '决胜图',
    brief: '在最后一张图上拿下系列赛',
    test: (_s, f) => f.deciders > 0,
  },
  {
    key: 'sweep', scope: 'run', group: '赛场', title: '干净利落',
    brief: '一张图不丢地赢下一个系列赛',
    test: (_s, f) => f.sweeps > 0,
  },

  // =================================================================== 养成
  {
    // 88, not 90. Six ten-year careers played for development — signing the
    // widest ceilings available and training every week — got a man who
    // arrived at 85 or under as far as 89 and no further. A 90 asked for one
    // point that the development curve does not have.
    key: 'ceiling', scope: 'run', group: '养成', title: '天花板',
    brief: '把一名到你手上时不到 85 的选手练到 88 以上',
    hard: true,
    test: (_s, f) => f.squad.some(
      (p) => p.overall >= 88 && (p.arrivedOverall ?? p.overall) <= 85),
  },
  {
    // The bar is what YOU added, not what he arrived at. An arrival cap of 75
    // meant the badge quietly excluded the ordinary path to it — sign a
    // promising 17-year-old at 77, coach him to 85 — while a fixed cap says
    // nothing about whether you did any coaching at all.
    key: 'teenStar', scope: 'run', group: '养成', title: '少年成名',
    brief: '把一名 20 岁及以下的选手练到 80 以上，且在你手下至少涨 8 点',
    hard: true,
    test: (_s, f) => f.squad.some(
      (p) => p.age <= 20 && p.overall >= 80 && p.overall - (p.arrivedOverall ?? p.overall) >= 8),
  },
  {
    // the best single development anyone managed across those six careers was
    // +14, so 15 was one point outside the game
    key: 'grew15', scope: 'run', group: '养成', title: '脱胎换骨',
    brief: '让一名选手在你手下涨 12 点能力',
    test: (_s, f) => f.squad.some((p) => p.overall - (p.arrivedOverall ?? p.overall) >= 12),
  },
  {
    // No rating on this one. Ageing in this game is steep: across six full
    // careers the best 30-year-old anybody had was 64, while the world's peak
    // was 95, so 「30 岁以上且 80 以上」 described a player who cannot exist.
    // What is real is choosing to keep one at all instead of churning.
    // 32, not 30: the world ships exactly one player aged 32 and two aged 31,
    // and FNC opens with a 30-year-old already in its five — which handed this
    // out before the first turn. Nobody starts with a 32-year-old starter, and
    // players age into it over a decade.
    key: 'veteran', scope: 'run', group: '养成', title: '老而弥坚',
    brief: '让一名 32 岁以上的选手留在首发五人里',
    test: (s, f) => {
      const starters = new Set(s.teams[s.myTeam]?.starters ?? [])
      return f.squad.some((p) => p.age >= 32 && starters.has(p.id))
    },
  },
  {
    key: 'mvpMachine', scope: 'run', group: '养成', title: 'MVP 收割机',
    brief: '队内一名选手生涯累计 20 次 MVP',
    hard: true,
    test: (_s, f) => f.squad.some((p) => (p.career?.mvps ?? 0) >= 20),
  },
  {
    key: 'facility', scope: 'run', group: '养成', title: '基建狂魔',
    brief: '把训练设施在你接手的基础上升 10 级',
    test: (s) => {
      const now = s.teams[s.myTeam]?.facilities ?? 0
      return now - (s.startFacilities ?? now) >= 10
    },
  },
  {
    key: 'facilityMax', scope: 'run', group: '养成', title: '顶级设施',
    brief: '把训练设施升到满级 95',
    hard: true,
    test: (s) => (s.teams[s.myTeam]?.facilities ?? 0) >= 95,
  },

  // =================================================================== 阵容
  {
    // Not just "has no imports" — 45 of the 78 clubs open that way, so half
    // the league was handed this before touching anything. It has to be a
    // squad you actually built: five signings made, and still nobody imported.
    key: 'noImports', scope: 'run', group: '阵容', title: '全本土',
    brief: '签过五名选手之后，阵容里依然没有一名外援',
    test: (s, f) => f.squad.length >= 5 && f.imports === 0 && tally(s).signed >= 5,
  },
  {
    key: 'rebuilt', scope: 'run', group: '阵容', title: '大换血',
    brief: '阵容里有五人不是你接手时的那批',
    test: (s, f) => {
      const inherited = new Set(s.startingSquad ?? [])
      return f.squad.filter((p) => !inherited.has(p.id)).length >= 5
    },
  },
  {
    key: 'signed15', scope: 'run', group: '阵容', title: '流水的兵',
    brief: '一段生涯里签下 15 名选手',
    test: (s) => tally(s).signed >= 15,
  },
  {
    key: 'signed30', scope: 'run', group: '阵容', title: '铁打的营盘',
    brief: '一段生涯里签下 30 名选手',
    hard: true,
    test: (s) => tally(s).signed >= 30,
  },
  {
    key: 'staff5', scope: 'run', group: '阵容', title: '教练组',
    brief: '一段生涯里聘用过 5 名教练或分析师',
    test: (s) => tally(s).hired >= 5,
  },
  {
    key: 'staffFull', scope: 'run', group: '阵容', title: '幕后班底',
    brief: '同时拥有四名以上教练组成员',
    test: (s) => (s.staff ?? []).length >= 4,
  },

  // =================================================================== 经营
  {
    key: 'bigDeal', scope: 'run', group: '经营', title: '大生意',
    brief: '单笔进账超过 100 万',
    test: (s) => (s.finances?.log ?? []).some((e) => e.amount >= 1_000_000),
  },
  {
    // 600万. Clubs are dealt 2-4 sponsors at world creation and the richest
    // opening book in the league is FUT's at 534万 — eighteen of the 78 start
    // above 350万 — so anything lower is handed to whoever picked the right
    // job. The audited ceiling is 685万.
    key: 'sponsorBook', scope: 'run', group: '经营', title: '商业版图',
    brief: '赞助总收入达到每赛季 600 万',
    hard: true,
    test: (s) => (s.teams[s.myTeam]?.sponsors ?? [])
      .reduce((n, sp) => n + sp.perSeason, 0) >= 6_000_000,
  },
  {
    key: 'commercial20', scope: 'run', group: '经营', title: '会做生意',
    brief: '商务与赞助累计进账 2000 万',
    test: (s) => tally(s).commercial >= 20_000_000,
  },
  {
    key: 'commercial60', scope: 'run', group: '经营', title: '商业帝国',
    // 3500万, which every audited career cleared. The figure swings with how
    // big a club you are at — runs harvested anywhere from 3870万 to 5729万 —
    // so the bar sits under the weakest of them rather than under the best.
    brief: '商务与赞助累计进账 3500 万',
    hard: true,
    test: (s) => tally(s).commercial >= 35_000_000,
  },
  {
    key: 'rich', scope: 'run', group: '经营', title: '家底',
    brief: '账面资金超过 2000 万',
    test: (s) => (s.finances?.balance ?? 0) >= 20_000_000,
  },
  {
    key: 'savings', scope: 'run', group: '经营', title: '积蓄',
    brief: '自己的工资累计拿满 200 万',
    test: (s) => tally(s).earned >= 2_000_000,
  },
  {
    // managerSalaryFor tops out near $360K a season — the best club in the
    // world paying a manager at maximum reputation — so eleven seasons is
    // about $3.96M and 800万 was money the game cannot pay.
    key: 'savingsBig', scope: 'run', group: '经营', title: '不缺钱了',
    brief: '自己的工资累计拿满 300 万',
    hard: true,
    test: (s) => tally(s).earned >= 3_000_000,
  },

  // =================================================================== 生涯
  {
    key: 'trusted', scope: 'run', group: '生涯', title: '一言九鼎',
    brief: '把董事会信任度做到 95 以上',
    test: (s) => (s.boardConfidence ?? 0) >= 95,
  },
  {
    key: 'threeClubs', scope: 'run', group: '生涯', title: '三朝元老',
    brief: '一段生涯里执教过三家俱乐部',
    test: (_s, f) => f.clubs >= 3,
  },
  {
    // `finished` alone is no longer enough: the five-year settlement also ends
    // a career finished rather than sacked, and this badge is for the people
    // who declined it and went the distance.
    key: 'tenYears', scope: 'run', group: '生涯', title: '走完十年',
    brief: '不在五年之约收官，完整走完 2026 到 2036',
    hard: true,
    test: (s) => !!s.finished && s.year >= FINAL_YEAR,
  },
  {
    // The other run-scoped key freeTeamChoice reads — reputation is clamped at
    // 96 in season.ts, so 90 is late-career air but reachable air.
    key: 'rep90', scope: 'run', group: '生涯', title: '名满天下',
    brief: '经理声望达到 90',
    hard: true,
    test: (s) => (s.manager?.reputation ?? 0) >= 90,
  },

  // =============================================================== 生涯累计
  {
    key: 'allRegions', scope: 'life', group: '收藏', title: '走遍四大赛区',
    brief: '在美洲、EMEA、太平洋、中国都执教过',
    hard: true,
    lifeTest: (r) => regionsManaged(r.clubs).length >= 4,
  },
  {
    key: 'careers5', scope: 'life', group: '收藏', title: '老江湖',
    brief: '累计开始过五段执教生涯',
    lifeTest: (r) => r.careers >= 5,
  },
  {
    key: 'finished3', scope: 'life', group: '收藏', title: '三个十年',
    brief: '累计三次走完十年任期',
    hard: true,
    lifeTest: (r) => r.finished >= 3,
  },
  {
    key: 'titles50', scope: 'life', group: '收藏', title: '五十冠',
    brief: '所有生涯累计五十座奖杯',
    lifeTest: (r) => r.titles >= 50,
  },
  {
    key: 'worlds10', scope: 'life', group: '收藏', title: '十座国际冠军',
    brief: '所有生涯累计十座国际冠军',
    hard: true,
    lifeTest: (r) => r.worldTitles >= 10,
  },
  {
    // 16, not 10. A single dominant ten-year career unlocks 14 of the 22 at
    // once — endingsFor is a filter, not a pick-one — so ten was a milestone
    // you passed without noticing on your first good save.
    key: 'endings10', scope: 'life', group: '收藏', title: '结局收藏家',
    brief: '解锁十六种不同的结局',
    hard: true,
    lifeTest: (_r, u) => u.endings.length >= 16,
  },
]

export const ACHIEVEMENT_COUNT = ACHIEVEMENTS.length
export const RUN_ACHIEVEMENTS = ACHIEVEMENTS.filter((a) => a.scope === 'run')
export const LIFE_ACHIEVEMENTS = ACHIEVEMENTS.filter((a) => a.scope === 'life')

/**
 * Every 局内 achievement this save currently satisfies.
 *
 * Each predicate is guarded on its own: a malformed save must not take the
 * game down over a badge, and one bad condition must not hide the other
 * forty-one.
 */
export function earnedNow(state: GameState): string[] {
  let f: Facts
  try {
    f = factsOf(state)
  } catch {
    return []
  }
  const out: string[] = []
  for (const a of RUN_ACHIEVEMENTS) {
    try {
      if (a.test?.(state, f)) out.push(a.key)
    } catch { /* skip this one only */ }
  }
  return out
}

/** Every 生涯 achievement the account's record satisfies. */
export function earnedLifetime(
  record: CareerRecord, unlocked: { endings: string[]; achievements: string[] },
): string[] {
  const out: string[] = []
  for (const a of LIFE_ACHIEVEMENTS) {
    try {
      if (a.lifeTest?.(record, unlocked)) out.push(a.key)
    } catch { /* same */ }
  }
  return out
}

export const achievementBy = (key: string): Achievement | undefined =>
  ACHIEVEMENTS.find((a) => a.key === key)
