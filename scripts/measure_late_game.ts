/**
 * How easy is the late game? (2026-09-23)
 *
 *   npx tsx scripts/measure_late_game.ts [seasons=4] [seeds=3]
 *   MAX=1  — every season opens with the five trained out (attributes to 97,
 *            maps to 90), which is what the group means by 「数值练满了」
 *   TEAM=EDG  DIFF=normal|hard|pro
 *
 * The managed club is run by a stand-in manager who does what a player
 * would do without thinking: the recommended personal focus, the drill an
 * AI club would pick, renewals at market pay, the board pinned so the clock
 * never stops. Prints per season: series record, record against the AI
 * top eight, titles.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, continuePastFive, setupSeason } from '../src/engine/season'
import { trainingAdvice, aiDrillFor } from '../src/engine/training'
import { renewContract } from '../src/engine/transfer'
import { expectedSalary, recomputeOverall } from '../src/engine/player'
import { poolFor } from '../src/engine/match'
import { defaultContract } from '../src/engine/types'
import type { GameState } from '../src/engine/types'

const SEASONS = Number(process.argv[2] ?? 4)
const SEEDS = Number(process.argv[3] ?? 3)
const MAX = process.env.MAX === '1'
const TAG = process.env.TEAM ?? 'EDG'
const DIFF = process.env.DIFF
// ROTATE=1: a manager who changes his dials every week, map by map, from three
// sensible plans — the counterplay to being read, at no cost in familiarity
const ROTATE = process.env.ROTATE === '1'
const PLANS = [
  { pace: 50, utility: 55, aggression: 50, adaptability: 50 },
  { pace: 30, utility: 70, aggression: 35, adaptability: 65 },
  { pace: 70, utility: 45, aggression: 65, adaptability: 40 },
]

const pct = (a: number, b: number) => b ? `${(100 * a / b).toFixed(0)}%` : '-'
const tot = { w: 0, l: 0, tw: 0, tl: 0, titles: 0, intl: 0, seasons: 0 }
// mean (mine − theirs) per edge term, over every official map against the AI top eight
const gap: Record<string, number> = {}
let gapN = 0

function maxOut(g: GameState) {
  const team = g.teams[g.myTeam]
  for (const p of squadOf(g, g.myTeam)) {
    for (const k of Object.keys(p.attrs) as (keyof typeof p.attrs)[]) p.attrs[k] = Math.max(p.attrs[k], 97)
    p.potential = Math.max(p.potential, 99)
    recomputeOverall(p)
  }
  for (const m of poolFor(g)) team.mapPrefs[m] = Math.max(team.mapPrefs[m] ?? 50, 90)
}

for (let s = 0; s < SEEDS; s++) {
  const seed = 20260923 + s * 101
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === TAG)!.id, '审计', seed)
  if (DIFF) (g as unknown as { difficulty: string }).difficulty = DIFF
  setupSeason(g)
  for (let y = 0; y < SEASONS; y++) {
    const year = g.year
    if (MAX) maxOut(g)
    const rank = Object.values(g.teams).filter((t) => t.id !== g.myTeam && t.tier === 1)
      .sort((a, b) => b.rating - a.rating).slice(0, 8).map((t) => t.id)
    let w = 0, l = 0, tw = 0, tl = 0
    const honours0 = g.honours.length
    let guard = 0
    while (g.year === year && guard++ < 500) {
      g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
      if (g.midReview) continuePastFive(g)
      if (g.day % 7 === 0) {
        for (const p of squadOf(g, g.myTeam)) g.training[p.id] = trainingAdvice(p, g.day).focus
        if (ROTATE) {
          g.mapTactics = {}
          poolFor(g).forEach((m, i) => { g.mapTactics![m] = { ...PLANS[(i + g.day / 7) % 3] } })
        }
        for (const p of squadOf(g, g.myTeam)) {
          if (p.contractYears <= 1) {
            const sal = Math.round(expectedSalary(p, g.teams[g.myTeam].tier) * 1.15)
            renewContract(g, p.id, defaultContract(sal, 2))
          }
        }
      }
      if (g.drillLock == null) { g.drill = aiDrillFor(g, g.teams[g.myTeam]); g.drillLock = g.day + 7 }
      const r = advanceDay(g, { autoResolveDrawDecisions: true })
      for (const f of r.playedMine) {
        if (f.scrim || !f.result) continue
        const mineA = f.teamA === g.myTeam
        const won = (f.result.mapsWonA > f.result.mapsWonB) === mineA
        const opp = mineA ? f.teamB : f.teamA
        won ? w++ : l++
        if (rank.includes(opp)) {
          won ? tw++ : tl++
          for (const m of f.result.maps) {
            if (!m.edge) continue
            const me = mineA ? m.edge.a : m.edge.b
            const them = mineA ? m.edge.b : m.edge.a
            for (const k of Object.keys(me) as (keyof typeof me)[]) {
              gap[k] = (gap[k] ?? 0) + (Number(me[k] ?? 0) - Number(them[k] ?? 0))
            }
            gapN++
          }
        }
      }
    }
    const got = g.honours.slice(honours0).map((h) => h.title)
    const intl = got.filter((t) => /Masters|Champions/.test(t)).length
    tot.w += w; tot.l += l; tot.tw += tw; tot.tl += tl; tot.titles += got.length; tot.intl += intl; tot.seasons++
    const five = squadOf(g, g.myTeam).sort((a, b) => b.overall - a.overall).slice(0, 5)
    const aiTop = Object.values(g.teams).filter((t) => t.id !== g.myTeam && t.tier === 1)
      .map((t) => squadOf(g, t.id).sort((a, b) => b.overall - a.overall).slice(0, 5).reduce((a, p) => a + p.overall, 0) / 5)
      .sort((a, b) => b - a)
    const aiTxt = `AI 最强 ${aiTop[0].toFixed(1)} 前八均 ${(aiTop.slice(0, 8).reduce((a, b) => a + b, 0) / 8).toFixed(1)}`
    const sc = g.scout
    const scTxt = sc ? `针对 ${sc.heat}${g.nemesis ? ` 宿敌 ${g.teams[g.nemesis.teamId].tag}` : ''}` : ''
    console.log(`seed ${seed} ${year}: ${w}-${l} (${pct(w, w + l)}) · vs AI前八 ${tw}-${tl} (${pct(tw, tw + tl)}) · 冠军 ${got.join(' / ') || '无'} · 五人 ${(five.reduce((a, p) => a + p.overall, 0) / 5).toFixed(1)} · 资金 ${(g.finances.balance / 1e6).toFixed(1)}M · ${aiTxt} · ${scTxt}`)
  }
}
console.log(`\n合计 ${tot.seasons} 季：${tot.w}-${tot.l} (${pct(tot.w, tot.w + tot.l)}) · vs AI前八 ${tot.tw}-${tot.tl} (${pct(tot.tw, tot.tw + tot.tl)}) · 冠军 ${(tot.titles / tot.seasons).toFixed(2)}/季 · 国际赛冠军 ${(tot.intl / tot.seasons).toFixed(2)}/季`)
if (process.env.EDGES === '1') {
  console.log('对 AI 前八每张图的平均差（我 − 对手）：')
  console.log(Object.entries(gap).map(([k, v]) => `${k} ${(v / Math.max(1, gapN)).toFixed(2)}`).join(' · '))
}
