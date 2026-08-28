import { Rng, clamp, hashStr } from './rng'
import { applyMatchStats, pruneMatchDetail, simulateMatch, stripRoundLogs } from './match'
import type { MatchResult } from './types'
import {
  CHAMP_POINTS, advanceBracket, applyResultToStandings, makeFixture, newStandings,
  resetFixtureSeq, scheduleRegularSeason, sortStandings, startBracket,
} from './league'
import { awardPrize, weeklyFinance } from './finance'
import { aiTransferTick, refreshListings, resolveDueOffers, resolveEnquiries } from './transfer'
import { offerGigs, resolveSponsorTalks, runGigsToday, streamWeek, settleSponsorDemands, sponsorWorth } from './commercial'
import { mapCn } from './content'
import { admitProspects } from './prospects'
import { endingsFor, FINAL_YEAR } from './endings'
import { applyMatchBonds } from './bonds'
import { trustAfterMatch } from './trust'
import { resolveApproaches, resolveStaffOffers } from './staff'
import { defaultContract, resolveApplications } from './career'
import { applyMatchFatigue, drillTick, seasonRollover, weeklyTick } from './training'
import { dailyLife, weeklyLife } from './life'
import { autoStarters, ensureCaller } from './world'
import { importBlock } from './imports'
import { contractLength, expectedSalary } from './player'
import { REGIONS } from './types'
import type { Competition, Fixture, GameState, Region, StageKey, Team, Tier } from './types'
import { track } from './telemetry'

export const SEASON_DAYS = 336

export interface StageDef {
  key: StageKey
  name: string
  start: number
  end: number
}

export const STAGES: StageDef[] = [
  { key: 'preseason', name: '季前准备', start: 0, end: 20 },
  { key: 'kickoff', name: 'Kickoff', start: 21, end: 62 },
  { key: 'masters1', name: 'Masters I', start: 63, end: 88 },
  { key: 'stage1', name: 'Stage 1', start: 89, end: 168 },
  { key: 'masters2', name: 'Masters II', start: 169, end: 194 },
  { key: 'stage2', name: 'Stage 2', start: 195, end: 274 },
  { key: 'champions', name: 'Champions', start: 275, end: 310 },
  { key: 'offseason', name: '休赛期', start: 311, end: SEASON_DAYS - 1 },
]

export const stageAt = (day: number): StageKey =>
  STAGES.find((s) => day >= s.start && day <= s.end)?.key ?? 'offseason'

export const stageName = (key: StageKey): string =>
  STAGES.find((s) => s.key === key)?.name ??
  ({ challengers1: 'Challengers 第一赛段', challengers2: 'Challengers 第二赛段', ascension: 'Ascension' } as Record<string, string>)[key] ??
  key

/** Display a day index as an in-fiction date. */
export function dateLabel(state: GameState): string {
  const d = new Date(Date.UTC(state.year, 0, 1))
  d.setUTCDate(d.getUTCDate() + state.day)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}

const compKey = (stage: string, region?: Region) => (region ? `${stage}:${region}` : stage)

function makeComp(
  state: GameState, stage: StageKey, name: string, teams: string[],
  region?: Region, tier?: Tier,
): Competition {
  const comp: Competition = {
    key: compKey(stage, region),
    name,
    region,
    tier,
    stage,
    teams,
    standings: newStandings(teams),
    finished: [],
  }
  state.comps[comp.key] = comp
  return comp
}

const tier1Of = (state: GameState, region: Region) =>
  Object.values(state.teams)
    .filter((t) => t.region === region && t.tier === 1)
    .sort((a, b) => b.rating - a.rating)
    .map((t) => t.id)

const tier2Of = (state: GameState, region: Region) =>
  Object.values(state.teams)
    .filter((t) => t.region === region && t.tier === 2)
    .sort((a, b) => b.rating - a.rating)
    .map((t) => t.id)

/** Build every fixture that can be known before a ball is thrown. */
export function setupSeason(state: GameState, notes?: string[]): void {
  state.managerContract ??= defaultContract(state)
  resetFixtureSeq(0)
  state.fixtures = []
  state.comps = {}
  const rng = new Rng(hashStr(`season:${state.seed}:${state.year}`))

  for (const region of REGIONS) {
    const t1 = tier1Of(state, region)
    const t2 = tier2Of(state, region)

    // ---- Kickoff: a short group phase, then a top-four knockout.
    // A bare bracket meant the very first fixture of a career was a
    // quarter-final against a club you had never played, and the standings
    // stayed empty all the way through because knockouts do not build a table.
    const kc = makeComp(state, 'kickoff', `${region} Kickoff`, t1, region, 1)
    state.fixtures.push(...scheduleRegularSeason(kc, 'kickoff', 24, 52, 3, rng, '小组赛', 5))

    // ---- Stage 1 & Stage 2: full round robin, playoffs seeded from the table
    const s1 = makeComp(state, 'stage1', `VCT ${region} · Stage 1`, t1, region, 1)
    state.fixtures.push(...scheduleRegularSeason(s1, 'stage1', 90, 158, 3, rng))

    const s2 = makeComp(state, 'stage2', `VCT ${region} · Stage 2`, t1, region, 1)
    state.fixtures.push(...scheduleRegularSeason(s2, 'stage2', 196, 264, 3, rng))

    // ---- Challengers: two splits, running alongside the tier-1 calendar
    // even a two-club Challengers league is playable now that small leagues cycle
    if (t2.length >= 2) {
      const c1 = makeComp(state, 'challengers1', `Challengers ${region} · 第一赛段`, t2, region, 2)
      state.fixtures.push(...scheduleRegularSeason(c1, 'challengers1', 28, 138, 3, rng, '常规赛'))

      const c2 = makeComp(state, 'challengers2', `Challengers ${region} · 第二赛段`, t2, region, 2)
      state.fixtures.push(...scheduleRegularSeason(c2, 'challengers2', 200, 262, 3, rng, '常规赛'))
    }
  }
  seedMarket(state, notes)
}

const PLAYOFF_CUT: Partial<Record<StageKey, number>> = {
  kickoff: 4, stage1: 8, stage2: 8, challengers1: 4, challengers2: 4,
}

/** Create an international event once its qualifiers are known. */
function createInternational(
  state: GameState, stage: StageKey, name: string, teams: string[], day: number,
): void {
  if (state.comps[stage] || teams.length < 2) return
  const comp = makeComp(state, stage, name, teams)
  state.fixtures.push(...startBracket(comp, teams, stage, day, 3))
  state.news.push({
    day: state.day, kind: 'league', important: true,
    text: `${name} 参赛名单出炉：${teams.map((t) => state.teams[t]?.name).join('、')}。`,
  })
}

function qualifiersFrom(state: GameState, stage: StageKey, perRegion: number): string[] {
  const out: string[] = []
  for (const region of REGIONS) {
    const comp = state.comps[compKey(stage, region)]
    if (comp?.finished.length) out.push(...comp.finished.slice(0, perRegion))
  }
  return out
}

