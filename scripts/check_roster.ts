/**
 * Nobody plays four against five.
 *
 * A player reported two things that turned out to be one story: a signing that
 * said "签约完成：X 加盟 Y" and never happened, and clubs fielding two and four
 * players in league matches. He had stripped his own squad, tried to rebuild
 * it through bids that all reported success and none of which landed, and the
 * game let him play the rest of the season short-handed — profitably, because
 * strength was a mean of who was present and a short side rated HIGHER.
 */
import { createNewGame, WORLD_TEAMS, squadOf } from '../src/engine/world'
import { advanceDay, setupSeason } from '../src/engine/season'
import { buildLineup, selectLineup, simulateMatch } from '../src/engine/match'
import { releasePlayer, resolveMyOffer, canSell, doTransfer } from '../src/engine/transfer'
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (tag: string, seed = 20260824): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === tag)!.id, '审计经理', seed)
  setupSeason(g)
  return g
}

// ---- the floor: a manager cannot strip his own squad below five
{
  const g = mk('WSIG')
  const start = squadOf(g, g.myTeam).length
  for (let i = 0; i < 12; i++) {
    const squad = squadOf(g, g.myTeam)
    if (!squad.length) break
    releasePlayer(g, squad[squad.length - 1])
  }
  const left = squadOf(g, g.myTeam).length
  check('releasing cannot take our squad below five', left === 5, `${start} 人连续解约 → ${left} 人`)
  check('and the lineup is still five', selectLineup(g, g.myTeam).length === 5)
}

// ---- a bid that cannot complete must not report that it did
{
  const g = mk('TYL')
  g.finances.balance = 50_000_000
  const seller = Object.values(g.teams).find((t) => t.id !== g.myTeam && squadOf(g, t.id).length === 5)!
  for (const p of Object.values(g.players)) if (!p.teamId) p.teamId = g.myTeam
  const target = squadOf(g, seller.id)[0]
  check('canSell refuses to gut a five-man club', !canSell(g, target))
  const offer = {
    id: 'X', playerId: target.id, fromTeam: seller.id, toTeam: g.myTeam,
    fee: 5_000_000, salary: target.salary, years: 2, day: g.day, respondOn: g.day,
    status: 'pending' as const,
    terms: { salary: target.salary * 4, years: 2, signingBonus: 0, bonusShare: 0,
      releaseClause: 0, promisedRole: 'star' },
  }
  g.offers.push(offer as never)
  const msg = resolveMyOffer(g, offer as never, new Rng(1))
  const moved = target.teamId === g.myTeam
  check('a bid that cannot complete is not reported as complete',
    !moved && !msg.includes('签约完成'), `"${msg}"`)
  check('and doTransfer says so out loud',
    doTransfer(g, target, g.myTeam, 1, offer.terms as never) === false)
}

// ---- short-handed must be a catastrophe, not an edge
{
  const g = mk('TYL')
  const t = g.teams[g.myTeam]
  const map = Object.keys(t.mapPrefs)[0]
  const full = [...t.roster]
  const strength: number[] = []
  for (const n of [5, 4, 3, 2]) {
    const squad = full.map((id) => g.players[id]).sort((a, b) => b.overall - a.overall).slice(0, n)
    t.roster = squad.map((p) => p.id)
    t.starters = squad.map((p) => p.id)
    strength.push(buildLineup(g, g.myTeam, map).atk)
  }
  t.roster = full
  const [five, four, three, two] = strength
  check('fewer players is strictly weaker',
    five > four && four > three && three > two,
    `5人 ${five.toFixed(1)} > 4人 ${four.toFixed(1)} > 3人 ${three.toFixed(1)} > 2人 ${two.toFixed(1)}`)
  check('and a man down is a real hole, not a rounding error',
    five - four > 12, `差 ${(five - four).toFixed(1)} 分`)
}

// ---- one game must not leak into the next
{
  const a = mk('EDG', 1)
  const spare = Object.values(a.players).find((p) => !p.teamId)!
  spare.teamId = a.myTeam
  a.teams[a.myTeam].roster.push(spare.id)
  const b = mk('EDG', 2)
  check('a new career does not inherit the last one\'s roster',
    !b.teams[b.myTeam].roster.includes(spare.id))
  const ghosts = Object.values(b.teams).flatMap((t) =>
    t.roster.filter((id) => b.players[id]?.teamId !== t.id).map((id) => `${t.tag}:${id}`))
  check('every roster entry belongs to the club listing it', ghosts.length === 0, ghosts.slice(0, 4).join(' '))
}

