/**
 * Eleven ways the game misled the manager, from the 138-agent audit.
 *
 * None of these crashed anything. They took money that was promised, punished
 * a sale that never happened, announced departures that did not occur, stopped
 * training while claiming to train, and stranded a competition on a match that
 * could never be played.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason, settleCompetition } from '../src/engine/season'
import { doTransfer, releasePlayer } from '../src/engine/transfer'
import { resolveSponsorTalks } from '../src/engine/commercial'
import { seasonUpkeep, weeklyUpkeep } from '../src/engine/finance'
import { effectiveRating, buildLineup } from '../src/engine/match'
import { saveGame, loadGame } from '../src/engine/save'
import { defaultContract } from '../src/engine/types'
import { Rng } from '../src/engine/rng'
import type { Competition, GameState } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}

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

// ---- a refused sale costs the dressing room nothing
{
  const g = mk()
  const me = g.teams[g.myTeam]
  const p = squadOf(g, g.myTeam)[0]
  const buyer = Object.values(g.teams).find((t) => t.id !== g.myTeam)!
  while (buyer.roster.length < 7) {                     // buyer full: the sale must fail
    const free = Object.values(g.players).find((x) => !x.teamId)!
    free.teamId = buyer.id; buyer.roster.push(free.id)
  }
  const trustBefore = JSON.stringify(g.trust ?? {})
  const moraleBefore = squadOf(g, g.myTeam).map((x) => x.morale).join()
  const newsBefore = g.news.length
  const ok = doTransfer(g, p, buyer.id, 0, defaultContract(50000, 2))
  check('a sale the roster cap refuses does not go through', !ok)
  check('and costs no trust or morale',
    JSON.stringify(g.trust ?? {}) === trustBefore && squadOf(g, g.myTeam).map((x) => x.morale).join() === moraleBefore)
  check('and announces nothing', g.news.length === newsBefore, `新增 ${g.news.length - newsBefore} 条新闻`)
  check('and he is still in the squad', me.roster.includes(p.id))
}

// ---- selling a starter refills the five
{
  const g = mk()
  const me = g.teams[g.myTeam]
  const starter = g.players[me.starters[0]]
  const buyer = Object.values(g.teams).find((t) => t.id !== g.myTeam && t.roster.length < 7)!
  doTransfer(g, starter, buyer.id, 0, defaultContract(50000, 2))
  check('the starting five is five again after a sale', me.starters.length === 5, `${me.starters.length} 人`)
  check('and the sold man is not in it', !me.starters.includes(starter.id))
  const released = g.players[me.starters[4]]
  releasePlayer(g, released)
  check('same after a release', me.starters.length === Math.min(5, me.roster.length))
}

// ---- placement bonuses are actually paid, once a season
{
  const g = mk()
  const me = g.teams[g.myTeam]
  me.sponsors = [{ name: '测试赞助', perSeason: 400_000, bonusPlacement: 4, bonus: 120_000 }]
  const comp = {
    key: 'k', stage: 'stage1', name: '测试赛段', region: 'China',
    teams: [g.myTeam], finished: [g.myTeam], champion: 'someone-else', awarded: false,
  } as unknown as Competition
  const paid = () => g.finances.log.filter((l) => l.label.startsWith('赞助达标奖'))
    .reduce((a, b) => a + b.amount, 0)
  settleCompetition(g, comp, [])
  check('finishing inside the threshold pays the bonus', paid() === 120_000, `$${paid()}`)
  settleCompetition(g, { ...comp, key: 'k2', awarded: false } as unknown as Competition, [])
  check('but only once in a season', paid() === 120_000, `$${paid()}`)
  // finish fifth against a contract that asks for top four
  delete me.sponsors[0].bonusPaidYear
  const others = Object.keys(g.teams).filter((id) => id !== g.myTeam).slice(0, 4)
  settleCompetition(g, {
    ...comp, key: 'k3', awarded: false,
    teams: [...others, g.myTeam], finished: [...others, g.myTeam],
  } as unknown as Competition, [])
  check('missing the threshold pays nothing', paid() === 120_000, `$${paid()}`)
}

// ---- the finance screen and the ledger agree
{
  const g = mk('WBG')
  const me = g.teams[g.myTeam]
  check('a Challengers club is not a VCT club', me.tier === 2)
  let charged = 0
  for (let i = 0; i < 7; i++) advanceDay(g)
  charged = -(g.finances.log.filter((l) => l.label === '运营开支').reduce((a, b) => a + b.amount, 0))
  check('the screen projects what the ledger charges',
    seasonUpkeep(g, g.myTeam) === weeklyUpkeep(g, g.myTeam) * 48 && charged === weeklyUpkeep(g, g.myTeam),
    `周扣 $${charged}，年估 $${seasonUpkeep(g, g.myTeam)}`)
}

// ---- unanswered offers do not shut the door on inbound sponsors
{
  const g = mk('WBG')
  const team = g.teams[g.myTeam]
  team.sponsors = team.sponsors.slice(0, 1)
  g.sponsorTalks = [1, 2, 3].map((n) => ({
    id: `X${n}`, name: `品牌${n}`, industry: '测试', base: 1, bonus: 1,
    bonusPlacement: 4, demands: [], day: 0, replyOn: 0, answer: 'offer',
  })) as never
  const rng = new Rng(21)
  let knocked = false
  for (let d = 0; d < 300 && !knocked; d++) {
    g.day += 1
    resolveSponsorTalks(g, rng)
    knocked = (g.sponsorTalks ?? []).some((t) => t.id.startsWith('SPIN'))
  }
  check('three offers on the table do not block the door', knocked)

  // pinned so they cannot lapse: the gate itself must count only talks still
  // awaiting the sponsor's answer, not ones already sitting on the table
  let knockedWithOffersPinned = false
  for (let seed = 0; seed < 60 && !knockedWithOffersPinned; seed++) {
    const g2 = mk('WBG')
    g2.teams[g2.myTeam].sponsors = g2.teams[g2.myTeam].sponsors.slice(0, 1)
    const r2 = new Rng(900 + seed)
    for (let d = 0; d < 18; d++) {
      g2.day += 1
      g2.sponsorTalks = [1, 2, 3].map((n) => ({
        id: `P${n}`, name: `品牌${n}`, industry: '测试', base: 1, bonus: 1,
        bonusPlacement: 4, demands: [], day: g2.day, replyOn: g2.day, answer: 'offer',
      })) as never
      resolveSponsorTalks(g2, r2)
      if ((g2.sponsorTalks ?? []).some((t) => t.id.startsWith('SPIN'))) {
        knockedWithOffersPinned = true; break
      }
    }
  }
  check('the gate counts talks in flight, not offers awaiting me', knockedWithOffersPinned)
  for (let d = 0; d < 40; d++) { g.day += 1; resolveSponsorTalks(g, rng) }
  check('and an offer nobody answers eventually lapses',
    !(g.sponsorTalks ?? []).some((t) => t.id === 'X1'))
}

// ---- a match left unplayed is played on the next day, not lost forever
{
  const g = mk()
  let mine: string | undefined
  for (let i = 0; i < 120 && !mine; i++) {
    const r = advanceDay(g, { deferMine: true })
    if (r?.pendingMine) mine = r.pendingMine.id
  }
  check('a match was handed over to watch', !!mine)
  if (mine) {
    const before = g.fixtures.find((f) => f.id === mine)!
    check('and it is still unplayed', !before.played)
    for (let i = 0; i < 3; i++) advanceDay(g)
    check('the abandoned match gets played anyway',
      g.fixtures.find((f) => f.id === mine)!.played, `第 ${before.day} 天的比赛，现在第 ${g.day} 天`)
  }
}

// ---- a job offer keeps the 30 days it was given
{
  const g = mk()
  g.jobOffers = [{ teamId: Object.keys(g.teams)[0], day: g.day, expiresOn: g.day + 30 } as never]
  saveGame('审计_邀请', g)
  const back = loadGame('审计_邀请')!
  check('a 30-day job offer survives a save and load',
    (back.jobOffers?.[0].expiresOn ?? 0) - back.day === 30,
    `还剩 ${(back.jobOffers?.[0].expiresOn ?? 0) - back.day} 天`)
}

// ---- playing hurt costs something, and a bench is worth carrying
{
  const g = mk()
  const p = squadOf(g, g.myTeam)[0]
  const fit = effectiveRating(p, g.day)
  p.injuredUntil = g.day + 10
  check('an injured man rates lower when the day is known',
    effectiveRating(p, g.day) < fit * 0.85, `${fit.toFixed(1)} → ${effectiveRating(p, g.day).toFixed(1)}`)
  check('and unchanged when it is not (ranking fit players)', effectiveRating(p) === fit)

  // Depth is compared on ONE squad against itself: the same seven men, once
  // with a bench to bring on and once cut to the five who must play through
  // it. Comparing two different clubs measured the quality of their backups,
  // not the value of having one — and agent assignment reshuffles when a
  // substitute of another role comes on, which can honestly cost more than
  // playing the specialist hurt.
  const g2 = mk()
  const deep = Object.values(g2.teams).find((t) => t.roster.length >= 7)!
  const hurt = g2.players[deep.starters[0]]
  const fitAtk = buildLineup(g2, deep.id, 'Ascent').atk
  hurt.injuredUntil = g2.day + 10
  const withBench = fitAtk - buildLineup(g2, deep.id, 'Ascent').atk
  // now take the bench away: the same five, forced to field the injured man
  deep.roster = deep.starters.slice()
  const noBench = fitAtk - buildLineup(g2, deep.id, 'Ascent').atk
  // Having a bench can only help. Where the reserve is a genuine replacement
  // he comes on; where he is not, the coach plays the specialist hurt and the
  // squad is no worse off than one that had no choice. What must never happen
  // is the version that used to: a fitter reserve of the wrong job forced on,
  // leaving the deep squad WORSE than the shallow one.
  check('carrying a bench is never worse than not having one',
    withBench <= noBench + 0.05, `有替补 -${withBench.toFixed(2)} vs 无替补 -${noBench.toFixed(2)}`)
  check('and the injury still costs something either way', noBench > 1, `-${noBench.toFixed(2)}`)
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