/**
 * Hand out the prizes when a competition ends.
 *
 * The board reacts to how we finished — a bottom-third finish at Masters costs
 * 7 confidence — and that reaction used to happen off-screen: the only line
 * written was who won the thing. Our own finish and what it cost now go into
 * the turn's digest.
 */
export function settleCompetition(state: GameState, comp: Competition, notes: string[] = []): void {
  if (comp.awarded || !comp.champion) return
  comp.awarded = true

  awardPrize(state, comp.stage, comp.finished)

  const pts = CHAMP_POINTS[comp.stage]
  if (pts) {
    comp.finished.forEach((teamId, i) => {
      const t = state.teams[teamId]
      if (t && pts[i]) t.champPoints += pts[i]
    })
  }

  const champ = state.teams[comp.champion]
  state.news.push({
    day: state.day, kind: 'league', important: true,
    text: `🏆 ${champ?.name} 夺得 ${comp.name} 冠军！`,
  })

  if (comp.champion === state.myTeam) {
    state.honours.push({ year: state.year, title: comp.name })
    state.boardConfidence = clamp(state.boardConfidence + 14, 0, 100)
    // A world title paints a target on the club. The league answers: harder
    // training and hungrier recruitment everywhere else, so the second trophy
    // has to be earned against a better world than the first.
    if (!comp.region) {
      state.rivalry = (state.rivalry ?? 0) + 1
      state.news.push({
        day: state.day, kind: 'league', important: true,
        text: `🔥 ${champ?.name} 的 ${comp.name} 冠军震动了各赛区——多家俱乐部宣布加练备战，休赛期引援预计更加激进。`,
      })
    }
    // winning is what actually makes your name
    if (state.manager) {
      const worth = comp.region ? 2.5 : 6   // an international title counts for more
      state.manager.reputation = clamp(state.manager.reputation + damped(state.manager.reputation, worth), 5, 96)
    }
    notes.push(`🏆 我们夺得 ${comp.name} 冠军！`)
  }
  // Sponsorship performance bonuses. Both screens have always printed
  // "前 N 名另奖 $X" on every contract and the engine never read the field —
  // the money simply did not exist. It does now: a regional stage we finish
  // at or above the threshold pays that contract, once per season, so a good
  // split is worth money and a sponsor is worth choosing for its terms.
  // Regional only, or an international run would pay every contract twice.
  if (comp.region && comp.finished.includes(state.myTeam)) {
    const me = state.teams[state.myTeam]
    const place = comp.finished.indexOf(state.myTeam) + 1
    // the best regional finish of the season is what a `placing` clause reads
    state.bestPlacing = Math.min(state.bestPlacing ?? 99, place)
    for (const sp of me?.sponsors ?? []) {
      if (sp.bonusPaidYear === state.year || place > sp.bonusPlacement || !sp.bonus) continue
      sp.bonusPaidYear = state.year
      state.finances.balance += sp.bonus
      state.finances.log.push({
        day: state.day, label: `赞助达标奖 · ${sp.name}（${comp.name} 第 ${place} 名）`, amount: sp.bonus,
      })
      notes.push(`💰 ${sp.name} 的达标奖金 $${sp.bonus.toLocaleString()} 到账——${comp.name} 第 ${place} 名，合同要求前 ${sp.bonusPlacement}。`)
    }
  }
  if (comp.champion !== state.myTeam && comp.teams.includes(state.myTeam)) {
    const place = comp.finished.indexOf(state.myTeam)
    if (place >= 0) {
      const share = place / Math.max(1, comp.finished.length - 1)
      const swing = share < 0.34 ? 5 : share > 0.7 ? -7 : 0
      state.boardConfidence = clamp(state.boardConfidence + swing, 0, 100)
      const rank = `${comp.name} 第 ${place + 1} 名（共 ${comp.finished.length} 队）`
      notes.push(
        swing > 0 ? `🏅 ${rank}，董事会满意（信任 +${swing}）。`
          : swing < 0 ? `📉 ${rank}，董事会不满（信任 ${swing}）。`
            : `🏁 ${rank}。`,
      )
    }
  }
}

/** Move every running competition forward: RR → playoffs → next bracket round. */
function progressCompetitions(state: GameState, notes: string[] = []): void {
  for (const comp of Object.values(state.comps)) {
    if (comp.champion) {
      settleCompetition(state, comp, notes)
      continue
    }
    const own = state.fixtures.filter((f) => f.comp === comp.key)
    const rr = own.filter((f) => !f.label.startsWith('KO:'))
    const ko = own.filter((f) => f.label.startsWith('KO:'))

    if (!comp.bracketStarted) {
      if (!rr.length) continue
      if (rr.some((f) => !f.played)) continue
      const cut = PLAYOFF_CUT[comp.stage] ?? 8
      const table = sortStandings(comp)
      const seeds = table.slice(0, Math.min(cut, table.length))
      // teams that missed the playoffs are already ranked, worst last
      comp.finished = table.slice(seeds.length)
      state.fixtures.push(...startBracket(comp, seeds, comp.stage, state.day + 4, 3))
      state.news.push({
        day: state.day, kind: 'league',
        text: `${comp.name} 常规赛结束，季后赛名单：${seeds.map((s) => state.teams[s]?.name).join('、')}。`,
        important: seeds.includes(state.myTeam),
      })
      continue
    }

    if (ko.length && ko.every((f) => f.played)) {
      const next = advanceBracket(state, comp, state.day + 3, 3)
      state.fixtures.push(...next)
      if (comp.champion) {
        if (comp.teams.includes(state.myTeam)) {
          track('stage_done', {
            stage: comp.stage, day: state.day,
            won: comp.champion === state.myTeam,
            place: comp.finished.indexOf(state.myTeam) + 1,
          })
        }
        settleCompetition(state, comp, notes)
      }
    }
  }

  // international events unlock as their feeder stages conclude
  const kickoffDone = REGIONS.every((r) => state.comps[compKey('kickoff', r)]?.champion)
  if (kickoffDone) createInternational(state, 'masters1', 'Masters I', qualifiersFrom(state, 'kickoff', 2), Math.max(state.day + 3, 66))

  const s1Done = REGIONS.every((r) => state.comps[compKey('stage1', r)]?.champion)
  if (s1Done) createInternational(state, 'masters2', 'Masters II', qualifiersFrom(state, 'stage1', 2), Math.max(state.day + 3, 172))

  const s2Done = REGIONS.every((r) => state.comps[compKey('stage2', r)]?.champion)
  if (s2Done && !state.comps.champions) {
    const field: string[] = []
    for (const region of REGIONS) {
      const ranked = Object.values(state.teams)
        .filter((t) => t.region === region && t.tier === 1)
        .sort((a, b) => b.champPoints - a.champPoints || b.rating - a.rating)
      field.push(...ranked.slice(0, 4).map((t) => t.id))
    }
    createInternational(state, 'champions', 'VALORANT Champions', field, Math.max(state.day + 4, 278))
  }
}

/** Stages the board actually judges you on. */
const JUDGED: StageKey[] = ['kickoff', 'stage1', 'stage2']

