/**
 * What the group reported on 2026-09-05, asked of the engine directly.
 *
 *   npx tsx scripts/check_ai_parity.ts
 *
 * Five points from the group and four from the owner, in one file because
 * they were one message: AI clubs that only ever trained one attribute per
 * man (no map week, no tape, no learner on a missing role, no physio, no
 * building), a club reputation that never moved, a board that asked the
 * weakest side of twelve for ninth, a bid at the printed asking price that
 * was refused with a note quoting the same number back, and an advance
 * button that promised seven days over a gap the calendar showed as four.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import {
  advanceDay, CLUB_REP, deservedReputation, SEASON_DAYS, settleClubReputation, settleCompetition, setupSeason,
} from '../src/engine/season'
import { cycleDays } from '../src/engine/actions'
import { nextInEvent } from '../src/engine/qualify'
import {
  AI_FACILITY_RESERVE, AI_PHYSIO_AT, AI_PHYSIO_RESERVE, AI_TEAM_SESSION_EVERY, aiClubWeek, aiDrillFor, aiFacilityUpgrade,
  MAP_DECAY_AFTER, MAP_DECAY_FLOOR, MAP_DECAY_PER_WEEK, markMapSeen, PHYSIO_COST, weeklyTick,
} from '../src/engine/training'
import { askingPrice, clubAcceptsFee, makeOffer, resolveDueOffers } from '../src/engine/transfer'
import { expectedSalary } from '../src/engine/player'
import { poolFor } from '../src/engine/match'
import { MAPS } from '../src/engine/content'
import { Rng } from '../src/engine/rng'
import { defaultContract } from '../src/engine/types'
import type { Competition, GameState, Player, Team } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (tag = 'EDG', seed = 20260905): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === tag)!.id, '审计', seed)
  setupSeason(g)
  return g
}
const MAPS_OFF_POOL = (g: GameState) => MAPS.filter((m) => !poolFor(g).includes(m))
const ai = (g: GameState, pick?: (t: Team) => boolean) =>
  Object.values(g.teams).find((t) => t.id !== g.myTeam && (!pick || pick(t)))!

// ---- 推进 says how many days it will actually run
{
  const g = mk()
  check('a week with nothing on: 7', cycleDays(g) === 7, `${cycleDays(g)}`)
  const first = g.fixtures.filter((f) => !f.played && (f.teamA === g.myTeam || f.teamB === g.myTeam)).sort((a, b) => a.day - b.day)[0]
  g.day = first.day - 4
  check('a fixture four days out: one day at a time', cycleDays(g) === 1, `${cycleDays(g)}`)
  g.day = first.day - 7
  check('seven days out is still a week', cycleDays(g) === 7, `${cycleDays(g)}`)
  const g2 = mk()
  g2.day = SEASON_DAYS - 3
  check('three days before the rollover the turn is three days', cycleDays(g2) === 3, `${cycleDays(g2)}`)
  // a round whose date is known but whose tie is not: play a strong club
  // into a regional playoff and find the day it waits on the other bracket
  const g3 = mk('PRX')
  let found: string | null = null
  const rng = new Rng(5)
  for (let d = 0; d < 260 && !found; d++) {
    advanceDay(g3, rng)
    const fx = g3.fixtures.some((f) => !f.played && f.comp !== 'scrim' && (f.teamA === g3.myTeam || f.teamB === g3.myTeam) && f.day - g3.day < 7)
    const ev = nextInEvent(g3)
    if (!fx && ev && ev.day - g3.day >= 1 && ev.day - g3.day < 7) {
      found = `day ${g3.day}: ${ev.round} on day ${ev.day}, no fixture yet → 推进 ${cycleDays(g3)}`
      check('an undrawn round inside the week is a one-day turn, not seven', cycleDays(g3) === 1, found)
    }
  }
  if (!found) console.log('     (no undrawn-round gap under seven days met in 260 days — skipped)')
}

// ---- a bid at the printed price is a sale; a club that cannot sell says why
{
  const g = mk()
  g.day = 5
  const rng = new Rng(9)
  const targets = Object.values(g.players).filter((p) => p.teamId && p.teamId !== g.myTeam && squadOf(g, p.teamId).length >= 6 && p.overall < 80)
  let refusedOnPrice = 0
  let tried = 0
  for (const p of targets.slice(0, 40)) {
    tried++
    if (!clubAcceptsFee(p, askingPrice(p), rng)) refusedOnPrice++
  }
  check('the club never refuses its own asking price', refusedOnPrice === 0, `${refusedOnPrice}/${tried}`)
  let under = 0
  for (const p of targets.slice(0, 40)) if (!clubAcceptsFee(p, askingPrice(p) * 0.6, rng)) under++
  check('and never talks under seventy percent of it', under === 40, `${under}/40`)
  // the message at a five-man club with nobody left to sign names the squad
  const g2 = mk()
  g2.day = 5
  for (const p of Object.values(g2.players)) if (!p.teamId) delete g2.players[p.id]
  // room on our side, so the only thing that can refuse is theirs
  const mine = g2.teams[g2.myTeam]
  while (mine.roster.length > 5) {
    const gone = mine.roster.pop()!
    mine.starters = mine.starters.filter((id) => id !== gone)
    delete g2.players[gone]
  }
  const thin = ai(g2, (t) => squadOf(g2, t.id).length === 5)
  const seller = squadOf(g2, thin.id).sort((a, b) => a.overall - b.overall)[0]
  const terms = { ...defaultContract(Math.round(expectedSalary(seller, 1) * 1.8), 2), signingBonus: 50000 }
  const offer = makeOffer(g2, seller.id, g2.myTeam, askingPrice(seller), terms)!
  offer.respondOn = g2.day
  const notes = resolveDueOffers(g2, new Rng(2))
  const line = notes.find((n) => n.includes(thin.name)) ?? ''
  check('a five-man club with no free agent says it is the squad, not the price', line.includes('只剩五名') && !line.includes('要价'), line)
}

// ---- the board asks the bottom half for one place, not a quarter of the table
{
  const g = mk('KBG')
  const rng = new Rng(3)
  let guard = 0
  while (!g.objective && guard++ < 200) advanceDay(g, rng)
  const me = g.teams[g.myTeam]
  const peers = Object.values(g.teams).filter((t) => t.region === me.region && t.tier === me.tier).sort((a, b) => b.rating - a.rating)
  const place = peers.findIndex((t) => t.id === me.id) + 1
  const size = peers.length
  const half = Math.ceil(size / 2)
  const want = place <= 2 ? place : place <= half ? Math.max(2, Math.ceil(place * 0.75)) : Math.max(half, place - 1)
  check(`the brief follows the table: rated ${place}/${size} → asked for ${g.objective?.placeAtLeast}`,
    g.objective?.placeAtLeast === want, g.objective?.text ?? 'no objective')
  // and the shape at twelve: last is asked for eleventh, tenth for ninth
  const shape = (p: number, n = 12) => { const h = Math.ceil(n / 2); return p <= 2 ? p : p <= h ? Math.max(2, Math.ceil(p * 0.75)) : Math.max(h, p - 1) }
  check('of twelve: 12→11, 10→9, 7→6, 4→3', shape(12) === 11 && shape(10) === 9 && shape(7) === 6 && shape(4) === 3)
}

// ---- reputation moves: on a trophy, in the winter, on going up or down
{
  const g = mk()
  const club = ai(g, (t) => t.tier === 1)
  const before = club.reputation
  const comp = (stage: string, region?: string): Competition => ({
    key: 'k', stage, name: '测试杯', region, teams: [club.id, ...Object.keys(g.teams).slice(0, 7)],
    finished: [club.id], champion: club.id, awarded: false,
  } as unknown as Competition)
  settleCompetition(g, comp('stage1', club.region))
  check('a regional title moves an AI club', club.reputation === before + CLUB_REP.regional, `${before} → ${club.reputation}`)
  settleCompetition(g, comp('champions'))
  check('a world title moves it more', club.reputation === before + CLUB_REP.regional + CLUB_REP.champions, `→ ${club.reputation}`)

  const g2 = mk()
  const t2 = ai(g2, (t) => t.tier === 2)
  t2.reputation = 75             // a relegated side's old name
  const order = Object.values(g2.teams).filter((t) => t.region === t2.region && t.tier === 2).map((t) => t.id)
  const target = deservedReputation(t2, order)
  settleClubReputation(g2, [])
  check('a second-division club carrying a VCT name loses a third of the gap each winter',
    target < 60 && Math.abs(t2.reputation - (75 + (target - 75) * CLUB_REP.pull)) < 1e-6, `deserved ${target.toFixed(1)}, now ${t2.reputation.toFixed(1)}`)
  const t1 = ai(g2, (t) => t.tier === 1 && t.rating >= 80)
  t1.reputation = 50
  const order1 = Object.values(g2.teams).filter((t) => t.region === t1.region && t.tier === 1).sort((a, b) => b.rating - a.rating).map((t) => t.id)
  const up = deservedReputation(t1, order1)
  check('a strong VCT side at 50 is pulled up toward the seventies', up >= 68, `deserved ${up.toFixed(1)}`)
}

// ---- AI clubs run the team sessions the manager runs, when they need them
{
  const g = mk()
  const rng = new Rng(4)
  const club = ai(g, (t) => t.tier === 1 && squadOf(g, t.id).length >= 5)
  // a hole in the five: nobody covers 哨卫
  for (const p of squadOf(g, club.id)) { p.roles = ['决斗者', '先锋', '控场']; p.role = '决斗者'; p.rolePro = {} }
  const d1 = aiDrillFor(g, club)
  check('a five with no sentinel puts a learner on it', d1.kind === 'agent' && d1.role === '哨卫', JSON.stringify(d1))
  // the pool's weakest map gets run
  for (const p of squadOf(g, club.id)) { p.roles = ['决斗者', '先锋', '控场', '哨卫'] }
  const pool = poolFor(g)
  for (const m of pool) club.mapPrefs[m] = 80
  club.mapPrefs[pool[3]] = 30
  const d2 = aiDrillFor(g, club)
  check('an uncomfortable pool map gets a map week', d2.kind === 'map' && (d2.map === pool[3] || d2.map2 === pool[3]), JSON.stringify(d2))
  // comfortable everywhere on a non-map week: the coach takes them through the tape
  club.mapPrefs[pool[3]] = 80
  g.day = 7 * (Math.floor(g.day / 7) + 1)
  if (Math.floor(g.day / 7) % 3 === 0) g.day += 7
  const d3 = aiDrillFor(g, club)
  check('a comfortable club reviews', d3.kind === 'review', JSON.stringify(d3))
  // the week actually moves the numbers
  g.day = 7 * AI_TEAM_SESSION_EVERY * 3   // a session week
  g.stage = 'stage1'
  const pool1 = poolFor(g)                 // the pool turns over with the stage
  for (const m of pool1) club.mapPrefs[m] = 80
  club.mapPrefs[pool1[0]] = 40
  club.mapPrefs[pool1[1]] = 40
  for (const p of squadOf(g, club.id)) p.fatigue = 20
  const xp0 = squadOf(g, club.id).reduce((s, p) => s + (p.xp.teamwork ?? 0) + (p.xp.awareness ?? 0), 0)
  aiClubWeek(g, club, rng)
  const xp1 = squadOf(g, club.id).reduce((s, p) => s + (p.xp.teamwork ?? 0) + (p.xp.awareness ?? 0), 0)
  check('a map week raises comfort on the two maps run', club.mapPrefs[pool1[0]] > 40 && club.mapPrefs[pool1[1]] > 40, `${club.mapPrefs[pool1[0]].toFixed(1)}, ${club.mapPrefs[pool1[1]].toFixed(1)}`)
  check('and the squad banks teamwork and awareness', xp1 > xp0, `${xp0.toFixed(1)} → ${xp1.toFixed(1)}`)
  // the off week is an off week
  const g4 = mk()
  const c4 = ai(g4, (t) => t.tier === 1)
  g4.day = 7 * (AI_TEAM_SESSION_EVERY * 3 + 1)
  g4.stage = 'stage1'
  const before4 = { ...c4.mapPrefs }
  const xp4 = squadOf(g4, c4.id).reduce((s, p) => s + (p.xp.teamwork ?? 0) + (p.xp.awareness ?? 0) + (p.xp.communication ?? 0), 0)
  for (const p of squadOf(g4, c4.id)) p.fatigue = 20
  aiClubWeek(g4, c4, new Rng(1))
  const xp5 = squadOf(g4, c4.id).reduce((s, p) => s + (p.xp.teamwork ?? 0) + (p.xp.awareness ?? 0) + (p.xp.communication ?? 0), 0)
  check(`every ${AI_TEAM_SESSION_EVERY === 2 ? 'other' : AI_TEAM_SESSION_EVERY + 'th'} week is scrims and travel: no session`,
    JSON.stringify(before4) === JSON.stringify(c4.mapPrefs) && xp4 === xp5)
}

// ---- the physio room and the building, at our prices, within their means
{
  const g = mk()
  const rich = ai(g, (t) => t.tier === 1 && t.budget > 3_000_000)
  const tired = squadOf(g, rich.id)[0]
  tired.fatigue = AI_PHYSIO_AT + 20
  const budget = rich.budget
  g.day = 7 * (AI_TEAM_SESSION_EVERY * 3 + 1)   // an off week, so only the table moves anything
  g.stage = 'stage1'
  aiClubWeek(g, rich, new Rng(6))
  check('a rich club treats a tired man', tired.fatigue <= AI_PHYSIO_AT + 20 - 35 + 0.01 && rich.budget === budget - PHYSIO_COST && g.physioOn?.[tired.id] === g.day,
    `fatigue ${tired.fatigue.toFixed(0)}, budget ${budget} → ${rich.budget}`)
  const poor = ai(g, (t) => t.tier === 2)
  poor.budget = AI_PHYSIO_RESERVE[2]
  const t2 = squadOf(g, poor.id)[0]
  t2.fatigue = 95
  aiClubWeek(g, poor, new Rng(6))
  check('a club at its reserve does not', t2.fatigue === 95 && poor.budget === AI_PHYSIO_RESERVE[2])

  const g2 = mk()
  const builder = ai(g2, (t) => t.tier === 1 && t.budget > 4_000_000 && t.facilities < 88)
  const f0 = builder.facilities
  const b0 = builder.budget
  const n = aiFacilityUpgrade(g2, builder)
  check('a rich club builds in the winter, up to two levels', n >= 1 && n <= 2 && builder.facilities === f0 + n && builder.budget < b0, `${f0} → ${builder.facilities}, ${b0} → ${builder.budget}`)
  const broke = ai(g2, (t) => t.tier === 2)
  broke.budget = AI_FACILITY_RESERVE[2]
  check('a club at its reserve does not build', aiFacilityUpgrade(g2, broke) === 0)
  check("the manager's own club is never built for him", aiFacilityUpgrade(g2, g2.teams[g2.myTeam]) === 0)
}

// ---- comfort fades on a map nobody has touched for a month
{
  const g = mk()
  const me = g.teams[g.myTeam]
  const rng = new Rng(8)
  const pool = poolFor(g)
  const idle = pool[0]
  const played = pool[1]
  me.mapPrefs[idle] = 80
  me.mapPrefs[played] = 80
  me.mapPrefs[pool[2]] = MAP_DECAY_FLOOR - 5
  // the clock starts on the first weekly look; nothing fades for four weeks
  g.day = 7
  weeklyTick(g, rng)
  check('the first weekly look starts every map\'s clock without docking anything', me.mapPrefs[idle] === 80 && me.mapSeen?.[idle] === 7)
  for (let d = 14; d <= MAP_DECAY_AFTER; d += 7) { g.day = d; weeklyTick(g, rng) }
  check('nothing fades inside the month', me.mapPrefs[idle] === 80, `${me.mapPrefs[idle]}`)
  // a map played this week is kept sharp; the untouched one slips
  const notes: string[] = []
  g.day = MAP_DECAY_AFTER + 7
  markMapSeen(me, played, g.day - 1)
  notes.push(...weeklyTick(g, rng))
  check('a map untouched for five weeks loses its weekly step', Math.abs(me.mapPrefs[idle] - (80 - MAP_DECAY_PER_WEEK)) < 1e-9, `${me.mapPrefs[idle]}`)
  check('a map played this week does not', me.mapPrefs[played] === 80, `${me.mapPrefs[played]}`)
  check('and the manager is told the week it starts', notes.some((n) => n.includes('开始回落')), notes.filter((n) => n.includes('回落')).join(' | '))
  check('a map already at neutral is left alone', me.mapPrefs[pool[2]] === MAP_DECAY_FLOOR - 5)
  for (let w = 0; w < 80; w++) { g.day += 7; weeklyTick(g, rng) }
  check('the slide stops at neutral, never below', me.mapPrefs[idle] === MAP_DECAY_FLOOR, `${me.mapPrefs[idle]}`)
  // every club fades the same way, so the world does not end up knowing every map perfectly
  const foe = ai(g, (t) => t.tier === 1)
  const benched = MAPS_OFF_POOL(g)
  check('an AI club\'s benched maps have all faded to neutral by then',
    benched.length > 0 && benched.every((m) => (foe.mapPrefs[m] ?? 50) <= MAP_DECAY_FLOOR + 1e-9),
    benched.map((m) => `${m} ${foe.mapPrefs[m]}`).join(', '))
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
