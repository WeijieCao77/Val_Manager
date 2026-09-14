/** A new job must not inherit the previous employer's bills or bookings. */
import assert from 'node:assert/strict'
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { moveToClub } from '../src/engine/season'
import { analystMarket, staffMarket, resolveStaffOffers } from '../src/engine/staff'
import { runGigsToday, resolveSponsorTalks } from '../src/engine/commercial'
import { wageBill } from '../src/engine/roster'
import { exportSave, importSave } from '../src/engine/save'
import { Rng } from '../src/engine/rng'

const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '换队审计', 20260914)
const oldId = g.myTeam, old = g.teams[oldId]
const next = Object.values(g.teams).find((t) => t.id !== oldId)!
const candidate = analystMarket(g)[0]
g.staff = [{ ...candidate, role: 'analyst', years: 2, salary: 100_000 }]
g.leagueDeal = { share: 75, mode: 'sales', bundleBet: true, talkedYear: g.year }
g.seasonGigs = 4; g.bestPlacing = 1
const due = g.day + 2
g.staffOffers = [{ id: 'old-hire', name: 'Pending Coach', from: old.name, role: 'assistant',
  tactics: 70, development: 70, motivation: 70, salary: 1_000_000, years: 2, day: g.day, replyOn: due }]
g.staffApproaches = [{ id: 'old-approach', teamId: next.id, name: next.coach?.name ?? 'Coach', fee: 1000,
  day: g.day, replyOn: due }]
g.sponsorTalks = [{ id: 'old-sponsor', name: 'Test Sponsor', industry: 'test', base: 1000,
  bonus: 100, bonusPlacement: 1, demands: [], day: g.day, replyOn: due }]
g.gigs = [{ id: 'old-gig', kind: 'photoshoot', label: '旧队活动', partner: 'Test', heads: 1,
  day: due, expiresOn: due, fee: 100_000, fans: 1, fatigue: 1, morale: 1, accepted: true,
  attendees: [old.roster[0]] }] as typeof g.gigs
g.ventures = [{ kind: 'bootcamp', day: due, cost: 10_000, heads: 1, attendees: [old.roster[0]] }]
g.pitchCooldown = g.day + 14; g.leagueOffer = { year: g.year, expires: due }
g.finances.balance -= 12345
const oldCash = g.finances.balance, newCash = next.budget, oldWages = wageBill(g, oldId)
const personal = () => JSON.stringify({ manager: g.manager, life: g.life, bonds: g.bonds,
  honours: g.honours, tally: g.tally, activity: g.activity,
  ties: Object.values(g.players).map((p) => [p.id, p.trust, p.loyalty]) })
const beforePersonal = personal()
moveToClub(g, next.id)
assert.equal(g.finances.balance, newCash)
assert.equal(old.budget, oldCash)
assert.equal(personal(), beforePersonal)
for (const key of ['staffOffers', 'staffApproaches', 'sponsorTalks', 'gigs', 'ventures'] as const) assert.deepEqual(g[key], [])
assert.equal(g.pitchCooldown, undefined)
assert.equal(g.leagueOffer, undefined)
assert.deepEqual(g.staff, [])
assert.equal(g.leagueDeal, undefined)
assert.equal(g.seasonGigs, 0)
assert.equal(g.bestPlacing, undefined)
assert.equal(old.supportStaff?.[0].name, candidate.name)
assert.equal(wageBill(g, oldId), oldWages)
assert.ok(!analystMarket(g).some((p) => p.name === candidate.name))
assert.ok(!staffMarket(g).some((p) => p.name === candidate.name))
console.log('ok employer transactions close; club staff/assets and personal wallet/relationships remain with their owners')

g.day = due
resolveStaffOffers(g, new Rng(1))
runGigsToday(g, [])
resolveSponsorTalks(g, new Rng(1))
assert.equal(g.finances.balance, newCash)
assert.ok(!g.staff?.some((s) => s.name === 'Pending Coach'))
console.log('ok delayed old hiring and event settlement cannot charge or pay the new club')

// Same-club calls previously reset finances and duplicate career tenures.
const beforeNoop = JSON.stringify(g)
moveToClub(g, g.myTeam)
assert.equal(JSON.stringify(g), beforeNoop)
console.log('ok staying at the same club is a side-effect-free no-op')

const loaded = importSave(exportSave(g))
moveToClub(loaded, oldId)
assert.equal(loaded.staff?.[0].name, candidate.name)
assert.equal(loaded.finances.balance, oldCash)
assert.equal(loaded.leagueDeal?.share, 75)
assert.equal(loaded.leagueDeal?.bundleBet, true)
assert.equal(loaded.seasonGigs, 4)
assert.equal(loaded.bestPlacing, 1)
console.log('ok returning in the same season restores club-owned staff, terms and counters after save roundtrip')

moveToClub(loaded, next.id)
loaded.year++
moveToClub(loaded, oldId)
assert.equal(loaded.leagueDeal?.share, 75)
assert.equal(loaded.leagueDeal?.bundleBet, false)
assert.equal(loaded.seasonGigs, 0)
assert.equal(loaded.bestPlacing, undefined)
console.log('ok returning in another season cannot resurrect old one-off rewards or season progress')
console.log('PASS job handoff ownership checks')