/**
 * The competition the managed club is actually in during a judged stage.
 *
 * A Challengers side does not play `stage1:China` — it plays two splits of its
 * own that straddle the tier-1 calendar. The board was setting it a target on
 * the VCT stage anyway and settleObjective then looked up a competition the
 * club is not in, found no placing, and returned. So a tier-2 objective was
 * text that could never be met: confidence could only fall, match by match,
 * with no route back up. Any Questions Gaming improved from rating 62 to 69
 * across three seasons and sat at 5% board confidence the whole way.
 */
function judgedCompKey(state: GameState, stage: StageKey): string | null {
  const me = state.teams[state.myTeam]
  if (!me) return null
  if (me.tier === 1) return `${stage}:${me.region}`
  // the two Challengers splits conclude around Stage 1 and Stage 2
  if (stage === 'stage1') return `challengers1:${me.region}`
  if (stage === 'stage2') return `challengers2:${me.region}`
  return null   // Kickoff has no Challengers equivalent
}

/** Where in its own league does the club sit by strength? */
function expectedPlace(state: GameState): { place: number; size: number } {
  const me = state.teams[state.myTeam]
  const peers = Object.values(state.teams)
    .filter((t) => t.region === me.region && t.tier === me.tier)
    .sort((a, b) => b.rating - a.rating)
  return { place: peers.findIndex((t) => t.id === me.id) + 1, size: peers.length }
}

/**
 * Ask the board what it wants from this stage.
 *
 * The target is pinned to the squad you actually have — a bottom side is asked
 * to survive, a favourite to win it — so overachieving is possible from
 * anywhere and the goal never reads as arbitrary.
 */
function setObjective(state: GameState, notes: string[]): void {
  if (!JUDGED.includes(state.stage) || !judgedCompKey(state, state.stage)) {
    state.objective = undefined
    return
  }
  const { place, size } = expectedPlace(state)
  // What the board asks for has to be reachable with the squad it gave you.
  //
  // It used to demand a 40% improvement on your expected finish every single
  // stage — which for a club expected second meant "win it", forever. Measured
  // over ten careers that got the manager sacked six times in three seasons
  // while averaging third of twelve, which is not a failure by any reading.
  //
  // A favourite is asked to stay a favourite; everyone else is asked for a
  // real but survivable step up. Beating the brief is still what moves your
  // reputation, so there is no less to play for.
  const target = place <= 2
    ? clamp(place, 1, 2)
    : clamp(Math.ceil(place * 0.75), 2, Math.max(1, size - 2))
  const text =
    target === 1 ? '董事会要求：拿下本赛段冠军。'
      : target <= Math.ceil(size / 4) ? `董事会要求：本赛段进入前 ${target} 名。`
        : target <= Math.ceil(size / 2) ? `董事会期望：本赛段打进前 ${target} 名（季后赛区）。`
          : `董事会目标：本赛段不低于第 ${target} 名。`
  state.objective = { stage: state.stage, placeAtLeast: target, text }
  notes.push(text)
  state.news.push({ day: state.day, kind: 'club', important: true, text })
}

/** Judge the stage that just ended, and move board confidence accordingly. */
function settleObjective(state: GameState, endedStage: StageKey, notes: string[]): void {
  const obj = state.objective
  if (!obj || obj.settled || obj.stage !== endedStage) return
  const key = judgedCompKey(state, endedStage)
  const comp = key ? state.comps[key] : undefined
  if (!comp) return

  const order = comp.finished.length ? comp.finished : sortStandings(comp)
  const place = order.indexOf(state.myTeam) + 1
  if (place <= 0) return

  obj.settled = true
  obj.met = place <= obj.placeAtLeast
  // Symmetric around the brief. It used to pay +6 for meeting the target and
  // charge -8 for missing it by a single place, so a club landing on its brief
  // about half the time drifted downward: 0.5*6 + 0.5*-8 = -1 a stage, on top
  // of the -0.1 a .500 record already bleeds match by match. Doing exactly what
  // was asked should not be a slow route to the sack, and it was — a squad
  // trained from 75 to 80 got fired for finishing 8th while a squad left alone
  // sat comfortably at 75% confidence.
  const swing = obj.met
    ? Math.min(16, 6 + (obj.placeAtLeast - place) * 3)
    : -Math.min(18, 2 + (place - obj.placeAtLeast) * 3)
  state.boardConfidence = clamp(state.boardConfidence + swing, 0, 100)
  state.missedStreak = obj.met ? 0 : (state.missedStreak ?? 0) + 1
  // beating the brief moves your standing; missing it costs you a little
  if (state.manager) {
    const growth = state.manager.growth
    const raw = obj.met ? (1 + (obj.placeAtLeast - place) * 0.5) * growth : -1.5
    const delta = raw > 0 ? damped(state.manager.reputation, raw) : raw
    state.manager.reputation = clamp(state.manager.reputation + delta, 5, 96)
  }

  const msg = obj.met
    ? `✅ 赛段目标达成：第 ${place} 名（要求前 ${obj.placeAtLeast}）。董事会满意。`
    : `❌ 赛段目标未达成：第 ${place} 名（要求前 ${obj.placeAtLeast}）。董事会不满。`
  notes.push(msg)
  state.news.push({ day: state.day, kind: 'club', important: true, text: msg })

  judgeTenure(state, place, notes)
}

/**
 * Whether the board keeps us.
 *
 * A career needs a way to end badly or its successes mean nothing. The board
 * warns first — it never fires without having said so — and only acts on a
 * stage boundary, where a verdict belongs.
 */
function judgeTenure(state: GameState, place: number, notes: string[]): void {
  const club = state.teams[state.myTeam]?.name ?? '俱乐部'

  const doomed =
    state.boardConfidence <= 6 ||
    (state.onNotice && (state.missedStreak ?? 0) >= 2) ||
    (state.onNotice && state.boardConfidence <= 18)

  if (doomed && state.onNotice) {
    // Say what actually ended it. There are three routes here and the message
    // only ever described one of them, so a manager fired on a confidence
    // floor was told "连续 1 个赛段没有达成目标" — a sentence that reads as a
    // mistake because a streak of one is not a streak.
    const streak = state.missedStreak ?? 0
    const conf = Math.round(state.boardConfidence)
    const why = streak >= 2
      ? `连续 ${streak} 个赛段没有达成目标，信任度已经跌到 ${conf}%。`
      : `被警告之后又交了一个不合格的赛段（本赛段第 ${place} 名），信任度只剩 ${conf}%。`
    state.gameOver = `${club} 董事会决定解除你的职务。${why}`
    track('sacked', {
      day: state.day, year: state.year, stage: state.stage,
      seasons: state.year - 2026,
      confidence: Math.round(state.boardConfidence),
      honours: state.honours.length,
    })
    notes.push(`🚪 ${state.gameOver}`)
    state.news.push({ day: state.day, kind: 'club', important: true, text: state.gameOver })
    return
  }

  if (!state.onNotice && (state.boardConfidence <= 20 || (state.missedStreak ?? 0) >= 2)) {
    state.onNotice = true
    const warn = `⚠ 董事会正式警告：再有一个赛段交不出成绩，就会换人。（当前信任度 ${Math.round(state.boardConfidence)}%）`
    notes.push(warn)
    state.news.push({ day: state.day, kind: 'club', important: true, text: warn })
    return
  }

  // a good stage buys back some patience
  if (state.onNotice && state.boardConfidence >= 45 && place <= 4) {
    state.onNotice = false
    const ok = '董事会撤回了此前的警告，你暂时坐稳了位置。'
    notes.push(ok)
    state.news.push({ day: state.day, kind: 'club', text: ok })
  }
}

