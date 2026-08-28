/**
 * Ten seasons, and then a verdict.
 *
 * A career used to end only by being sacked. Now it also ends by finishing:
 * 2026 to 2036 is the whole story, and what you did with it decides which
 * ending you get. They are graded like achievements rather than scored — a
 * dynasty and a one-club man are different endings, not a better and a worse
 * one — and the account remembers every ending it has ever reached, so the
 * question the screen asks is "which ones have you not seen yet".
 *
 * Every condition here is read off the save, never off a flag set at the
 * moment it happened: a save imported from an older version, or one edited by
 * hand, gets the same answer as one played straight through. `honours` and
 * `tenures` are the record, and the record is what is judged.
 *
 * The id lives with the card mode's, because they are the same person.
 */
import type { GameState, Player } from './types'
import { squadOf } from './world'
import { isImport } from './imports'

export const FINAL_YEAR = 2036

export type EndingKey =
  | 'dynasty5' | 'dynasty3' | 'treble' | 'worldFirst'
  | 'loyalWithMe' | 'homegrown' | 'oneClub'
  | 'fallen' | 'nearly' | 'promoted' | 'survivor' | 'journeyman'

export interface Ending {
  key: EndingKey
  title: string
  /** shown before it is earned: what it takes, never how to game it */
  brief: string
  /** shown once earned, as the ending itself */
  text: (s: GameState, f: Facts) => string
  rank: number
  test: (s: GameState, f: Facts) => boolean
}

/** Everything the conditions need, computed once off the record. */
export interface Facts {
  seasons: number
  /** international titles (Masters / Champions), by year */
  worldYears: number[]
  /** regional titles, by year */
  regionYears: number[]
  /** the longest run of consecutive years with at least one world title */
  worldStreak: number
  /** the longest run of consecutive years winning everything entered */
  sweepStreak: number
  titles: number
  clubs: number
  /** players from the first squad still on the books */
  originalsLeft: number
  originalsAt: number
  imports: number
  promotions: number
  /** won a world title, then finished a later season with nothing at all */
  crashedAfterGlory: boolean
}

const yearsOf = (s: GameState, pred: (t: string) => boolean): number[] =>
  s.honours.filter((h) => pred(h.title)).map((h) => h.year)

const isWorld = (t: string) => /Masters|Champions/i.test(t) && !/Challengers/i.test(t)
const isRegional = (t: string) => /VCT|Challengers|Kickoff|Stage/i.test(t)

/** The longest run of consecutive years present in a list. */
function longestRun(years: number[]): number {
  const set = [...new Set(years)].sort((a, b) => a - b)
  let best = 0
  let run = 0
  let prev: number | null = null
  for (const y of set) {
    run = prev !== null && y === prev + 1 ? run + 1 : 1
    prev = y
    if (run > best) best = run
  }
  return best
}

export function factsOf(state: GameState): Facts {
  const worldYears = yearsOf(state, isWorld)
  const regionYears = yearsOf(state, isRegional)
  const allYears = state.honours.map((h) => h.year)

  // A sweep is a season in which every trophy the club took part in came home.
  // The record cannot say what was entered, so it uses the strongest evidence
  // it has: a world title AND a regional title in the same year.
  const sweeps = worldYears.filter((y) => regionYears.includes(y))

  const originals = state.startingSquad ?? []
  const stillHere = new Set(squadOf(state, state.myTeam).map((p: Player) => p.id))

  const squad = squadOf(state, state.myTeam)
  const me = state.teams[state.myTeam]
  // The same definition the import rule uses — nationality, falling back to
  // the region he entered the world in. Comparing `region` alone made this
  // free: `region` IS the club's region for anyone signed at world creation,
  // so an untouched squad counted as fully homegrown without trying.
  const foreign = me ? squad.filter((p) => isImport(p, me)).length : 0

  // fell off: won a world title, and a LATER season brought nothing at all
  const lastWorld = worldYears.length ? Math.max(...worldYears) : null
  const crashed = lastWorld !== null
    && state.year > lastWorld
    && !allYears.some((y) => y > lastWorld)

  return {
    seasons: state.year - 2026 + 1,
    worldYears, regionYears,
    worldStreak: longestRun(worldYears),
    sweepStreak: longestRun(sweeps),
    titles: state.honours.length,
    clubs: new Set((state.tenures ?? []).map((t) => t.teamId)).size || 1,
    originalsLeft: originals.filter((id) => stillHere.has(id)).length,
    originalsAt: originals.length,
    imports: foreign,
    promotions: state.honours.filter((h) => /晋级/.test(h.title)).length,
    crashedAfterGlory: crashed,
  }
}

const club = (s: GameState) => s.teams[s.myTeam]?.name ?? '你的俱乐部'

/**
 * Ordered best-first. A career gets the FIRST one it qualifies for as its
 * ending, and unlocks every one it qualifies for in the collection — so a
 * dynasty built with a homegrown squad is credited with both.
 */
