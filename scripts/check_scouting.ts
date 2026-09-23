/**
 * 对手针对 and 难度 (2026-09-23) — engine/scouting.ts, engine/difficulty.ts.
 *
 *   npx tsx scripts/check_scouting.ts
 *
 * The group: 「把数值练满了后期就无脑玩了」. What has to hold:
 *   1. the rules — heat up on a win, down harder on a loss; a plan played
 *      three times is read; a changed agent or dial is partly unread; scrims
 *      and AI-vs-AI maps carry no prep; the flattened top is identity below
 *      the knee; difficulty only goes up
 *   2. a season played headless moves the numbers the panel shows, and an
 *      old save with none of the new fields plays on
 *   3. the late game is harder than it was, and harder with each level: a
 *      trained-out five that never changes its plan no longer wins everything
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, continuePastFive, setupSeason } from '../src/engine/season'
import { trainingAdvice, aiDrillFor } from '../src/engine/training'
import { recomputeOverall } from '../src/engine/player'
import { buildLineup, poolFor, sheetFor, tacticsFor } from '../src/engine/match'
import { DIFFICULTY, flattenTop, raiseDifficulty } from '../src/engine/difficulty'
import { HEAT_LOSS, HEAT_WIN, READ_FULL, prepEdge, readOf, recordMatch, scoutWinter } from '../src/engine/scouting'
import { payDemands } from '../src/engine/life'
import { expectedSalary } from '../src/engine/player'
import { Rng } from '../src/engine/rng'
import type { Fixture, GameState } from '../src/engine/types'

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`)
}

const EDG = WORLD_TEAMS.find((t) => t.tag === 'EDG')!.id
const fresh = (seed = 20260923): GameState => {
  const g = createNewGame(EDG, '审计', seed)
  setupSeason(g)
  return g
}

// ---------------------------------------------------------------- 1. rules
{
  const g = fresh()
  const map = poolFor(g)[0]
  const foe = Object.values(g.teams).find((t) => t.id !== g.myTeam && t.tier === 1)!
  const sheet = sheetFor(g, g.myTeam, map).agents
  const dials = tacticsFor(g, g.myTeam, map)
  const fx = (won: boolean): Fixture => ({
    id: `x${Math.random()}`, day: g.day, stage: g.stage, comp: 'VCT China', teamA: g.myTeam, teamB: foe.id, bo: 1,
    label: '常规赛 W1', played: true,
    result: { mapsWonA: won ? 1 : 0, mapsWonB: won ? 0 : 1, maps: [{ map, scoreA: won ? 13 : 5, scoreB: won ? 5 : 13, lines: {} } as never], vetoLog: [], mvp: null, highlights: [] },
  })
  const plans = { [map]: { agents: sheet, tactics: dials } }
  check(prepEdge(g, foe.id, g.myTeam, map, sheet, dials, true) === 0, '没人盯的时候对手没有备战分')
  recordMatch(g, fx(true), plans, false)
  check(g.scout!.heat === HEAT_WIN, `赢一场针对度 +${HEAT_WIN}`, `${g.scout!.heat}`)
  recordMatch(g, fx(false), plans, false)
  check(g.scout!.heat === 0, `输一场 −${HEAT_LOSS}，不低于 0`, `${g.scout!.heat}`)
  g.scout!.heat = 100
  for (let i = 0; i < READ_FULL; i++) recordMatch(g, fx(true), plans, false)
  const full = readOf(g, map, sheet, dials).read
  check(full > 0.99, `同一套打 ${READ_FULL} 场被摸透`, full.toFixed(2))
  const ids = Object.keys(sheet)
  const swapped = { ...sheet, [ids[0]]: sheet[ids[0]] === 'Jett' ? 'Raze' : 'Jett' }
  const one = readOf(g, map, swapped, dials)
  check(Math.abs(one.sheet - 0.8) < 1e-9, '换一个英雄，阵容部分剩五分之四', one.sheet.toFixed(2))
  const moved = { ...dials, pace: dials.pace + 15 }
  const dm = readOf(g, map, sheet, moved)
  check(dm.dials === 0 && dm.sheet > 0.99, '滑杆动 10 以上，滑杆部分作废', `${dm.sheet.toFixed(2)} / ${dm.dials}`)
  const pFull = prepEdge(g, foe.id, g.myTeam, map, sheet, dials, true)
  const pMoved = prepEdge(g, foe.id, g.myTeam, map, sheet, moved, true)
  check(Math.abs(pFull - DIFFICULTY.normal.prepMax) < 1e-9, '针对度满、被摸透：普通难度备战分到上限', pFull.toFixed(2))
  check(pMoved < pFull, '拨滑杆能降低备战分', `${pFull.toFixed(2)} → ${pMoved.toFixed(2)}`)
  check(prepEdge(g, foe.id, g.myTeam, map, sheet, dials, false) === 0, '训练赛没有备战分')
  const other = Object.values(g.teams).find((t) => t.id !== g.myTeam && t.id !== foe.id)!
  check(prepEdge(g, foe.id, other.id, map, sheet, dials, true) === 0, 'AI 打 AI 没有备战分')
  check(prepEdge(g, g.myTeam, foe.id, map, sheet, dials, true) === 0, '我方没有备战分')
  const lu = buildLineup(g, foe.id, map, g.myTeam, true)
  check(Math.abs((lu.edge.prep ?? 0) - pFull) < 1e-9, '比赛里对手的强弱分解带着备战分', `${lu.edge.prep?.toFixed(2)}`)
  const scrimLu = buildLineup(g, foe.id, map, g.myTeam, false)
  check(scrimLu.edge.prep === undefined, '训练赛的强弱分解里没有这一行')

  // winter: attention cools, a nemesis declares
  g.scout!.beat = { [foe.id]: 5 }
  const notes: string[] = []
  scoutWinter(g, g.year + 1, notes)
  check(g.nemesis?.teamId === foe.id && g.nemesis.year === g.year + 1, '针对度够高时，被赢最多的一级队成为宿敌', foe.tag)
  check(g.scout!.heat === 60, '过冬针对度剩六成', `${g.scout!.heat}`)
  check(notes.some((n) => n.includes(foe.name)), '宿敌有一条消息')

  check(flattenTop({}, 85) === 85 && flattenTop({ difficulty: 'pro' }, 80) === 80, '拐点以下不压缩')
  check(Math.abs(flattenTop({ difficulty: 'pro' }, 96) - (DIFFICULTY.pro.topKnee + (96 - DIFFICULTY.pro.topKnee) * DIFFICULTY.pro.topSlope)) < 1e-9, '职业难度顶端按比例压缩')
  check(raiseDifficulty(g, 'hard') === null && g.difficulty === 'hard', '难度能往上调')
  check(raiseDifficulty(g, 'normal') !== null && g.difficulty === 'hard', '难度不能往下调')
}

// ---------------------------------------------------------------- pay demands
{
  const g = fresh()
  g.difficulty = 'hard'
  const p = squadOf(g, g.myTeam).sort((a, b) => b.overall - a.overall)[0]
  const worth = expectedSalary(p, g.teams[g.myTeam].tier)
  p.salary = Math.round(worth / 2)
  p.payAskedOn = g.day
  p.grievance = 10
  const m0 = p.morale
  payDemands(g, new Rng(1), [])
  check(p.grievance === 10 + DIFFICULTY.hard.payGrievance && p.morale === Math.max(10, m0 - 1),
    '加薪没兑现：每周不满上涨、士气 −1', `不满 ${p.grievance}，士气 ${m0}→${p.morale}`)
  p.salary = worth
  const g1 = p.grievance
  payDemands(g, new Rng(2), [])
  check(p.grievance === g1, '涨到身价之后不再加不满', `${g1}→${p.grievance}`)
}

// ---------------------------------------------------------------- 2 + 3. seasons
interface Run { w: number; l: number; heat: number; titles: number; nemesis: boolean }
function play(diff: 'normal' | 'hard' | 'pro' | 'old', maxed: boolean, seed: number, seasons: number): Run {
  const g = fresh(seed)
  if (diff === 'old') { delete g.scout; delete g.difficulty; delete g.nemesis }
  else if (diff !== 'normal') g.difficulty = diff
  const run: Run = { w: 0, l: 0, heat: 0, titles: 0, nemesis: false }
  for (let y = 0; y < seasons; y++) {
    if (maxed) {
      for (const p of squadOf(g, g.myTeam)) {
        for (const k of Object.keys(p.attrs) as (keyof typeof p.attrs)[]) p.attrs[k] = Math.max(p.attrs[k], 97)
        p.potential = 99
        recomputeOverall(p)
      }
      for (const m of poolFor(g)) g.teams[g.myTeam].mapPrefs[m] = Math.max(g.teams[g.myTeam].mapPrefs[m] ?? 50, 90)
    }
    const year = g.year
    const h0 = g.honours.length
    let guard = 0
    while (g.year === year && guard++ < 500) {
      g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
      if (g.midReview) continuePastFive(g)
      if (g.day % 7 === 0) for (const p of squadOf(g, g.myTeam)) g.training[p.id] = trainingAdvice(p, g.day).focus
      if (g.drillLock == null) { g.drill = aiDrillFor(g, g.teams[g.myTeam]); g.drillLock = g.day + 7 }
      const r = advanceDay(g, { autoResolveDrawDecisions: true })
      for (const f of r.playedMine) {
        if (f.scrim || !f.result) continue
        const won = (f.result.mapsWonA > f.result.mapsWonB) === (f.teamA === g.myTeam)
        won ? run.w++ : run.l++
      }
      run.heat = Math.max(run.heat, g.scout?.heat ?? 0)
    }
    run.titles += g.honours.length - h0
    run.nemesis ||= !!g.nemesis
  }
  return run
}
const rate = (r: Run) => r.w / Math.max(1, r.w + r.l)
const pct = (x: number) => `${(x * 100).toFixed(0)}%`

{
  const old = play('old', false, 20260924, 1)
  check(old.w + old.l > 30, '没有新字段的旧存档照常打完一个赛季', `${old.w}-${old.l}`)
  check(old.heat > 40, '强队打一季，针对度涨起来', `最高 ${old.heat}`)
}

{
  const seeds = [20260923, 20261024]
  const sum = (d: 'normal' | 'hard' | 'pro', maxed: boolean) => {
    const rs = seeds.map((s) => play(d, maxed, s, 2))
    return { rate: rs.reduce((a, r) => a + r.w, 0) / rs.reduce((a, r) => a + r.w + r.l, 0), titles: rs.reduce((a, r) => a + r.titles, 0) / (rs.length * 2), nemesis: rs.some((r) => r.nemesis) }
  }
  const nMax = sum('normal', true)
  const pMax = sum('pro', true)
  const nAuto = sum('normal', false)
  console.log(`     练满不变阵：普通 ${pct(nMax.rate)} ${nMax.titles.toFixed(1)} 冠/季 · 职业 ${pct(pMax.rate)} ${pMax.titles.toFixed(1)} 冠/季；开局阵容普通 ${pct(nAuto.rate)}`)
  // before this change the same stand-in won 99% and all six trophies a year
  check(pMax.rate < nMax.rate, '职业难度比普通难', `${pct(pMax.rate)} < ${pct(nMax.rate)}`)
  check(pMax.titles <= 4.5, '职业难度下练满也拿不满六个冠军', `${pMax.titles.toFixed(1)}/季`)
  check(nAuto.rate >= 0.65 && nAuto.rate <= 0.9, '普通难度开局强队仍然是强队', pct(nAuto.rate))
  check(nMax.nemesis, '称霸两季会冒出宿敌')
}

console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