/**
 * Reputation gets harder to earn the more of it you have.
 *
 * Without this a manager who wins one season is already the biggest name in the
 * sport, and every remaining season has nothing left to climb toward.
 */
function damped(current: number, gain: number): number {
  return gain * clamp((96 - current) / 42, 0.12, 1)
}

/**
 * Clubs coming after the manager.
 *
 * This is the reward for a career going well, and the only route to the jobs
 * that were locked at creation: reputation earned by winning opens doors that
 * choosing never could.
 */
function offerJobs(state: GameState, notes: string[]): void {
  const m = state.manager
  if (!m || state.gameOver) return
  state.jobOffers = (state.jobOffers ?? []).filter((o) => o.expiresOn > state.day)

  // a club will not poach a manager their own board just warned
  if (state.onNotice) return
  const rng = new Rng(hashStr(`jobs:${state.seed}:${state.year}:${state.day}`))
  const here = state.teams[state.myTeam]
  if (!here) return

  const candidates = Object.values(state.teams).sort((a, b) => b.reputation - a.reputation)
  for (const t of candidates) {
    if (state.jobOffers.length >= 3) break     // an inbox, not a spreadsheet
    if (t.id === state.myTeam) continue
    if (t.reputation <= here.reputation) continue          // no sideways moves
    if (state.jobOffers.some((o) => o.teamId === t.id)) continue
    // they want someone they can justify hiring
    const reach = m.reputation - t.reputation
    if (reach < -6) continue
    const chance = clamp(0.04 + reach * 0.01 + state.honours.length * 0.015, 0, 0.3)
    if (!rng.chance(chance)) continue

    state.jobOffers.push({
      id: `J${t.id}_${state.day}`,
      teamId: t.id,
      day: state.day,
      expiresOn: state.day + 30,
      pitch: t.tier === 1
        ? `${t.name} 希望你接手一线队，预算 ${Math.round(t.budget / 10000) / 100} 千万级别。`
        : `${t.name} 想请你来重建队伍。`,
    })
    notes.push(`📩 ${t.name} 向你发出了执教邀请。`)
    state.news.push({
      day: state.day, kind: 'club', important: true,
      text: `📩 ${t.name} 向你发出执教邀请（声望 ${t.reputation}）。`,
    })
  }
}

/** Take a job elsewhere. The career continues; the club does not. */
export function acceptJob(state: GameState, offerId: string): string {
  const offer = state.jobOffers?.find((o) => o.id === offerId)
  const to = offer ? state.teams[offer.teamId] : null
  if (!offer || !to) return '这份邀请已经失效。'
  return moveToClub(state, to.id)
}

/**
 * The five who actually played for this club in this fixture.
 *
 * `starters` is the intention; `result.lineups` is what happened. They differ
 * whenever anyone was injured, and the post-match rewards were reading the
 * intention — which is how a man who never left the physio room banked the
 * win bonus.
 */
function played(
  state: GameState, f: Fixture, teamId: string, result: MatchResult,
): string[] {
  const lineup = teamId === f.teamA ? result.lineups?.a : result.lineups?.b
  return lineup ?? state.teams[teamId]?.starters ?? []
}

/** Take over at another club, however the job came about. */
export function moveToClub(state: GameState, teamId: string): string {
  const to = state.teams[teamId]
  if (!to) return '找不到这支球队。'

  const from = state.teams[state.myTeam]
  state.tenures ??= []
  const current = state.tenures.find((t) => t.teamId === state.myTeam && !t.toYear)
  if (current) current.toYear = state.year
  else state.tenures.push({ teamId: state.myTeam, fromYear: 2026, toYear: state.year })
  state.tenures.push({ teamId: to.id, fromYear: state.year })

  state.myTeam = to.id
  // a new squad, and their development starts being yours from today — the
  // stars you walked in on are not something you built
  for (const id of to.roster) {
    const p = state.players[id]
    if (p) p.arrivedOverall = p.overall
  }
  state.jobOffers = []
  state.jobApplications = []
  state.managerContract = undefined
  state.boardConfidence = 62
  state.onNotice = false
  state.missedStreak = 0
  state.objective = undefined
  state.finances = { balance: to.budget, log: [] }
  state.training = {}
  state.drill = { kind: 'none' }
  // ...and everything else that belonged to the old job. A drill lock left
  // running greyed out the new club's training panel for up to a week; a pair
  // drill kept coaching two players who now work somewhere else; and a bid
  // left pending settled later at the OLD club, spending the new club's money
  // to sign a player for the one you just left.
  state.drillLock = undefined
  state.duo = undefined
  state.physioOn = {}
  state.commercialDays = {}
  for (const o of state.offers) {
    if (o.status === 'pending' && (o.toTeam === from?.id || o.fromTeam === from?.id)) {
      o.status = 'rejected'
    }
  }
  state.enquiries = []
  for (const pid of to.roster) state.training[pid] = 'rest'

  state.managerContract = defaultContract(state)
  state.news.push({
    day: state.day, kind: 'club', important: true,
    text: `你离开 ${from?.name} 出任 ${to.name} 的经理。`,
  })
  return `你已就任 ${to.name} 的经理。`
}

export interface DayReport {
  day: number
  stage: StageKey
  stageChanged: boolean
  playedMine: Fixture[]
  notes: string[]
  seasonEnded: boolean
  /** set when the manager's own match was left for them to play */
  pendingMine?: Fixture
}

export interface AdvanceOpts {
  /** hand the manager's own fixture back unplayed so they can watch it */
  deferMine?: boolean
  /**
   * Play scrims automatically instead of handing them over.
   *
   * A scrim booked for tomorrow used to halt a week-long turn on its first day,
   * so the rest of the week — and everything scheduled inside it — never ran
   * until the manager clicked through. Practice matches resolve themselves when
   * a turn covers several days; the scoreboard is still there to open.
   */
  autoScrims?: boolean
}

/** Each fixture gets its own stream, so a result never depends on play order. */
export const fixtureRng = (state: GameState, f: Fixture) =>
  new Rng(hashStr(`match:${state.seed}:${state.year}:${f.id}`))

export const isScrim = (f: Fixture) => f.comp === 'scrim'

/** Apply a result the UI produced, then move the competition forward. */
/**
 * Record a played fixture.
 *
 * `notes` is the turn's digest when time is being advanced. Playing a match
 * live goes through here too, and finishing one can conclude a competition —
 * prize money, championship points and the board's reaction — so the caller is
 * handed those lines rather than having them vanish.
 */
/**
 * How far a practice match alone can take a map, and how soon it starts to
 * teach less. Comfortable, not mastered.
 */
const SCRIM_MAP_CEIL = 80
const SCRIM_MAP_TAPER = 25

