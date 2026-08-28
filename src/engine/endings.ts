/**
 * Ten seasons, and two verdicts.
 *
 * A career used to end only by being sacked. Now it also ends by finishing:
 * 2026 to 2036 is the whole story, and what you did with it decides how it is
 * remembered. Two things are remembered, not one, because a decade answers two
 * different questions and collapsing them into a single title throws away
 * whichever one you were not optimising for:
 *
 *   王朝线 — what you won. Read off the trophy cabinet and nothing else.
 *   故事线 — how it went. Who you kept, where you started, how it ended.
 *
 * Every finished career gets one of each, and unlocks every ending it
 * qualifies for, so a homegrown side that wins everything is credited twice.
 *
 * The trophy conditions are built on the season the game actually runs. A year
 * holds exactly three international events — Masters I, Masters II and
 * Champions — so a 全冠年 is those three, and 黄金之路 is three such years in a
 * row: nine international titles without dropping one. That number comes from
 * the calendar rather than from wanting a big-sounding figure.
 *
 * Same rule as everywhere else here: every condition is a question asked of
 * the save's own record — honours, tenures, the squad — never a flag written
 * at the moment something happened. A save imported from an older version, or
 * edited by hand, answers exactly as one played straight through.
 */
import type { GameState, Player } from './types'
import { squadOf } from './world'
import { isImport } from './imports'

export const FINAL_YEAR = 2036

export type EndingTrack = '王朝' | '故事'

export interface Ending {
  key: string
  track: EndingTrack
  title: string
  /** shown before it is earned: what it takes, never how to game it */
  brief: string
  /** shown once earned, as the ending itself */
  text: (s: GameState, f: Facts) => string
  test: (s: GameState, f: Facts) => boolean
}

// --------------------------------------------------------------- the record

/** The three international events of a season. All three in a year is 全冠. */
export const INTL_TITLES = ['Masters I', 'Masters II', 'Champions'] as const

const isIntl = (t: string) => (INTL_TITLES as readonly string[]).includes(t)
const isChampions = (t: string) => t === 'Champions'
/** A tier-1 regional trophy: a Kickoff or one of the two Stages. */
const isRegional = (t: string) => /Kickoff$/.test(t) || /^VCT .+ · Stage \d$/.test(t)
const isChallengers = (t: string) => /^Challengers /.test(t)
const isAscension = (t: string) => /^晋级 VCT/.test(t)

export interface Facts {
  seasons: number
  /** years holding the Champions trophy */
  champYears: number[]
  /** years in which all three international events came home */
  perfectYears: number[]
  /** longest run of consecutive perfect years — three of them is 黄金之路 */
  perfectStreak: number
  /** longest run of consecutive years holding Champions */
  champStreak: number
  intlTitles: number
  regionalTitles: number
  challengersTitles: number
  promotions: number
  titles: number
  clubs: number
  /** players from the first squad still on the books */
  originalsLeft: number
  originalsAt: number
  imports: number
  /** took the first job at a second-tier club */
  startedLow: boolean
  /**
   * Champion in consecutive years, and then a later season with nothing at
   * all. The fall, not merely the absence of a rise.
   */
  fellOff: boolean
}

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
  const honours = state.honours ?? []
  const yearsOf = (pred: (t: string) => boolean) =>
    honours.filter((h) => pred(h.title)).map((h) => h.year)

  const champYears = yearsOf(isChampions)
  const intlYears = yearsOf(isIntl)

  // a perfect year holds all three of them
  const byYear = new Map<number, Set<string>>()
  for (const h of honours) {
    if (!isIntl(h.title)) continue
    if (!byYear.has(h.year)) byYear.set(h.year, new Set())
    byYear.get(h.year)!.add(h.title)
  }
  const perfectYears = [...byYear.entries()]
    .filter(([, got]) => INTL_TITLES.every((t) => got.has(t)))
    .map(([y]) => y)
    .sort((a, b) => a - b)

  const squad = squadOf(state, state.myTeam)
  const me = state.teams[state.myTeam]
  const originals = state.startingSquad ?? []
  const here = new Set(squad.map((p: Player) => p.id))

  // The fall: at least two years running at the top, and then a whole season
  // afterwards with nothing at all. Being merely worse is not this ending —
  // going from champion to empty-handed is.
  const streakEnd = (() => {
    const set = [...new Set(champYears)].sort((a, b) => a - b)
    let run = 0
    let best = 0
    let prev: number | null = null
    let end: number | null = null
    for (const y of set) {
      run = prev !== null && y === prev + 1 ? run + 1 : 1
      prev = y
      if (run > best) { best = run; end = y }
    }
    return best >= 2 ? end : null
  })()
  const allYears = honours.map((h) => h.year)
  const fellOff = streakEnd !== null
    && state.year > streakEnd
    && !allYears.some((y) => y > streakEnd)

  // Which tier the job was taken at. A career that never moved has no tenure
  // row at all, so the fallback is the club we are still at.
  const firstClub = (state.tenures ?? [])[0]?.teamId ?? state.myTeam
  const startedLow = (state.teams[firstClub]?.tier ?? 1) === 2

  return {
    seasons: state.year - 2026 + 1,
    champYears,
    perfectYears,
    perfectStreak: longestRun(perfectYears),
    champStreak: longestRun(champYears),
    intlTitles: intlYears.length,
    regionalTitles: yearsOf(isRegional).length,
    challengersTitles: yearsOf(isChallengers).length,
    promotions: yearsOf(isAscension).length,
    titles: honours.length,
    clubs: new Set((state.tenures ?? []).map((t) => t.teamId)).size || 1,
    originalsLeft: originals.filter((id) => here.has(id)).length,
    originalsAt: originals.length,
    imports: me ? squad.filter((p) => isImport(p, me)).length : 0,
    startedLow,
    fellOff,
  }
}

