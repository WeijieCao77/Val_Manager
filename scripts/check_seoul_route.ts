/**
 * 首尔征途: the road is 2024's, it costs nothing, and it pays two packs once.
 *
 *   npx tsx scripts/check_seoul_route.ts
 *
 * Drives the real actions (runAction, the function the server runs) with fixed
 * seeds, so every match here is played by the production engine on the 2024
 * map pool.
 */
import assert from 'node:assert/strict'
import { mergeClientFields, migrateGacha, newGacha, SERVER_KEYS } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import type { ActEnv } from '../src/engine/cardActions'
import { SEOUL_TEAMS } from '../src/engine/seoul2024'
import { ROUTE_LEGS_MAX, SEOUL_FIVES, SEOUL_POOL, SEOUL_ROUTES, cleanRoute } from '../src/engine/seoulRoute'
import type { RouteOutcome } from '../src/engine/seoulRoute'
import { cardById, isPlayerCard, personOf } from '../src/engine/cards'
import { playRivalMatch } from '../src/engine/arena'
import type { ArenaResult } from '../src/engine/arena'

// ---- the roads are the bracket as played
assert.equal(Object.keys(SEOUL_ROUTES).length, 16)
assert.equal(Object.values(SEOUL_ROUTES).reduce((n, r) => n + r.length, 0), 68, 'each of the 34 series sits on two roads')
assert.deepEqual(SEOUL_ROUTES.EDG.map((s) => s.opp), ['FUT', 'G2', 'PRX', 'TE', 'SEN', 'LEV', 'TH'])
assert.deepEqual(SEOUL_ROUTES.TH.map((s) => s.opp), ['FPX', 'GEN', 'FNC', 'LEV', 'DRX', 'SEN', 'LEV', 'EDG'])
assert.deepEqual(SEOUL_ROUTES.BLG.map((s) => s.opp), ['FNC', 'KRÜ'])
assert.equal(SEOUL_ROUTES.EDG[1].stage, '小组赛 D 组胜者组')
assert.deepEqual([SEOUL_ROUTES.EDG[1].won, SEOUL_ROUTES.EDG[1].lost], [1, 2], 'EDG lost to G2 in the groups')
const final = SEOUL_ROUTES.EDG.at(-1)!
assert.deepEqual([final.stage, final.bo, final.won, final.lost], ['总决赛', 5, 3, 2])
assert.deepEqual(final.maps.map((m) => m.map), ['Haven', 'Sunset', 'Lotus', 'Bind', 'Abyss'])
assert.equal(SEOUL_ROUTES.TH[6].stage, '败者组决赛')
assert.equal(SEOUL_ROUTES.TH[6].bo, 5)
for (const [tag, road] of Object.entries(SEOUL_ROUTES)) {
  for (const st of road) {
    const other = SEOUL_ROUTES[st.opp].find((x) => x.series === st.series)
    assert(other, `${tag} ${st.series} is on ${st.opp}'s road too`)
    assert.equal(other.opp, tag)
    assert.deepEqual([other.won, other.lost, other.bo], [st.lost, st.won, st.bo], `${st.series} reads the same from both sides`)
  }
}
assert.equal(SEOUL_TEAMS.filter((t) => { const last = SEOUL_ROUTES[t.tag].at(-1)!; return last.won < last.lost }).length, 15,
  'every road but the champion\'s ends on a match lost in 2024')
assert.deepEqual(SEOUL_POOL, ['Abyss', 'Ascent', 'Bind', 'Haven', 'Icebox', 'Lotus', 'Sunset'])
for (const t of SEOUL_TEAMS) {
  const five = SEOUL_FIVES[t.tag]
  const cards = five.slots.map((id) => cardById(id!))
  assert.equal(five.coach, null)
  assert(cards.every((c) => c && isPlayerCard(c) && c.event === 'seoul-2024' && c.clubTag === t.tag), `${t.tag} fields its own 2024 cards`)
  assert.equal(new Set(cards.map((c) => personOf(c!))).size, 5, `${t.tag} seats five people`)
}