export function commitFixture(
  state: GameState, f: Fixture, result: MatchResult, notes: string[] = [],
): void {
  const isMine = f.teamA === state.myTeam || f.teamB === state.myTeam
  if (!isMine) stripRoundLogs(result)
  f.result = result
  f.played = true
  const rng = fixtureRng(state, f)
  // how the dressing room took it, for our club only
  if (isMine) {
    // This block used to declare its own `notes`, shadowing the digest passed
    // in — so every dressing-room consequence of a defeat went to state.news
    // and nowhere else. Measured from the digest, the game looked as though it
    // had no dressing-room incidents at all; it had them, and never said so.
    const room: string[] = []
    const isA = f.teamA === state.myTeam
    const won = (result.mapsWonA > result.mapsWonB) === isA
    trustAfterMatch(state, won, (isA ? result.lineups?.a : result.lineups?.b) ?? [])
    applyMatchBonds(state, result, state.myTeam, isA, rng, room)
    for (const t of room) {
      state.news.push({ day: state.day, kind: 'club', important: true, text: t })
      notes.push(t)
    }

    // A club too short to field five sends out someone who is not fit. The
    // engine has always done this rather than play 4v5; it never mentioned it.
    const played = (isA ? result.lineups?.a : result.lineups?.b) ?? []
    const hurt = played
      .map((id) => state.players[id])
      .filter((p) => p && p.injuredUntil > state.day)
    for (const p of hurt) {
      notes.push(`⚕️ 人手不够，带伤的 ${p.ign} 还是上了场（${p.injuryNote ?? '伤病'}）。`)
    }
  }
  // scrims build form and cost condition but never enter the record books
  if (isScrim(f)) {
    applyMatchFatigue(state, f.teamA, result.maps.length, rng, notes, result.lineups?.a)
    applyMatchFatigue(state, f.teamB, result.maps.length, rng, notes, result.lineups?.b)
    const aWon = result.mapsWonA > result.mapsWonB
    for (const [teamId, won] of [[f.teamA, aWon], [f.teamB, !aWon]] as [string, boolean][]) {
      // whoever actually played, not whoever was nominally a starter: an
      // injured man collected the win's morale from the treatment table while
      // the substitute who played every map got nothing
      for (const pid of played(state, f, teamId, result)) {
        const p = state.players[pid]
        if (!p) continue
        // losing used to average +0.35 form, so a defeat made a player sharper
        p.form = clamp(p.form + (won ? rng.range(0.4, 2.2) : -rng.range(0.4, 2.2)), 30, 99)
        p.morale = clamp(p.morale + (won ? rng.range(0, 2) : -rng.range(0, 1.5)), 10, 100)
      }
    }
    // Practising a map is the reason a scrim is booked on one, and until now
    // it did nothing for that map at all — the panel said so because it was
    // true. Both sides learn, win or lose, and less than a week of the 跑图
    // drill: that costs a whole team-training slot and gives about +2, this
    // costs a day and a squad's condition.
    const scrimMap = f.scrim?.map
    if (scrimMap) {
      for (const teamId of [f.teamA, f.teamB]) {
        const t = state.teams[teamId]
        if (!t) continue
        const before = t.mapPrefs[scrimMap] ?? 50
        // Diminishing, and that is the whole balance of it. A flat gain let a
        // manager book the same map every free day and reach the 95 ceiling
        // inside one season — measured at 293 scrims and +50 — which would
        // have made the 跑图 drill pointless. Practice matches take a map to
        // comfortable; going past that is what the drill and real fixtures
        // are for.
        const room = clamp((SCRIM_MAP_CEIL - before) / SCRIM_MAP_TAPER, 0, 1)
        t.mapPrefs[scrimMap] = clamp(before + rng.range(0.6, 1.0) * room, 0, 95)
        if (teamId === state.myTeam && Math.round(t.mapPrefs[scrimMap]) > Math.round(before)) {
          notes.push(`🗺 ${mapCn(scrimMap)} 熟练度提升到 ${Math.round(t.mapPrefs[scrimMap])}。`)
        }
      }
    }
    if (isMine) state.lastResults.push(f.id)
    state.news.push({
      day: state.day, kind: 'club',
      text: `训练赛｜${state.teams[f.teamA]?.tag} ${result.mapsWonA}-${result.mapsWonB} ${state.teams[f.teamB]?.tag}`,
    })
    return
  }
  applyMatchStats(state, result)
  applyMatchFatigue(state, f.teamA, result.maps.length, rng, notes, result.lineups?.a)
  applyMatchFatigue(state, f.teamB, result.maps.length, rng, notes, result.lineups?.b)

  // A veto and an agent sheet belong to the match they were made for; leaving
  // them behind would silently apply last week's plan to next week's opponent.
  state.vetoPlan = undefined
  state.agentPicks = undefined

  const comp = state.comps[f.comp]
  if (comp && !f.label.startsWith('KO:')) applyResultToStandings(comp, f)

  const aWon = result.mapsWonA > result.mapsWonB
  for (const [teamId, won] of [[f.teamA, aWon], [f.teamB, !aWon]] as [string, boolean][]) {
    for (const pid of played(state, f, teamId, result)) {
      const p = state.players[pid]
      if (p) p.morale = clamp(p.morale + (won ? rng.range(1, 5) : -rng.range(1, 5)), 10, 100)
    }
  }

  if (isMine) {
    state.lastResults.push(f.id)
    const mine = f.teamA === state.myTeam
    const myWin = mine ? aWon : !aWon
    state.boardConfidence = clamp(state.boardConfidence + (myWin ? 1.2 : -1.4), 0, 100)
  }

  state.news.push({
    day: state.day,
    kind: 'match',
    // a scoreline is the densest thing in the feed; the tags are what people
    // read anyway, and the competition name already says where it happened
    text: `${comp?.name ?? f.comp}｜${state.teams[f.teamA]?.tag} ${result.mapsWonA}-${result.mapsWonB} ${state.teams[f.teamB]?.tag}`,
    important: isMine,
  })
  progressCompetitions(state, notes)
}

