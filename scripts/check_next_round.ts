/**
 * A side beaten in a regional upper final knows its next match.
 *
 * The bracket is drawn one wave at a time, so after the upper final the
 * lower final does not exist yet, and the top bar counted down to a league
 * game nine weeks away: 「下一场：TYL · 63天后」 over a 败者组决赛 two days
 * on. The round is known from the format; only the opponent is not. Plays
 * a season until some regional upper final has been played with the lower
 * semi still to come, stands in the loser's shoes and asks nextInEvent.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { SEASON_DAYS, advanceDay, setupSeason, nextRealFixtureFor } from '../src/engine/season'
import { nextInEvent, eventRounds } from '../src/engine/qualify'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'PRX')!.id, '审计经理', 20260905)
setupSeason(g)
let found: { comp: string; loser: string; day: number } | null = null
let guard = 0
while (!found && g.day < SEASON_DAYS - 2 && guard++ < 500) {
  advanceDay(g)
  for (const comp of Object.values(g.comps)) {
    if (comp.format !== 'double' || !comp.bracketStarted || comp.champion) continue
    const ubf = g.fixtures.find((f) => f.comp === comp.key && f.played && f.label.endsWith(':胜者组决赛'))
    const lbf = g.fixtures.find((f) => f.comp === comp.key && f.label.endsWith(':败者组决赛'))
    if (ubf && !lbf) {
      const loser = ubf.result!.mapsWonA > ubf.result!.mapsWonB ? ubf.teamB : ubf.teamA
      found = { comp: comp.key, loser, day: ubf.day }
      break
    }
  }
}
check('a regional upper final has been played with the lower final not yet drawn', !!found, JSON.stringify(found))
if (found) {
  g.myTeam = found.loser
  const real = nextRealFixtureFor(g, g.myTeam)
  const next = nextInEvent(g)
  console.log(`  ${g.teams[found.loser].tag} lost the upper final of ${found.comp} on day ${found.day}; next real fixture day ${real?.day ?? '—'}`)
  check('nextInEvent names the lower final', next?.round === '季后赛 败者组决赛', JSON.stringify(next && { comp: next.comp.key, day: next.day, round: next.round }))
  const lbfDay = eventRounds(g, g.comps[found.comp]).find((r) => r.name === '败者组决赛')?.day
  check('on the lower final\'s day — two waves after the upper final', !!next && next.day === lbfDay && lbfDay === found.day + 4, `${next?.day} vs ${lbfDay}`)
  check('and before whatever the fixture list says', !!next && (!real || next.day < real.day), `${next?.day} < ${real?.day}`)
  const rounds = eventRounds(g, g.comps[found.comp])
  check('the playoff rounds are dated from the bracket, not from the league', rounds.length === 6 && rounds[0].day >= found.day - 4,
    rounds.map((r) => `${r.name}@${r.day}${r.drawn ? '' : '?'}`).join(', '))
  // play on: the lower final actually arrives on that day with us in it
  let steps = 0
  while (steps++ < 6 && !g.fixtures.some((f) => f.comp === found!.comp && f.label.endsWith(':败者组决赛'))) advanceDay(g)
  const lbf = g.fixtures.find((f) => f.comp === found!.comp && f.label.endsWith(':败者组决赛'))
  check('the lower final is drawn on the projected day with us in it', !!lbf && lbf.day === lbfDay && (lbf.teamA === g.myTeam || lbf.teamB === g.myTeam),
    lbf ? `day ${lbf.day}, ${g.teams[lbf.teamA]?.tag} v ${g.teams[lbf.teamB]?.tag}` : 'none')
}
console.log(bad ? `\n${bad} problem(s)` : '\nall good')
process.exit(bad ? 1 : 0)
