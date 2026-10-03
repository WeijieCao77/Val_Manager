/**
 * 娱乐模式 balance (2026-10-03): what signing the comeback players does to a
 * club, against the same club left alone.
 *
 *   npx tsx scripts/measure_fun_mode.ts [seasons=3] [seeds=2]
 *   TEAMS=FUR,MAND
 *
 * The signing manager, each window: while the squad is under seven and the
 * money lasts, offer the best comeback player whose asking pay (×1.1, two
 * years) fits in a quarter of the balance; he signs if playerAcceptsTerms
 * says so. Otherwise the measure_manager_balance stand-in.
 */
import raw from '../src/data/funPool.json'
import { autoStarters, createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { squadOf } from '../src/engine/roster'
import { advanceDay, continuePastFive, setupSeason } from '../src/engine/season'
import { trainingAdvice, aiDrillFor } from '../src/engine/training'
import { doTransfer, playerAcceptsTerms, renewContract } from '../src/engine/transfer'
import { expectedSalary } from '../src/engine/player'
import { defaultContract } from '../src/engine/types'
import { Rng } from '../src/engine/rng'
import type { FunRow } from '../src/engine/fun'
import type { GameState } from '../src/engine/types'

const SEASONS = Number(process.argv[2] ?? 3)
const SEEDS = Number(process.argv[3] ?? 2)
const TAGS = (process.env.TEAMS ?? 'FUR,MAND').split(',')
const rows = (raw as unknown as { players: FunRow[] }).players
const M = (n: number) => `${(n / 1e6).toFixed(2)}M`
const five = (g: GameState) => { const s = squadOf(g, g.myTeam).sort((a, b) => b.overall - a.overall).slice(0, 5); return s.reduce((a, p) => a + p.overall, 0) / s.length }

function sign(g: GameState, rng: Rng): string[] {
  const got: string[] = []
  const team = g.teams[g.myTeam]
  for (let tries = 0; tries < 12 && squadOf(g, g.myTeam).length < 7; tries++) {
    const pool = Object.values(g.players).filter((p) => p.comeback && !p.teamId)
      .filter((p) => expectedSalary(p, team.tier) * 1.1 <= g.finances.balance * 0.25)
      .sort((a, b) => b.overall - a.overall)
    const target = pool[tries]
    if (!target) break
    const terms = defaultContract(Math.round(expectedSalary(target, team.tier) * 1.1), 2)
    if (playerAcceptsTerms(g, target, team, terms, rng).ok && doTransfer(g, target, g.myTeam, 0, terms)) got.push(`${target.ign}(${target.overall})`)
  }
  // the manager puts his signings in: the five is his to pick, nothing reshuffles it for him
  if (got.length) team.starters = autoStarters(g, g.myTeam)
  return got
}

for (const tag of TAGS) {
  for (const mode of ['不签', '签复出'] as const) {
    let w = 0, l = 0, titles = 0, money = 0, fives = 0
    for (let s = 0; s < SEEDS; s++) {
      const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === tag)!.id, '审计', 20261003 + s * 97, undefined, { fun: rows })
      setupSeason(g)
      const rng = new Rng(77 + s)
      const bal0 = g.finances.balance
      const signed: string[] = []
      for (let y = 0; y < SEASONS; y++) {
        const year = g.year
        const h0 = g.honours.length
        while (g.year === year) {
          g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
          if (g.midReview) continuePastFive(g)
          if (mode === '签复出' && (g.day === 1 || g.day === 120)) signed.push(...sign(g, rng))
          if (g.day % 7 === 0) {
            for (const p of squadOf(g, g.myTeam)) g.training[p.id] = trainingAdvice(p, g.day).focus
            for (const p of squadOf(g, g.myTeam)) if (p.contractYears <= 1) renewContract(g, p.id, defaultContract(Math.round(expectedSalary(p, g.teams[g.myTeam].tier) * 1.15), 2))
          }
          if (g.drillLock == null) { g.drill = aiDrillFor(g, g.teams[g.myTeam]); g.drillLock = g.day + 7 }
          const r = advanceDay(g, { autoResolveDrawDecisions: true })
          for (const f of r.playedMine) {
            if (f.scrim || !f.result) continue
            ;(f.result.mapsWonA > f.result.mapsWonB) === (f.teamA === g.myTeam) ? w++ : l++
          }
        }
        titles += g.honours.length - h0
      }
      money += g.finances.balance - bal0
      fives += five(g)
      console.log(`  ${tag} ${mode} seed ${s}: 签下 ${signed.join(' ') || '—'} · 五人 ${five(g).toFixed(1)} · 资金 ${M(bal0)} → ${M(g.finances.balance)} · 联赛 ${g.teams[g.myTeam].tier === 1 ? 'VCT' : 'CHAL'}`)
    }
    console.log(`${tag} ${mode}: ${w}-${l} (${Math.round(100 * w / Math.max(1, w + l))}%) · 冠军 ${(titles / SEEDS / SEASONS).toFixed(2)}/季 · 结束五人 ${(fives / SEEDS).toFixed(1)} · 资金变化 ${M(money / SEEDS)}\n`)
  }
}