// the veto deals the 2024 pool evenly: with every preference level it leans on list
// position, and before the pool was shuffled Sunset got 7% of maps and Haven 20%
const dealt: Record<string, number> = Object.fromEntries(SEOUL_POOL.map((m) => [m, 0]))
for (let i = 0; i < 400; i++) {
  const res = playRivalMatch(
    { ...SEOUL_FIVES.EDG, name: 'EDward Gaming', tag: 'EDG' }, () => 0,
    { ...SEOUL_FIVES.TH, name: 'Team Heretics', tag: 'TH', levels: {}, div: 0, points: 0 },
    3, 777 + i * 104_729, SEOUL_POOL,
  )
  for (const m of res.result.maps) dealt[m.map]++
}
const mapsDealt = Object.values(dealt).reduce((a, b) => a + b, 0)
for (const [m, k] of Object.entries(dealt)) {
  assert(k / mapsDealt > 0.10 && k / mapsDealt < 0.19, `${m} is ${(k / mapsDealt * 100).toFixed(1)}% of ${mapsDealt} maps`)
}

// ---- the actions
let tick = 0
const env = (): ActEnv => { tick++; return { now: 1_790_000_000_000 + tick * 60_000, today: '2026-09-12', seed: 40_000 + tick * 7919 } }
const route = (g: { seoulRoute?: unknown }) => cleanRoute(g.seoulRoute)

const g = newGacha('ROUTE-AUDIT', '征途测试', '2026-09-12')
assert.equal(runAction(g, 'seoul_play', {}, env()).ok, false, 'no road, no match')
// taken after one action, so what every action normalizes (the ladder's points) is not blamed on the road
const before = { stamina: g.daily.stamina, coins: g.coins, cards: JSON.stringify(g.cards), ladder: JSON.stringify(g.ladder) }
assert.equal(runAction(g, 'seoul_start', { team: 'XYZ' }, env()).ok, false)
assert.equal(runAction(g, 'seoul_start', { team: 'constructor' }, env()).ok, false, 'not a key off the prototype')
assert(runAction(g, 'seoul_start', { team: 'BLG' }, env()).ok)
assert(runAction(g, 'seoul_start', { team: 'BLG' }, env()).ok)
assert.equal(route(g).records.BLG.runs, 1, 'a double tap starts one road')

function drive(team: string): { played: number; lost: number; outs: RouteOutcome[] } {
  let played = 0
  let lost = 0
  const outs: RouteOutcome[] = []
  assert.equal(route(g).run?.team, team)
  while (route(g).run) {
    const stage = route(g).run!.stage
    const packs = g.packs.seoul2024 ?? 0
    const firstWin = route(g).firstWin
    const r = runAction(g, 'seoul_play', {}, env())
    assert(r.ok, 'a road in progress always plays')
    const { res, out } = r.result as { res: ArenaResult; out: RouteOutcome }
    const st = SEOUL_ROUTES[team][stage]
    played++
    if (!res.win) lost++
    outs.push(out)
    assert.equal(out.win, res.win)
    assert.equal(res.mapsWon + res.mapsLost <= st.bo, true, `BO${st.bo}`)
    assert.equal(Math.max(res.mapsWon, res.mapsLost), Math.ceil(st.bo / 2))
    for (const m of res.result.maps) assert(SEOUL_POOL.includes(m.map), `${m.map} is not a 2024 map`)
    assert.equal(out.rewrote, res.win && st.won < st.lost)
    assert.equal(out.losses, lost, 'losses on the road count every match lost since it started')
    assert.equal((g.packs.seoul2024 ?? 0) - packs, out.packs)
    if (res.win && !firstWin) assert(out.packs >= 1, 'the first win pays')
    assert(played < 400)
  }
  return { played, lost, outs }
}

