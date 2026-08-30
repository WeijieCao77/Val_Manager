/**
 * Does the game tell you everything it did to you?
 *
 *   npx tsx scripts/audit_feedback.ts [seasons]
 *
 * Two passes, because there are two ways feedback goes missing.
 *
 * 1. Actions. Every outward-facing action returns a sentence for the toast. An
 *    action that succeeds silently, or — worse — refuses silently, leaves the
 *    manager clicking a button that appears to do nothing. Each is called here
 *    for real, in both its working and its refused state, and the answer must
 *    be a sentence.
 *
 * 2. Turns. Advancing time changes money, squads, staff, contracts and moods
 *    on its own. The digest is the only place those surface, so a season is
 *    played out day by day with the state diffed across every advance: if
 *    something material moved and no note mentioned it, that is a change the
 *    manager had no way to see.
 */
import { createNewGame, WORLD_TEAMS, squadOf } from '../src/engine/world'
import { advanceDay, continuePastFive, setupSeason } from '../src/engine/season'
import { Rng } from '../src/engine/rng'
import {
  enquireAbout, makeOffer, releasePlayer, answerIncoming, incomingOffers, windowOpen,
  windowBlock,
} from '../src/engine/transfer'
import {
  bookGig, cancelGig, openGigs, pitchSponsor, signSponsor, declineSponsor,
  signStream, endStream, startVenture, streamOffer,
} from '../src/engine/commercial'
import {
  upgradeFacility, staffMarket, analystMarket, offerToStaff, releaseStaff,
  approachForCoach, employedCoaches,
} from '../src/engine/staff'
import { applyForJob, renegotiate } from '../src/engine/career'
import { actionsLeft } from '../src/engine/actions'
import { recomputeOverall } from '../src/engine/player'
import type { GameState, Player } from '../src/engine/types'

const seasons = Number(process.argv[2] ?? 1)
let fails = 0
let checks = 0

