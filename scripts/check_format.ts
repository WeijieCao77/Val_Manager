/**
 * The circuit's shape, played through headlessly.
 *
 *   Masters   twelve teams; eight in a three-round Swiss, four through on two
 *             wins, four out on two losses; then a fourteen-match double
 *             elimination whose lower final and grand final are BO5
 *   Champions sixteen teams in four GSL groups of five matches each, two
 *             through per group, then the same double elimination
 *   Stage 1/2 an eight-team double elimination; Kickoff a four-team one
 *   Every competition ends with a champion and a full, duplicate-free order.
 *
 *   npx tsx scripts/check_format.ts
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason, championsField } from '../src/engine/season'
import { upcomingInternational } from '../src/engine/qualify'
import { REGIONS } from '../src/engine/types'
import type { Fixture, GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}

const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
const g: GameState = createNewGame(me.id, '赛制审计', 4242)
setupSeason(g)
let guard = 0
// the gap between our Kickoff ending and the Masters draw: the club must
// already be able to say where it is going
// Sealed before the final: once the lower final is played, its loser is third
// and booked for Masters while the champion is still undecided. Asked from
// that club's chair, the helper must already name the event; from the fourth
// place's chair it must not.
let sealed: { day: number; third: ReturnType<typeof upcomingInternational>; fourth: ReturnType<typeof upcomingInternational> } | null = null
while (g.day < 318 && guard++ < 600) {
  advanceDay(g)
  const kc = g.comps['kickoff:China']
  if (!sealed && kc?.bracketStarted && !kc.champion && kc.finished.length === kc.teams.length - 2) {
    const place = (id: string) => kc.teams.length - kc.finished.length + kc.finished.indexOf(id) + 1
    const third = kc.finished.find((id) => place(id) === 3)!
    const fourth = kc.finished.find((id) => place(id) === 4)!
    const was = g.myTeam
    g.myTeam = third; const a = upcomingInternational(g)
    g.myTeam = fourth; const b = upcomingInternational(g)
    g.myTeam = was
    sealed = { day: g.day, third: a, fourth: b }
  }
}

const fx = (key: string, prefix: string): Fixture[] =>
  g.fixtures.filter((f) => f.comp === key && f.label.startsWith(prefix))
const name = (f: Fixture) => f.label.split(':')[2] ?? ''
const winner = (f: Fixture) => (f.result!.mapsWonA > f.result!.mapsWonB ? f.teamA : f.teamB)

for (const key of ['masters1', 'masters2']) {
  const c = g.comps[key]
  console.log(`\n=== ${c?.name ?? key} ===`)
  check('exists', !!c); if (!c) continue
  check('12 teams', c.teams.length === 12, String(c.teams.length))
  const sw = fx(key, 'SW:')
  check('Swiss: 10 matches over 3 rounds', sw.length === 10, String(sw.length))
  check('Swiss: all BO3', sw.every((f) => f.bo === 3))
  const swissTeams = new Set(sw.flatMap((f) => [f.teamA, f.teamB]))
  check('Swiss: 8 teams', swissTeams.size === 8, String(swissTeams.size))
  const rec = (id: string) => ({ w: c.standings[id]?.w ?? 0, l: c.standings[id]?.l ?? 0 })
  const through = [...swissTeams].filter((id) => rec(id).w === 2)
  const out = [...swissTeams].filter((id) => rec(id).l === 2)
  check('Swiss: 4 through on two wins, 4 out on two losses', through.length === 4 && out.length === 4, `${through.length}/${out.length}`)
  check('Swiss: no rematch', new Set(sw.map((f) => [f.teamA, f.teamB].sort().join('|'))).size === sw.length)
  const ko = fx(key, 'KO:')
  check('playoffs: 14 matches', ko.length === 14, String(ko.length))
  const names = [...new Set(ko.map(name))]
  check('playoffs: upper, lower and grand final present',
    ['胜者组第一轮', '胜者组第二轮', '胜者组决赛', '败者组第一轮', '败者组第二轮', '败者组半决赛', '败者组决赛', '总决赛'].every((n) => names.includes(n)),
    names.join(','))
  check('lower final and grand final BO5', ko.filter((f) => ['败者组决赛', '总决赛'].includes(name(f))).every((f) => f.bo === 5))
  check('everything else BO3', ko.filter((f) => !['败者组决赛', '总决赛'].includes(name(f))).every((f) => f.bo === 3))
  const koTeams = new Set(ko.flatMap((f) => [f.teamA, f.teamB]))
  check('playoffs: 8 teams = 4 byes + 4 Swiss qualifiers', koTeams.size === 8 && through.every((t) => koTeams.has(t)), String(koTeams.size))
  const gf = ko.find((f) => name(f) === '总决赛')
  check('champion won the grand final', !!gf?.result && winner(gf) === c.champion)
  check('order complete and unique', c.finished.length === 12 && new Set(c.finished).size === 12, String(c.finished.length))
  check('order: champion first, Swiss losers last', c.finished[0] === c.champion && out.every((t) => c.finished.indexOf(t) >= 8))
  // a lost upper-bracket match must not end a team's run
  const ub1Losers = ko.filter((f) => name(f) === '胜者组第一轮').map((f) => (winner(f) === f.teamA ? f.teamB : f.teamA))
  check('upper-bracket losers play again', ub1Losers.every((t) => ko.some((f) => name(f) === '败者组第一轮' && (f.teamA === t || f.teamB === t))))
  const lastDay = Math.max(...ko.map((f) => f.day))
  const firstDay = Math.min(...sw.map((f) => f.day))
  console.log(`     ran day ${firstDay} → ${lastDay} (${lastDay - firstDay} days)`)
}

{
  const c = g.comps.champions
  console.log(`\n=== ${c?.name ?? 'champions'} ===`)
  check('exists', !!c)
  if (c) {
    check('16 teams, 4 per region', c.teams.length === 16 && REGIONS.every((r) => c.teams.filter((t) => g.teams[t]?.region === r).length === 4))
    const field = championsField(g)
    check('field = Stage 2 top two + points top two per region', REGIONS.every((r) => field[r].every((t) => c.teams.includes(t))))
    const ko = fx('champions', 'KO:')
    const groupMatches = ko.filter((f) => /^[A-D]组 /.test(name(f)))
    check('groups: 4 × 5 matches', groupMatches.length === 20, String(groupMatches.length))
    check('groups: one team per region in each', (c.groups ?? []).every((grp) => new Set(grp.map((t) => g.teams[t]?.region)).size === 4))
    const po = ko.filter((f) => !/^[A-D]组 /.test(name(f)))
    check('playoffs: 14 matches', po.length === 14, String(po.length))
    const gf = po.find((f) => name(f) === '总决赛')
    check('champion won the grand final', !!gf?.result && winner(gf) === c.champion)
    check('order complete and unique', c.finished.length === 16 && new Set(c.finished).size === 16, String(c.finished.length))
    const firstDay = Math.min(...ko.map((f) => f.day))
    const lastDay = Math.max(...ko.map((f) => f.day))
    console.log(`     ran day ${firstDay} → ${lastDay} (${lastDay - firstDay} days)`)
  }
}

console.log('\n=== regional ===')
for (const r of REGIONS) {
  for (const stage of ['kickoff', 'stage1', 'stage2']) {
    const key = `${stage}:${r}`
    const c = g.comps[key]
    if (!c) { check(`${key} exists`, false); continue }
    const ko = fx(key, 'KO:')
    const want = stage === 'kickoff' ? 6 : 14
    check(`${key}: ${want}-match double elimination, champion, full order`,
      ko.length === want && !!c.champion && c.finished.length === c.teams.length && new Set(c.finished).size === c.teams.length,
      `${ko.length} matches, ${c.finished.length}/${c.teams.length} placed`)
    const gf = ko.find((f) => name(f) === '总决赛')
    if (gf && gf.result) check(`${key}: champion won the grand final`, winner(gf) === c.champion)
  }
  const ch = g.comps[`challengers1:${r}`]
  if (ch) check(`challengers1:${r}: single bracket still concludes`, !!ch.champion)
}

// the Masters byes are the regional winners, the Swiss seeds the 2nd and 3rd
{
  const c = g.comps.masters1
  const winners = REGIONS.map((r) => g.comps[`kickoff:${r}`]?.finished[0]).filter(Boolean)
  const sw = fx('masters1', 'SW:')
  const swissTeams = new Set(sw.flatMap((f) => [f.teamA, f.teamB]))
  check('\nMasters I byes are the four Kickoff winners', !!c && winners.every((t) => c.teams.includes(t!) && !swissTeams.has(t!)))
  const seconds = REGIONS.flatMap((r) => (g.comps[`kickoff:${r}`]?.finished ?? []).slice(1, 3))
  check('Masters I Swiss field is the eight 2nd/3rd places', seconds.every((t) => swissTeams.has(t)))
}

{
  console.log(`\n=== the gap before the draw (Kickoff China final still to play, day ${sealed?.day}) ===`)
  check('the lower-final loser is told about Masters I before the final is played',
    !!sealed?.third && sealed.third.name === 'Masters I' && sealed.third.swiss && sealed.third.day >= 66 && sealed.third.day >= sealed.day + 3,
    JSON.stringify(sealed?.third))
  check('the fourth place is told nothing', sealed !== null && sealed.fourth === null, JSON.stringify(sealed?.fourth))
  check('once the draw exists the placeholder is gone', !!g.comps.masters1 && upcomingInternational(g) === null)
}

console.log(bad ? `\n${bad} FAILED` : '\nall held')
process.exit(bad ? 1 : 0)
