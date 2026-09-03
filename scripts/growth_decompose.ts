/**
 * Diagnostic: where does AI top-ten growth come from over 2 / 5 / 10 seasons?
 * Not part of the audit — a measurement tool for tuning the growth engine.
 *   npx tsx scripts/growth_decompose.ts [years=2] [seeds=3]
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, continuePastFive, setupSeason } from '../src/engine/season'
import { Rng } from '../src/engine/rng'
import type { GameState, Player } from '../src/engine/types'

const years = Number(process.argv[2] ?? 2)
const nSeeds = Number(process.argv[3] ?? 3)
const RIVALRY = Number(process.env.RIVALRY ?? 0)
const SEEDS: [number, number][] = [[20260826, 7], [20260827, 17], [20260828, 27], [20260829, 37], [20260830, 47]]

const mk = (seed: number): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', seed)
  setupSeason(g)
  return g
}
const topSquads = (g: GameState) => Object.values(g.teams)
  .filter((t) => t.id !== g.myTeam)
  .map((t) => squadOf(g, t.id).sort((a, b) => b.overall - a.overall).slice(0, 5))
  .sort((a, b) => b.reduce((x, p) => x + p.overall, 0) - a.reduce((x, p) => x + p.overall, 0))
  .slice(0, 10)
const top10mean = (g: GameState) => {
  const os = topSquads(g).map((s) => s.reduce((x, p) => x + p.overall, 0) / s.length)
  return os.reduce((a, b) => a + b, 0) / os.length
}
const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
const leagueAll = (g: GameState) => Object.values(g.players).filter((p) => p.teamId && p.teamId !== g.myTeam)
const bucket = (age: number) => age <= 20 ? '≤20' : age <= 23 ? '21-23' : age <= 26 ? '24-26' : '27+'

for (const [seed, simSeed] of SEEDS.slice(0, nSeeds)) {
  const t0 = Date.now()
  const g = mk(seed)
  g.rivalry = RIVALRY
  const rng = new Rng(simSeed)
  const eligibleAll = leagueAll(g).filter((p) => p.age <= 23 && p.potential - p.overall >= 3)
    .map((p) => ({ p, o: p.overall, room: p.potential - p.overall }))
  const cohort = topSquads(g).flat().map((p) => ({ p, o: p.overall, pot: p.potential, age: p.age, room: p.potential - p.overall }))
  const start = top10mean(g)
  const league = leagueAll(g)
  const medStart = median(league.map((p) => p.overall))
  const meanStart = mean(league.map((p) => p.overall))
  console.log(`\n=== seed ${seed}/${simSeed}: top10 ${start.toFixed(2)} · cohort age ${mean(cohort.map((c) => c.age)).toFixed(1)} · room ${mean(cohort.map((c) => c.room)).toFixed(1)} · young(≤23,room≥3) ${cohort.filter((c) => c.age <= 23 && c.room >= 3).length}/50 · league median ${medStart} mean ${meanStart.toFixed(2)} (n=${league.length})`)
  const leagueCohort = league.slice()
  const byB: Record<string, number> = {}
  for (const c of cohort) byB[bucket(c.age)] = (byB[bucket(c.age)] ?? 0) + 1
  console.log('  cohort ages:', JSON.stringify(byB))
  for (let y = 1; y <= years; y++) {
    let guard = 0
    const yr = g.year
    while (g.year === yr && guard++ < 400) {
      // the human manager is a bystander here: the board never sacks him and
      // the five-year review is always answered "play on"
      g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
      if (g.midReview) continuePastFive(g)
      advanceDay(g, rng)
    }
    if (g.gameOver) console.log('  !! gameOver:', g.gameOver)
    const end = top10mean(g)
    const lg = leagueAll(g)
    const fixed = mean(cohort.map((c) => c.p.overall)) - mean(cohort.map((c) => c.o))
    const young = cohort.filter((c) => c.age <= 23 && c.room >= 3)
    const share = mean(young.map((c) => (c.p.overall - c.o) / c.room))
    const revs = Object.values(g.players).filter((p) => (p.potentialRevisions ?? 0) > 0).length
    const invalid = Object.values(g.players).filter((p) => p.overall > p.potential || p.potential > 99).length
    const parts = ['≤20', '21-23', '24-26', '27+'].map((b) => {
      const cs = cohort.filter((c) => bucket(c.age) === b)
      return `${b}: ${cs.length ? (mean(cs.map((c) => c.p.overall - c.o))).toFixed(2) : '-'}`
    }).join(' · ')
    const potUp = mean(cohort.map((c) => c.p.potential - c.pot))
    const ages = mean(lg.map((p) => p.age))
    const youngN = lg.filter((p) => p.age <= 23).length
    const fixedLeague = mean(leagueCohort.map((p) => p.overall)) - meanStart
    console.log(`     league: fixed-cohort ${fixedLeague >= 0 ? '+' : ''}${fixedLeague.toFixed(2)} · signed mean age ${ages.toFixed(1)} · ≤23 ${youngN} · retired/unsigned ${leagueCohort.filter((p) => !p.teamId).length}`)
    const shareAll = mean(eligibleAll.map((c) => (c.p.overall - c.o) / c.room))
    console.log(`     eligible youth league-wide (${eligibleAll.length}): share ${(shareAll * 100).toFixed(0)}% · room ${mean(eligibleAll.map((c) => c.room)).toFixed(1)}`)
    console.log(`  Y${y}: top10 ${end.toFixed(2)} (+${(end - start).toFixed(2)}) · fixed cohort +${fixed.toFixed(2)} [${parts}] · youth share ${(share * 100).toFixed(0)}% · cohort pot +${potUp.toFixed(2)} · revisions ${revs} · league median ${median(lg.map((p) => p.overall))} mean ${mean(lg.map((p) => p.overall)).toFixed(2)} (n=${lg.length}) · invalid ${invalid} · ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  }
}