const club = (s: GameState) => s.teams[s.myTeam]?.name ?? '你的俱乐部'

// ------------------------------------------------------------------ endings

/**
 * Ordered best-first WITHIN each track. A career is remembered by the first
 * one it qualifies for in each track, and unlocks every one it qualifies for
 * anywhere.
 *
 * Every condition is real — none is a `() => true` fallback. The last two of
 * each track partition the remaining space instead (有过高光／空手而归 by
 * whether anything was won, 十年一日／来过 by whether the decade was finished),
 * so a career always resolves to exactly one per track without a badge
 * unlocking for people it plainly does not describe.
 */
export const ENDINGS: Ending[] = [
  // ================================================================== 王朝线
  {
    key: 'immortal', track: '王朝', title: '不朽',
    brief: '连续五年包揽两站大师赛和冠军赛——十五座国际冠军',
    test: (_s, f) => f.perfectStreak >= 5,
    text: (s, f) => `连续 ${f.perfectStreak} 年，两站大师赛和冠军赛全部属于${club(s)}。`
      + `十五座国际奖杯。后来的人提起这十年，不会说它属于谁——他们会说，那就是那个时代。`,
  },
  {
    key: 'golden', track: '王朝', title: '黄金之路',
    brief: '连续三年包揽两站大师赛和冠军赛——三年九冠',
    test: (_s, f) => f.perfectStreak >= 3,
    text: (s, f) => `三年，九座国际冠军，一座没让。${club(s)}走完了那条`
      + `所有人都以为只存在于理论里的路——${f.perfectYears.slice(0, 3).join('、')}，一年不落。`,
  },
  {
    key: 'perfectYear', track: '王朝', title: '全冠之年',
    brief: '同一年拿下两站大师赛和冠军赛',
    test: (_s, f) => f.perfectYears.length > 0,
    text: (s, f) => `${f.perfectYears[0]} 年，这个赛季所有的国际奖杯都进了${club(s)}的柜子。`
      + `那一年打完，所有人的休赛期都只在研究一件事：怎么防住你。`,
  },
  {
    key: 'fivePeat', track: '王朝', title: '五连霸',
    brief: '连续五年拿下冠军赛',
    test: (_s, f) => f.champStreak >= 5,
    text: (s, f) => `连续 ${f.champStreak} 年的世界冠军。${club(s)}这个名字`
      + `已经不再是一支队伍的称呼，而是一个时代的名字。`,
  },
  {
    key: 'threePeat', track: '王朝', title: '三连霸',
    brief: '连续三年拿下冠军赛',
    test: (_s, f) => f.champStreak >= 3,
    text: (s, f) => `连续 ${f.champStreak} 年的世界冠军。十年任期结束时，`
      + `没有人再怀疑${club(s)}属于哪个层级。`,
  },
  {
    key: 'tenCrowns', track: '王朝', title: '十冠王',
    brief: '生涯累计十座国际冠军',
    test: (_s, f) => f.intlTitles >= 10,
    text: (s, f) => `${f.intlTitles} 座国际奖杯。没有哪一年是绝对的统治，`
      + `但十年下来，决赛那一边站着的总是${club(s)}。`,
  },
  {
    key: 'defend', track: '王朝', title: '卫冕',
    brief: '连续两年拿下冠军赛',
    test: (_s, f) => f.champStreak >= 2,
    text: (s) => `蝉联世界冠军。第一座可以说是运气，第二座是${club(s)}`
      + `真的学会了怎么赢。`,
  },
  {
    key: 'summit', track: '王朝', title: '登顶',
    brief: '拿下一次冠军赛',
    test: (_s, f) => f.champYears.length > 0,
    text: (s, f) => `${f.champYears[0]} 年，${club(s)}第一次举起了冠军赛奖杯。`
      + `十年任期里，你做到了绝大多数经理做不到的事。`,
  },
  {
    key: 'masterOnly', track: '王朝', title: '大师',
    brief: '拿过大师赛，但始终没能拿下冠军赛',
    test: (_s, f) => f.intlTitles > 0 && f.champYears.length === 0,
    text: (s, f) => `${f.intlTitles} 座大师赛奖杯，和一个始终没填上的空位。`
      + `${club(s)}赢过所有人，只是从来没在最后那一天赢。`,
  },
  {
    key: 'regionKing', track: '王朝', title: '赛区霸主',
    brief: '拿下五个赛区冠军，却没有国际冠军',
    test: (_s, f) => f.regionalTitles >= 5 && f.intlTitles === 0,
    text: (s, f) => `${f.regionalTitles} 个赛区冠军。国内没有人是${club(s)}的对手——`
      + `出了国门，这句话每年都要重新证明一次，而你没能证明。`,
  },
  {
    key: 'ascend', track: '王朝', title: '升班马',
    brief: '带队从次级联赛升入 VCT',
    test: (_s, f) => f.promotions > 0,
    text: (s) => `你在次级联赛接手了${club(s)}，把它送进了 VCT。`
      + `那些年在空荡荡的赛场里打的比赛，现在都值了。`,
  },
  {
    key: 'silverware', track: '王朝', title: '有过高光',
    brief: '拿到过奖杯，但一座国际冠军也没有',
    test: (_s, f) => f.titles > 0 && f.intlTitles === 0,
    text: (s, f) => `${f.titles} 座奖杯。不是一个会被写进历史的十年，`
      + `但${club(s)}的球迷记得每一座是怎么来的。`,
  },
  {
    // A real condition, not a `() => true` fallback. Written that way once, it
    // meant a nine-title dynasty「同时达成」了「空手而归」 — the catch-all
    // unlocked for everybody and put a nonsense badge in their collection.
    // Between them, silverware and this one still cover every career that has
    // no international trophy, so nothing falls through.
    key: 'nothing', track: '王朝', title: '空手而归',
    brief: '一座奖杯也没有',
    test: (_s, f) => f.titles === 0,
    text: (s) => `${club(s)}的陈列柜依然空着。`
      + `这一行就是这样——绝大多数人的十年，都是这样的。`,
  },

  // ================================================================== 故事线
  {
    key: 'icarus', track: '故事', title: '乐极生悲',
    brief: '连冠之后，突然有一个赛季颗粒无收',
    test: (_s, f) => f.fellOff,
    text: (s) => `你曾经让${club(s)}把冠军变成一种习惯。然后有一年，`
      + `奖杯被别人举起来了，你在台下看着——那之后，它再也没有回来过。`,
  },
  {
    key: 'homegrown', track: '故事', title: '本土主义',
    brief: '阵容里没有一名外援，并拿下国际冠军',
    test: (_s, f) => f.intlTitles > 0 && f.imports === 0 && f.seasons >= 3,
    text: (s) => `整整十年，${club(s)}没有签下过一名外赛区选手，`
      + `却把国际冠军带回了家。有人说这不可能，你没有回应。`,
  },
  {
    key: 'loyal', track: '故事', title: '一起走到最后',
    brief: '带着当初那批人中的三人以上走完十年',
    test: (_s, f) => f.originalsAt > 0 && f.originalsLeft >= 3 && f.seasons >= 5,
    text: (s, f) => `十年前接手时的那批人，还有 ${f.originalsLeft} 个在队里。`
      + `${club(s)}的更衣室里，有些故事只有他们和你知道。`,
  },
  {
    key: 'grassroots', track: '故事', title: '草根',
    brief: '从次级联赛的球队起步，最后拿下 VCT 赛区冠军',
    test: (_s, f) => f.startedLow && f.regionalTitles > 0,
    text: (s) => `你是从没人看的次级联赛开始的。现在${club(s)}是赛区冠军，`
      + `而当年那间小小的训练室，墙上还挂着第一张合影。`,
  },
  {
    key: 'rebuild', track: '故事', title: '推倒重来',
    brief: '接手时的队员一个不剩，并拿下国际冠军',
    test: (_s, f) => f.originalsAt > 0 && f.originalsLeft === 0 && f.intlTitles > 0,
    text: (s) => `接手时的那支队伍，如今一个人都不剩了。这很残酷，`
      + `但${club(s)}举起奖杯的那天，没有人再问值不值得。`,
  },
  {
    key: 'oneClub', track: '故事', title: '一生一队',
    brief: '十年只执教一家俱乐部，并拿下冠军',
    test: (_s, f) => f.clubs === 1 && f.titles > 0 && f.seasons >= 8,
    text: (s, f) => `十年，一家俱乐部，${f.titles} 座奖杯。`
      + `${club(s)}的历史里，有一页专门写你。`,
  },
  {
    key: 'journeyman', track: '故事', title: '流浪教头',
    brief: '十年之内执教过三家以上俱乐部',
    test: (_s, f) => f.clubs >= 3,
    text: (_s, f) => `十年，${f.clubs} 家俱乐部。你没有属于哪一支队伍，`
      + `但每一支都记得你来过。`,
  },
  {
    key: 'quiet', track: '故事', title: '十年一日',
    brief: '完整走完十个赛季',
    test: (_s, f) => f.seasons >= 10,
    text: (s, f) => `十个赛季，${f.titles} 座奖杯。在一个平均任期不到两年的行业里，`
      + `你在${club(s)}待满了十年——这件事本身就没几个人做到过。`,
  },
  {
    // 十年一日 and this one partition every career between them, so the story
    // track always resolves without either of them being unconditional.
    key: 'shortStay', track: '故事', title: '来过',
    brief: '没能走完十年',
    test: (_s, f) => f.seasons < 10,
    text: (s, f) => `${f.seasons} 个赛季之后，你离开了${club(s)}。`
      + `这一行的门一直开着——进来容易，留下来才难。`,
  },
]

export const ENDING_COUNT = ENDINGS.length
export const DYNASTY_ENDINGS = ENDINGS.filter((e) => e.track === '王朝')
export const STORY_ENDINGS = ENDINGS.filter((e) => e.track === '故事')

/** Every ending this career qualifies for, best first within each track. */
export const endingsFor = (state: GameState): Ending[] => {
  const f = factsOf(state)
  return ENDINGS.filter((e) => e.test(state, f))
}

/**
 * The two it is remembered by: the best of each track.
 *
 * Both are always present, because each track's last entry is a catch-all —
 * there is no way to reach the end of a career and be told nothing.
 */
export function endingOf(state: GameState): { dynasty: Ending | null; story: Ending | null } {
  const got = endingsFor(state)
  return {
    dynasty: got.find((e) => e.track === '王朝') ?? null,
    story: got.find((e) => e.track === '故事') ?? null,
  }
}
