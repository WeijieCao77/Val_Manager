/** The 曼谷 2025 series' data: who played Masters Bangkok, for whom, where the
 * team finished, and every stat the cards read — the 首尔 2024 recipe, event 2281.
 *
 *   node scripts/build_bangkok2025.mjs
 *
 * Inputs, all already on disk:
 *   scripts/cache/vlr_event_stats.json        the event page's 41 players (maps, Rating 2.0, ACS, KAST, KPR, APR, clutch %, agents)
 *   scripts/cache/vlr_matches_bangkok2025.json every map, with the round it was played in (fetch_bangkok2025_maps.py)
 *   data-raw/people.json                       flag, real name and birth by vlr id (the identity truth)
 *   src/data/world_2025.json                   the P-id a man already has, so a card and his career stay one person
 *
 * Writes src/data/bangkok2025.json (meta, teams, players) and
 * src/data/bangkok2025_stages.json (stage-weighted stats, build_seoul_stages.mjs's weights).
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const J = (p) => JSON.parse(readFileSync(p, 'utf8'))
const EVENT = '2281'
const stats = J('scripts/cache/vlr_event_stats.json').stats[EVENT]
const matches = J('scripts/cache/vlr_matches_bangkok2025.json').matches
const people = J('data-raw/people.json')
const w25 = J('src/data/world_2025.json')
const w26 = J('src/data/world.json')
assert.equal(stats.length, 41, 'the event page lists 41 players')

// Names as the event printed them: Riot's own captions say DRX (vlr now shows the later KIWOOM DRX / KRX).
const TEAMS = [
  { tag: 'T1', vlr: 'T1', name: 'T1', clubTag: 'T1', placement: 1 },
  { tag: 'G2', vlr: 'G2', name: 'G2 Esports', clubTag: 'G2', placement: 2 },
  { tag: 'EDG', vlr: 'EDG', name: 'EDward Gaming', clubTag: 'EDG', placement: 3 },
  { tag: 'VIT', vlr: 'VIT', name: 'Team Vitality', clubTag: 'VIT', placement: 4 },
  { tag: 'DRX', vlr: 'KRX', name: 'DRX', clubTag: 'KRX', placement: 5 },
  { tag: 'TL', vlr: 'TL', name: 'Team Liquid', clubTag: 'TL', placement: 5 },
  { tag: 'SEN', vlr: 'SEN', name: 'Sentinels', clubTag: 'SEN', placement: 7 },
  { tag: 'TE', vlr: 'TE', name: 'Trace Esports', clubTag: 'TE', placement: 7 },
]

// ---- placements, checked against the bracket rather than typed in
const series = Object.values(matches).filter((m) => !/showmatch/i.test(m.stage ?? ''))
assert.equal(series.length, 16, '16 series: 10 Swiss, 6 playoff')
const winnerOf = (m) => {
  const won = {}
  for (const map of m.maps) { const w = map.score[0] > map.score[1] ? 0 : 1; won[map.teams[w]] = (won[map.teams[w]] ?? 0) + 1 }
  return Object.entries(won).sort((a, b) => b[1] - a[1])[0][0]
}
const tagOfName = { 'T1': 'T1', 'G2 Esports': 'G2', 'EDward Gaming': 'EDG', 'Team Vitality': 'VIT', 'KIWOOM DRX': 'DRX', 'Team Liquid': 'TL', 'Sentinels': 'SEN', 'Trace Esports': 'TE' }
const gf = series.find((m) => /grand final/i.test(m.stage))
assert.equal(tagOfName[winnerOf(gf)], 'T1', 'T1 won the grand final')
const lf = series.find((m) => /lower final/i.test(m.stage))
assert.equal(tagOfName[gf.maps[0].teams.find((t) => t !== winnerOf(gf))], 'G2', 'G2 runner-up')
assert.equal(tagOfName[lf.maps[0].teams.find((t) => t !== winnerOf(lf))], 'EDG', 'EDG third')

// ---- stage weights, exactly build_seoul_stages.mjs's rule
const WEIGHTS = [1, 1.5, 2, 3]
const tierOf = (stage) => {
  const s = (stage ?? '').toLowerCase()
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
const by25 = new Map(w25.players.filter((p) => p.vlrId).map((p) => [String(p.vlrId), p]))
const club26 = new Map(w26.teams.map((t) => [t.tag, t]))
const START = new Date('2025-02-20')
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
  const w = by25.get(p.vlrId)
  const team = TEAMS.find((t) => t.vlr === p.club)
  const face = w && existsSync(`public/faces/${w.id}.webp`) ? `/faces/${w.id}.webp` : null
  return {
    ign: p.ign, team: team.tag, vlrId: p.vlrId,
    // a live P-id carries the man's card identity; anyone else is event-only
    playerId: w?.id?.startsWith('P') ? w.id : null,
    profile: `https://www.vlr.gg/player/${p.vlrId}/${slug(p.ign)}`,
    nat: who.nat, realName: w?.realName ?? who.real ?? null, birth: who.birth ?? null, age: ageAt(who.birth), face,
    agents: p.agents.map(([a]) => a), agentUsage: Object.fromEntries(p.agents.map(([a, s]) => [a, s])),
    rating: p.rating2, acs: p.acs, kd: p.kd, kast: p.kast, adr: p.adr, kpr: p.kpr, apr: p.apr, hs: p.hs, clutch: p.clp,
    maps: p.maps, rounds: p.rnd, number: i + 1,
  }
})

const teams = TEAMS.map(({ tag, name, clubTag, placement }) => {
  const c = club26.get(clubTag)
  return { tag, name, region: c?.region ?? null, clubId: c?.id ?? null, placement }
})

writeFileSync('src/data/bangkok2025.json', JSON.stringify({
  meta: {
    name: 'VALORANT Masters Bangkok 2025', start: '2025-02-20', end: '2025-03-02',
    rosterSource: 'https://www.vlr.gg/event/stats/2281/valorant-masters-bangkok-2025',
    matchesSource: 'https://www.vlr.gg/event/matches/2281/valorant-masters-bangkok-2025/?series_id=all',
    eventSource: 'https://valorantesports.com/en-US/news/masters-bangkok-eyntk-2025',
    scope: '41 players with maps played (T1 fielded six); team names as the event printed them (DRX, not the later KIWOOM DRX). Showmatch excluded.',
    retrieved: '2026-09-30',
  },
  teams, players,
}, null, 1) + '\n')
writeFileSync('src/data/bangkok2025_stages.json', JSON.stringify({
  weights: { swiss: 1, firstPlayoffRounds: 1.5, upperSemifinalToLowerFinal: 2, grandFinal: 3 },
  source: 'https://www.vlr.gg/event/matches/2281/valorant-masters-bangkok-2025/?series_id=all',
  retrieved: '2026-09-30',
  players: staged,
}, null, 1) + '\n')
console.log(`Wrote ${players.length} players, ${teams.length} teams; live ids ${players.filter((p) => p.playerId).length}, faces ${players.filter((p) => p.face).length}`)
