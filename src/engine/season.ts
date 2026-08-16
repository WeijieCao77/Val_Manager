import { Rng, clamp, hashStr } from './rng'
import { applyMatchStats, simulateMatch, stripRoundLogs } from './match'
import type { MatchResult } from './types'
import {
  CHAMP_POINTS, advanceBracket, applyResultToStandings, makeFixture, newStandings,
  resetFixtureSeq, scheduleRegularSeason, sortStandings, startBracket,
} from './league'
import { awardPrize, weeklyFinance } from './finance'
import { aiTransferTick, refreshListings, resolveDueOffers, resolveEnquiries } from './transfer'
import { offerGigs, runGigsToday, streamWeek } from './commercial'
import { applyMatchBonds } from './bonds'
import { trustAfterMatch } from './trust'
import { resolveApproaches, resolveStaffOffers } from './staff'
import { defaultContract, resolveApplications } from './career'
import { applyMatchFatigue, seasonRollover, weeklyTick } from './training'
import { autoStarters } from './world'
import { expectedSalary } from './player'
import { REGIONS } from './types'
import type { Competition, Fixture, GameState, Region, StageKey, Tier } from './types'

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
export function setupSeason(state: GameState): void {
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
  seedMarket(state)
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

/** Prize money, championship points, honours and headlines for a finished event. */
function settleCompetition(state: GameState, comp: Competition): void {
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
    // winning is what actually makes your name
    if (state.manager) {
      const worth = comp.region ? 2.5 : 6   // an international title counts for more
      state.manager.reputation = clamp(state.manager.reputation + damped(state.manager.reputation, worth), 5, 96)
    }
  } else if (comp.teams.includes(state.myTeam)) {
    const place = comp.finished.indexOf(state.myTeam)
    if (place >= 0) {
      const share = place / Math.max(1, comp.finished.length - 1)
      state.boardConfidence = clamp(state.boardConfidence + (share < 0.34 ? 5 : share > 0.7 ? -7 : 0), 0, 100)
    }
  }
}