function ok(name: string, pass: boolean, detail = ''): void {
  checks++
  if (!pass) fails++
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

/** A reply is only feedback if it says something. */
function speaks(name: string, msg: unknown): void {
  const s = typeof msg === 'string' ? msg.trim() : ''
  ok(name, s.length > 3, s ? `"${s.slice(0, 64)}"` : `returned ${JSON.stringify(msg)}`)
}

function fresh(seed = 4242): GameState {
  const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
  const g = createNewGame(me.id, '审计经理', seed)
  setupSeason(g)
  g.actions = { day: g.day, used: 0 }
  return g
}

// ---------------------------------------------------------------- 1. actions
console.log('\nactions — every button answers, including when it refuses\n')
{
  const g = fresh()
  const me = g.teams[g.myTeam]
  const mine = squadOf(g, g.myTeam)

  // transfers
  const target = Object.values(g.players).find(
    (p) => p.teamId && p.teamId !== g.myTeam,
  ) as Player
  speaks('enquireAbout — a player at another club', enquireAbout(g, target.id))
  speaks('enquireAbout — the same player twice', enquireAbout(g, target.id))
  speaks('enquireAbout — one of your own', enquireAbout(g, mine[0].id))

  const terms = {
    salary: target.salary, years: 2, signingBonus: 0, bonusShare: 5,
    promisedRole: 'starter' as const, releaseClause: 0, noPoach: false,
  }
  // makeOffer is the one action that answers with an object rather than a
  // sentence, so what it must carry is the date the club will come back
  const offer = makeOffer(g, target.id, g.myTeam, Math.round(target.value), terms)
  ok('makeOffer — says when the answer comes',
    !!offer && offer.respondOn > g.day, `respondOn day ${offer?.respondOn} vs today ${g.day}`)
  ok('makeOffer — the commitment is on the books',
    g.offers.some((o) => o.id === offer?.id && o.status === 'pending'))
  speaks('answerIncoming — an offer that does not exist', answerIncoming(g, 'nope', true))

  // A shut window stops you starting something, not finishing it. Both halves
  // have to hold: refusing a new bid is useless if it also freezes the answer
  // to one already on the table, and vice versa.
  {
    const shut = fresh(808)
    while (windowOpen(shut.day)) advanceDay(shut, new Rng(5))
    const other = Object.values(shut.players).find((p) => p.teamId && p.teamId !== shut.myTeam)!
    ok('window shut — no new bid',
      makeOffer(shut, other.id, shut.myTeam, 50_000, terms) === null)
    const said = enquireAbout(shut, other.id)
    ok('window shut — no new enquiry either', said === windowBlock(shut), `"${said}"`)
    const ours = Object.values(shut.players).find((p) => p.teamId === shut.myTeam)!
    shut.offers.push({
      id: 'IN_audit', playerId: ours.id, fromTeam: shut.myTeam,
      toTeam: Object.values(shut.teams).find((t) => t.id !== shut.myTeam)!.id,
      fee: 500_000, salary: ours.salary, years: 2, day: shut.day,
      respondOn: shut.day, status: 'pending',
    } as never)
    const pend = incomingOffers(shut)
    ok('window shut — a bid for our player still needs answering', pend.length === 1)
    speaks('window shut — and can be answered', answerIncoming(shut, pend[0].id, false))
  }

  // An enquiry comes back with two answers from two different parties — the
  // club's price and the player's own willingness — and a reader asked which
  // of them had refused, because the note said only "本人". Both halves have
  // to name who is speaking.
  {
    const asked = fresh(909)
    const marks = Object.values(asked.players)
      .filter((p) => p.teamId && p.teamId !== asked.myTeam)
      .sort((a, b) => b.overall - a.overall).slice(0, 30)
    for (const m of marks) enquireAbout(asked, m.id)
    const replies: string[] = []
    for (let d = 0; d < 8; d++) {
      replies.push(...(advanceDay(asked, new Rng(70 + d))?.notes ?? []).filter((n) => n.startsWith('📋 就')))
    }
    const named = replies.filter((n) => n.includes('选手本人'))
    ok('an enquiry reply says which side said what',
      replies.length > 0 && named.length === replies.length,
      replies[0] ?? 'no reply came back')
  }

  // commercial
  const gigs = openGigs(g)
  if (gigs.length) {
    speaks('bookGig', bookGig(g, gigs[0].id, mine.slice(0, gigs[0].heads).map((p) => p.id)))
    speaks('bookGig — wrong headcount', bookGig(g, gigs[0].id, mine.slice(0, 1).map((p) => p.id)))
    speaks('cancelGig', cancelGig(g, gigs[0].id))
  }
  speaks('cancelGig — one that is not booked', cancelGig(g, 'nope'))
  speaks('pitchSponsor', pitchSponsor(g))
  speaks('pitchSponsor — again inside the cooldown', pitchSponsor(g))
  speaks('signSponsor — a talk that does not exist', signSponsor(g, 'nope'))
  speaks('declineSponsor — a talk that does not exist', declineSponsor(g, 'nope'))
  const streamer = mine.find((p) => streamOffer(g, p.id))
  if (streamer) {
    speaks('signStream', signStream(g, streamer.id))
    speaks('signStream — the same player twice', signStream(g, streamer.id))
    speaks('endStream', endStream(g, streamer.id))
  }
  speaks('endStream — nobody streaming', endStream(g, mine[mine.length - 1].id))
  const five = mine.slice(0, 5).map((p) => p.id)
  speaks('startVenture', startVenture(g, 'openday', five))
  speaks('startVenture — the same one twice', startVenture(g, 'openday', five))
  speaks('startVenture — wrong number of players', startVenture(g, 'merch', five.slice(0, 2)))
  const skint = fresh()
  skint.finances.balance = 0
  speaks('startVenture — with no money',
    startVenture(skint, 'bootcamp', squadOf(skint, skint.myTeam).slice(0, 5).map((p) => p.id)))

  // staff and facilities
  speaks('upgradeFacility', upgradeFacility(g))
  const poor = fresh()
  poor.money = 0
  speaks('upgradeFacility — with no money', upgradeFacility(poor))
  const cand = [...staffMarket(g), ...analystMarket(g)][0]
  if (cand) {
    speaks('offerToStaff', offerToStaff(g, cand, 'analyst', cand.salary))
    speaks('offerToStaff — the same person twice', offerToStaff(g, cand, 'analyst', cand.salary))
  }
  speaks('releaseStaff — nobody by that name', releaseStaff(g, '查无此人'))
  const employed = employedCoaches(g)[0]
  if (employed) {
    speaks('approachForCoach', approachForCoach(g, employed.team.id, employed.ask))
    speaks('approachForCoach — again', approachForCoach(g, employed.team.id, employed.ask))
  }

  // career
  const other = Object.values(g.teams).find((t) => t.id !== g.myTeam)!
  speaks('applyForJob', applyForJob(g, other.id, 400_000, 2))
  speaks('applyForJob — the same club twice', applyForJob(g, other.id, 400_000, 2))
  speaks('applyForJob — your own club', applyForJob(g, g.myTeam, 400_000, 2))
  speaks('renegotiate', renegotiate(g, 600_000, 3))
  speaks('renegotiate — an absurd demand', renegotiate(g, 99_000_000, 3))

  // Releasing must be paid for out of money the manager can see move — and a
  // club already down to five cannot release at all, so top up first.
  while (squadOf(g, g.myTeam).length <= 5) {
    const spare = Object.values(g.players).find((p) => !p.teamId)
    if (!spare) break
    spare.teamId = g.myTeam
    g.teams[g.myTeam].roster.push(spare.id)
  }
  const before = g.finances.balance
  const logLen = g.finances.log.length
  const victim = squadOf(g, g.myTeam).slice(-1)[0]
  speaks('releasePlayer', releasePlayer(g, victim))
  ok('releasePlayer — the pay-off appears in the finance log',
    g.finances.log.length > logLen || g.finances.balance !== before,
    `balance ${Math.round(before)} → ${Math.round(g.finances.balance)}, `
    + `log +${g.finances.log.length - logLen}`)
  ok('releasePlayer — he actually leaves',
    !g.teams[g.myTeam].roster.includes(victim.id))

  // The floor. A manager stripped his own squad to two and the game let him,
  // then played every remaining fixture two against five.
  {
    const thin = fresh(4321)
    while (squadOf(thin, thin.myTeam).length > 5) {
      releasePlayer(thin, squadOf(thin, thin.myTeam).slice(-1)[0])
    }
    const last = squadOf(thin, thin.myTeam).slice(-1)[0]
    const refusal = releasePlayer(thin, last)
    ok('a five-man squad cannot release its fifth man',
      squadOf(thin, thin.myTeam).length === 5, refusal)
    ok('and it says why rather than failing quietly',
      refusal.includes('五人'), `"${refusal}"`)
  }

  // the lineup the engine picks must contain the caller — going without one
  // costs more than any role gap, and the five picks itself on rating
  {
    const g2 = fresh()
    const bad: string[] = []
    for (const t of Object.values(g2.teams)) {
      const hasIgl = t.roster.some((id) => g2.players[id]?.isIgl)
      if (hasIgl && !t.starters.some((id) => g2.players[id]?.isIgl)) bad.push(t.tag)
    }
    ok('every club starts its IGL', bad.length === 0, bad.join(' '))
  }

  // `overall` must be a pure function of the player, or it changes the first
  // time anything recomputes him. It was not: build_world weighted by role and
  // the engine re-derived on a flat table, so 94 of 515 players moved 3+ points
  // on their first training week and duelists lost up to 6.
  {
    const g3 = fresh()
    let worst = 0, off = 0, n = 0
    for (const p of Object.values(g3.players)) {
      const before = p.overall
      recomputeOverall(p)
      const d = Math.abs(p.overall - before)
      n++
      if (d >= 2) off++
      worst = Math.max(worst, d)
    }
    ok('overall survives a recompute (role weights match build_world)',
      off <= n * 0.02, `${off}/${n} players move 2+ points, worst ${worst}`)
  }

  // the action budget must refuse out loud, not by doing nothing
  const spent = fresh()
  spent.actions = { day: spent.day, used: 99 }
  ok('the action budget reports itself as spent', actionsLeft(spent) === 0,
    `${actionsLeft(spent)} left after 99 used`)
}

// ---------------------------------------------------------------- 2. turns
console.log('\nturns — nothing material changes without a note\n')

interface Snap {
  money: number
  roster: string[]
  staff: string
  sponsors: string
  facilities: number
  confidence: number
  injured: string[]
  contractYears: string
  listings: string[]
  incomingBids: string[]
  overall: Record<string, number>
  managerJob: string
}

function snap(g: GameState): Snap {
  const me = g.teams[g.myTeam]
  const mine = squadOf(g, g.myTeam)
  return {
    money: Math.round(g.finances.balance),
    roster: me.roster.slice().sort(),
    staff: JSON.stringify([me.coach?.name ?? '', (g.staff ?? []).map((s) => s.name).sort()]),
    sponsors: (me.sponsors ?? []).map((s) => s.name).sort().join(','),
    facilities: me.facilities,
    confidence: Math.round(g.boardConfidence),
    injured: mine.filter((p) => p.injuredUntil > g.day).map((p) => p.id).sort(),
    contractYears: mine.map((p) => `${p.id}:${p.contractYears}`).sort().join(','),
    // The rule the game promises is "someone at least as good as what we
    // already have came onto the market" — reporting every squad-filler a
    // rival lists would bury the digest. So that is what is checked: a
    // notable listing must be reported, a minor one need not be. A rival
    // quietly taking a player back off the market is not news either.
    listings: Object.values(g.players)
      .filter((p) => p.listed && p.overall >= (g.teams[g.myTeam]?.rating ?? 60))
      .map((p) => p.id).sort(),
    overall: Object.fromEntries(mine.map((p) => [p.id, p.overall])),
    managerJob: g.myTeam,
    // A rival bidding for one of our players is a decision with a deadline.
    // This was missing, and that is exactly how the bug got in: the bid only
    // reached state.news, so the digest announced the withdrawal a week later
    // for an offer nobody had been shown.
    incomingBids: g.offers
      .filter((o) => o.status === 'pending' && o.fromTeam === g.myTeam && o.toTeam !== g.myTeam)
      .map((o) => o.id).sort(),
  }
}

/** Changes a match result accounts for on its own. */
const MATCH_EXPLAINS = new Set(['confidence', 'money', 'injured', 'overall'])

/** Which words in the digest would explain a change of this kind. */
const EXPLAINS: Record<keyof Snap, RegExp> = {
  money: /💰|💼|📋|签下|加盟|离队|转会|赞助|奖金|活动|直播|工资|薪|违约|设施|费用|收入|支出|解约|买断|青训|周边|训练营/,
  roster: /签下|加盟|离队|转会|解约|租借|自由身|退役|升入一队|报价/,
  staff: /教练|分析师|助教|上任|离任|解约|加盟|挖角|离开/,
  sponsors: /赞助|合作|续约|到期|终止/,
  facilities: /设施|基地|升级/,
  confidence: /董事会|目标|信心|警告|下课|排名|夺冠|冠军|晋级|淘汰|失望|满意/,
  injured: /⚕️|伤|康复|归队|缺阵/,
  contractYears: /合同|续约|到期|签下|加盟|离队|转会|解约|退役/,
  listings: /挂牌|转会|市场|自由身|报价|撤下/,
  overall: /📈|📉|📊|能力|成长|进步|退步|训练|突破/,
  managerJob: /上任|经理|下课|离任|执教|邀请/,
  incomingBids: /求购|报价|解约金|挖角|收购|撤回/,
}

{
  const g = fresh(99)
  const silent: Record<string, number> = {}
  const examples: Record<string, string> = {}
  let days = 0

  for (let s = 0; s < seasons; s++) {
    const startYear = g.year
    while (g.year === startYear) {
      // A sacked (or settled) career freezes the clock: advanceDay returns
      // without moving the year, and this loop spun on that at 100% CPU for
      // as long as anyone let it. Which seed gets sacked inside the window
      // shifts with every balance change, so the exit has to be here.
      if (g.gameOver) break
      if (g.midReview) continuePastFive(g)
      const before = snap(g)
      const logBefore = g.finances.log.at(-1)?.day ?? -1
      const r = advanceDay(g, { autoScrims: true })
      const after = snap(g)
      days++
      const text = r.notes.join(' | ')

      for (const key of Object.keys(before) as (keyof Snap)[]) {
        let a = JSON.stringify(before[key])
        let b = JSON.stringify(after[key])
        // A player leaving is a roster change, and the roster check already
        // covers it — comparing whole maps would count it a second time as an
        // unexplained ability change. Only players present in both are compared.
        if (key === 'overall') {
          const x = before.overall as Record<string, number>
          const y = after.overall as Record<string, number>
          const both = Object.keys(x).filter((id) => id in y)
          a = JSON.stringify(both.map((id) => `${id}:${x[id]}`))
          b = JSON.stringify(both.map((id) => `${id}:${y[id]}`))
        }
        // likewise, a listing being withdrawn elsewhere in the league is not
        // something the manager needs told
        if (key === 'listings') {
          const was = new Set(before.listings as string[])
          const now = (after.listings as string[]).filter((id) => !was.has(id))
          a = '[]'
          b = JSON.stringify(now)
        }
        // board confidence is a continuous drift shown as a live number on the
        // dashboard; only a real jump needs narrating
        if (key === 'confidence'
          && Math.abs((after.confidence as number) - (before.confidence as number)) <= 2) continue
        if (a === b) continue
        if (EXPLAINS[key].test(text)) continue
        // a match the manager is shown explains its own consequences: the
        // digest lists it above the notes, and clicking through gives the
        // scoreline, the rounds and the board's reaction
        if (r.playedMine.length && MATCH_EXPLAINS.has(key)) continue
        // money is not narrated day by day on purpose — the weekly settlement
        // writes labelled lines (赞助收入 / 选手薪资 / 运营开支) that the finance
        // screen shows in full. Only an unlabelled move is invisible.
        if (key === 'money' && (g.finances.log.at(-1)?.day ?? -1) !== logBefore) continue
        silent[key] = (silent[key] ?? 0) + 1
        if (!examples[key]) {
          examples[key] = `day ${g.day}: ${a.slice(0, 70)} → ${b.slice(0, 70)}`
            + (text ? ` | notes: ${text.slice(0, 80)}` : ' | no notes at all')
        }
      }
    }
  }

  console.log(`  played ${days} days across ${seasons} season(s)\n`)
  for (const key of Object.keys(EXPLAINS) as (keyof Snap)[]) {
    const n = silent[key] ?? 0
    // Every one of these must be zero. `money` is the only one that ever earned
    // an allowance, and it no longer needs it now that the finance log is
    // checked by its last entry's day rather than by its length — the log is
    // capped at 200 rows, so length stops growing and the old test passed
    // vacuously for 55 days a career.
    const label = key === 'listings'
      ? 'listings at or above our level are never silent'
      : `${key} never changes unexplained`
    ok(label, n === 0, n ? `${n} silent day(s); first ${examples[key]}` : '')
  }
}

console.log(`\n${fails ? `FAILED — ${fails}/${checks}` : `all ${checks} checks passed`}`)
process.exit(fails ? 1 : 0)
