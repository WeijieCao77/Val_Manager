/** Score fairness across different rosters, both seats, cups and both ladder paths. */
import assert from 'node:assert/strict'
import { ARENA_TEAM, buildCupArena, playCupMatch, playArenaMatch, playRivalMatch } from '../src/engine/arena'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import { squadPaper, squadRating } from '../src/engine/cards'
import { buildLineup } from '../src/engine/match'
import { hashStr } from '../src/engine/rng'
import { WORLD_TEAMS } from '../src/engine/teams'
import { LEAGUE_RULES } from '../src/engine/gacha'

const N = Number(process.env.ODDS_SAMPLES ?? 400)
assert(N >= 400, 'statistical tests require at least 400 samples')
const score = (t: typeof CUP_TEAMS[number]) => squadPaper(t.squad).score
const pairs = CUP_TEAMS.flatMap((a, i) => CUP_TEAMS.slice(i + 1)
  .filter(b => a.rating === b.rating && Math.abs(score(a) - score(b)) < .5)
  .map(b => {
    const { state } = buildCupArena(a.squad, () => 0, b.id, 7)
    delete state.cardMatchStrength
    const A = buildLineup(state, ARENA_TEAM, 'Ascent', b.id)
    const B = buildLineup(state, b.id, 'Ascent', ARENA_TEAM)
    return { a, b, hidden: Math.abs((A.atk + A.def - B.atk - B.def) / 2) }
  })).sort((a, b) => b.hidden - a.hidden).slice(0, 8)
assert.equal(pairs.length, 8)
for (const { a, b, hidden } of pairs) {
  let wins = 0
  for (let i = 0; i < N; i++) {
    // Alternate who occupies the human seat: neither player nor club gets a buff.
    const reverse = i % 2 === 1
    const first = reverse ? b : a, second = reverse ? a : b
    const r = playCupMatch(first.squad, () => 0, second.id, 3, hashStr(`equal-score:${a.id}:${b.id}:${i}`))
    wins += Number(reverse ? !r.win : r.win)
  }
  const rate = wins / N
  assert(rate >= .38 && rate <= .62, `${a.tag}/${b.tag} equal ${a.rating}: ${rate}`)
  console.log(`equal ${a.rating}: ${a.tag}/${b.tag}, old hidden gap ${hidden.toFixed(2)}, ${wins}/${N} (${(rate * 100).toFixed(1)}%)`)
}

// fences round balance v3 (2026-09-20): BO3 60 / 77 / 93 / 99.5, a BO5 a little above
for (const bo of [3, 5] as const) {
  for (const [gap, min, max] of [[0, .42, .58], [3, .54, .70], [6, .70, .88], [10, .88, .99], [15, .97, 1]]) {
    const fixtures = CUP_TEAMS.flatMap(a => CUP_TEAMS.filter(b => a.id !== b.id && Math.abs(score(a) - score(b) - gap) < .3).map(b => ({ a, b })))
    assert(fixtures.length >= 3)
    let wins = 0
    for (let i = 0; i < N * 2; i++) {
      const { a, b } = fixtures[i % fixtures.length]
      const reverse = i % 2 === 1
      const first = reverse ? b : a, second = reverse ? a : b
      const seed = hashStr(`score-curve:${bo}:${gap}:${i}`)
      const cup = playCupMatch(first.squad, () => 0, second.id, bo, seed)
      wins += Number(reverse ? !cup.win : cup.win)
      // Exact card/cup parity, including round logs, independent of opponent IDs.
      if (i < 4) {
        const pvp = playRivalMatch(first.squad, () => 0, { ...second.squad, name: second.name, tag: second.tag, levels: {}, div: 4, points: 0 }, bo, seed, undefined, true)
        assert.deepEqual(cup.result.maps, pvp.result.maps)
      }
    }
    const rate = wins / (N * 2)
    assert(rate >= min && rate <= max, `BO${bo} gap ${gap}: ${rate}`)
    console.log(`BO${bo} gap +${gap}: ${wins}/${N * 2} (${(rate * 100).toFixed(1)}%)`)
  }
}

// Club ladders must use the displayed club score including every league bump.
for (const [league, rule] of Object.entries(LEAGUE_RULES)) {
  const b = WORLD_TEAMS[0]
  const a = CUP_TEAMS.reduce((x, y) => Math.abs(score(x) - b.rating - rule.oppBump) < Math.abs(score(y) - b.rating - rule.oppBump) ? x : y)
  let wins = 0
  for (let i = 0; i < N; i++) {
    const r = playArenaMatch(a.squad, () => 0, b.id, 3, hashStr(`club-odds:${league}:${i}`), rule.oppBump)
    if (r.win) wins++
    if (i === 0) {
      const edge = r.result.maps[0].edge!
      const gap = score(a) - (b.rating + rule.oppBump)
      assert(Math.sign(edge.a.atk - edge.b.atk) === Math.sign(gap))
    }
  }
  assert(wins / N > .36 && wins / N < .64, `${league} equal-ish club: ${wins}/${N}`)
  console.log(`${league} club ${squadRating(a.squad)} vs ${b.rating + rule.oppBump}: ${wins}/${N}`)
}
console.log('card score odds: all passed')
