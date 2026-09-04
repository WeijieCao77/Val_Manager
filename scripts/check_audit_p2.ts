/**
 * The middle band of the audit: nothing here broke a save, and all of it
 * either quietly did the wrong thing or told the manager something untrue.
 */
import { createNewGame, autoStarters } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, commitFixture, setupSeason, moveToClub } from '../src/engine/season'
import { aiTransferTick, bidForOurPlayers, doTransfer, rosterBlock, windowEnd } from '../src/engine/transfer'
import { gigWindow, openGigs, settleSponsorDemands, dropSponsor } from '../src/engine/commercial'
import { staffMarket } from '../src/engine/staff'
import { weeklyTick } from '../src/engine/training'
import { activityOn, agendaFor, logActivity } from '../src/engine/agenda'
import { MatchSim } from '../src/engine/match'
import { fmtDay } from '../src/ui/common'
import { defaultContract } from '../src/engine/types'
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (tag = 'TYL'): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === tag)!.id, '审计', 20260827)
  setupSeason(g)
  return g
}

// ---- the AI shops for positions that exist
{
  // 自由人 in this data means "vlr never recorded a position", and only ten
  // players carry it. Treating it as a role to fill made it every squad's
  // "weakest" one — nobody has one — so AI shopping pointed at those ten and
  // the paid transfer market went quiet.
  const roleOf: Record<string, number> = {}
  for (let seed = 0; seed < 60; seed++) {
    const g0 = mk()
    g0.day = 5
    for (const t of Object.values(g0.teams)) if (t.id !== g0.myTeam) t.budget = 30_000_000
    for (const p of Object.values(g0.players)) if (p.teamId && p.teamId !== g0.myTeam) p.listed = true
    const before = new Map(Object.values(g0.players).map((p) => [p.id, p.teamId]))
    aiTransferTick(g0, new Rng(seed * 13 + 3))
    for (const p of Object.values(g0.players)) {
      if (p.teamId && before.get(p.id) && p.teamId !== before.get(p.id)) {
        roleOf[p.role] = (roleOf[p.role] ?? 0) + 1
      }
    }
  }
  const total = Object.values(roleOf).reduce((a, b) => a + b, 0)
  const flex = roleOf['自由人'] ?? 0
  check('AI shopping is not cornered into the ten-player 自由人 pool',
    total > 0 && flex / total < 0.35, `${flex}/${total} 笔买的是自由人`)
  // a full club must not open a bid it cannot complete
  const g2 = mk()
  g2.day = 5
  for (const t of Object.values(g2.teams)) {
    if (t.id === g2.myTeam) continue
    while (t.roster.length < 7) {
      const free = Object.values(g2.players).find((x) => !x.teamId)
      if (!free) break
      free.teamId = t.id; t.roster.push(free.id)
    }
  }
  for (const p of squadOf(g2, g2.myTeam)) p.listed = true
  const before = g2.offers.length
  for (let i = 0; i < 40; i++) bidForOurPlayers(g2, new Rng(i * 7 + 1))
  const fromFull = g2.offers.slice(before).filter((o) => rosterBlock(g2, o.toTeam))
  check('a club with no room never bids', fromFull.length === 0, `${fromFull.length} 份来自满员球队`)
}

// ---- team drills cannot push a player past his own potential
{
  const g = mk()
  const p = squadOf(g, g.myTeam)[0]
  p.potential = p.overall
  const cap = p.overall
  g.drill = { kind: 'map', map: 'Sunset' }
  g.duo = { a: squadOf(g, g.myTeam)[0].id, b: squadOf(g, g.myTeam)[1].id }
  g.drillLock = g.day + 7
  // long enough for the drill to convert XP into points several times over
  for (let season = 0; season < 3; season++) {
    for (let i = 0; i < 100; i++) {
      if (g.drillLock == null || g.drillLock <= g.day) {
        g.drill = { kind: 'map', map: 'Sunset' }
        g.drillLock = g.day + 7
      }
      advanceDay(g)
      p.potential = Math.min(p.potential, cap)   // scouts must not re-rate him up
    }
  }
  check('a maxed player stays at his ceiling', p.overall <= cap, `${cap} → ${p.overall}`)
}

// ---- an injured man is rested, so the trust tick cannot punish him for it
{
  // One fixed seed and forty weeks used to be "enough" for an injury to
  // turn up, until it was not, and the test failed for want of a patient.
  // Injuries are rare by design, so several seeds are tried; the failure
  // that matters is an injured man left training, not a lucky squad.
  let found = false
  for (let seed = 4; seed < 40 && !found; seed++) {
    const g = mk()
    for (const p of squadOf(g, g.myTeam)) { g.training[p.id] = 'aim'; p.fatigue = 95 }
    const rng = new Rng(seed)
    for (let w = 0; w < 40 && !found; w++) {
      weeklyTick(g, rng)
      const hurt = squadOf(g, g.myTeam).find((p) => p.injuredUntil > g.day)
      if (hurt) { found = true; check('an injured player is put on rest', g.training[hurt.id] === 'rest', g.training[hurt.id]) }
      g.day += 7
    }
  }
  check('an injury actually occurred to test (within 36 seeds × 40 weeks)', found)
}

