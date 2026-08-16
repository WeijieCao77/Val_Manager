import { Rng } from './rng'
import type { Competition, Fixture, GameState, StageKey, StandingRow } from './types'

export const newRow = (teamId: string): StandingRow => ({
  teamId, w: 0, l: 0, mapW: 0, mapL: 0, roundW: 0, roundL: 0, pts: 0,
})

export function newStandings(teams: string[]): Record<string, StandingRow> {
  const out: Record<string, StandingRow> = {}
  for (const t of teams) out[t] = newRow(t)
  return out
}

/** Circle-method round robin. Returns one array of pairings per round. */
export function roundRobin(ids: string[], rng: Rng): [string, string][][] {
  const list = rng.shuffle(ids)
  if (list.length % 2 === 1) list.push('__BYE__')
  const n = list.length
  const rounds: [string, string][][] = []
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = []
    for (let i = 0; i < n / 2; i++) {
      const a = list[i]
      const b = list[n - 1 - i]
      if (a !== '__BYE__' && b !== '__BYE__') {
        // alternate home/away so the veto first-pick rotates
        pairs.push(r % 2 === 0 ? [a, b] : [b, a])
      }
    }
    rounds.push(pairs)
    list.splice(1, 0, list.pop()!)
  }
  return rounds
}

let fixtureSeq = 0
export function resetFixtureSeq(n = 0) {
  fixtureSeq = n
}

export function makeFixture(
  day: number, stage: StageKey, comp: string,
  teamA: string, teamB: string, bo: 1 | 3 | 5, label: string,
): Fixture {
  return {
    id: `F${fixtureSeq++}`, day, stage, comp, teamA, teamB, bo, label, played: false,
  }
}

/**
 * How many times a league plays itself through.
 *
 * A twelve-team league needs one pass to give everyone eleven games. A small
 * Challengers league of three would only get two, which is not a season — so
 * small leagues cycle several times, the way real lower divisions do.
 */
export function cyclesFor(teamCount: number, targetGames = 10): number {
  const perCycle = Math.max(1, teamCount - 1)
  return Math.max(1, Math.ceil(targetGames / perCycle))
}

/** Spread round-robin rounds across the days available in a stage window. */
export function scheduleRegularSeason(
  comp: Competition, stage: StageKey, startDay: number, endDay: number,
  bo: 1 | 3 | 5, rng: Rng, labelPrefix = '常规赛', targetGames = 10,
): Fixture[] {
  const cycles = cyclesFor(comp.teams.length, targetGames)
  let rounds: [string, string][][] = []
  for (let c = 0; c < cycles; c++) {
    // reversing every other pass keeps home/away alternating across cycles
    for (const pairs of roundRobin(comp.teams, rng)) {
      rounds.push(c % 2 === 0 ? pairs : pairs.map(([a, b]) => [b, a] as [string, string]))
    }
  }
  // a short group phase plays only part of the way round, so a Kickoff is not
  // as long as a full stage
  if (rounds.length > targetGames) rounds = rounds.slice(0, targetGames)
  if (!rounds.length) return []
  const span = Math.max(1, endDay - startDay)
  const step = Math.max(2, Math.floor(span / rounds.length))
  const out: Fixture[] = []
  rounds.forEach((pairs, i) => {
    const day = startDay + i * step
    pairs.forEach(([a, b]) => {
      out.push(makeFixture(day, stage, comp.key, a, b, bo, `${labelPrefix} 第${i + 1}轮`))
    })
  })
  return out
}

/** Order a table: wins, then map diff, then round diff. */
export function sortStandings(comp: Competition): string[] {
  return Object.values(comp.standings)
    .slice()
    .sort((x, y) =>
      y.w - x.w ||
      y.mapW - y.mapL - (x.mapW - x.mapL) ||
      y.roundW - y.roundL - (x.roundW - x.roundL) ||
      y.mapW - x.mapW)
    .map((r) => r.teamId)
}

