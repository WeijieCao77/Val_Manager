/**
 * The economy has two failure modes, and both were reported in one message:
 * a manager who pitched every fortnight compounded to forty deals and money
 * that stopped mattering, while one who never found the button starved on two
 * starting contracts. Five sponsor slots, pitches priced off the club rather
 * than off existing deals, sponsors who knock on their own, streaming that
 * fluctuates and spikes when the team wins, and prize money that moves a
 * balance sheet.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { setupSeason } from '../src/engine/season'
import {
  dropSponsor, pitchSponsor, resolveSponsorTalks, signSponsor, SPONSOR_MAX, streamWeek,
} from '../src/engine/commercial'
import { PRIZE } from '../src/engine/finance'
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'WBG')!.id, '审计', 20260828)
  setupSeason(g)
  return g
}

// ---- five slots, and the pitch says so
{
  const g = mk()
  const me = g.teams[g.myTeam]
  while (me.sponsors.length < SPONSOR_MAX) {
    me.sponsors.push({ name: `T${me.sponsors.length}`, perSeason: 100000, bonusPlacement: 4, bonus: 20000 })
  }
  check('a full book refuses a sixth pitch', pitchSponsor(g).includes('栏位已满'))
  // addressed by row index, not by name: two contracts with the same partner
  // used to make "end this one" ambiguous and it always ended the first
  check('walking away frees the slot',
    dropSponsor(g, me.sponsors.length - 1).includes('解约') && me.sponsors.length === SPONSOR_MAX - 1)
  check('and the pitch resumes', !pitchSponsor(g).includes('栏位已满'))
}

// ---- pitches are priced off the club, not off the deals it already holds
{
  const poor = mk()
  poor.teams[poor.myTeam].sponsors = []
  pitchSponsor(poor)
  const rich = mk()
  rich.teams[rich.myTeam].sponsors = Array.from({ length: 4 }, (_, i) =>
    ({ name: `巨头${i}`, perSeason: 5_000_000, bonusPlacement: 4, bonus: 500000 }))
  pitchSponsor(rich)
  const a = poor.sponsorTalks![0].base
  const b = rich.sponsorTalks![0].base
  check('an empty book and a stacked one are quoted alike', b < a * 2 && a < b * 2,
    `空手 $${a} vs 满手 $${b}`)
}

// ---- sponsors knock on their own for a club light on deals
{
  const g = mk()
  g.teams[g.myTeam].sponsors = g.teams[g.myTeam].sponsors.slice(0, 1)
  const rng = new Rng(21)
  let knocked = false
  for (let d = 0; d < 250 && !knocked; d++) {
    g.day += 1
    resolveSponsorTalks(g, rng)
    knocked = (g.sponsorTalks ?? []).some((t) => t.id.startsWith('SPIN') && t.answer === 'offer')
  }
  check('within a season, someone comes to the door', knocked)
}

// ---- streaming fluctuates, and wins fill the gift feed
{
  const g = mk()
  const p = squadOf(g, g.myTeam)[0]
  p.stream = { platform: '虎牙', fee: 480000, nights: 2, months: 12, until: g.day + 300 }
  const rng = new Rng(31)
  const weeks: number[] = []
  for (let w = 0; w < 12; w++) {
    const before = g.finances.balance
    streamWeek(g, rng, [])
    weeks.push(g.finances.balance - before)
  }
  check('stream income moves week to week', new Set(weeks).size > 1,
    `${Math.min(...weeks)}~${Math.max(...weeks)}`)
  const noGift = g.finances.log.some((l) => l.label.includes('直播礼物'))
  check('no wins, no gifts', !noGift)
  g.fixtures.push({
    id: 'W1', day: g.day - 2, stage: g.stage, comp: 'Challengers China', teamA: g.myTeam,
    teamB: Object.keys(g.teams).find((id) => id !== g.myTeam)!, bo: 3, label: '测试',
    played: true, result: { mapsWonA: 2, mapsWonB: 0 } as never,
  } as never)
  streamWeek(g, rng, [])
  check('a win brings gifts', g.finances.log.some((l) => l.label.includes('直播礼物') && l.amount > 0))
}

// ---- trophies move a balance sheet
check('a Challengers title is worth winning', PRIZE.challengers1[0] >= 80000 && PRIZE.challengers2[0] >= 120000,
  `${PRIZE.challengers1[0]} / ${PRIZE.challengers2[0]}`)
check('Champions pays like the biggest event in the game', PRIZE.champions[0] >= 1500000)

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