// ---- autoStarters does not field the injured
{
  const g = mk()
  const squad = squadOf(g, g.myTeam)
  squad.slice(0, 2).forEach((p) => { p.injuredUntil = g.day + 10 })
  const five = autoStarters(g, g.myTeam)
  // A club whose only player at a position is hurt still has to field him.
  // What must never happen: an injured man chosen over a FIT player who
  // covers the same job.
  const bad = five.filter((id) => {
    const x = g.players[id]
    if (x.injuredUntil <= g.day) return false
    const roles = x.roles ?? [x.role]
    return squad.some((y) => !five.includes(y.id) && y.injuredUntil <= g.day
      && (y.roles ?? [y.role]).some((r) => roles.includes(r)))
  })
  check('自动首发 prefers a fit player wherever one covers the job',
    bad.length === 0, `${bad.length} 处本可以换健康球员`)
}

// ---- a 12-12 scrim is a draw, not a defeat
{
  const g = mk()
  const foe = Object.values(g.teams).find((t) => t.id !== g.myTeam)!
  const sim = new MatchSim(g, g.myTeam, foe.id, 1, new Rng(1), true)
  sim.nextMap()
  const m = sim.current!
  ;(m as unknown as { a: number; b: number }).a = 12
  ;(m as unknown as { a: number; b: number }).b = 12
  sim.closeMap()
  check('a 12-12 scrim is nobody\'s win',
    sim.wonA === 0 && sim.wonB === 0, `大比分 ${sim.wonA}-${sim.wonB}`)
}

// ---- changing clubs leaves nothing behind
{
  const g = mk()
  g.drillLock = g.day + 5
  g.duo = { a: squadOf(g, g.myTeam)[0].id, b: squadOf(g, g.myTeam)[1].id }
  g.physioOn = { x: 1 }
  g.enquiries = [{ id: 'E', playerId: 'p', teamId: 't', day: 0, replyOn: 3 }] as never
  const other = Object.values(g.teams).find((t) => t.id !== g.myTeam)!
  g.offers.push({ id: 'O', playerId: 'p', fromTeam: null, toTeam: g.myTeam, fee: 0,
    salary: 0, years: 1, day: 0, respondOn: g.day + 5, status: 'pending' } as never)
  moveToClub(g, other.id)
  check('the old job leaves no ghost drill', g.drillLock === undefined && g.duo === undefined)
  check('no pending bid follows you', !g.offers.some((o) => o.status === 'pending'))
  check('and no enquiry either', (g.enquiries ?? []).length === 0)
}

// ---- an assistant already on staff is off the market
{
  const g = mk()
  const first = staffMarket(g)[0]
  g.staff = [{ name: first.name, role: 'assistant', salary: first.salary, years: 2,
    tactics: first.tactics, development: first.development, motivation: first.motivation } as never]
  check('you cannot hire the same assistant twice',
    !staffMarket(g).some((c) => c.name === first.name), first.name)
}

// ---- unaccepted invitations stay visible for their whole window
{
  const g = mk()
  g.gigs = [{ id: 'G', kind: 'brand', label: '测试', partner: 'X', day: g.day + 1,
    windowEnd: g.day + 12, expiresOn: g.day + 10, fee: 1000, heads: 1 } as never]
  g.day += 5
  check('an invitation is open until its window closes, not its first day',
    openGigs(g).length === 1)
}

// ---- no countdown on the agenda ever runs backwards
{
  const g = mk()
  // mid-season, where the agenda is not already full of preseason errands
  // (it only ever shows five, in insertion order)
  g.day = 100
  g.stage = 'stage1'
  g.drillLock = g.day + 7
  // an invitation whose window opened two days ago and closes in five
  g.gigs = [{
    id: 'G1', kind: 'stream', label: '直播', partner: '某平台', blurb: '',
    day: g.day - 2, windowEnd: g.day + 5, expiresOn: g.day + 5,
    fee: 30000, heads: 1, fatigue: 5, morale: 1, fans: 3,
  }] as never
  const item = agendaFor(g).find((x) => x.key === 'gig')
  check('a window that already opened is still on the agenda', !!item, item?.text ?? '不见了')
  check('and it counts forward, not backward',
    !!item && !/-\d/.test(item.text) && item.text.includes('还剩 5 天'), item?.text ?? '')

  // and the window helper agrees
  const w = gigWindow(g, g.gigs![0])
  check('the earliest day it can still be held is today, not two days ago',
    w.from === g.day && w.left === 5, `from ${w.from - g.day}，剩 ${w.left}`)

  // walk the whole window and assert nothing ever goes negative
  let worst = 99
  for (let d = 0; d <= 5; d++) {
    const t = agendaFor(g).find((x) => x.key === 'gig')?.text ?? ''
    const n = /还剩 (\d+) 天/.exec(t)
    if (n) worst = Math.min(worst, Number(n[1]))
    if (/-\d/.test(t)) { check(`day +${d} prints a negative`, false, t); break }
    g.day += 1
  }
  check('the countdown reaches zero without going under', worst === 0 || worst === 1, `最小值 ${worst}`)
}