// ---- and none of it drifts over a season of real play
{
  const g = mk('TYL', 99)
  const rng = new Rng(3)
  let guard = 0
  const shortLineups: string[] = []
  const seen = new Set<string>()
  while (!g.gameOver && guard++ < 400 && g.year === 2026) {
    advanceDay(g, rng)
    for (const f of g.fixtures) {
      if (!f.played || seen.has(f.id) || f.comp === 'scrim') continue
      seen.add(f.id)
      const L = (f.result as never as { lineups?: { a: string[]; b: string[] } })?.lineups
      if (L && (L.a.length < 5 || L.b.length < 5)) shortLineups.push(f.id)
    }
  }
  check('a full season is played five a side, every match',
    shortLineups.length === 0, `${seen.size} 场中 ${shortLineups.length} 场缺人`)
  const desync = Object.values(g.teams).flatMap((t) =>
    t.roster.filter((id) => g.players[id]?.teamId !== t.id))
  check('roster and teamId still agree after a season', desync.length === 0, `${desync.length} 处不一致`)
  const below = Object.values(g.teams).filter((t) => squadOf(g, t.id).length < 5)
  check('no club ends the season below five',
    below.length === 0, below.map((t) => `${t.tag}(${squadOf(g, t.id).length})`).join(' '))
}
// ---- short-handed must look short-handed in the box score too
{
  const g = mk('TYL', 42)
  const foe = Object.values(g.teams).find(t => t.id !== g.myTeam && squadOf(g, t.id).length >= 5)!
  const mine = g.teams[g.myTeam]
  const full = [...mine.roster]
  const line = (keep: number) => {
    const squad = full.map(id => g.players[id]).sort((a, b) => b.overall - a.overall).slice(0, keep)
    mine.roster = squad.map(p => p.id); mine.starters = mine.roster
    for (const p of Object.values(g.players)) p.injuredUntil = 0
    let k = 0, d = 0, acs = 0, n = 0
    for (let i = 0; i < 40; i++) {
      for (const m of simulateMatch(g, g.myTeam, foe.id, 1, new Rng(1000 + i)).maps) {
        for (const [pid, l] of Object.entries(m.lines)) {
          if (!mine.roster.includes(pid)) continue
          k += l.kills; d += l.deaths; acs += l.acs; n++
        }
      }
    }
    return { kd: k / d, acs: acs / n }
  }
  const five = line(5)
  const two = line(2)
  mine.roster = full
  check('a two-man side does not out-frag a full one',
    two.kd < five.kd && two.acs < five.acs * 1.1,
    `5人 K/D ${five.kd.toFixed(2)} ACS ${five.acs.toFixed(0)} vs 2人 K/D ${two.kd.toFixed(2)} ACS ${two.acs.toFixed(0)}`)
}

// ---- fatigue is charged to whoever actually walked out
{
  const g = mk('TE', 20260824)
  const rng2 = new Rng(11)
  let ghosts = 0, subs = 0
  const before = new Map<string, number>()
  let guard = 0
  const seen2 = new Set<string>()
  while (!g.gameOver && guard++ < 200 && g.year === 2026) {
    for (const p of Object.values(g.players)) before.set(p.id, p.fatigue)
    advanceDay(g, rng2)
    for (const f of g.fixtures) {
      if (!f.played || seen2.has(f.id) || f.comp === 'scrim') continue
      seen2.add(f.id)
      const L = (f.result as never as { lineups?: { a: string[]; b: string[] } })?.lineups
      for (const [side, tid] of [[L?.a, f.teamA], [L?.b, f.teamB]] as const) {
        if (!side) continue
        const sheet = g.teams[tid as string].starters
        for (const pid of sheet) {
          if (side.includes(pid)) continue
          if ((g.players[pid]?.fatigue ?? 0) - (before.get(pid) ?? 0) > 1) ghosts++
        }
        for (const pid of side) {
          if (sheet.includes(pid)) continue
          if ((g.players[pid]?.fatigue ?? 0) - (before.get(pid) ?? 0) > 1) subs++
        }
      }
    }
  }
  check('nobody is tired by a match they did not play', ghosts === 0, `${ghosts} 人次`)
  check('and the substitute who did play is', subs > 0, `${subs} 人次`)
}

process.exit(bad ? 1 : 0)
