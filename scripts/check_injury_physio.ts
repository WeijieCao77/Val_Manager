/**
 * Injuries follow condition; money buys treatment; rosters stop at seven.
 *
 * The group reported three things at once: squads with four of seven injured,
 * one player relapsing the week he returned, and 20+ day layoffs as the norm —
 * while the meta for money was to hoard ten players and farm 商务 with a bench
 * that never plays. Injuries are now gated on fatigue (a rested player is
 * essentially safe), the just-healed are watched for two weeks, layoffs top
 * out at 18 days, a paid physio session restores condition and shortens
 * recovery, and no club may sign past seven players.
 */
import { createNewGame, WORLD_TEAMS, squadOf } from '../src/engine/world'
import { setupSeason } from '../src/engine/season'
import { weeklyTick, doPhysio, physioBlock, PHYSIO_COST } from '../src/engine/training'
import { doTransfer, makeOffer, rosterBlock, ROSTER_MAX, enquireAbout, windowOpen } from '../src/engine/transfer'
import { sponsorSlots } from '../src/engine/commercial'
import { screenLocked } from '../src/engine/agenda'
import { INJURIES } from '../src/engine/content'
import { defaultContract } from '../src/engine/types'
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', 20260827)
  setupSeason(g)
  return g
}

// count my-squad injuries across N weekly ticks with fatigue pinned
const injuriesOver = (weeks: number, fatigue: number, healedDaysAgo?: number) => {
  const g = mk()
  const rng = new Rng(41)
  g.day = 100
  let n = 0
  for (let w = 0; w < weeks; w++) {
    for (const p of squadOf(g, g.myTeam)) {
      p.fatigue = fatigue
      p.injuredUntil = healedDaysAgo !== undefined ? g.day - healedDaysAgo : 0
      g.training[p.id] = 'aim'   // a squad that trains, not one on holiday
    }
    weeklyTick(g, rng)
    for (const p of squadOf(g, g.myTeam)) if (p.injuredUntil > g.day) n++
  }
  return n
}

// ---- rested players are essentially safe; the exhausted are not
{
  const rested = injuriesOver(150, 20)
  const exhausted = injuriesOver(150, 85)
  check('a rested squad barely gets hurt', rested <= 4, `${rested} injuries in 150 weeks at fatigue 20`)
  check('an exhausted squad pays for it', exhausted >= 8 && exhausted > rested * 4,
    `${exhausted} at fatigue 85 vs ${rested} at 20`)
}

// ---- the just-healed are watched
{
  const plain = injuriesOver(300, 85)
  const watched = injuriesOver(300, 85, 5)
  check('two weeks of physio-table grace after an injury', watched < plain * 0.6,
    `${watched} with grace vs ${plain} without`)
}

// ---- no layoff runs past 18 days
check('the longest injury on the books is 18 days',
  Math.max(...INJURIES.map((i) => i.days[1])) <= 18,
  INJURIES.map((i) => `${i.note} ${i.days[0]}-${i.days[1]}`).join('，'))

// ---- physio: money in, condition back, recovery shortened, once a week
{
  const g = mk()
  const p = squadOf(g, g.myTeam)[0]
  g.day = 50
  p.fatigue = 80
  p.injuredUntil = g.day + 10
  const cash = g.finances.balance
  const note = doPhysio(g, p.id)
  check('physio charges its price', !!note && g.finances.balance === cash - PHYSIO_COST,
    `balance ${cash} → ${g.finances.balance}`)
  check('condition comes back', p.fatigue === 45, `fatigue 80 → ${p.fatigue}`)
  check('an active injury is shortened', p.injuredUntil <= g.day + 7,
    `复出还需 ${p.injuredUntil - g.day} 天（原 10 天）`)
  check('but not skipped outright', p.injuredUntil > g.day)
  check('once a week per player', physioBlock(g, p.id) !== null, physioBlock(g, p.id) ?? '')
  const other = squadOf(g, g.myTeam)[1]
  check('a teammate can still book', physioBlock(g, other.id) === null)
}

// ---- the seven-man ceiling
{
  const g = mk()
  const me = g.teams[g.myTeam]
  const free = Object.values(g.players).filter((p) => !p.teamId)
  while (me.roster.length < ROSTER_MAX) {
    const p = free.pop()!
    p.teamId = me.id
    me.roster.push(p.id)
  }
  const target = free.pop()!
  check('the eighth signing is refused', !doTransfer(g, target, g.myTeam, 0, defaultContract(50000, 2)),
    rosterBlock(g, g.myTeam) ?? '')
  const enq = enquireAbout(g, Object.values(g.players).find((p) => p.teamId && p.teamId !== g.myTeam)!.id)
  check('a full book may still ask prices', enq.includes('问价') && enq.includes('等待答复'), enq)
  check('with the ceiling named in the reply', enq.includes('名单已满'))
  check('and may even bid — only completion is blocked',
    makeOffer(g, target.id, g.myTeam, 0, defaultContract(50000, 2)) !== null)
  me.roster.pop()
  check('at six, business resumes', rosterBlock(g, g.myTeam) === null)
}

// ---- physio bookings survive the calendar, not the other way round
{
  const g = mk()
  const p = squadOf(g, g.myTeam)[0]
  g.day = 5
  g.physioOn = { [p.id]: 300 }   // a booking from last season, unshifted
  check('a stale booking from last year does not lock the room',
    physioBlock(g, p.id) === null, physioBlock(g, p.id) ?? '')
  g.physioOn = { [p.id]: 4 }
  check('while a real booking yesterday still holds', physioBlock(g, p.id) !== null)
}

// ---- sponsor slots and the spring window
{
  const g = mk()
  const me2 = g.teams[g.myTeam]
  me2.reputation = 82
  check('a club at the top of the sport carries eight logos', sponsorSlots(me2) === 8)
  me2.reputation = 72
  check('seven at reputation 70', sponsorSlots(me2) === 7)
  me2.reputation = 66
  check('six at reputation 65', sponsorSlots(me2) === 6)
  me2.reputation = 64
  check('and five just below the first tier', sponsorSlots(me2) === 5)
  check('the market opens during Masters I', windowOpen(70))
  check('and the locked screen counts down to day 63', (screenLocked('transfers', { ...g, day: 30 } as never) ?? '').includes('33 天'))
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
