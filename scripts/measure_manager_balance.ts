/**
 * 电竞经理 balance at a glance (2026-10-03): one stand-in manager per club
 * strength — the strongest, the median and the weakest tier-one club and a
 * mid tier-two club — over several seasons, printing what a player feels:
 * results, titles, money in and out by kind, the five's rating against the
 * world's, morale and fatigue.
 *
 *   npx tsx scripts/measure_manager_balance.ts [seasons=4] [seeds=2]
 *   DIFF=normal|hard|pro   ONLY=top,mid,low,t2
 *
 * The stand-in does what a player does without thinking (measure_late_game's
 * manager): recommended personal focus, the AI's drill, renewals at market
 * pay +15%, no signings, the board pinned so the clock never stops.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { advanceDay, continuePastFive, setupSeason } from '../src/engine/season'
import { trainingAdvice, aiDrillFor } from '../src/engine/training'
import { renewContract } from '../src/engine/transfer'
import { expectedSalary } from '../src/engine/player'
import { defaultContract } from '../src/engine/types'
import type { GameState } from '../src/engine/types'

const SEASONS = Number(process.argv[2] ?? 4)
const SEEDS = Number(process.argv[3] ?? 2)
const DIFF = process.env.DIFF
const ONLY = process.env.ONLY?.split(',')

const M = (n: number) => `${(n / 1e6).toFixed(2)}M`
const pct = (a: number, b: number) => b ? `${Math.round(100 * a / b)}%` : '-'
const five = (g: GameState, id: string) => {
  const s = squadOf(g, id).sort((a, b) => b.overall - a.overall).slice(0, 5)
  return s.length ? s.reduce((a, p) => a + p.overall, 0) / s.length : 0
}
/** a finance log label folded to its kind: the text before a colon or a space-number */
const kind = (label: string) => label.replace(/[:：].*$/, '').replace(/\s*[\d(（].*$/, '').slice(0, 14)

import { WORLD_TEAMS } from '../src/engine/teams'
const probe = createNewGame(WORLD_TEAMS[0].id, '审计', 1)
const tier1 = Object.values(probe.teams).filter(t => t.tier === 1).sort((a, b) => five(probe, b.id) - five(probe, a.id))
const tier2 = Object.values(probe.teams).filter(t => t.tier === 2).sort((a, b) => five(probe, b.id) - five(probe, a.id))
const picks: [string, string][] = ([
  ['top', tier1[0].id], ['mid', tier1[Math.floor(tier1.length / 2)].id], ['low', tier1[tier1.length - 1].id],
  ['t2', tier2[Math.floor(tier2.length / 2)].id],
] as [string, string][]).filter(([k]) => !ONLY || ONLY.includes(k))

for (const [label, clubId] of picks) {
  for (let s = 0; s < SEEDS; s++) {
    const seed = 20261003 + s * 97
    const g = createNewGame(clubId, '审计', seed)
    if (DIFF) (g as unknown as { difficulty: string }).difficulty = DIFF
    setupSeason(g)
    const seen = new WeakSet<object>()
    for (const e of g.finances.log) seen.add(e)
    console.log(`\n== ${label} ${g.teams[clubId].tag} (tier ${g.teams[clubId].tier}) seed ${seed} · start ${M(g.finances.balance)} · five ${five(g, clubId).toFixed(1)}`)
    for (let y = 0; y < SEASONS; y++) {
      const year = g.year
      const bal0 = g.finances.balance
      const flows: Record<string, number> = {}
      let w = 0, l = 0, mapsW = 0, mapsL = 0, guard = 0, morale = 0, fatigue = 0, weeks = 0
      const honours0 = g.honours.length
      while (g.year === year && guard++ < 500 && !g.gameOver) {
        g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
        if (g.midReview) continuePastFive(g)
        if (g.day % 7 === 0) {
          const sq = squadOf(g, g.myTeam)
          for (const p of sq) g.training[p.id] = trainingAdvice(p, g.day).focus
          for (const p of sq) {
            if (p.contractYears <= 1) renewContract(g, p.id, defaultContract(Math.round(expectedSalary(p, g.teams[g.myTeam].tier) * 1.15), 2))
          }
          morale += sq.reduce((a, p) => a + p.morale, 0) / Math.max(1, sq.length)
          fatigue += sq.reduce((a, p) => a + p.fatigue, 0) / Math.max(1, sq.length)
          weeks++
        }
        if (g.drillLock == null) { g.drill = aiDrillFor(g, g.teams[g.myTeam]); g.drillLock = g.day + 7 }
        const r = advanceDay(g, { autoResolveDrawDecisions: true })
        for (const e of g.finances.log) if (!seen.has(e)) { seen.add(e); flows[kind(e.label)] = (flows[kind(e.label)] ?? 0) + e.amount }
        for (const f of r.playedMine) {
          if (f.scrim || !f.result) continue
          const mineA = f.teamA === g.myTeam
          ;(f.result.mapsWonA > f.result.mapsWonB) === mineA ? w++ : l++
          mapsW += mineA ? f.result.mapsWonA : f.result.mapsWonB
          mapsL += mineA ? f.result.mapsWonB : f.result.mapsWonA
        }
      }
      const got = g.honours.slice(honours0).map(h => h.title)
      const t1 = Object.values(g.teams).filter(t => t.tier === 1 && t.id !== g.myTeam).map(t => five(g, t.id)).sort((a, b) => b - a)
      const income = Object.entries(flows).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
      const spend = Object.entries(flows).filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1])
      console.log(`${year}: ${w}-${l} (${pct(w, w + l)}, 图 ${pct(mapsW, mapsW + mapsL)}) · 冠军 ${got.join(' / ') || '无'} · 五人 ${five(g, g.myTeam).toFixed(1)}`
        + ` · AI 一级 最强 ${t1[0]?.toFixed(1)} 中位 ${t1[Math.floor(t1.length / 2)]?.toFixed(1)} · 士气 ${(morale / Math.max(1, weeks)).toFixed(0)} 疲劳 ${(fatigue / Math.max(1, weeks)).toFixed(0)}`)
      console.log(`      资金 ${M(bal0)} → ${M(g.finances.balance)} (${g.finances.balance >= bal0 ? '+' : ''}${M(g.finances.balance - bal0)})`
        + ` · 收入 ${income.map(([k, v]) => `${k} ${M(v)}`).join(' ')} · 支出 ${spend.map(([k, v]) => `${k} ${M(v)}`).join(' ')}`)
      if (g.gameOver) { console.log('   GAME OVER', g.gameOver); break }
    }
  }
}
