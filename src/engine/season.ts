import { Rng, clamp, hashStr } from './rng'
import { applyMatchStats, simulateMatch, stripRoundLogs } from './match'
import {
  CHAMP_POINTS, advanceBracket, applyResultToStandings, makeFixture, newStandings,
  resetFixtureSeq, scheduleRegularSeason, sortStandings, startBracket,
} from './league'
import { awardPrize, weeklyFinance } from './finance'
import { aiTransferTick } from './transfer'
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
  resetFixtureSeq(0)
  state.fixtures = []
  state.comps = {}
  const rng = new Rng(hashStr(`season:${state.seed}:${state.year}`))

  for (const region of REGIONS) {
    const t1 = tier1Of(state, region)
    const t2 = tier2Of(state, region)

    // ---- Kickoff: straight knockout, top seeds get a bye
    const kc = makeComp(state, 'kickoff', `${region} Kickoff`, t1, region, 1)
    state.fixtures.push(...startBracket(kc, t1, 'kickoff', 24, 3))

    // ---- Stage 1 & Stage 2: full round robin, playoffs seeded from the table
    const s1 = makeComp(state, 'stage1', `VCT ${region} · Stage 1`, t1, region, 1)
    state.fixtures.push(...scheduleRegularSeason(s1, 'stage1', 90, 158, 3, rng))

    const s2 = makeComp(state, 'stage2', `VCT ${region} · Stage 2`, t1, region, 1)
    state.fixtures.push(...scheduleRegularSeason(s2, 'stage2', 196, 264, 3, rng))

    // ---- Challengers: two splits, running alongside the tier-1 calendar
    if (t2.length >= 4) {
      const c1 = makeComp(state, 'challengers1', `Challengers ${region} · 第一赛段`, t2, region, 2)
      state.fixtures.push(...scheduleRegularSeason(c1, 'challengers1', 28, 138, 3, rng, '常规赛'))

      const c2 = makeComp(state, 'challengers2', `Challengers ${region} · 第二赛段`, t2, region, 2)
      state.fixtures.push(...scheduleRegularSeason(c2, 'challengers2', 200, 262, 3, rng, '常规赛'))
    }
  }
}

const PLAYOFF_CUT: Partial<Record<StageKey, number>> = {
  stage1: 8, stage2: 8, challengers1: 4, challengers2: 4,
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

export interface DayReport {
  day: number
  stage: StageKey
  stageChanged: boolean
  playedMine: Fixture[]
  notes: string[]
  seasonEnded: boolean
}

export function advanceDay(state: GameState): DayReport {
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
  }

  // ---- play today's matches
  const today = state.fixtures.filter((f) => f.day === state.day && !f.played)
  for (const f of today) {
    const a = state.teams[f.teamA]
    const b = state.teams[f.teamB]
    if (!a || !b) {
      f.played = true
      continue
    }
    const result = simulateMatch(state, f.teamA, f.teamB, f.bo, rng)
    const isMine = f.teamA === state.myTeam || f.teamB === state.myTeam
    // full round detail is only retained for the manager's own matches
    if (!isMine) stripRoundLogs(result)
    f.result = result
    f.played = true
    applyMatchStats(state, result)
    applyMatchFatigue(state, f.teamA, result.maps.length, rng)
    applyMatchFatigue(state, f.teamB, result.maps.length, rng)

    const comp = state.comps[f.comp]
    if (comp && !f.label.startsWith('KO:')) applyResultToStandings(comp, f)

    const aWon = result.mapsWonA > result.mapsWonB
    // morale swings with the result
    for (const [teamId, won] of [[f.teamA, aWon], [f.teamB, !aWon]] as [string, boolean][]) {
      for (const pid of state.teams[teamId]?.starters ?? []) {
        const p = state.players[pid]
        if (p) p.morale = clamp(p.morale + (won ? rng.range(1, 5) : -rng.range(1, 5)), 10, 100)
      }
    }

    if (f.teamA === state.myTeam || f.teamB === state.myTeam) {
      playedMine.push(f)
      state.lastResults.push(f.id)
      const mine = f.teamA === state.myTeam
      const myWin = mine ? aWon : !aWon
      state.boardConfidence = clamp(state.boardConfidence + (myWin ? 1.2 : -1.4), 0, 100)
    }

    state.news.push({
      day: state.day,
      kind: 'match',
      text: `${comp?.name ?? f.comp}｜${a.name} ${result.mapsWonA}-${result.mapsWonB} ${b.name}`,
      important: f.teamA === state.myTeam || f.teamB === state.myTeam,
    })
  }

  progressCompetitions(state)

  // ---- weekly upkeep
  if (state.day % 7 === 0) {
    notes.push(...weeklyTick(state, rng))
    weeklyFinance(state)
    aiTransferTick(state, rng)
    ensureMinimumRosters(state, rng)
  }

  if (state.news.length > 400) state.news.splice(0, state.news.length - 400)

  let seasonEnded = false
  if (state.day >= SEASON_DAYS) {
    endSeason(state, rng)
    notes.push(`—— ${state.year} 赛季结束 ——`)
    seasonEnded = true
  }

  return { day: state.day, stage: state.stage, stageChanged, playedMine, notes, seasonEnded }
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

export const fixturesFor = (state: GameState, teamId: string): Fixture[] =>
  state.fixtures
    .filter((f) => f.teamA === teamId || f.teamB === teamId)
    .sort((a, b) => a.day - b.day)

/** Fast-forward until something the manager should look at happens. */
export function advanceToNextMatch(state: GameState, maxDays = 40): DayReport[] {
  const reports: DayReport[] = []
  for (let i = 0; i < maxDays; i++) {
    const r = advanceDay(state)
    reports.push(r)
    if (r.playedMine.length || r.seasonEnded) break
    const next = nextFixtureFor(state, state.myTeam)
    if (next && next.day === state.day + 1) break
  }
  return reports
}

export function makeFriendly(state: GameState, oppId: string, day: number): Fixture {
  const f = makeFixture(day, state.stage, 'friendly', state.myTeam, oppId, 1, '训练赛')
  state.fixtures.push(f)
  return f
}