export const ENDINGS: Ending[] = [
  {
    key: 'dynasty5', rank: 1, title: '王朝',
    brief: '连续五年拿下世界冠军',
    test: (_s, f) => f.worldStreak >= 5,
    text: (s, f) => `连续 ${f.worldStreak} 年站在世界之巅。十年之后，${club(s)}这个名字`
      + `已经不再是一支队伍的称呼，而是一个时代的名字。`,
  },
  {
    key: 'treble', rank: 2, title: '全冠三连',
    brief: '连续三年包揽赛区与世界冠军',
    test: (_s, f) => f.sweepStreak >= 3,
    text: (s, f) => `连续 ${f.sweepStreak} 个赛季，${club(s)}把能拿的都拿了。`
      + `对手研究了三年，也没找到破解的办法。`,
  },
  {
    key: 'dynasty3', rank: 3, title: '三连霸',
    brief: '连续三年拿下世界冠军',
    test: (_s, f) => f.worldStreak >= 3,
    text: (s, f) => `连续 ${f.worldStreak} 年的世界冠军。十年任期结束时，`
      + `没有人再怀疑${club(s)}属于哪个层级。`,
  },
  {
    key: 'homegrown', rank: 4, title: '本土主义',
    brief: '整个阵容没有一名外援，并夺得世界冠军',
    test: (_s, f) => f.worldYears.length > 0 && f.imports === 0,
    text: (s) => `整整十年，${club(s)}没有签下过一名外赛区选手，`
      + `却把世界冠军带回了家。有人说这不可能，你没有回应。`,
  },
  {
    key: 'loyalWithMe', rank: 5, title: '一起走到最后',
    brief: '带着当初那批人中的三人以上走完十年',
    test: (_s, f) => f.originalsAt > 0 && f.originalsLeft >= 3,
    text: (s, f) => `十年前接手时的那批人，还有 ${f.originalsLeft} 个在队里。`
      + `${club(s)}的更衣室里，有些故事只有他们和你知道。`,
  },
  {
    key: 'nearly', rank: 6, title: '功亏一篑',
    brief: '拿过世界冠军，却在之后的赛季里颗粒无收',
    test: (_s, f) => f.crashedAfterGlory,
    text: (s) => `你曾经把${club(s)}带上过世界之巅。然后一切开始下坠——`
      + `阵容老了，对手变强了，而那座奖杯再也没有回来。`,
  },
  {
    key: 'worldFirst', rank: 7, title: '登顶',
    brief: '至少拿下一次世界冠军',
    test: (_s, f) => f.worldYears.length > 0,
    text: (s, f) => `${f.worldYears[0]} 年，${club(s)}第一次举起了世界冠军奖杯。`
      + `十年任期里，你做到了绝大多数经理做不到的事。`,
  },
  {
    key: 'promoted', rank: 8, title: '升班马',
    brief: '带队从次级联赛升入 VCT',
    test: (_s, f) => f.promotions > 0,
    text: (s) => `你在次级联赛接手了${club(s)}，把它送进了 VCT。`
      + `那些年在空荡荡的赛场里打的比赛，现在都值了。`,
  },
  {
    key: 'oneClub', rank: 9, title: '一生一队',
    brief: '十年只执教一家俱乐部，并拿下冠军',
    test: (_s, f) => f.clubs === 1 && f.titles > 0,
    text: (s, f) => `十年，一家俱乐部，${f.titles} 座奖杯。`
      + `${club(s)}的历史里，有一页专门写你。`,
  },
  {
    key: 'journeyman', rank: 10, title: '流浪教头',
    brief: '十年之内执教过三家以上俱乐部',
    test: (_s, f) => f.clubs >= 3,
    text: (_s, f) => `十年，${f.clubs} 家俱乐部。你没有属于哪一支队伍，`
      + `但每一支都记得你来过。`,
  },
  {
    key: 'fallen', rank: 11, title: '空手而归',
    brief: '走完十年，一座奖杯也没有',
    test: (_s, f) => f.titles === 0,
    text: (s) => `十年过去了，${club(s)}的陈列柜依然空着。`
      + `这一行就是这样——绝大多数人的十年，都是这样的。`,
  },
  {
    key: 'survivor', rank: 12, title: '活下来了',
    brief: '完整走完十个赛季',
    test: (_s, f) => f.seasons >= 10,
    text: (s, f) => `十个赛季，${f.titles} 座奖杯。在一个平均任期不到两年的行业里，`
      + `你在${club(s)}待满了十年。`,
  },
]

export const ENDING_COUNT = ENDINGS.length

/** Every ending this career qualifies for, best first. */
export const endingsFor = (state: GameState): Ending[] => {
  const f = factsOf(state)
  return ENDINGS.filter((e) => e.test(state, f))
}

/** The one it is remembered by. */
export const endingOf = (state: GameState): Ending | null => endingsFor(state)[0] ?? null

// The collection used to live here, in its own localStorage key. It moved to
// engine/profile.ts when the account stopped being the card mode's and became
// the site's — endings, achievements and the lifetime record are one row now,
// and keeping a second copy of half of it here could only ever disagree.