export function advanceDay(state: GameState, opts: AdvanceOpts = {}): DayReport {
  // A career that has ended does not keep going. The sack screen has no close
  // button so a person cannot click past it, but nothing in the engine said so:
  // driven any other way the clock ran on for another season and a half,
  // collecting honours and a promotion for a manager who had been dismissed —
  // and autosaving that state over the record of the career.
  if (state.gameOver) {
    return {
      day: state.day, stage: state.stage, stageChanged: false,
      playedMine: [], notes: [], seasonEnded: false,
    }
  }
  const rng = new Rng(hashStr(`day:${state.seed}:${state.year}:${state.day}`))
  const prevStage = state.stage
  state.day++

  const notes: string[] = []
  const playedMine: Fixture[] = []
  state.lastResults = []

  // Going down was announced; coming back never was. A player simply became
  // selectable again at some point and you found out by opening the squad
  // screen — which is precisely the day you would want to change your five.
  for (const pid of state.teams[state.myTeam]?.roster ?? []) {
    const p = state.players[pid]
    if (p && p.injuredUntil === state.day) {
      notes.push(`⚕️ ${p.ign} 已康复，可以重新出场。`)
      p.injuryNote = undefined
    }
  }

  dailyLife(state, notes)

  state.stage = stageAt(state.day)
  const stageChanged = state.stage !== prevStage
  if (stageChanged) {
    notes.push(`—— 进入 ${stageName(state.stage)} ——`)
    settleObjective(state, prevStage, notes)
    setObjective(state, notes)
    offerJobs(state, notes)
  }

  // ---- play today's matches
  let pendingMine: Fixture | undefined
  // Anything still unplayed from an earlier day is played now, oldest first.
  // The filter used to be an exact `=== state.day`: a match handed to the
  // manager to watch was written to the autosave as unplayed, and if the page
  // vanished before the modal resolved (a phone reclaiming the tab), the day
  // moved on and that fixture was never eligible again — the whole
  // competition sat waiting for a result that could not arrive.
  const today = state.fixtures
    .filter((f) => f.day <= state.day && !f.played)
    .sort((a, b) => a.day - b.day)
  for (const f of today) {
    const a = state.teams[f.teamA]
    const b = state.teams[f.teamB]
    if (!a || !b) {
      f.played = true
      continue
    }
    const isMine = f.teamA === state.myTeam || f.teamB === state.myTeam
    if (isMine && opts.deferMine && !pendingMine && !(opts.autoScrims && isScrim(f))) {
      // leave it for the manager to watch or skip
      pendingMine = f
      continue
    }
    const result = simulateMatch(state, f.teamA, f.teamB, f.bo, fixtureRng(state, f), f.scrim)
    commitFixture(state, f, result, notes)
    if (isMine) playedMine.push(f)
  }

  if (!pendingMine) progressCompetitions(state, notes)

  // ---- commercial work booked for today, then any new approach
  runGigsToday(state, notes)
  offerGigs(state, rng, notes)
  notes.push(...resolveSponsorTalks(state, rng))
  drillTick(state, rng, notes)
  pruneMatchDetail(state)

  // ---- coaches and clubs answering today
  notes.push(...resolveApproaches(state, rng))
  notes.push(...resolveStaffOffers(state, rng))
  notes.push(...resolveApplications(state, rng))

  // ---- offers whose waiting period is up
  notes.push(...resolveEnquiries(state, rng))
  notes.push(...resolveDueOffers(state, rng))

  // ---- weekly upkeep
  if (state.day % 7 === 0) {
    streamWeek(state, rng, notes)
    notes.push(...weeklyTick(state, rng))
    weeklyLife(state, rng, notes)
    weeklyFinance(state)
    aiTransferTick(state, rng, notes)
    refreshListings(state, rng, notes)   // runs all year so stale listings expire
    ensureMinimumRosters(state, rng)
  }

  if (state.news.length > 400) state.news.splice(0, state.news.length - 400)

  let seasonEnded = false
  if (state.day >= SEASON_DAYS) {
    notes.push(`—— ${state.year} 赛季结束 ——`)
    endSeason(state, rng, notes)
    seasonEnded = true
  }

  return { day: state.day, stage: state.stage, stageChanged, playedMine, notes, seasonEnded, pendingMine }
}

/**
 * Promotion, contracts, ageing, then a fresh calendar.
 *
 * `notes` is the turn's digest. The off-season is the single biggest thing
 * that happens to a squad without the manager doing anything — players age,
 * develop, decline, run down their deals and retire — and all of it used to
 * happen in silence: seasonRollover built its 📈/📉 lines and the return value
 * was dropped on the floor. Everything here that lands on the managed club
 * goes into the digest, so the season turns over in front of you.
 */
