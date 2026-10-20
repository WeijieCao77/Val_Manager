/** The 洛杉矶 2023 series' data: who played VALORANT Champions 2023 (Los Angeles),
 * for whom, where the team finished, and every stat the cards read — the
 * 首尔 2024 / 曼谷 2025 recipe on vlr event 1657.
 *
 *   node scripts/build_losangeles2023.mjs
 *
 * Inputs, all already on disk:
 *   scripts/cache/vlr_event_stats.json   the event page's 80 players (maps, Rating 2.0, ACS, KAST, KPR, APR, clutch %, agents)
 *   scripts/cache/vlr_matches_la2023.json every map, with the round it was played in (fetch_la2023_maps.py)
 *   data-raw/people.json                  flag, real name, birth and display handle by vlr id (the identity truth)
 *   src/data/world_2023.json              the P-id a man already has, so a card and his career stay one person
 *
 * Writes src/data/losangeles2023.json (meta, teams, players) and
 * src/data/losangeles2023_stages.json (stage-weighted stats, build_seoul_stages.mjs's weights).
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const J = (p) => JSON.parse(readFileSync(p, 'utf8'))
const EVENT = '1657'
const stats = J('scripts/cache/vlr_event_stats.json').stats[EVENT]
const matches = J('scripts/cache/vlr_matches_la2023.json').matches
const people = J('data-raw/people.json')
const w23 = J('src/data/world_2023.json')
const w26 = J('src/data/world.json')
assert.equal(stats.length, 80, 'the event page lists 80 players')

// Names as the event printed them: Riot's captions say DRX (vlr now shows the later KIWOOM DRX / KRX) and
// Giants (the club is GIANTX today).
const TEAMS = [
  { tag: 'EG', vlr: 'EG', name: 'Evil Geniuses', clubTag: 'EG', placement: 1, match: 'Evil Geniuses' },
  { tag: 'PRX', vlr: 'PRX', name: 'Paper Rex', clubTag: 'PRX', placement: 2, match: 'Paper Rex' },
  { tag: 'LOUD', vlr: 'LOUD', name: 'LOUD', clubTag: 'LOUD', placement: 3, match: 'LOUD' },
  { tag: 'FNC', vlr: 'FNC', name: 'FNATIC', clubTag: 'FNC', placement: 4, match: 'FNATIC' },
  { tag: 'DRX', vlr: 'KRX', name: 'DRX', clubTag: 'KRX', placement: 5, match: 'KIWOOM DRX' },
  { tag: 'EDG', vlr: 'EDG', name: 'EDward Gaming', clubTag: 'EDG', placement: 5, match: 'EDward Gaming' },
  { tag: 'BLG', vlr: 'BLG', name: 'Bilibili Gaming', clubTag: 'BLG', placement: 7, match: 'Bilibili Gaming' },
  { tag: 'FUT', vlr: 'FUT', name: 'FUT Esports', clubTag: 'FUT', placement: 7, match: 'FUT Esports' },
  { tag: 'NAVI', vlr: 'NAVI', name: 'Natus Vincere', clubTag: 'NAVI', placement: 9, match: 'Natus Vincere' },
  { tag: 'NRG', vlr: 'NRG', name: 'NRG', clubTag: 'NRG', placement: 9, match: 'NRG' },
  { tag: 'T1', vlr: 'T1', name: 'T1', clubTag: 'T1', placement: 9, match: 'T1' },
  { tag: 'GIA', vlr: 'GIA', name: 'Giants Gaming', clubTag: 'GX', placement: 9, match: 'Giants Gaming' },
  { tag: 'TL', vlr: 'TL', name: 'Team Liquid', clubTag: 'TL', placement: 13, match: 'Team Liquid' },
  { tag: 'FPX', vlr: 'FPX', name: 'FunPlus Phoenix', clubTag: 'FPX', placement: 13, match: 'FunPlus Phoenix' },
  { tag: 'KRÜ', vlr: 'KRÜ', name: 'KRÜ Esports', clubTag: 'KRÜ', placement: 13, match: 'KRÜ Esports' },
  { tag: 'ZETA', vlr: 'ZETA', name: 'ZETA DIVISION', clubTag: 'ZETA', placement: 13, match: 'ZETA DIVISION' },
]
const tagOfName = Object.fromEntries(TEAMS.map((t) => [t.match, t.tag]))

// ---- placements, checked against the bracket rather than typed in
const series = Object.values(matches).filter((m) => !/showmatch/i.test(m.stage ?? ''))
assert.equal(series.length, 34, '34 series: 20 group, 14 playoff')
const winnerOf = (m) => {
  const won = {}
  for (const map of m.maps) { const w = map.score[0] > map.score[1] ? 0 : 1; won[map.teams[w]] = (won[map.teams[w]] ?? 0) + 1 }
  return Object.entries(won).sort((a, b) => b[1] - a[1])[0][0]
}
const loserOf = (m) => m.maps[0].teams.find((t) => t !== winnerOf(m))
const stage = (re) => series.filter((m) => re.test(m.stage))
const gf = stage(/grand final/i)[0]
assert.equal(tagOfName[winnerOf(gf)], 'EG', 'EG won the grand final')
assert.equal(tagOfName[loserOf(gf)], 'PRX', 'PRX runner-up')
assert.equal(tagOfName[loserOf(stage(/lower final/i)[0])], 'LOUD', 'LOUD third')
assert.equal(tagOfName[loserOf(stage(/lower round 3/i)[0])], 'FNC', 'FNATIC fourth')
const lost = (re) => stage(re).map((m) => tagOfName[loserOf(m)]).sort()
assert.deepEqual(lost(/lower round 2/i), ['DRX', 'EDG'].sort(), '5th–6th')
assert.deepEqual(lost(/lower round 1/i), ['BLG', 'FUT'].sort(), '7th–8th')
assert.deepEqual(lost(/decider/i), ['GIA', 'NAVI', 'NRG', 'T1'].sort(), '9th–12th')
assert.deepEqual(lost(/elimination/i), ['FPX', 'KRÜ', 'TL', 'ZETA'].sort(), '13th–16th')
for (const name of new Set(series.flatMap((m) => m.maps.flatMap((x) => x.teams)))) assert(tagOfName[name], `team ${name} known`)

// ---- stage weights, exactly build_seoul_stages.mjs's rule (Seoul 2024 ran the same format)
const WEIGHTS = [1, 1.5, 2, 3]
const tierOf = (s0) => {
  const s = (s0 ?? '').toLowerCase()
  if (!s.startsWith('playoffs')) return 0
  if (s.includes('grand final')) return 3
  if (/upper semifinal|upper final|lower round 3|lower final/.test(s)) return 2
  return 1
}
const lines = new Map(stats.map((p) => [p.vlrId, []]))
for (const m of series) {
  for (const map of m.maps) {
    const rounds = map.score[0] + map.score[1]
    for (const r of map.rows) lines.get(r.vlrId)?.push({ w: rounds * WEIGHTS[tierOf(m.stage)], rating: r.rating2, acs: r.acs, kast: r.kast, kpr: r.k / rounds, apr: r.a / rounds })
  }
}
const staged = {}
for (const p of stats) {
  const xs = lines.get(p.vlrId)
  assert.equal(xs.length, p.maps, `${p.ign}: every map he played`)
  const mean = (k) => xs.reduce((s, x) => s + x[k] * x.w, 0) / xs.reduce((s, x) => s + x.w, 0)
  staged[p.vlrId] = { ign: p.ign, rating: +mean('rating').toFixed(3), acs: +mean('acs').toFixed(1), kast: +mean('kast').toFixed(1), kpr: +mean('kpr').toFixed(3), apr: +mean('apr').toFixed(3) }
}

// ---- who each man is
const by23 = new Map(w23.players.filter((p) => p.vlrId).map((p) => [String(p.vlrId), p]))
const club26 = new Map(w26.teams.map((t) => [t.tag, t]))
const START = new Date('2023-08-06')
const ageAt = (birth) => {
  if (!birth) return null
  const b = new Date(birth)
  let a = START.getUTCFullYear() - b.getUTCFullYear()
  if (START.getUTCMonth() < b.getUTCMonth() || (START.getUTCMonth() === b.getUTCMonth() && START.getUTCDate() < b.getUTCDate())) a--
  return a
}
const slug = (ign) => ign.toLowerCase().replace(/[^a-z0-9]+/g, '-')

const teamOrder = new Map(TEAMS.map((t, i) => [t.vlr, i]))
const ordered = [...stats].sort((a, b) => teamOrder.get(a.club) - teamOrder.get(b.club) || b.maps - a.maps || b.rating2 - a.rating2)
const players = ordered.map((p, i) => {
  const who = people[p.vlrId]
  assert(who, `${p.ign}: in people.json`)
  const w = by23.get(p.vlrId)
  const team = TEAMS.find((t) => t.vlr === p.club)
  assert(team, `${p.ign}: team ${p.club}`)
  const face = w && existsSync(`public/faces/${w.id}.webp`) ? `/faces/${w.id}.webp` : null
  return {
    // the handle as the event printed it (people.json's display handle: FNS, TZH), not vlr's later alias
    ign: who.ign ?? p.ign, team: team.tag, vlrId: p.vlrId,
    playerId: w?.id?.startsWith('P') ? w.id : null,
    profile: `https://www.vlr.gg/player/${p.vlrId}/${slug(p.ign)}`,
    nat: who.nat, realName: who.real ?? w?.realName ?? null, birth: who.birth ?? null, age: ageAt(who.birth), face,
    agents: p.agents.map(([a]) => a), agentUsage: Object.fromEntries(p.agents.map(([a, s]) => [a, s])),
    rating: p.rating2, acs: p.acs, kd: p.kd, kast: p.kast, adr: p.adr, kpr: p.kpr, apr: p.apr, hs: p.hs, clutch: p.clp,
    maps: p.maps, rounds: p.rnd, number: i + 1,
  }
})

const teams = TEAMS.map(({ tag, name, clubTag, placement }) => {
  const c = club26.get(clubTag)
  assert(c, `${tag}: a 2026 club`)
  return { tag, name, region: c.region, clubId: c.id, placement }
})

writeFileSync('src/data/losangeles2023.json', JSON.stringify({
  meta: {
    name: 'VALORANT Champions 2023', city: 'Los Angeles', start: '2023-08-06', end: '2023-08-26',
    rosterSource: 'https://www.vlr.gg/event/stats/1657/valorant-champions-2023',
    matchesSource: 'https://www.vlr.gg/event/matches/1657/valorant-champions-2023/?series_id=all',
    eventSource: 'https://valorantesports.com/en-US/news/valorant-champions-2023-everything-you-need',
    scope: '80 players, 16 teams of five (nobody subbed in); team names as the event printed them (DRX, Giants).',
    retrieved: '2026-10-18',
  },
  teams, players,
}, null, 1) + '\n')
writeFileSync('src/data/losangeles2023_stages.json', JSON.stringify({
  weights: { groups: 1, firstPlayoffRounds: 1.5, upperSemifinalToLowerFinal: 2, grandFinal: 3 },
  source: 'https://www.vlr.gg/event/matches/1657/valorant-champions-2023/?series_id=all',
  retrieved: '2026-10-18',
  players: staged,
}, null, 1) + '\n')
console.log(`Wrote ${players.length} players, ${teams.length} teams; live ids ${players.filter((p) => p.playerId).length}, faces ${players.filter((p) => p.face).length}`)
