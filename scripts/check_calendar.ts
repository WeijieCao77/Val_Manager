/**
 * The year holds together: stages tile it with no gap, every international
 * opens inside its own stage with room for its rounds, the market's windows
 * sit in the breaks, and the host cities are three different places that
 * were not last year's. Then one season is played through with the club
 * that wins its region, and the poster's subject appears when its place is
 * sealed and names the city the event is later created with.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { INTERNATIONAL_OPEN, SEASON_DAYS, STAGES, advanceDay, setupSeason } from '../src/engine/season'
import { TRANSFER_WINDOWS } from '../src/engine/transfer'
import { hostCities } from '../src/engine/hosts'
import { qualifiedEvent } from '../src/engine/qualify'

let bad = 0
const check = (ok: boolean, what: string) => { if (!ok) { bad++; console.log('  ✗', what) } else console.log('  ✓', what) }

console.log('calendar')
for (let i = 0; i < STAGES.length; i++) {
  const s = STAGES[i], next = STAGES[i + 1]
  if (next) check(next.start === s.end + 1, `${s.name} ${s.start}-${s.end} runs straight into ${next.name}`)
}
check(STAGES[0].start === 0 && STAGES[STAGES.length - 1].end === SEASON_DAYS - 1, `stages cover 0..${SEASON_DAYS - 1}`)
for (const [key, open] of Object.entries(INTERNATIONAL_OPEN)) {
  const st = STAGES.find((s) => s.key === key)!
  check(open - st.start >= 10, `${st.name} opens on day ${open}, ${open - st.start} days into its stage (a break first)`)
  check(st.end - open >= 20, `${st.name} has ${st.end - open} days after opening for Swiss/groups and a double-elim`)
}
check(TRANSFER_WINDOWS.every(([a, b]) => a < b && a >= 0 && b < SEASON_DAYS), 'transfer windows sit inside the year')
check(TRANSFER_WINDOWS[1][0] === STAGES.find((s) => s.key === 'masters1')!.start, 'the spring window opens the day Kickoff ends')
check(TRANSFER_WINDOWS[3][0] === STAGES.find((s) => s.key === 'offseason')!.start, 'the offseason window opens with the offseason')

console.log('host cities')
const seen = new Set<string>()
let prev: string[] = []
for (let y = 2026; y < 2036; y++) {
  const c = Object.values(hostCities(9001, y))
  check(new Set(c).size === 3, `${y}: ${c.join('、')} — three different cities`)
  if (prev.length) check(!c.some((x) => prev.includes(x)), `${y}: none repeats ${prev.join('、')}`)
  prev = c; c.forEach((x) => seen.add(x))
}
check(seen.size >= 12, `ten years visit ${seen.size} different cities`)
check(hostCities(9001, 2028).masters1 !== hostCities(9002, 2028).masters1 || hostCities(9001, 2028).champions !== hostCities(9002, 2028).champions, 'a different seed travels differently')

console.log('a season, from the strongest club')
const strongest = WORLD_TEAMS.find((t) => t.tag === 'PRX')!
const g = createNewGame(strongest.id, 'cal', 4242)
setupSeason(g)
let firstPoster: { day: number; key: string; city: string; how: string } | null = null
let guard = 0
while (g.day < SEASON_DAYS - 2 && guard++ < 500) {
  advanceDay(g)
  const q = qualifiedEvent(g)
  if (q && !firstPoster) firstPoster = { day: g.day, key: q.key, city: q.city, how: q.how }
}
check(!!firstPoster, `a poster appeared: ${JSON.stringify(firstPoster)}`)
if (firstPoster) {
  const comp = g.comps[firstPoster.key]
  check(!!comp?.city && comp.city === firstPoster.city, `the event was created in the city the poster named (${comp?.city})`)
  const first = g.fixtures.filter((f) => f.comp === firstPoster!.key).sort((a, b) => a.day - b.day)[0]
  check(!!first && first.day > firstPoster.day, `the poster came ${first ? first.day - firstPoster.day : '?'} days before the event's first match`)
}
for (const key of ['masters1', 'masters2', 'champions'] as const) {
  const comp = g.comps[key]
  const days = g.fixtures.filter((f) => f.comp === key).map((f) => f.day)
  const st = STAGES.find((s) => s.key === key)!
  check(!!comp?.champion, `${key} concluded (champion ${comp?.champion ? g.teams[comp.champion]?.tag : '—'})`)
  check(days.length > 0 && Math.min(...days) >= st.start && Math.max(...days) <= st.end, `${key} played on days ${Math.min(...days)}–${Math.max(...days)} inside ${st.start}–${st.end}`)
}
const lastRegional = Math.max(...g.fixtures.filter((f) => f.stage === 'stage2').map((f) => f.day))
check(lastRegional < INTERNATIONAL_OPEN.champions - 7, `Stage 2 ended on day ${lastRegional}, ${INTERNATIONAL_OPEN.champions - lastRegional} days before Champions opens`)
console.log(bad ? `\n${bad} problem(s)` : '\nall good')
process.exit(bad ? 1 : 0)