function endSeason(state: GameState, rng: Rng, notes: string[] = []): void {
  // Ten seasons is the whole story: 2036 is the last campaign played, and when
  // it is settled the career ends on its own terms rather than running on until
  // somebody is sacked.
  //
  // This has to come FIRST, before a single line of the off-season runs. The
  // check used to sit at the bottom, and by the time it was reached every
  // expiring contract had already been let go, the retirements had already
  // happened and ensureMinimumRosters had reshuffled the league — so the
  // endings were judging a squad that had just been dissolved. 「一起走到最后」
  // was decided after the men in question had walked out the door on the same
  // afternoon, and 「本土主义」 came free to anyone left with three players.
  // There is no 2037 to prepare for, so none of that should happen at all: the
  // record ends with the last season, and the last season's squad is the one
  // that gets judged.
  if (state.year >= FINAL_YEAR) {
    const earned = endingsFor(state)
    state.finished = true
    state.gameOver = earned[0]
      ? `十年任期结束——${earned[0].title}`
      : '十年任期结束。'
    notes.push(`🏁 ${state.gameOver}`)
    state.news.push({ day: state.day, kind: 'club', important: true, text: state.gameOver })
    return
  }

  // ---- Ascension: each region's Challengers champion swaps with the weakest tier-1 side
  for (const region of REGIONS) {
    const chal = state.comps[compKey('challengers2', region)]
    const promoted = chal?.champion ? state.teams[chal.champion] : null
    if (!promoted) continue
    const relegated = Object.values(state.teams)
      .filter((t) => t.region === region && t.tier === 1)
      .sort((a, b) => a.champPoints - b.champPoints || a.rating - b.rating)[0]
    if (!relegated || relegated.id === promoted.id) continue

    promoted.tier = 1
    promoted.league = `VCT ${region}`
    relegated.tier = 2
    relegated.league = `Challengers ${region}`

    // Sponsorship follows the league you play in. Without this a promoted club
    // kept its Challengers deals and picked up VCT running costs the same
    // week — M80 went up and was insolvent two seasons later no matter what
    // the manager did. Going up is a windfall and coming down is a cliff, and
    // both are things a manager should be told rather than discover.
    const reprice = (t: Team, factor: number) => {
      for (const sp of t.sponsors) {
        sp.perSeason = Math.round(sp.perSeason * factor)
        sp.bonus = Math.round(sp.bonus * factor)
      }
    }
    // Priced off what a sponsorship in each league is actually worth rather
    // than a flat guess. A flat 2.5x left promoted clubs structurally
    // insolvent — around $700k of sponsorship against $926k of VCT running
    // costs before a single wage — and 25 of 36 AI promotions measured over
    // four seasons ended up in the red and out of the transfer market.
    const step = sponsorWorth({ ...promoted, tier: 1 } as Team) /
      Math.max(1, sponsorWorth({ ...promoted, tier: 2 } as Team))
    reprice(promoted, step)
    reprice(relegated, 1 / step)
    if (promoted.id === state.myTeam) {
      notes.push('💰 升入一级联赛后，赞助合同全部重新议价，收入大幅提高。')
    }
    if (relegated.id === state.myTeam) {
      notes.push('📉 降级后赞助合同被重新议价，赛季收入大幅缩水——先把薪资压下来。')
    }
    state.news.push({
      day: state.day, kind: 'league', important: true,
      text: `🎫 ${promoted.name} 通过 Ascension 升入 VCT ${region}，${relegated.name} 降入次级联赛。`,
    })
    if (promoted.id === state.myTeam) state.honours.push({ year: state.year, title: `晋级 VCT ${region}` })
    if (promoted.id === state.myTeam) notes.push(`🎫 我们通过 Ascension 升入 VCT ${region}。`)
    if (relegated.id === state.myTeam) notes.push(`🎫 我们降入 Challengers ${region}。`)
  }

  // ---- contracts tick down; expiring players leave
  const finalYear: string[] = []
  const released: string[] = []
  for (const p of Object.values(state.players)) {
    if (!p.teamId) continue
    const mine = p.teamId === state.myTeam
    p.contractYears -= 1
    // a deal running down is the thing a manager most needs warning about, and
    // it happened silently: one year quietly became zero over the winter
    if (mine && p.contractYears === 1) finalYear.push(p.ign)
    if (p.contractYears <= 0) {
      const team = state.teams[p.teamId]
      // clubs usually renew players they still rate
      const keep = p.overall >= (team?.rating ?? 60) - 6 && rng.chance(0.72)
      if (keep && team && team.id !== state.myTeam) {
        p.contractYears = contractLength(p, rng, team.roster.map((id) => state.players[id]))
      } else if (team && team.id === state.myTeam) {
        // One winter of grace, then he actually goes. It used to be an
        // unlimited stay: the agenda warned every single day that he would
        // leave if not renewed, and he never did — he simply drew wages
        // forever on a contract that had run out.
        if (p.expiredYear != null && p.expiredYear < state.year) {
          team.roster = team.roster.filter((id) => id !== p.id)
          team.starters = team.starters.filter((id) => id !== p.id)
          p.teamId = null
          p.expiredYear = undefined
          state.news.push({
            day: state.day, kind: 'club', important: true,
            text: `👋 ${p.ign} 的合同到期满一年未续约，已经离队。`,
          })
          notes.push(`👋 ${p.ign} 合同到期一年未续，已自由转会离队。`)
        } else {
          p.expiredYear ??= state.year
          state.news.push({
            day: state.day, kind: 'club', important: true,
            text: `⏳ ${p.ign} 的合同已到期，本赛季内必须续约，否则下个休赛期他会走。`,
          })
          notes.push(`⏳ ${p.ign} 的合同已到期——这是最后一个赛季，不续约他就走了。`)
          p.contractYears = 0
        }
      } else if (team) {
        team.roster = team.roster.filter((id) => id !== p.id)
        team.starters = team.starters.filter((id) => id !== p.id)
        p.teamId = null
        // one batched line, not one per man: a winter shakes dozens loose
        released.push(`${p.ign}（${team.tag}）`)
      }
    }
  }

  if (released.length) {
    state.news.push({
      day: state.day, kind: 'transfer',
      text: `合同到期成为自由人：${released.slice(0, 8).join('、')}`
        + (released.length > 8 ? ` 等 ${released.length} 人` : '') + '。',
    })
  }

  if (finalYear.length) {
    notes.push(`📋 合同进入最后一年：${finalYear.slice(0, 6).join('、')}`
      + (finalYear.length > 6 ? ` 等 ${finalYear.length} 人` : ''))
  }

  track('season_done', {
    year: state.year, seasons: state.year - 2026 + 1,
    honours: state.honours.length,
    confidence: Math.round(state.boardConfidence),
  })
  // clauses are judged on the season that just ended, before the counters reset
  notes.push(...settleSponsorDemands(state))
  // and a new intake arrives, so a career that runs long still has somebody
  // to sign and somebody to develop
  notes.push(...admitProspects(state, rng))
  state.seasonGigs = 0
  state.bestPlacing = undefined
  notes.push(...seasonRollover(state, rng))

  // ---- retirements. With no invented prospects backfilling the pool these are
  // kept conservative, so a career stays playable for many seasons.
  for (const p of Object.values(state.players)) {
    const retireP = p.age >= 34 ? 0.45 : p.age >= 32 ? 0.2 : p.age >= 30 ? 0.06 : 0
    if (retireP && rng.chance(retireP)) {
      if (p.teamId) {
        const t = state.teams[p.teamId]
        if (t) {
          t.roster = t.roster.filter((id) => id !== p.id)
          t.starters = t.starters.filter((id) => id !== p.id)
        }
        if (p.teamId === state.myTeam) {
          state.news.push({ day: state.day, kind: 'player', important: true, text: `👋 ${p.ign} 宣布退役。` })
          notes.push(`👋 ${p.ign} 宣布退役，${p.age} 岁。`)
        }
      }
      delete state.players[p.id]
    }
  }
  ensureMinimumRosters(state, rng)

  // ---- team ratings follow the squads they now have
  for (const t of Object.values(state.teams)) {
    const squad = t.roster.map((id) => state.players[id]).filter(Boolean)
    if (squad.length) {
      const top5 = squad.sort((a, b) => b!.overall - a!.overall).slice(0, 5)
      t.rating = Math.round(top5.reduce((s, p) => s + p!.overall, 0) / top5.length)
    }
    t.champPoints = 0
    t.seasonPrize = 0
    // a new season, a new chance to hit the placement each contract asks for
    for (const sp of t.sponsors) delete sp.bonusPaidYear
    if (t.starters.length < 5) t.starters = autoStarters(state, t.id)
  }

  rebaseSeasonClock(state, state.day)

  state.year += 1
  state.day = 0
  state.stage = 'preseason'
  setupSeason(state, notes)
}

/**
 * Shift every forward-looking timer back with the calendar.
 *
 * The rollover sets `day = 0`, but everything scheduled against the old
 * calendar used to keep its absolute number — so a sponsor-pitch cooldown of
 * "day + 14" written on day 310 became "324 days from now", a pending transfer
 * bid was answered eleven months late, and an injury due to heal on day 340
 * kept a player out for a second full season. A fourteen-day wait that spans
 * New Year is still a fourteen-day wait.
 *
 * Deadlines are shifted, not clamped: a reply due on day 340 is due on day 4
 * of the new season, and a record made on day 300 lands at -36, which keeps
 * every "days since" comparison honest about how long ago it really was.
 * History — news, activity, the finance log — is left alone: those entries
 * describe last season and should not be re-dated into this one.
 */