export function applyResultToStandings(comp: Competition, f: Fixture): void {
  if (!f.result) return
  const a = comp.standings[f.teamA]
  const b = comp.standings[f.teamB]
  if (!a || !b) return
  const { mapsWonA, mapsWonB, maps } = f.result
  const aWon = mapsWonA > mapsWonB
  if (aWon) {
    a.w++
    b.l++
    a.pts += 3
  } else {
    b.w++
    a.l++
    b.pts += 3
  }
  a.mapW += mapsWonA
  a.mapL += mapsWonB
  b.mapW += mapsWonB
  b.mapL += mapsWonA
  for (const m of maps) {
    a.roundW += m.scoreA
    a.roundL += m.scoreB
    b.roundW += m.scoreB
    b.roundL += m.scoreA
  }
}

// ---------------------------------------------------------------- knockout brackets

const ROUND_LABEL = (remaining: number): string => {
  switch (remaining) {
    case 2: return '决赛'
    case 4: return '半决赛'
    case 8: return '四分之一决赛'
    case 16: return '八分之一决赛'
    default: return `${remaining}强`
  }
}

/** Standard 1v8 / 2v7 seeding. */
export function pairSeeds(seeds: string[]): [string, string][] {
  const out: [string, string][] = []
  const n = seeds.length
  for (let i = 0; i < n / 2; i++) out.push([seeds[i], seeds[n - 1 - i]])
  return out
}

/**
 * Generate the next knockout round for a competition, if one is due.
 * Returns new fixtures (possibly empty).
 */
export function advanceBracket(
  state: GameState, comp: Competition, day: number, bo: 1 | 3 | 5,
): Fixture[] {
  const bracketFixtures = state.fixtures.filter(
    (f) => f.comp === comp.key && f.label.startsWith('KO:'),
  )
  if (!bracketFixtures.length) return []
  const unplayed = bracketFixtures.filter((f) => !f.played)
  if (unplayed.length) return []

  // find the most recent round and who survived it
  const lastRound = Math.max(...bracketFixtures.map((f) => Number(f.label.split(':')[1] || 0)))
  const lastFixtures = bracketFixtures.filter((f) => Number(f.label.split(':')[1] || 0) === lastRound)
  const winners: string[] = []
  const losers: string[] = []
  for (const f of lastFixtures) {
    if (!f.result) continue
    const aWon = f.result.mapsWonA > f.result.mapsWonB
    winners.push(aWon ? f.teamA : f.teamB)
    losers.push(aWon ? f.teamB : f.teamA)
  }

  // record eliminated teams from best to worst as the bracket unwinds
  comp.finished = [...losers.reverse(), ...comp.finished]

  // seeds that sat out round 1 join here
  const advancing = [...(comp.byes ?? []), ...winners]
  comp.byes = undefined

  if (advancing.length <= 1) {
    comp.champion = advancing[0]
    if (advancing[0]) comp.finished = [advancing[0], ...comp.finished]
    return []
  }

  const pairs = pairSeeds(advancing)
  const label = ROUND_LABEL(advancing.length)
  return pairs.map(([a, b]) =>
    makeFixture(day, comp.stage, comp.key, a, b, bo, `KO:${lastRound + 1}:${label}`),
  )
}

/**
 * Kick off a knockout stage from a seeded list. Fields that aren't a power of
 * two give the top seeds a bye into round 2.
 */
export function startBracket(
  comp: Competition, seeds: string[], stage: StageKey, day: number, bo: 1 | 3 | 5,
): Fixture[] {
  comp.bracketStarted = true
  const n = seeds.length
  if (n < 2) {
    comp.champion = seeds[0]
    comp.finished = seeds.slice()
    return []
  }
  const pow2 = 1 << Math.ceil(Math.log2(n))
  const byeCount = pow2 - n
  const byes = seeds.slice(0, byeCount)
  const playing = seeds.slice(byeCount)
  comp.byes = byes.length ? byes : undefined

  const label = ROUND_LABEL(playing.length)
  return pairSeeds(playing).map(([a, b]) =>
    makeFixture(day, stage, comp.key, a, b, bo, `KO:1:${label}`),
  )
}

/** Championship-point awards for a completed competition. */
export const CHAMP_POINTS: Record<string, number[]> = {
  kickoff: [6, 4, 3, 2, 1, 1],
  stage1: [9, 7, 5, 4, 3, 2, 1, 1],
  stage2: [9, 7, 5, 4, 3, 2, 1, 1],
  masters1: [12, 9, 7, 5],
  masters2: [12, 9, 7, 5],
}