const blg = drive('BLG')
assert.equal(g.packs.seoul2024, 2, 'first win and first finished road, one 首尔包 each')
let rec = route(g).records.BLG
assert.deepEqual([rec.clears, rec.best, rec.legs.length], [1, blg.lost, blg.played])
assert(blg.outs.at(-1)!.cleared)
assert.equal(g.daily.stamina, before.stamina, 'no 体力')
assert.equal(g.coins, before.coins, 'no coins either way')
assert.equal(JSON.stringify(g.cards), before.cards, 'the collection is not touched')
assert.equal(JSON.stringify(g.ladder), before.ladder, 'the ladder is not touched')

assert(runAction(g, 'seoul_start', { team: 'FUT' }, env()).ok)
drive('FUT')
assert.equal(g.packs.seoul2024, 2, 'the two packs are the account\'s, once')

// the record keeps the fewest losses, and a worse road does not replace it
let bestSoFar = rec.best!
for (let i = 0; i < 4; i++) {
  assert(runAction(g, 'seoul_start', { team: 'BLG' }, env()).ok)
  const again = drive('BLG')
  bestSoFar = Math.min(bestSoFar, again.lost)
  rec = route(g).records.BLG
  assert.equal(rec.best, bestSoFar)
  assert.equal(again.outs.at(-1)!.bestBefore !== null, true)
}
assert.equal(rec.clears, 5)
assert(rec.legs.length <= ROUTE_LEGS_MAX)

// giving up, and switching teams mid-road
assert(runAction(g, 'seoul_start', { team: 'EDG' }, env()).ok)
assert(runAction(g, 'seoul_play', {}, env()).ok)
assert(runAction(g, 'seoul_start', { team: 'TH' }, env()).ok)
assert.equal(route(g).run?.team, 'TH')
assert.deepEqual([route(g).run?.stage, route(g).run?.losses], [0, 0])
assert.equal(route(g).records.EDG.clears, 0)
assert.equal(route(g).records.EDG.legs.length, 1, 'a road given up keeps the matches it played')
assert(runAction(g, 'seoul_quit', {}, env()).ok)
assert.equal(route(g).run, null)
assert.equal(runAction(g, 'seoul_play', {}, env()).ok, false)

// ---- the server owns it
assert((SERVER_KEYS as readonly string[]).includes('seoulRoute'))
const forged = JSON.parse(JSON.stringify(g))
forged.seoulRoute = { run: null, records: {}, firstWin: false, firstClear: false }
const merged = mergeClientFields(JSON.parse(JSON.stringify(g)), forged)
assert.equal(route(merged).firstWin, true, 'a client save cannot hand the first-win pack back')
assert.equal(route(merged).records.BLG.clears, 5)
const reloaded = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
assert.deepEqual(route(reloaded), route(g), 'survives a save round trip')
const broken = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
;(broken as { seoulRoute?: unknown }).seoulRoute = { run: { team: 'EDG', stage: 99, losses: -3 }, records: 'x', firstWin: 'yes' }
assert.deepEqual(route(broken), { run: null, records: {}, firstWin: false, firstClear: false })
assert.equal(runAction(broken, 'seoul_play', {}, env()).ok, false, 'a hand-edited road is dropped, not played')

// an account that holds none of the cards plays the same road
const empty = newGacha('ROUTE-EMPTY', '空账号', '2026-09-12')
empty.cards = {}
empty.squad = { slots: [null, null, null, null, null], coach: null }
assert(runAction(empty, 'seoul_start', { team: 'EDG' }, env()).ok)
assert(runAction(empty, 'seoul_play', {}, env()).ok, 'the five is 2024\'s, not the collection\'s')

console.log(`ok  首尔征途 — 16 roads, 68 matches, pool ${SEOUL_POOL.join('/')}, ${tick} actions driven`)