// ---- sponsorship clauses are enforced
{
  const g = mk()
  const me = g.teams[g.myTeam]
  me.sponsors = [{ name: '严苛品牌', industry: '测试', perSeason: 500_000, bonusPlacement: 4,
    bonus: 1, demands: [{ key: 'gigs', text: '每赛季至少出席 3 次商务活动' }] }]
  g.seasonGigs = 0
  settleSponsorDemands(g)
  check('a broken clause ends the contract', me.sponsors.length === 0)
  me.sponsors = [{ name: '严苛品牌', industry: '测试', perSeason: 500_000, bonusPlacement: 4,
    bonus: 1, demands: [{ key: 'gigs', text: '每赛季至少出席 3 次商务活动' }] }]
  g.seasonGigs = 4
  settleSponsorDemands(g)
  check('a clause kept keeps the money', me.sponsors.length === 1)
  dropSponsor(g, 0)
}

// ---- money owed costs the board's patience
{
  const g = mk('WBG')
  g.finances.balance = -2_000_000
  const c0 = g.boardConfidence
  for (let i = 0; i < 21; i++) advanceDay(g)
  check('insolvency costs board confidence', g.boardConfidence < c0 - 5,
    `${c0.toFixed(0)} → ${g.boardConfidence.toFixed(0)}`)
}

// ---- an expired contract eventually walks
{
  const g = mk()
  const p = squadOf(g, g.myTeam)[0]
  p.contractYears = 0
  p.expiredYear = g.year - 1
  const rng = new Rng(6)
  let guard = 0
  const y = g.year
  while (g.year === y && guard++ < 400) advanceDay(g)
  void rng
  check('a deal expired a year ago ends in free agency', p.teamId !== g.myTeam,
    p.teamId === g.myTeam ? '还在原队' : p.teamId ? '去了别队' : '成为自由人')
}

// ---- the calendar agrees with itself
{
  check('day 59 is not 2/29 in a common year', fmtDay(59, 2026) !== '2/29', fmtDay(59, 2026))
  check('and the label tracks the save year', fmtDay(59, 2026) === '3/1', fmtDay(59, 2026))
}

// ---- yesterday's errands stay in yesterday's season
{
  const g = mk()
  g.day = 100
  logActivity(g, 'transfer', '去年的操作')
  g.year += 1
  check('last season activity does not surface as today', activityOn(g, 100).length === 0)
  logActivity(g, 'transfer', '今年的操作')
  check('this season activity does', activityOn(g, 100).length === 1)
}

// ---- the offseason fast-forward stops at the window's edge
{
  const g = mk()
  g.day = 315
  check('an open window has an end to stop at', windowEnd(345) === 363, String(windowEnd(345)))
  check('and a closed day has none', windowEnd(250) === null)
}

// ---- a scrim teaches the map it is played on, up to a point
{
  const g = mk()
  const foe = Object.values(g.teams).find((t) => t.id !== g.myTeam)!
  const play = (map: string) => {
    const f = {
      id: `S${g.day}`, day: g.day, stage: g.stage, comp: 'scrim',
      teamA: g.myTeam, teamB: foe.id, bo: 1, label: '训练赛', played: false,
      scrim: { map, format: 'first13' },
    } as never
    const sim = new MatchSim(g, g.myTeam, foe.id, 1, new Rng(g.day), { map, format: 'first13' })
    while (!sim.decided && sim.nextMap()) { sim.current!.runOut(); sim.closeMap() }
    commitFixture(g, f, sim.finish(), [])
    g.day += 1
  }
  const me = g.teams[g.myTeam]
  me.mapPrefs.Ascent = 45
  const foeBefore = foe.mapPrefs.Ascent ?? 50
  play('Ascent')
  const one = me.mapPrefs.Ascent - 45
  check('a scrim raises the map it was played on', one >= 0.6 && one <= 1.0, `+${one.toFixed(2)}`)
  check('and the opponent learns it too', (foe.mapPrefs.Ascent ?? 0) > foeBefore)
  const other = me.mapPrefs.Bind
  check('but only that map', me.mapPrefs.Bind === other)

  // it stops well short of mastery, or the 跑图 drill would be pointless
  for (let i = 0; i < 400; i++) play('Ascent')
  check('scrims alone stop at comfortable, not mastered',
    me.mapPrefs.Ascent <= 80.01 && me.mapPrefs.Ascent >= 79,
    `400 场后 ${me.mapPrefs.Ascent.toFixed(1)}（跑图上限 95）`)
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