/** Move every running competition forward: RR → playoffs → next bracket round. */
function progressCompetitions(state: GameState): void {
  for (const comp of Object.values(state.comps)) {
    if (comp.champion) {
      settleCompetition(state, comp)
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
      if (comp.champion) settleCompetition(state, comp)
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
  if (!JUDGED.includes(state.stage)) {
    state.objective = undefined
    return
  }
  const { place, size } = expectedPlace(state)
  // Ask for a real improvement rather than "one better than last". A bottom
  // club told to finish above 11th of 12 has been asked for nothing, which is
  // why the board could never justify acting.
  const target = clamp(Math.round(place * 0.6), 1, Math.max(1, size - 2))
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
  const comp = state.comps[`${endedStage}:${state.teams[state.myTeam]?.region}`]
  if (!comp) return

  const order = comp.finished.length ? comp.finished : sortStandings(comp)
  const place = order.indexOf(state.myTeam) + 1
  if (place <= 0) return

  obj.settled = true
  obj.met = place <= obj.placeAtLeast
  const swing = obj.met
    ? Math.min(16, 6 + (obj.placeAtLeast - place) * 3)
    : -Math.min(18, 5 + (place - obj.placeAtLeast) * 3)
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
    state.gameOver =
      `${club} 董事会决定解除你的职务。` +
      `连续 ${state.missedStreak ?? 0} 个赛段没有达成目标，信任度已经跌到 ${Math.round(state.boardConfidence)}%。`
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
}

/** Each fixture gets its own stream, so a result never depends on play order. */
export const fixtureRng = (state: GameState, f: Fixture) =>
  new Rng(hashStr(`match:${state.seed}:${state.year}:${f.id}`))

export const isScrim = (f: Fixture) => f.comp === 'scrim'

/** Apply a result the UI produced, then move the competition forward. */
export function commitFixture(state: GameState, f: Fixture, result: MatchResult): void {
  const isMine = f.teamA === state.myTeam || f.teamB === state.myTeam
  if (!isMine) stripRoundLogs(result)
  f.result = result
  f.played = true
  const rng = fixtureRng(state, f)
  // how the dressing room took it, for our club only
  if (isMine) {
    const notes: string[] = []
    const isA = f.teamA === state.myTeam
    const won = (result.mapsWonA > result.mapsWonB) === isA
    trustAfterMatch(state, won, (isA ? result.lineups?.a : result.lineups?.b) ?? [])
    applyMatchBonds(state, result, state.myTeam, isA, rng, notes)
    for (const t of notes) {
      state.news.push({ day: state.day, kind: 'club', important: true, text: t })
    }
  }
  // scrims build form and cost condition but never enter the record books
  if (isScrim(f)) {
    applyMatchFatigue(state, f.teamA, result.maps.length, rng)
    applyMatchFatigue(state, f.teamB, result.maps.length, rng)
    const aWon = result.mapsWonA > result.mapsWonB
    for (const [teamId, won] of [[f.teamA, aWon], [f.teamB, !aWon]] as [string, boolean][]) {
      for (const pid of state.teams[teamId]?.starters ?? []) {
        const p = state.players[pid]
        if (!p) continue
        p.form = clamp(p.form + (won ? rng.range(0.5, 2.5) : rng.range(-0.5, 1.2)), 30, 99)
        p.morale = clamp(p.morale + (won ? rng.range(0, 2) : -rng.range(0, 1.5)), 10, 100)
      }
    }
    if (isMine) state.lastResults.push(f.id)
    state.news.push({
      day: state.day, kind: 'club',
      text: `训练赛｜${state.teams[f.teamA]?.name} ${result.mapsWonA}-${result.mapsWonB} ${state.teams[f.teamB]?.name}`,
    })
    return
  }
  applyMatchStats(state, result)
  applyMatchFatigue(state, f.teamA, result.maps.length, rng)
  applyMatchFatigue(state, f.teamB, result.maps.length, rng)

  const comp = state.comps[f.comp]
  if (comp && !f.label.startsWith('KO:')) applyResultToStandings(comp, f)

  const aWon = result.mapsWonA > result.mapsWonB
  for (const [teamId, won] of [[f.teamA, aWon], [f.teamB, !aWon]] as [string, boolean][]) {
    for (const pid of state.teams[teamId]?.starters ?? []) {
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
    text: `${comp?.name ?? f.comp}｜${state.teams[f.teamA]?.name} ${result.mapsWonA}-${result.mapsWonB} ${state.teams[f.teamB]?.name}`,
    important: isMine,
  })
  progressCompetitions(state)
}

export function advanceDay(state: GameState, opts: AdvanceOpts = {}): DayReport {
  const rng = new Rng(hashStr(`day:${state.seed}:${state.year}:${state.day}`))
  const prevStage = state.stage
  state.day++

  const notes: string[] = []
  const playedMine: Fixture[] = []
  state.lastResults = []

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
  const today = state.fixtures.filter((f) => f.day === state.day && !f.played)
  for (const f of today) {
    const a = state.teams[f.teamA]
    const b = state.teams[f.teamB]
    if (!a || !b) {
      f.played = true
      continue
    }
    const isMine = f.teamA === state.myTeam || f.teamB === state.myTeam
    if (isMine && opts.deferMine && !pendingMine) {
      // leave it for the manager to watch or skip
      pendingMine = f
      continue
    }
    const result = simulateMatch(state, f.teamA, f.teamB, f.bo, fixtureRng(state, f), f.scrim)
    commitFixture(state, f, result)
    if (isMine) playedMine.push(f)
  }

  if (!pendingMine) progressCompetitions(state)

  // ---- commercial work booked for today, then any new approach
  runGigsToday(state, notes)
  offerGigs(state, rng, notes)

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
    weeklyFinance(state)
    aiTransferTick(state, rng)
    refreshListings(state, rng)   // runs all year so stale listings expire
    ensureMinimumRosters(state, rng)
  }

  if (state.news.length > 400) state.news.splice(0, state.news.length - 400)

  let seasonEnded = false
  if (state.day >= SEASON_DAYS) {
    endSeason(state, rng)
    notes.push(`—— ${state.year} 赛季结束 ——`)
    seasonEnded = true
  }

  return { day: state.day, stage: state.stage, stageChanged, playedMine, notes, seasonEnded, pendingMine }
}

/** Promotion, contracts, ageing, then a fresh calendar. */
function endSeason(state: GameState, rng: Rng): void {
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
    state.news.push({
      day: state.day, kind: 'league', important: true,
      text: `🎫 ${promoted.name} 通过 Ascension 升入 VCT ${region}，${relegated.name} 降入次级联赛。`,
    })
    if (promoted.id === state.myTeam) state.honours.push({ year: state.year, title: `晋级 VCT ${region}` })
  }

  // ---- contracts tick down; expiring players leave
  for (const p of Object.values(state.players)) {
    if (!p.teamId) continue
    p.contractYears -= 1
    if (p.contractYears <= 0) {
      const team = state.teams[p.teamId]
      // clubs usually renew players they still rate
      const keep = p.overall >= (team?.rating ?? 60) - 6 && rng.chance(0.72)
      if (keep && team && team.id !== state.myTeam) {
        p.contractYears = rng.int(1, 3)
      } else if (team && team.id === state.myTeam) {
        state.news.push({
          day: state.day, kind: 'club', important: true,
          text: `⏳ ${p.ign} 的合同已到期，需要在休赛期内续约或放走。`,
        })
        p.contractYears = 0
      } else if (team) {
        team.roster = team.roster.filter((id) => id !== p.id)
        team.starters = team.starters.filter((id) => id !== p.id)
        p.teamId = null
      }
    }
  }

  seasonRollover(state, rng)

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
    if (t.starters.length < 5) t.starters = autoStarters(state, t.id)
  }

  state.year += 1
  state.day = 0
  state.stage = 'preseason'
  setupSeason(state)
}

/**
 * Keep AI clubs at five players by signing from the free-agent pool.
 *
 * Every person in this game is a real player, so nothing is invented here: if
 * the market is empty a club simply runs short and the shortage is reported,
 * rather than conjuring a fictional prospect to paper over it.
 */
/** Give the market a starting state, so the first window is not empty. */
export function seedMarket(state: GameState): void {
  refreshListings(state, new Rng(hashStr(`market:${state.seed}:${state.year}`)))
}

export function ensureMinimumRosters(state: GameState, rng: Rng): void {
  const short: string[] = []
  for (const team of Object.values(state.teams)) {
    if (team.id === state.myTeam) continue
    let guard = 0
    while (team.roster.length < 5 && guard++ < 10) {
      const target = Object.values(state.players)
        .filter((p) => p.teamId === null)
        .sort(
          (a, b) =>
            b.overall + (b.region === team.region ? 6 : 0) -
            (a.overall + (a.region === team.region ? 6 : 0)),
        )[0]
      if (!target) break
      target.teamId = team.id
      target.contractYears = rng.int(1, 3)
      target.salary = expectedSalary(target, team.tier)
      team.roster.push(target.id)
    }
    if (team.roster.length < 5) short.push(team.name)
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
