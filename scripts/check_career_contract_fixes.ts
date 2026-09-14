/** Regression coverage for contract renewals, release clauses and prize ledgers. */
import assert from 'node:assert/strict'
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { renewContract, resolveMyOffer, askingPrice, clubAcceptsFee, makeOffer } from '../src/engine/transfer'
import { awardPrize } from '../src/engine/finance'
import { defaultContract, type TransferOffer } from '../src/engine/types'
import { advanceDay, setupSeason } from '../src/engine/season'
import { Rng } from '../src/engine/rng'
import { exportSave, importSave } from '../src/engine/save'

const mk = () => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '合同审计', 20260914)
  setupSeason(g)
  return g
}
let checks = 0
const test = (name: string, run: () => void) => { run(); checks++; console.log(`ok ${name}`) }

test('renewal refuses unaffordable and malformed terms without any mutation', () => {
  const g = mk(), p = g.players[g.teams[g.myTeam].roster[0]]
  g.finances.balance = 100
  const before = JSON.stringify(g)
  const terms = { ...defaultContract(p.salary * 10, 2), signingBonus: 1_000_000 }
  assert.equal(renewContract(g, p.id, terms).ok, false)
  for (const patch of [{ salary: NaN }, { signingBonus: -1 }, { years: 0 }, { bonusShare: 101 }]) {
    assert.equal(renewContract(g, p.id, { ...terms, ...patch }).ok, false)
  }
  assert.equal(JSON.stringify(g), before)
})

test('renewal refusal and foreign-player renewal cost nothing', () => {
  const g = mk(), p = g.players[g.teams[g.myTeam].roster[0]]
  const before = JSON.stringify(g)
  assert.equal(renewContract(g, p.id, defaultContract(0, 4)).ok, false)
  const other = Object.values(g.players).find((x) => x.teamId !== g.myTeam)!
  assert.equal(renewContract(g, other.id, defaultContract(1_000_000, 4)).ok, false)
  assert.equal(JSON.stringify(g), before)
})

test('renewal pays once, clears expiry, keeps roster/history and rewards a real extension once', () => {
  const g = mk(), team = g.teams[g.myTeam], p = g.players[team.roster[0]]
  p.contractYears = 0; p.expiredYear = g.year - 1; p.loyalty = 50; p.morale = 60
  const terms = { ...defaultContract(p.salary * 10, 2), signingBonus: 1_000 }
  g.finances.balance = 1_000
  const budget = team.budget, roster = JSON.stringify(team.roster), history = JSON.stringify(p.clubHist)
  assert.equal(renewContract(g, p.id, terms).ok, true)
  assert.equal(g.finances.balance, 0)
  assert.equal(team.budget, budget - 1_000)
  assert.equal(p.expiredYear, undefined)
  assert.equal(p.loyalty, 55)
  assert.equal(p.morale, 68)
  assert.equal(JSON.stringify(team.roster), roster)
  assert.equal(JSON.stringify(p.clubHist), history)
  const after = JSON.stringify(g)
  assert.equal(renewContract(g, p.id, terms).ok, false)
  assert.equal(JSON.stringify(g), after)
  // A salary amendment must not mint the relationship bonus again.
  assert.equal(renewContract(g, p.id, { ...terms, signingBonus: 0, salary: terms.salary + 1 }).ok, true)
  assert.equal(p.loyalty, 55)
  assert.equal(p.morale, 68)
  assert.equal(renewContract(g, p.id, { ...terms, signingBonus: 0, years: 1 }).ok, true)
  assert.equal(renewContract(g, p.id, { ...terms, signingBonus: 0, years: 2 }).ok, true)
  assert.equal(p.loyalty, 55)
  assert.equal(p.morale, 68)
  const loaded = importSave(exportSave(g))
  assert.equal(loaded.players[p.id].renewalRewardYear, g.year)
  assert.equal(renewContract(loaded, p.id, { ...terms, signingBonus: 0, years: 4 }).ok, true)
  assert.equal(loaded.players[p.id].loyalty, 55)
  assert.equal(loaded.players[p.id].morale, 68)
})

