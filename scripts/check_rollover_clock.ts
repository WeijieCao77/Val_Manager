/**
 * A fourteen-day wait that spans New Year is still a fourteen-day wait.
 *
 * The rollover sets day = 0 and used to leave every forward-looking timer at
 * its old absolute number. Two players sent screenshots of the wreckage: a
 * sponsor-pitch cooldown reading "296 天后可以再谈" (it is written as
 * day + 14), and a pending transfer bid waiting "334 天" for an answer that is
 * written as day + 7..10. This plays a career across the boundary and checks
 * every timer the state carries.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, SEASON_DAYS, setupSeason } from '../src/engine/season'
import { makeOffer, enquireAbout } from '../src/engine/transfer'
import { pitchSponsor } from '../src/engine/commercial'
import { Rng } from '../src/engine/rng'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计经理', 20260825)
setupSeason(g)
const rng = new Rng(9)

// play deep into the offseason, where the transfer window is open: close
// enough to the boundary that a bid's 7–10 day answer lands past it. This
// was a literal 328 from the 336-day year, and with the year at 364 the
// answer to a bid on day 328 fell on day 337, safely inside the season.
const LATE = SEASON_DAYS - 6
let guard = 0
while (!g.gameOver && guard++ < 500 && !(g.stage === 'offseason' && g.day >= LATE)) {
  advanceDay(g, rng)
}
check('reached late offseason', g.stage === 'offseason' && g.day >= LATE, `day ${g.day} of ${SEASON_DAYS}`)

// 1) the sponsor pitch from the screenshot: written as a fortnight
pitchSponsor(g)
const cdBefore = (g.pitchCooldown ?? 0) - g.day
check('a pitch cooldown is a fortnight when set', cdBefore <= 14, `${cdBefore} 天`)

// 2) a transfer bid whose answer lands past the rollover
// (the roster cap now refuses an eighth man, so make room first)
{
  const me = g.teams[g.myTeam]
  while (me.roster.length >= 7) {
    const cutId = me.roster[me.roster.length - 1]
    me.roster = me.roster.filter((id) => id !== cutId)
    me.starters = me.starters.filter((id) => id !== cutId)
    g.players[cutId].teamId = null
  }
}
g.finances.balance = 50_000_000
const mark = Object.values(g.players)
  .filter((p) => p.teamId && p.teamId !== g.myTeam)
  .sort((a, b) => b.overall - a.overall)[0]
const off = makeOffer(g, mark.id, g.myTeam, 100_000,
  { salary: mark.salary, years: 2, signingBonus: 0, bonusShare: 0, releaseClause: 0 } as never)!
check('the bid straddles the boundary', (off.respondOn ?? 0) >= SEASON_DAYS, `答复日 ${off.respondOn}`)

// 3) an enquiry, an injury and a listing that straddle it too
enquireAbout(g, Object.values(g.players).filter((p) => p.teamId && p.teamId !== g.myTeam)[5].id)
const hurt = squadOf(g, g.myTeam)[0]
hurt.injuredUntil = g.day + 12
const listed = Object.values(g.players).find((p) => p.teamId && p.teamId !== g.myTeam && p.listed)

// cross into the new season
guard = 0
while (!g.gameOver && guard++ < 60 && g.stage === 'offseason') advanceDay(g, rng)
check('the season rolled over', g.day < 40, `now day ${g.day}, ${g.year}`)

// the cooldown must still be a fortnight, not eleven months
const cdAfter = (g.pitchCooldown ?? 0) - g.day
check('the pitch cooldown survives as days, not as a season',
  cdAfter <= 14, `还剩 ${cdAfter} 天`)

// the bid must be answered on its original schedule
const wait = (off.respondOn ?? 0) - g.day
check('the pending bid is due within its week, not in 334 days',
  wait <= 12, `还需等待 ${wait} 天`)

// the injury heals on schedule
check('the injury heals in days, not seasons',
  hurt.injuredUntil - g.day <= 12, `还伤 ${Math.max(0, hurt.injuredUntil - g.day)} 天`)

// nothing else in the state still points a year ahead
const horizon = g.day + 40
const stragglers: string[] = []
for (const o of g.offers) if (o.status === 'pending' && (o.respondOn ?? 0) > horizon) stragglers.push(`offer:${o.id}`)
for (const e of g.enquiries ?? []) if (!e.answer && e.replyOn > horizon) stragglers.push(`enquiry:${e.id}`)
for (const t of g.sponsorTalks ?? []) if (!('answer' in t && t.answer) && t.replyOn > horizon) stragglers.push(`talk:${t.id}`)
for (const o of g.staffOffers ?? []) if (!o.answer && o.replyOn > horizon) stragglers.push(`staff:${o.id}`)
for (const p of Object.values(g.players)) {
  if (p.injuredUntil > horizon) stragglers.push(`injury:${p.ign}`)
  if (p.stream && p.stream.until > g.day + 120) stragglers.push(`stream:${p.ign}`)
}
check('no timer still points a season ahead', stragglers.length === 0, stragglers.slice(0, 5).join(' '))

// and the answer actually arrives: play a fortnight and look
guard = 0
while (guard++ < 15 && off.status === 'pending') advanceDay(g, rng)
check('the bid actually gets its answer in the new season',
  off.status !== 'pending', `status=${off.status}`)

// ---- a sponsor's terms survive the seven-day stride
// The success branch never recorded an answer, so the same talk re-entered the
// resolver every day and re-rolled the odds — seven re-rolls per offseason
// turn, so it nearly always hit the rejection branch before the player saw it.
{
  const g2 = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', 20260825)
  setupSeason(g2)
  const { pitchSponsor: pitch, signSponsor } = await import('../src/engine/commercial')
  const rng2 = new Rng(21)
  let offered = 0, signed = 0, tries = 0
  while (tries < 30) {
    g2.pitchCooldown = 0
    pitch(g2)
    tries++
    for (let i = 0; i < 21; i++) advanceDay(g2, rng2)   // three strides past the reply
    const t = (g2.sponsorTalks ?? []).find((x) => x.answer === 'offer')
    if (t) {
      offered++
      const before = g2.teams[g2.myTeam].sponsors.length
      signSponsor(g2, t.id)
      if (g2.teams[g2.myTeam].sponsors.length === before + 1) signed++
      break
    }
  }
  check('an offer survives weeks untouched and still signs',
    offered > 0 && signed > 0, `${tries} 次尝试后拿到并签下`)
  const reRolled = (g2.sponsorTalks ?? []).some((t) => !t.answer && t.replyOn <= g2.day)
  check('no talk keeps re-rolling after its reply day', !reRolled)
}

process.exit(bad ? 1 : 0)
