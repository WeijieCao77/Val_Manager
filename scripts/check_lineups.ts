/**
 * Nobody walks out four-handed.
 *
 *   npx tsx scripts/check_lineups.ts [seasons]
 *
 * A club can drop below five at any moment — a transfer completes, somebody
 * retires, a contract runs out — and the engine's answer has always been
 * ensureMinimumRosters, which signs a free agent. It ran in the WEEKLY block,
 * below the fixtures, so a side stripped on a Monday played every match until
 * Sunday with whoever was left. The group chat found it before this file
 * existed, with a scoreboard showing three names: 「为什么四个人也能开比赛啊」.
 *
 * So the backstop runs daily and before kickoff now, and this is the test that
 * says so. Two ways: a season played out with every lineup counted, and the
 * exact scenario — take two players off a club and look at the very next day.
 *
 * The managed club is exempt on purpose. Filling the manager's own roster
 * behind his back would be the engine playing the game for him; the agenda
 * shouts about it instead. That is asserted too, so nobody "fixes" it later.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason, SEASON_DAYS } from '../src/engine/season'
import { selectLineup } from '../src/engine/match'
import type { GameState } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}
;(globalThis as never as { fetch: unknown }).fetch = undefined

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const fresh = (): GameState => {
  const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
  const g = createNewGame(me.id, '审计', 20260831)
  setupSeason(g)
  return g
}

// ---- a club stripped mid-week is whole again before it plays
{
  const g = fresh()
  while (g.day % 7 !== 1) advanceDay(g, { autoScrims: true })
  const victim = Object.values(g.teams).find((t) => t.id !== g.myTeam && t.tier === 1)!
  for (const pid of victim.roster.slice(0, 2)) {
    g.players[pid].teamId = null
    victim.roster = victim.roster.filter((x) => x !== pid)
    victim.starters = victim.starters.filter((x) => x !== pid)
  }
  check('挖走两个人之后当场确实只剩三个', selectLineup(g, victim.id).length === 3)
  advanceDay(g, { autoScrims: true })
  check('下一天开赛之前就补回五人', selectLineup(g, victim.id).length === 5,
    `名单 ${victim.roster.length} 人`)
  check('补人这件事写进了新闻',
    g.news.some((n) => n.kind === 'transfer' && n.text.includes(victim.name)),
    g.news.filter((n) => n.text.includes(victim.name)).slice(-1)[0]?.text ?? '没有')
}

// ---- and a whole season never puts a short side on the board
{
  const seasons = Number(process.argv[2] ?? 2)
  const g = fresh()
  const thin: string[] = []
  let counted = 0
  // Counted the day the match is played, never afterwards: pruneMatchDetail
  // strips `lineups` off other clubs' matches once they are ten days old, so
  // reading them at the end of a season measures nothing at all — which is
  // exactly what the first version of this check did.
  for (let s = 0; s < seasons; s++) {
    for (let d = 0; d < SEASON_DAYS; d++) {
      g.boardConfidence = 85; g.onNotice = false; g.missedStreak = 0
      if (g.finances.balance < 5_000_000) g.finances.balance = 20_000_000
      const played = advanceDay(g, { autoScrims: true }).playedMine
      void played
      for (const f of g.fixtures) {
        if (f.day !== g.day || !f.played || !f.result || f.scrim) continue
        for (const [side, teamId] of [['a', f.teamA], ['b', f.teamB]] as const) {
          const n = f.result.lineups?.[side]?.length
          if (n == null) continue
          counted++
          if (n < 5 && teamId !== g.myTeam) {
            thin.push(`${g.teams[teamId]?.tag ?? teamId} ${g.year}年第${f.day}天 ${n} 人`)
          }
        }
      }
      if (g.midReview) { g.midReview = false; g.midReviewDone = true }
    }
  }
  check(`${seasons} 个赛季里没有一支 AI 球队少于五人出场`, thin.length === 0,
    thin.length ? `${thin.length} 次，例：${thin.slice(0, 4).join(' / ')}` : `查了 ${counted} 份出场名单`)
  check('AI 球队全都满员', Object.values(g.teams)
    .filter((t) => t.id !== g.myTeam).every((t) => t.roster.length >= 5),
    Object.values(g.teams).filter((t) => t.id !== g.myTeam && t.roster.length < 5)
      .map((t) => `${t.tag}(${t.roster.length})`).join(' ') || '')
}

// ---- the manager's own club is his own problem, deliberately
{
  const g = fresh()
  const mine = g.teams[g.myTeam]
  // relative to whatever the club starts with — a real roster is five to
  // seven, and a signing in the data must not read as the engine refilling
  const before = mine.roster.length
  for (const pid of mine.roster.slice(0, 2)) {
    g.players[pid].teamId = null
    mine.roster = mine.roster.filter((x) => x !== pid)
    mine.starters = mine.starters.filter((x) => x !== pid)
  }
  advanceDay(g, { autoScrims: true })
  check('自己的队不会被引擎偷偷补人', mine.roster.length === before - 2,
    `${before} → ${mine.roster.length} 人——这是有意的，补阵容是经理自己的事`)
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
