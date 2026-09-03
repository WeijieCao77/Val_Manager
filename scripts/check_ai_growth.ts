/**
 * The world fights back.
 *
 * A player who trained a 90+ squad reported winning every title forever: AI
 * clubs felt like they never improved, and the first world championship began
 * a permanent procession. Three mechanisms answer it — winter potential
 * re-evaluation keeps young headroom from running dry, an international title
 * raises `rivalry` so every other club trains harder and recruits for
 * potential, and rivalry also puts real bids on the champion's own starters.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason, settleCompetition } from '../src/engine/season'
import { weeklyTick, seasonRollover } from '../src/engine/training'
import { Rng } from '../src/engine/rng'
import type { Competition, GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', 20260826)
  setupSeason(g)
  return g
}

// ---- an international title provokes the league; a regional one does not
{
  const g = mk()
  const comp = (region?: string): Competition => ({
    key: 'k', stage: 'masters1', name: '测试杯', region,
    teams: Object.keys(g.teams).slice(0, 8), finished: [g.myTeam],
    champion: g.myTeam, awarded: false,
  } as unknown as Competition)
  settleCompetition(g, comp())
  check('a world title raises rivalry', (g.rivalry ?? 0) === 1, `rivalry=${g.rivalry}`)
  settleCompetition(g, comp('China'))
  check('a regional title does not', (g.rivalry ?? 0) === 1, `rivalry=${g.rivalry}`)
}

// ---- provoked AI clubs train measurably harder
{
  const xpSum = (g: GameState, teamId: string) =>
    squadOf(g, teamId).reduce((s, p) => s + Object.values(p.xp).reduce((a, b) => a + (b ?? 0), 0), 0)
  const run = (rivalry: number) => {
    const g = mk()
    g.rivalry = rivalry
    const foe = Object.values(g.teams).find((t) => t.id !== g.myTeam)!
    weeklyTick(g, new Rng(11))
    return xpSum(g, foe.id)
  }
  const calm = run(0)
  const chased = run(2)
  check('rivalry 2 trains AI ~1.44x harder', chased > calm * 1.35 && chased < calm * 1.55,
    `xp ${calm.toFixed(1)} → ${chased.toFixed(1)} (${(chased / calm).toFixed(2)}x)`)
}

// ---- winter re-evaluation: the young get re-rated, the old never do
{
  const probe = (age: number, pot: (o: number) => number) => {
    let raised = 0
    for (let seed = 0; seed < 80; seed++) {
      const g2 = mk()
      const q = squadOf(g2, g2.myTeam)[0]
      q.age = age
      q.potential = pot(q.overall)
      const before = q.potential
      seasonRollover(g2, new Rng(500 + seed))
      if (q.potential > before) raised++
    }
    return raised
  }
  const youngRaised = probe(22, (o) => o + 1)
  const oldRaised = probe(25, (o) => o + 1)
  const cappedMoved = probe(22, () => 98)
  check('a 23-and-under near his ceiling sometimes gets re-rated', youngRaised >= 8, `${youngRaised}/80`)
  check('a 25-year-old never does', oldRaised === 0, `${oldRaised}/80`)
  check('a 98-potential player is already believed in', cappedMoved === 0, `${cappedMoved}/80`)
}

// ---- across two seasons the AI top of the world keeps climbing
{
  const g = mk()
  const rng = new Rng(7)
  const top10mean = () => {
    const os = Object.values(g.teams)
      .filter((t) => t.id !== g.myTeam)
      .map((t) => {
        const s = squadOf(g, t.id).map((p) => p.overall).sort((a, b) => b - a).slice(0, 5)
        return s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)
      })
      .sort((a, b) => b - a)
    return os.slice(0, 10).reduce((a, b) => a + b, 0) / 10
  }
  // "At least a point in two seasons" was written when the top ten sat at 85
  // with room to spare. After the 2026-09-03 rating rework they open at 87.6,
  // mostly 24-to-27-year-olds a few points under their ceilings, and a flat
  // point would ask veterans to grow through their own potential. So two
  // things are checked instead: the top ten still climb (no stagnation), and
  // the young men in those squads — the ones with room — actually use it.
  const topSquads = () => Object.values(g.teams)
    .filter((t) => t.id !== g.myTeam)
    .map((t) => squadOf(g, t.id).sort((a, b) => b.overall - a.overall).slice(0, 5))
    .sort((a, b) => b.reduce((x, p) => x + p.overall, 0) - a.reduce((x, p) => x + p.overall, 0))
    .slice(0, 10)
    .flat()
  const start = top10mean()
  const young = topSquads().filter((p) => p.age <= 23 && p.potential - p.overall >= 3)
  const youngStart = young.map((p) => ({ p, o: p.overall, room: p.potential - p.overall }))
  for (let season = 0; season < 2; season++) {
    let guard = 0
    const y = g.year
    while (g.year === y && guard++ < 400) advanceDay(g, rng)
  }
  const end = top10mean()
  check('two seasons on, the AI top ten mean still climbs', end - start >= 0.5,
    `${start.toFixed(2)} → ${end.toFixed(2)} (+${(end - start).toFixed(2)})`)
  check('and did not run away', end <= 93, `${end.toFixed(2)}`)
  const grown = youngStart.map(({ p, o, room }) => (p.overall - o) / room)
  const share = grown.reduce((a, b) => a + b, 0) / Math.max(1, grown.length)
  check(`the young in those squads close a quarter of their headroom (${youngStart.length} of them)`,
    youngStart.length === 0 || share >= 0.25,
    `mean ${(share * 100).toFixed(0)}% closed · ` + youngStart.slice(0, 5).map(({ p, o, room }) => `${p.ign} ${o}→${p.overall}/${o + room}`).join(', '))
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