function rebaseSeasonClock(state: GameState, shift: number): void {
  if (shift <= 0) return
  const move = (v: number | undefined): number | undefined =>
    v == null ? v : v - shift

  if (state.pitchCooldown != null) state.pitchCooldown = Math.max(0, state.pitchCooldown - shift)
  if (state.drillLock != null) state.drillLock = Math.max(0, state.drillLock - shift)
  // physio bookings live in the past; left unshifted, "day - last" went
  // negative after the new year and locked the whole squad out of the physio
  // room for a season ("理疗室不能点了")
  if (state.physioOn) {
    for (const k of Object.keys(state.physioOn)) state.physioOn[k] -= shift
  }
  // the turn budget re-mints itself whenever its day is in the future or past
  state.actions = undefined

  for (const p of Object.values(state.players)) {
    if (p.injuredUntil > 0) p.injuredUntil = Math.max(0, p.injuredUntil - shift)
    if (p.listedOn != null) p.listedOn = move(p.listedOn)
    if (p.payAskedOn != null) p.payAskedOn = move(p.payAskedOn)
    if (p.rumourOn != null) p.rumourOn = move(p.rumourOn)
    if (p.stream) {
      p.stream.since -= shift
      p.stream.until -= shift
    }
  }

  for (const o of state.offers) {
    o.day -= shift
    if (o.respondOn != null) o.respondOn -= shift
  }
  for (const e of state.enquiries ?? []) { e.day -= shift; e.replyOn -= shift }
  for (const j of state.jobOffers ?? []) { j.day -= shift; j.expiresOn -= shift }
  for (const a of state.jobApplications ?? []) { a.day -= shift; a.replyOn -= shift }
  for (const o of state.staffOffers ?? []) { o.day -= shift; o.replyOn -= shift }
  for (const a of state.staffApproaches ?? []) { a.day -= shift; a.replyOn -= shift }
  for (const t of state.sponsorTalks ?? []) { t.day -= shift; t.replyOn -= shift }
  for (const g of state.gigs ?? []) {
    g.day -= shift
    g.expiresOn -= shift
    if (g.windowEnd != null) g.windowEnd -= shift
  }
  for (const v of state.ventures ?? []) v.day -= shift
}

/**
 * Keep AI clubs at five players by signing from the free-agent pool.
 *
 * Every person in this game is a real player, so nothing is invented here: if
 * the market is empty a club simply runs short and the shortage is reported,
 * rather than conjuring a fictional prospect to paper over it.
 */
/** Give the market a starting state, so the first window is not empty. */
export function seedMarket(state: GameState, notes?: string[]): void {
  refreshListings(state, new Rng(hashStr(`market:${state.seed}:${state.year}`)), notes)
}

export function ensureMinimumRosters(state: GameState, rng: Rng): void {
  const short: string[] = []
  for (const team of Object.values(state.teams)) {
    if (team.id === state.myTeam) continue
    let guard = 0
    while (team.roster.length < 5 && guard++ < 10) {
      const free = Object.values(state.players).filter((p) => p.teamId === null)
      // under the import rule a club refills from its own region first;
      // fielding five still outranks the rule when the pool runs dry
      const legal = free.filter((p) => !importBlock(state, team.id, p))
      const target = (legal.length ? legal : free)
        .sort(
          (a, b) =>
            b.overall + (b.region === team.region ? 6 : 0) -
            (a.overall + (a.region === team.region ? 6 : 0)),
        )[0]
      if (!target) break
      target.teamId = team.id
      target.contractYears = contractLength(target, rng, team.roster.map((id) => state.players[id]))
      target.salary = expectedSalary(target, team.tier)
      team.roster.push(target.id)
      // offseason emergency signings go on the record like any other move
      state.news.push({
        day: state.day, kind: 'transfer',
        text: `${team.name} 免费签下自由人 ${target.ign}（${target.overall}）。`,
      })
    }
    if (team.roster.length < 5) short.push(team.name)
    // expiries and retirements can walk a club's caller out the door too
    ensureCaller(state, team.id)
    if (team.starters.length < 5) team.starters = autoStarters(state, team.id)
  }
  if (short.length) {
    state.news.push({
      day: state.day, kind: 'system',
      text: `自由市场已无可签选手，以下战队人数不足：${short.slice(0, 6).join('、')}。`,
    })
  }
}

/** Next unplayed fixture for a club. */
export const nextFixtureFor = (state: GameState, teamId: string): Fixture | undefined =>
  state.fixtures
    .filter((f) => !f.played && (f.teamA === teamId || f.teamB === teamId))
    .sort((a, b) => a.day - b.day)[0]

/**
 * The next match that counts.
 *
 * A booked scrim used to replace the league fixture everywhere it was shown,
 * so the one thing a manager always wants in view — when do we next play for
 * real — kept disappearing behind a friendly.
 */
export const nextRealFixtureFor = (state: GameState, teamId: string): Fixture | undefined =>
  state.fixtures
    .filter((f) => !f.played && !isScrim(f) && (f.teamA === teamId || f.teamB === teamId))
    .sort((a, b) => a.day - b.day)[0]

export const nextScrimFor = (state: GameState, teamId: string): Fixture | undefined =>
  state.fixtures
    .filter((f) => !f.played && isScrim(f) && (f.teamA === teamId || f.teamB === teamId))
    .sort((a, b) => a.day - b.day)[0]

/** Matches we have played, most recent first — scrims included. */
export const recentResultsFor = (state: GameState, teamId: string, n = 6): Fixture[] =>
  state.fixtures
    .filter((f) => f.result && (f.teamA === teamId || f.teamB === teamId))
    .sort((a, b) => b.day - a.day)
    .slice(0, n)

export const fixturesFor = (state: GameState, teamId: string): Fixture[] =>
  state.fixtures
    .filter((f) => f.teamA === teamId || f.teamB === teamId)
    .sort((a, b) => a.day - b.day)

/** Fast-forward until something the manager should look at happens. */
export function advanceToNextMatch(
  state: GameState, maxDays = 40, opts: AdvanceOpts = {},
): DayReport[] {
  const reports: DayReport[] = []
  for (let i = 0; i < maxDays; i++) {
    const r = advanceDay(state, opts)
    reports.push(r)
    if (r.playedMine.length || r.pendingMine || r.seasonEnded) break
    const next = nextFixtureFor(state, state.myTeam)
    if (next && next.day === state.day + 1) break
  }
  return reports
}

/** A scrim is arranged, not drawn: you name the opponent, the map and the format. */
export type ScrimFormat = 'first13' | 'full24'

/**
 * Would this club take the practice?
 *
 * Clubs about to face us competitively will not show their hand, and a side far
 * above us has nothing to gain from the session.
 */
export function scrimReply(
  state: GameState, oppId: string,
): { ok: boolean; reason?: string } {
  const opp = state.teams[oppId]
  const me = state.teams[state.myTeam]
  if (!opp || !me) return { ok: false, reason: '对手不存在。' }

  const soon = state.fixtures.some(
    (f) => !f.played && f.comp !== 'scrim' && f.day - state.day <= 10 &&
      ((f.teamA === state.myTeam && f.teamB === oppId) ||
       (f.teamB === state.myTeam && f.teamA === oppId)),
  )
  if (soon) return { ok: false, reason: `${opp.name} 很快要和我们打正赛，不想提前暴露战术。` }

  const gap = opp.rating - me.rating
  const rng = new Rng(hashStr(`scrim:${state.seed}:${state.day}:${oppId}`))
  if (gap >= 10 && rng.chance(0.55 + (gap - 10) * 0.03)) {
    return { ok: false, reason: `${opp.name} 认为和我们打收益不大，婉拒了。` }
  }
  if (rng.chance(0.12)) return { ok: false, reason: `${opp.name} 这几天的训练安排已经排满了。` }
  return { ok: true }
}

export function makeScrim(
  state: GameState, oppId: string, day: number, map: string, format: ScrimFormat,
): Fixture {
  const f = makeFixture(day, state.stage, 'scrim', state.myTeam, oppId, 1, '训练赛')
  f.scrim = { map, format }
  state.fixtures.push(f)
  return f
}
