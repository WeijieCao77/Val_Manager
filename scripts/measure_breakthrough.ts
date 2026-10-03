/**
 * 潜力突破: how fast the bar fills, and what a career of it is worth (2026-10-03).
 *
 *   npx tsx scripts/measure_breakthrough.ts [seasons=5] [seeds=3]
 *   TEAMS=PRX,TEC,...  (default: a top club, a mid one, a weak one, a tier-two one)
 *
 * A stand-in manager trains on the advice, renews at market pay, pins the
 * board, and starts a 突破特训 the day one is allowed. Prints per club and
 * season: what a full season of official series would put on the bar for each
 * starter (whether or not he is at his ceiling — the rate), how many camps
 * ran and worked, and at the end every player's potential moved by it.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, continuePastFive, setupSeason } from '../src/engine/season'
import { trainingAdvice, aiDrillFor } from '../src/engine/training'
import { renewContract } from '../src/engine/transfer'
import { expectedSalary } from '../src/engine/player'
import { defaultContract } from '../src/engine/types'
import { BREAK, breakBlock, sparkFor, startBreak } from '../src/engine/breakthrough'

const SEASONS = Number(process.argv[2] ?? 5)
const SEEDS = Number(process.argv[3] ?? 3)
const TAGS = (process.env.TEAMS ?? 'PRX,TEC,KRÜ,AQ').split(',')

for (const tag of TAGS) {
  const club = WORLD_TEAMS.find((t) => t.tag === tag)
  if (!club) throw new Error(`no club ${tag}`)
  const rate: number[] = []
  let camps = 0, wins = 0, seasons = 0
  const lifts: number[] = []
  for (let s = 0; s < SEEDS; s++) {
    const seed = 20261003 + s * 101
    const g = createNewGame(club.id, '审计', seed)
    setupSeason(g)
    const pot0 = new Map(squadOf(g, g.myTeam).map((p) => [p.id, p.potential]))
    for (let y = 0; y < SEASONS; y++) {
      const year = g.year
      const would = new Map<string, number>()
      let guard = 0
      while (g.year === year && guard++ < 500) {
        g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
        if (g.midReview) continuePastFive(g)
        if (g.day % 7 === 0) {
          for (const p of squadOf(g, g.myTeam)) {
            g.training[p.id] = trainingAdvice(p, g.day).focus
            if (p.contractYears <= 1) {
              renewContract(g, p.id, defaultContract(Math.round(expectedSalary(p, g.teams[g.myTeam].tier) * 1.15), 2))
            }
          }
        }
        for (const p of squadOf(g, g.myTeam)) {
          if (!breakBlock(g, p.id)) { startBreak(g, p.id); camps++ }
        }
        if (g.drillLock == null) { g.drill = aiDrillFor(g, g.teams[g.myTeam]); g.drillLock = g.day + 7 }
        const before = new Map(squadOf(g, g.myTeam).map((p) => [p.id, p.breakDone ?? 0]))
        const r = advanceDay(g, { autoResolveDrawDecisions: true })
        for (const p of squadOf(g, g.myTeam)) if ((p.breakDone ?? 0) > (before.get(p.id) ?? 0)) wins++
        for (const f of r.playedMine) {
          if (f.scrim || !f.result) continue
          const isA = f.teamA === g.myTeam
          const won = (f.result.mapsWonA > f.result.mapsWonB) === isA
          const intl = f.stage === 'masters1' || f.stage === 'masters2' || f.stage === 'champions'
          const ko = intl || !/常规赛|瑞士|小组/.test(f.label)
          for (const id of (isA ? f.result.lineups?.a : f.result.lineups?.b) ?? []) {
            would.set(id, (would.get(id) ?? 0) + sparkFor(won, f.result.mvp === id, ko, intl))
          }
        }
      }
      seasons++
      const top = [...would.values()].sort((a, b) => b - a).slice(0, 5)
      rate.push(...top)
      console.log(`${tag} seed ${seed} ${year}: 五名主力一季的契机 ${top.map((v) => v.toFixed(0)).join(' / ')}（满 ${BREAK.full}）`)
    }
    for (const p of squadOf(g, g.myTeam)) {
      if (p.breakDone) lifts.push(p.breakDone)
      if (p.breakDone) console.log(`  ${p.ign} ${p.age} 岁：突破 ${p.breakDone} 次，潜力 ${pot0.get(p.id) ?? '?'} → ${p.potential}，能力 ${p.overall}`)
    }
  }
  rate.sort((a, b) => a - b)
  const med = rate[Math.floor(rate.length / 2)]
  console.log(`== ${tag}: 主力一季契机中位 ${med.toFixed(0)}，≥${BREAK.full} 的占 ${(100 * rate.filter((v) => v >= BREAK.full).length / rate.length).toFixed(0)}%；特训 ${camps} 次，成功 ${wins} 次（${seasons} 季）\n`)
}