test('renewed expired player survives the next winter rather than keeping an old departure countdown', () => {
  const g = mk(), p = g.players[g.teams[g.myTeam].roster[0]]
  p.contractYears = 0; p.expiredYear = g.year - 1; p.retiring = false
  const terms = defaultContract(p.salary * 10, 1)
  assert.equal(renewContract(g, p.id, terms).ok, true)
  g.day = 363; g.stage = 'offseason'; g.boardConfidence = 100
  advanceDay(g, { autoResolveDrawDecisions: true })
  assert.equal(p.teamId, g.myTeam)
  assert.equal(p.contractYears, 0)
  assert.notEqual(p.expiredYear, undefined)
})

const transferFixture = () => {
  const g = mk(), me = g.teams[g.myTeam]
  for (const pid of me.roster.splice(5)) g.players[pid].teamId = null
  me.starters = [...me.roster]
  const p = Object.values(g.players).find((x) => x.teamId && x.teamId !== g.myTeam && x.region === me.region)!
  p.contract = { ...defaultContract(p.salary, 2), releaseClause: 1_000 }
  const terms = defaultContract(p.salary * 10, 2)
  const offer: TransferOffer = { id: 'audit-clause', playerId: p.id, fromTeam: p.teamId, toTeam: me.id,
    fee: 1_000, salary: terms.salary, years: terms.years, terms, day: 0, respondOn: 0, status: 'pending' }
  return { g, p, offer }
}

test('a low release clause overrides asking price and debits only the agreed fee', () => {
  const { g, p, offer } = transferFixture()
  assert.ok(askingPrice(p) * 0.7 > offer.fee)
  assert.equal(clubAcceptsFee(p, offer.fee - 1, new Rng(1)), false)
  const balance = g.finances.balance
  resolveMyOffer(g, offer, new Rng(1))
  assert.equal(offer.status, 'accepted')
  assert.equal(p.teamId, g.myTeam)
  assert.equal(g.finances.balance, balance - offer.fee)
})

test('pre-contract saves with no terms still resolve using the original default contract', () => {
  const { g, p, offer } = transferFixture()
  delete offer.terms
  resolveMyOffer(g, offer, new Rng(1))
  assert.equal(offer.status, 'accepted')
  assert.deepEqual(p.contract, defaultContract(offer.salary, offer.years))
})

test('release clauses still require player consent, sufficient cash and roster room', () => {
  for (const condition of ['consent', 'cash', 'roster'] as const) {
    const { g, p, offer } = transferFixture()
    if (condition === 'consent') { offer.terms!.salary = 0; offer.salary = 0 }
    if (condition === 'cash') g.finances.balance = 999
    if (condition === 'roster') {
      for (const q of Object.values(g.players).filter((x) => !x.teamId).slice(0, 2)) {
        q.teamId = g.myTeam; g.teams[g.myTeam].roster.push(q.id)
      }
    }
    const balance = g.finances.balance, from = p.teamId
    resolveMyOffer(g, offer, new Rng(1))
    assert.equal(offer.status, 'rejected', condition)
    assert.equal(p.teamId, from, condition)
    assert.equal(g.finances.balance, balance, condition)
  }
})

test('negative or non-finite transfer money cannot create cash or corrupt contracts', () => {
  const { g, p, offer } = transferFixture()
  const before = JSON.stringify(g)
  assert.equal(makeOffer(g, p.id, g.myTeam, -1, offer.terms!), null)
  assert.equal(makeOffer(g, p.id, g.myTeam, 0, { ...offer.terms!, signingBonus: NaN }), null)
  offer.fee = -1
  resolveMyOffer(g, offer, new Rng(1))
  assert.equal(offer.status, 'rejected')
  assert.equal(JSON.stringify(g), before)
})

test('prize ledger reconciles to the actual balance for zero, mixed and full negotiated shares', () => {
  for (const mode of ['zero', 'mixed', 'max'] as const) {
    const g = mk(), team = g.teams[g.myTeam]
    team.roster.forEach((pid, i) => { g.players[pid].contract = {
      ...defaultContract(100_000, 2), bonusShare: mode === 'zero' ? 0 : mode === 'max' ? 35 : i * 5,
    } })
    const balance = g.finances.balance, budget = team.budget, n = g.finances.log.length
    awardPrize(g, 'champions', [g.myTeam])
    const net = g.finances.balance - balance
    assert.equal(g.finances.log.slice(n).reduce((sum, entry) => sum + entry.amount, 0), net)
    assert.equal(team.budget - budget, net)
    assert.equal(g.finances.log[n].amount, 1_500_000)
  }
})
console.log(`PASS ${checks} career contract/finance regression groups`)
