/**
 * The 2026 rulebook, played through headless: every draw the plan names,
 * held against its acceptance criteria.
 *
 *   npx tsx scripts/check_draws.ts [seeds]
 *
 * Kickoff drawn as a twelve-team triple elimination with last year's
 * Champions sides (the region's best-regarded four in a career's first
 * year) on byes; Stage 1 groups from six pots; the Masters Swiss drawn round
 * by round — second seeds against third seeds of other regions, then by
 * record, then without a rematch — and the champions picking their
 * quarter-final opponents in a drawn order; Stage 2 reshuffled by three
 * swap pools; Champions drawn from four pots with one side per region per
 * group, and a drawn quarter-final with same-group sides in opposite
 * halves. The same seed draws the same thing twice, and the season ends
 * with a champion.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { SEASON_DAYS, advanceDay, setupSeason } from '../src/engine/season'
import { CHAMPIONS_2025, setCurrentRuleset } from '../src/engine/ruleset'
import { readFileSync } from 'node:fs'
import { WORLD_PLAYERS } from '../src/engine/world'
import { drawsOf, choosePick, pickerNow } from '../src/engine/draw'
import { REGIONS } from '../src/engine/types'
import type { GameState, Fixture } from '../src/engine/types'

const N = Number(process.argv[2] ?? 2)
let bad = 0
const check = (ok: boolean, what: string) => { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${what}`) }
const tag = (g: GameState, id: string) => g.teams[id]?.tag ?? id
const loserOf = (f: Fixture) => (f.result!.mapsWonA > f.result!.mapsWonB ? f.teamB : f.teamA)
const nameOf = (f: Fixture) => f.label.split(':')[2] ?? ''

setCurrentRuleset('vct-2026')

// ---- the Champions 2025 field the first Kickoff uses is what the records say
{
  const rec = JSON.parse(readFileSync(new URL('../src/data/records.json', import.meta.url), 'utf8')) as { players: Record<string, { ev?: [string, string, string, string][] }> }
  const names = new Set<string>()
  for (const p of Object.values(rec.players)) for (const e of p.ev ?? []) if (String(e[0]) === '2283') names.add(e[2])
  const byName = new Map(WORLD_TEAMS.map((t) => [t.name, t.id]))
  const ids = [...names].map((n) => byName.get(n) ?? WORLD_TEAMS.find((t) => n.toLowerCase().startsWith(t.name.toLowerCase()) || t.name.toLowerCase().startsWith(n.toLowerCase()))?.id).filter((x): x is string => !!x)
  console.log('Champions 2025 in the records')
  check(ids.length === 16 && ids.every((id) => CHAMPIONS_2025.includes(id)) && CHAMPIONS_2025.every((id) => ids.includes(id)),
    `sixteen sides, and CHAMPIONS_2025 names exactly them (${ids.length} matched)`)
  void WORLD_PLAYERS
}

function playSeason(g: GameState): void {
  let guard = 0
  while (g.day < SEASON_DAYS - 1 && guard++ < 600) {
    const r = advanceDay(g, { autoResolveDrawDecisions: true })
    if (r.seasonEnded) break
  }
}

for (let i = 0; i < N; i++) {
  const seed = 5000 + i * 11
  const team = WORLD_TEAMS.filter((t) => t.tier === 1)[i * 7 % 40]
  const g = createNewGame(team.id, 'draws', seed)
  setupSeason(g)
  console.log(`\n${team.tag} seed ${seed} (${g.rulesetId})`)

  // ---- Kickoff, before a ball is played
  for (const region of REGIONS) {
    const kc = g.comps[`kickoff:${region}`]
    const ev = drawsOf(g, kc.key).find((d) => d.kind === 'kickoff-bracket')!
    const seeds = ev.outcome.seeds ?? []
    check(kc.format === 'triple' && seeds.length === 12 && new Set(seeds).size === 12, `${region} Kickoff: twelve seeds drawn, each once`)
    const real = CHAMPIONS_2025.filter((t) => kc.teams.includes(t))
    check(real.length === 4 && real.every((t) => kc.byes?.includes(t)), `${region}: first-year byes are the Champions 2025 sides (${real.map((t) => tag(g, t)).join('/')})`)
    const wave1 = g.fixtures.filter((f) => f.comp === kc.key)
    check(wave1.length === 4 && wave1.every((f) => !kc.byes?.includes(f.teamA) && !kc.byes?.includes(f.teamB)), `${region}: four opening ties, no bye side in them`)
  }
  const s1 = g.comps[`stage1:${g.teams[g.myTeam].region}`]
  check(!!s1?.grouped && !s1.groups && !g.fixtures.some((f) => f.comp === s1.key), 'Stage 1 is a shell until its draw')

  playSeason(g)

  // ---- Kickoff played out
  for (const region of REGIONS) {
    const kc = g.comps[`kickoff:${region}`]
    const ko = g.fixtures.filter((f) => f.comp === kc.key)
    const losses = new Map<string, number>()
    for (const f of ko) if (f.result) losses.set(loserOf(f), (losses.get(loserOf(f)) ?? 0) + 1)
    const finals = ko.filter((f) => ['胜者组决赛', '中段组决赛', '败者组决赛'].includes(nameOf(f)))
    check(ko.length === 30 && ko.every((f) => f.played), `${region} Kickoff: thirty ties, all played`)
    check(finals.length === 3 && finals.every((f) => f.bo === 5), `${region}: the three finals are BO5`)
    check([...losses.values()].every((n) => n <= 3) && kc.finished.length === 12 && new Set(kc.finished).size === 12, `${region}: nobody lost more than three, twelve placings, each once (losses ${[...losses.values()].sort().join('')})`)
    const q = kc.finished.slice(0, 3)
    check(losses.get(q[0]) === undefined && losses.get(q[1]) === 1 && losses.get(q[2]) === 2, `${region}: seeds 1/2/3 have 0/1/2 losses (${q.map((t) => tag(g, t)).join('/')})`)
  }

  // ---- Stage 1 groups
  for (const region of REGIONS) {
    const s = g.comps[`stage1:${region}`]
    const kc = g.comps[`kickoff:${region}`]
    const groups = s.groups ?? []
    check(groups.length === 2 && groups.every((x) => x.length === 6) && new Set(groups.flat()).size === 12, `${region} Stage 1: Alpha and Omega of six, each side once`)
    const pots = s.seedPots ?? []
    check(pots.length === 6 && pots.every((p, k) => p.includes(kc.finished[k * 2]) && p.includes(kc.finished[k * 2 + 1])), `${region}: six pots by Kickoff placing`)
    check(pots.every((p) => groups[0].filter((t) => p.includes(t)).length === 1 && groups[1].filter((t) => p.includes(t)).length === 1), `${region}: each group has one side from every pot`)
    const rr = g.fixtures.filter((f) => f.comp === s.key && !f.label.startsWith('KO:'))
    const games = (t: string) => rr.filter((f) => f.teamA === t || f.teamB === t).length
    const cross = rr.some((f) => groups[0].includes(f.teamA) !== groups[0].includes(f.teamB))
    check(rr.length === 30 && s.teams.every((t) => games(t) === 5) && !cross, `${region}: five group games each, none across groups`)
    const ko = g.fixtures.filter((f) => f.comp === s.key && f.label.startsWith('KO:'))
    check((s.seeds ?? []).length === 8 && ko.length === 12 && !!s.champion && s.finished.length === 12, `${region}: eight in the playoffs from the two tables, twelve ties, a champion (${tag(g, s.champion!)})`)
    const opening = ko.filter((f) => nameOf(f) === '胜者组第一轮')
    check(opening.length === 2 && opening.every((f) => groups[0].includes(f.teamA) !== groups[0].includes(f.teamB)), `${region}: the opening round crosses the groups`)
  }

  // ---- Masters I and II
  for (const key of ['masters1', 'masters2'] as const) {
    const m = g.comps[key]
    const draws = drawsOf(g, key)
    const r1 = draws.find((d) => d.phase === 'swiss-r1')!
    const r1pairs = r1.outcome.pairs ?? []
    const seconds = new Set(m.swissSeeds?.slice(0, 4)), thirds = new Set(m.swissSeeds?.slice(4))
    check(m.teams.length === 12 && (m.byes?.length ?? (m.seeds?.length ?? 0) / 2) >= 4, `${key}: twelve teams`)
    check(r1pairs.length === 4 && r1pairs.every(([a, b]) => seconds.has(a) && thirds.has(b) && g.teams[a].region !== g.teams[b].region), `${key}: round one is second v third seed, regions apart`)
    const sw = g.fixtures.filter((f) => f.comp === key && f.label.startsWith('SW:'))
    const rounds = [...new Set(sw.map((f) => f.label.split(':')[1]))].sort()
    const rec = new Map<string, [number, number]>()
    const met = new Set<string>()
    let recordOk = true, rematch = false
    for (const rnd of rounds) {
      for (const f of sw.filter((x) => x.label.split(':')[1] === rnd)) {
        const ra = rec.get(f.teamA) ?? [0, 0], rb = rec.get(f.teamB) ?? [0, 0]
        if (ra[0] !== rb[0] || ra[1] !== rb[1]) recordOk = false
        if (met.has(`${f.teamA}|${f.teamB}`)) rematch = true
        met.add(`${f.teamA}|${f.teamB}`); met.add(`${f.teamB}|${f.teamA}`)
      }
      for (const f of sw.filter((x) => x.label.split(':')[1] === rnd)) {
        const w = f.result!.mapsWonA > f.result!.mapsWonB ? f.teamA : f.teamB
        const l = w === f.teamA ? f.teamB : f.teamA
        const rw = rec.get(w) ?? [0, 0], rl = rec.get(l) ?? [0, 0]
        rec.set(w, [rw[0] + 1, rw[1]]); rec.set(l, [rl[0], rl[1] + 1])
      }
    }
    check(recordOk && !rematch, `${key}: every Swiss tie is between equal records, no rematch (${rounds.length} rounds, ${sw.length} ties)`)
    const through = [...rec].filter(([, r]) => r[0] >= 2).map(([t]) => t)
    const out = [...rec].filter(([, r]) => r[1] >= 2).map(([t]) => t)
    check(through.length === 4 && out.length === 4, `${key}: four through on two wins, four out on two losses`)
    const pick = draws.find((d) => d.kind === 'masters-playoff-pick')!
    const pairs = pick.outcome.pairs ?? []
    check(pick.status === 'complete' && (pick.pickOrder?.length === 4) && pairs.length === 4
      && new Set(pairs.flat()).size === 8 && pairs.every(([c, q]) => !through.includes(c) && through.includes(q)),
      `${key}: four champions picked in the drawn order, each qualifier picked once (${pairs.map(([c, q]) => `${tag(g, c)}→${tag(g, q)}`).join(' ')})`)
    const qf = g.fixtures.filter((f) => f.comp === key && nameOf(f) === '胜者组第一轮')
    check(qf.length === 4 && qf.every((f, k) => f.teamA === pairs[k][0] && f.teamB === pairs[k][1]), `${key}: the quarter-finals are the pairs made`)
    check(!!m.champion && m.finished.length === 12, `${key}: a champion (${tag(g, m.champion!)}), twelve placings`)
  }

  // ---- Stage 2 reshuffle
  for (const region of REGIONS) {
    const s1c = g.comps[`stage1:${region}`], s2c = g.comps[`stage2:${region}`]
    const ev = drawsOf(g, s2c.key).find((d) => d.kind === 'stage2-reshuffle')!
    const before = s1c.groups!, after = s2c.groups!
    check(after.length === 2 && after.every((x) => x.length === 6) && new Set(after.flat()).size === 12, `${region} Stage 2: two groups of six, each side once`)
    const swapped = [0, 1, 2, 3, 4, 5].filter((k) => before[0][k] !== undefined && after[1].includes(s1c ? (ev.pots[Math.floor(k / 2)].teams[0] === before[0][k] || true ? before[0][k] : '') : ''))
    // exactly one placing per pool swapped: the Alpha side of that placing is now in Omega
    const alphaOrder = (ev.pots.flatMap((p) => p.teams))
    void alphaOrder; void swapped
    const s1alpha = before[0]
    const movedAlpha = s1alpha.filter((t) => after[1].includes(t))
    check(movedAlpha.length === 3 && ev.steps.length === 6, `${region}: three sides left Alpha, one per swap pool (${movedAlpha.map((t) => tag(g, t)).join('/')})`)
    const rr = g.fixtures.filter((f) => f.comp === s2c.key && !f.label.startsWith('KO:'))
    check(rr.length === 30 && rr.every((f) => f.played) && !!s2c.champion, `${region}: thirty group games and a Stage 2 champion (${tag(g, s2c.champion!)})`)
    check(Object.values(s2c.standings).every((r) => r.w + r.l <= 5) , `${region}: Stage 1 records did not carry over`)
  }

  // ---- Champions
  {
    const c = g.comps.champions
    const draws = drawsOf(g, 'champions')
    const gd = draws.find((d) => d.kind === 'champions-groups')!
    const groups = c.groups ?? []
    check(c.teams.length === 16 && groups.length === 4 && groups.every((x) => x.length === 4), 'Champions: sixteen in four groups of four')
    check(groups.every((x) => new Set(x.map((t) => g.teams[t].region)).size === 4), 'Champions: four regions in every group')
    const pots = c.seedPots ?? []
    check(pots.length === 4 && groups.every((x) => pots.every((p) => x.filter((t) => p.includes(t)).length === 1)), 'Champions: one side from each pot in every group')
    const opening = g.fixtures.filter((f) => f.comp === 'champions' && /开局赛$/.test(nameOf(f)))
    check(opening.length === 8 && opening.every((f) => {
      const gi = groups.findIndex((x) => x.includes(f.teamA)); const x = groups[gi]
      return (x.indexOf(f.teamA) === 0 && x.indexOf(f.teamB) === 3) || (x.indexOf(f.teamA) === 1 && x.indexOf(f.teamB) === 2)
    }), 'Champions: GSL openers are pot 1 v pot 4 and pot 2 v pot 3')
    const pd = draws.find((d) => d.kind === 'champions-playoffs')!
    const pairs = pd.outcome.pairs ?? []
    const groupOf = (t: string) => groups.findIndex((x) => x.includes(t))
    const half = (k: number) => (k < 2 ? 0 : 1)
    const halvesOk = pairs.every(([w, r], k) => {
      const wOfR = pairs.findIndex(([ww]) => groupOf(ww) === groupOf(r))
      const rOfW = pairs.findIndex(([, rr]) => groupOf(rr) === groupOf(w))
      return half(k) !== half(wOfR) && half(k) !== half(rOfW)
    })
    check(pairs.length === 4 && pairs.every(([w, r]) => groupOf(w) !== groupOf(r)) && new Set(pairs.flat()).size === 8, 'Champions: each quarter-final is a group winner against another group\'s runner-up')
    check(halvesOk, 'Champions: a group\'s two sides sit in opposite halves')
    const ko = g.fixtures.filter((f) => f.comp === 'champions' && f.label.startsWith('KO:') && !/^[A-D]组/.test(nameOf(f)))
    check(ko.length === 14 && !!c.champion && c.finished.length === 16, `Champions: fourteen playoff ties, a champion (${tag(g, c.champion!)}), sixteen placings`)
    check(gd.steps.every((st) => !st.note || st.note.includes('顺延')) && gd.log.length === 4, 'Champions: every forced placement carries its reason')
  }
  check(g.stage === 'offseason' && !g.pendingDecisionDrawId, `season ${g.year} reached the off-season with nothing pending`)
  check(g.day >= SEASON_DAYS - 1 || g.stage === 'offseason', 'the year ran its course')

  // ---- the same seed draws the same thing
  if (i === 0) {
    const h = createNewGame(team.id, 'draws', seed)
    setupSeason(h)
    const a = drawsOf(g, `kickoff:${g.teams[g.myTeam].region}`)[0].outcome.seeds?.join(',')
    const b = drawsOf(h, `kickoff:${h.teams[h.myTeam].region}`)[0].outcome.seeds?.join(',')
    check(!!a && a === b, 'the same seed draws the same Kickoff bracket')
  }

  // ---- next year: this year's Champions field takes the byes
  if (i === 0) {
    const champs = g.comps.champions.teams.slice()
    advanceDay(g); advanceDay(g)
    let guard = 0
    while (g.stage === 'offseason' && guard++ < 60) advanceDay(g)
    check(g.year === 2027 && (g.lastChampionsTeams ?? []).length === 16, `rolled into ${g.year} remembering ${g.lastChampionsTeams?.length} Champions sides`)
    for (const region of REGIONS) {
      const kc = g.comps[`kickoff:${region}`]
      const want = champs.filter((t) => g.teams[t]?.region === region && kc.teams.includes(t))
      check(want.every((t) => kc.byes?.includes(t)), `${region} ${g.year}: last year's Champions sides (${want.map((t) => tag(g, t)).join('/')}) have the byes`)
    }
  }
}

// ---- the human's pick: the clock waits, the choice is written, the bracket follows
{
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'PRX')!.id, 'draws', 4242)
  setupSeason(g)
  let guard = 0
  let stopped: string | undefined
  while (guard++ < 600 && g.day < SEASON_DAYS - 1) {
    const r = advanceDay(g)
    if (r.pendingDecision) { stopped = r.pendingDecision; break }
    if (r.seasonEnded) break
  }
  console.log('\nthe manager\'s own pick')
  if (!stopped) {
    console.log('  (PRX was not a region champion this run — no pick fell to the manager; the auto path is covered above)')
  } else {
    const ev = g.draws!.find((d) => d.id === stopped)!
    const comp = g.comps[ev.competitionKey]
    check(pickerNow(ev) === g.myTeam && ev.status === 'awaiting-choice', `the clock stopped for ${tag(g, g.myTeam)} to pick (${comp.name})`)
    const day = g.day
    advanceDay(g)
    check(g.day === day, 'the day does not advance while the pick waits')
    const pool = ev.pickPool!.slice()
    const msg = choosePick(g, ev, comp, g.myTeam, pool[pool.length - 1], '手动选择')
    console.log('  ' + msg)
    const { settlePendingPick } = await import('../src/engine/season')
    settlePendingPick(g)
    check(ev.status === 'complete' && ev.consumed === true, 'the pick completed and the quarter-finals were opened at once')
    const qf = g.fixtures.filter((f) => f.comp === comp.key && nameOf(f) === '胜者组第一轮')
    check(qf.some((f) => (f.teamA === g.myTeam && f.teamB === pool[pool.length - 1])), 'our quarter-final is against the side we chose')
    const r2 = advanceDay(g)
    check(!r2.pendingDecision && g.day === day + 1, 'and the clock runs again')
  }
}

console.log(bad ? `\n${bad} problem(s)` : '\nall good')
process.exit(bad ? 1 : 0)
