/**
 * Headless sanity run: play a full season and assert the world stays coherent.
 *   npx tsx scripts/smoke.ts [seasons]
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason, SEASON_DAYS, stageName } from '../src/engine/season'
import { statLine } from '../src/engine/player'
import { ratingOf } from '../src/engine/match'
import type { GameState } from '../src/engine/types'

const seasons = Number(process.argv[2] ?? 1)
const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
const state: GameState = createNewGame(me.id, '测试经理', 12345)
setupSeason(state)
// Which league a stat line was earned in is the tier the club held when the
// season began, not the one it holds after Ascension. REJECT farmed a second
// division all year and then won promotion; reading their tier at the end
// filed those totals under VCT and blamed VCT's calibration for them.
const startTier = new Map(Object.values(state.teams).map((t) => [t.id, t.tier]))

console.log(`managing ${state.teams[state.myTeam].name} (${state.teams[state.myTeam].league})`)
console.log(`fixtures generated: ${state.fixtures.length}`)

const t0 = Date.now()
let matches = 0
const titles: string[] = []
for (let s = 0; s < seasons; s++) {
  const yearStart = state.year
  while (state.year === yearStart) {
    const before = state.fixtures.filter((f) => f.played).length
    const r = advanceDay(state)
    matches += state.fixtures.filter((f) => f.played).length - before
    if (r.stageChanged) {
      console.log(`  day ${String(state.day).padStart(3)} → ${stageName(state.stage)}`)
    }
    // snapshot international results before the season rolls over and clears them
    for (const key of ['masters1', 'masters2', 'champions']) {
      const c = state.comps[key]
      if (c?.champion && !titles.some((t) => t.startsWith(`${yearStart} ${c.name}`))) {
        titles.push(`${yearStart} ${c.name}: ${state.teams[c.champion]?.name}`)
      }
    }
    if (state.day > SEASON_DAYS + 5) throw new Error('season did not roll over')
  }
}
const elapsed = Date.now() - t0

console.log('\ninternational titles:')
if (!titles.length) console.log('  ⚠️  none — international events never concluded')
for (const t of titles) console.log('  ' + t)

console.log(`\nsimulated ${seasons} season(s), ${matches} matches in ${elapsed}ms`)

// ---- invariants
const problems: string[] = []
for (const t of Object.values(state.teams)) {
  const squad = squadOf(state, t.id)
  // the human club is exempt: nobody re-signed its expiring contracts in a headless run
  if (t.id !== state.myTeam) {
    if (squad.length < 5) problems.push(`${t.name} has only ${squad.length} players`)
    if (t.starters.length !== 5) problems.push(`${t.name} has ${t.starters.length} starters`)
  } else if (squad.length < 5) {
    console.log(`\n(managed club ${t.name} is down to ${squad.length} players — expected, the UI warns the manager)`)
  }
  for (const id of t.roster) {
    if (!state.players[id]) problems.push(`${t.name} references missing player ${id}`)
    else if (state.players[id].teamId !== t.id) problems.push(`${id} teamId mismatch`)
  }
}
const tierCount: Record<string, number> = {}
for (const t of Object.values(state.teams)) {
  const k = `${t.region}/T${t.tier}`
  tierCount[k] = (tierCount[k] ?? 0) + 1
}
for (const [k, v] of Object.entries(tierCount)) {
  if (k.endsWith('T1') && v !== 12) problems.push(`${k} has ${v} teams (expected 12)`)
}

console.log('\nleague sizes:', tierCount)

// ---- did the competitions actually conclude?
const comps = Object.values(state.comps)
console.log(`competitions this season: ${comps.length}`)

// ---- statistical realism check on last season's totals
const played = Object.values(state.players).filter((p) => p.career.maps > 10)
played.sort((a, b) => statLine(b.career).acs - statLine(a.career).acs)
console.log('\ntop 8 by career ACS:')
for (const p of played.slice(0, 8)) {
  const s = statLine(p.career)
  console.log(
    `  ${p.ign.padEnd(12)} ${state.teams[p.teamId ?? '']?.name ?? 'FA'}`.padEnd(34) +
    `OVR ${p.overall}  ACS ${s.acs.toFixed(0)}  K/D ${s.kd.toFixed(2)}  ADR ${s.adr.toFixed(0)}  ` +
    `RAT ${ratingOf(p.career).toFixed(2)}  maps ${p.career.maps}`,
  )
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const lines = played.map((p) => statLine(p.career))
const acsAll = lines.map((l) => l.acs)
const kdAll = lines.map((l) => l.kd)
const pct = (xs: number[], q: number) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * q)]

console.log(
  `\nleague-wide  ACS ${avg(acsAll).toFixed(0)} avg / ${pct(acsAll, 0.95).toFixed(0)} p95 / ${Math.max(...acsAll).toFixed(0)} max` +
  `\n             K/D ${avg(kdAll).toFixed(2)} avg / ${pct(kdAll, 0.95).toFixed(2)} p95 / ${Math.max(...kdAll).toFixed(2)} max` +
  `\n             ADR ${avg(lines.map((l) => l.adr)).toFixed(0)}   KPR ${avg(lines.map((l) => l.kpr)).toFixed(2)}` +
  `   RAT ${avg(played.map((p) => ratingOf(p.career))).toFixed(2)}`,
)

// real VCT reference: ACS ~200 avg / ~270 elite, K/D 1.00 avg / ~1.35 elite, ADR ~135, KPR ~0.72
if (avg(acsAll) < 175 || avg(acsAll) > 235) problems.push(`ACS average ${avg(acsAll).toFixed(0)} outside 175-235`)
if (avg(kdAll) < 0.9 || avg(kdAll) > 1.12) problems.push(`K/D average ${avg(kdAll).toFixed(2)} outside 0.90-1.12`)
// Only judge players with a real sample, the way a stats leaderboard
// qualifies them — and judge the two tiers against their own yardsticks. The
// reference numbers above are VCT numbers, so holding a Challengers season to
// them compares against the wrong league: a VCT-calibre player stuck in a
// second division genuinely farms, which is the same gap the data build
// corrects for with SUBTIER_TO_VCT. Judging them together meant the league
// leader was whichever tier-2 star had the softest schedule, and the check
// passed or failed on him rather than on VCT being calibrated.
const qualifiedOf = (tier: 1 | 2) => played
  .filter((p) => p.career.maps >= 55 && (startTier.get(p.teamId ?? '') ?? 1) === tier)
  .map((p) => statLine(p.career).kd)
const t1Kd = qualifiedOf(1)
const t2Kd = qualifiedOf(2)
const topT1 = t1Kd.length ? Math.max(...t1Kd) : 0
const topT2 = t2Kd.length ? Math.max(...t2Kd) : 0
if (topT1 > 1.55) problems.push(`top VCT K/D ${topT1.toFixed(2)} too dominant (real max ~1.5)`)
if (topT2 > 1.95) problems.push(`top Challengers K/D ${topT2.toFixed(2)} beyond even a farmed second division`)
console.log(
  `qualified (55+ maps): VCT ${t1Kd.length} 人 top K/D ${topT1.toFixed(2)}, ` +
  `次级 ${t2Kd.length} 人 top K/D ${topT2.toFixed(2)}`,
)
if (avg(lines.map((l) => l.kpr)) < 0.6 || avg(lines.map((l) => l.kpr)) > 0.85) {
  problems.push(`KPR average ${avg(lines.map((l) => l.kpr)).toFixed(2)} outside 0.60-0.85`)
}

const ovr = Object.values(state.players).map((p) => p.overall).sort((a, b) => a - b)
console.log(`overall spread: ${ovr[0]} / ${ovr[Math.floor(ovr.length / 2)]} / ${ovr[ovr.length - 1]}`)
console.log(`players in world: ${Object.keys(state.players).length}`)
console.log(`board confidence: ${state.boardConfidence.toFixed(0)}   honours: ${state.honours.length}`)

if (problems.length) {
  console.log(`\n❌ ${problems.length} problem(s):`)
  for (const p of problems.slice(0, 25)) console.log('   -', p)
  process.exit(1)
}
console.log('\n✅ all invariants held')
