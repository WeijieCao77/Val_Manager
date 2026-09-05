/**
 * No two of our competitions on one day, and a real break between them.
 *
 * The Masters bracket is generated as it goes — its Swiss round opens when
 * every Kickoff has a champion, its playoffs eight days later, a round every
 * two days — while the league's rounds are laid down for fixed days at the
 * start of the season. Nothing tied the two together, and 「4/1 Masters I
 * 败者组决赛」 sat above 「4/1 Stage 1 第1轮」 in a manager's schedule.
 *
 * Plays whole seasons from several clubs and prints, per international, the
 * days it was played and the first day of the league after it; then sets a
 * season up on the calendar a save from before 2026-09-04 carries — Stage 1
 * from day 89, a round every six days — and plays it through the engine as
 * it is now, which has to move that league out of the Masters' way.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { BREAK_AFTER_INTERNATIONAL, LEAGUE_DAYS, SEASON_DAYS, STAGES, advanceDay, setupSeason } from '../src/engine/season'
import type { GameState } from '../src/engine/types'

const N = Number(process.argv[2] ?? 6)
const WANT = Number(process.argv[3] ?? 20)
let bad = 0
const check = (ok: boolean, what: string) => { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${what}`) }
const tags = ['PRX', 'EDG', 'SEN', 'FNC', 'KBG', 'TYL', 'G2', 'NRG']
const nextOf = { masters1: 'stage1', masters2: 'stage2', champions: 'offseason' } as const

function playAndReport(g: GameState, label: string, want: number): void {
  let guard = 0
  while (g.day < SEASON_DAYS - 2 && guard++ < 500) advanceDay(g)
  console.log(label)
  for (const key of ['masters1', 'masters2', 'champions'] as const) {
    const days = g.fixtures.filter((f) => f.comp === key).map((f) => f.day)
    const nextDays = g.fixtures.filter((f) => f.stage === nextOf[key]).map((f) => f.day)
    const last = Math.max(...days)
    const st = STAGES.find((s) => s.key === key)!
    check(days.length > 0 && last <= st.end, `${key} played ${Math.min(...days)}–${last}, inside its stage (ends ${st.end})`)
    if (nextDays.length) {
      const first = Math.min(...nextDays)
      check(first - last >= want, `${nextOf[key]} opens on ${first}, ${first - last} days after ${key}`)
    }
  }
  const mine = g.fixtures.filter((f) => f.teamA === g.myTeam || f.teamB === g.myTeam)
  const byDay = new Map<number, string[]>()
  for (const f of mine) byDay.set(f.day, [...(byDay.get(f.day) ?? []), f.comp])
  const clashes = [...byDay].filter(([, c]) => c.length > 1)
  check(!clashes.length, clashes.length
    ? `two of our matches on days ${clashes.map(([d, c]) => `${d}(${c.join('+')})`).join(', ')}`
    : `never two of our matches on one day (${mine.length} matches)`)
}

for (let i = 0; i < N; i++) {
  const team = WORLD_TEAMS.find((t) => t.tag === tags[i % tags.length])!
  const g = createNewGame(team.id, 'cal', 1000 + i * 7)
  setupSeason(g)
  playAndReport(g, `${team.tag} seed ${1000 + i * 7}`, WANT)
}

// a season set up before the calendar changed: Stage 1 from day 89, one
// round every six days, as the saves of 2026-09-03 carry it
{
  const team = WORLD_TEAMS.find((t) => t.tag === 'KBG')!
  const g = createNewGame(team.id, 'cal', 4242)
  setupSeason(g)
  const rounds = new Map<string, number>()
  for (const f of g.fixtures.filter((f) => f.stage === 'stage1')) {
    if (!rounds.has(f.label)) rounds.set(f.label, rounds.size)
    f.day = 89 + rounds.get(f.label)! * 6
  }
  const before = Math.min(...g.fixtures.filter((f) => f.stage === 'stage1').map((f) => f.day))
  console.log(`\nold save: Stage 1 laid down from day ${before} (${rounds.size} rounds, every 6 days)`)
  playAndReport(g, 'KBG on the 2026-09-03 calendar', BREAK_AFTER_INTERNATIONAL)
  const s1 = g.fixtures.filter((f) => f.stage === 'stage1' && !f.label.startsWith('KO:')).map((f) => f.day)
  check(Math.max(...s1) <= LEAGUE_DAYS.stage1[1] + 2, `its Stage 1 still ends by day ${Math.max(...s1)} (window ends ${LEAGUE_DAYS.stage1[1]})`)
}
console.log(bad ? `\n${bad} problem(s)` : '\nall good')
process.exit(bad ? 1 : 0)
