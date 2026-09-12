/** Isolated champion-strength and three-price collection experiment.
 * node scripts/analyze_seoul_launch.mjs [accounts=2000] [seeds=48]
 * Bundles actual card/gacha/match engines into a temporary directory; source
 * changes exist only in these bundles, never in production files or accounts.
 */
import { build } from 'esbuild'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const accounts = Number(process.argv[2] ?? 2000)
const seeds = Number(process.argv[3] ?? 48)
assert(Number.isInteger(accounts) && accounts > 0)
assert(Number.isInteger(seeds) && seeds >= 16 && seeds % 2 === 0)
const prices = [3000, 3100, 3200]
const variants = [
  { name: 'current', boost: 0, silver: 76 },
  { name: 'silver72', boost: 0, silver: 72, skipBattle: true },
  { name: 'edg2', boost: 2, silver: 72 },
  { name: 'edg4', boost: 4, silver: 72 },
  { name: 'edg6', boost: 6, silver: 72 },
]
const sourceFiles = ['src/engine/seoul2024.ts', 'src/data/seoul2024.json', 'src/engine/cards.ts', 'src/engine/gacha.ts', 'src/engine/arena.ts', 'src/engine/match.ts']
const hashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
const sourceHashes = await hashes()
const prior = JSON.parse(await readFile('analysis/seoul_balance.json', 'utf8'))
const source = await readFile('src/engine/seoul2024.ts', 'utf8')
for (const file of sourceFiles.filter(f => f !== 'src/engine/seoul2024.ts')) assert.equal(sourceHashes[file], prior.meta.sourceHashes[file], `Rebuild opponent panel if ${file} changes`)
if (sourceHashes['src/engine/seoul2024.ts'] !== prior.meta.sourceHashes['src/engine/seoul2024.ts']) {
  // A concurrent working-tree update added d4v41 as the historical PRX caller.
  // Accept ONLY that reviewed change; rebuild the actual event comparisons.
  const previous = source.replace('// PRX called by committee in 2024; d4v41 is the one most sources name, and a\n// five with no caller at all plays under a stand-in on 指挥 55\n', '').replace("'nephh', 'd4v41'", "'nephh'")
  assert.equal(createHash('sha256').update(previous).digest('hex'), prior.meta.sourceHashes['src/engine/seoul2024.ts'], 'Unreviewed event source change')
}
const reuse = process.env.REUSE_COLLECTION === '1' ? JSON.parse(await readFile('analysis/seoul_launch.json', 'utf8')) : null
if (reuse) {
  assert.deepEqual(reuse.meta.sourceHashes, sourceHashes)
  assert.equal(reuse.meta.accounts, accounts)
  assert.equal(reuse.meta.seeds, seeds)
  assert.deepEqual(reuse.meta.variants, variants)
}
const ratingNeedle = 'const rating = bounded(70 + (p.rating - .75) * 45)'
const attrsNeedle = '    return {\n      kind:'
assert(source.includes(ratingNeedle) && source.includes(attrsNeedle))
const temp = await mkdtemp(join(tmpdir(), 'seoul-launch-'))
const quantile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]
const stats = xs => ({ p10: quantile(xs, .1), median: quantile(xs, .5), p90: quantile(xs, .9), mean: xs.reduce((a, b) => a + b, 0) / xs.length })
const output = { meta: { accounts, seeds, prices, sourceHashes, variants, collection: 'Identical account IDs and seed paths across variants; zero event collection; retain first copy of every player; sell duplicates only; no upgrades, trading, gifts, or income assumptions. Prices change spend, not card RNG. Team means all five Seoul player cards, no coach.', battle: 'Full BO3 engine, fixed twelve ordinary-club opponents from previous audit and all fifteen other event teams; same seeds at levels 0/5; alternating A/B. Event-only comparisons have no coach on either side. Ordinary-field comparisons use own-club ordinary coaches as in previous audit. Boost adds to EDG card total rating and all attributes, capped at 96, and recomputes rarity.' }, variants: [], eventRoundRobin: [] }
if (reuse) output.eventRoundRobin = reuse.eventRoundRobin

function best(E, pool, coach, name) {
  let result = null, score = -Infinity
  function visit(picks, val) {
    if (picks.length === 5) {
      const total = val - (picks.some(c => c.isIgl) ? 0 : 15)
      if (total > score) { score = total; result = { name, slots: picks.map(c => c.id), coach } }
      return
    }
    const role = E.SQUAD_SLOTS[picks.length]
    for (const c of pool) if (!picks.some(p => p.playerId === c.playerId)) {
      visit([...picks, c], val + c.rating - (role === '自由人' || c.roles.includes(role) ? 0 : 6))
    }
  }
  visit([], 0)
  assert(result)
  return result
}
function playable(E, pool) {
  if (pool.length < 5 || !pool.some(c => c.isIgl)) return false
  function visit(picks) {
    if (picks.length === 5) return picks.some(c => c.isIgl)
    const role = E.SQUAD_SLOTS[picks.length]
    return pool.some(c => !picks.includes(c) && (role === '自由人' || c.roles.includes(role)) && visit([...picks, c]))
  }
  return visit([])
}
try {
  const baselineAttrs = new Map()
  for (const variant of variants) {
    const patched = source.replace(ratingNeedle, `${ratingNeedle} + (p.team === 'EDG' ? ${variant.boost} : 0)`)
      // IGL is derived from rating; remove the rating boost here before adding
      // the explicit attribute boost below, so calling is increased only once.
      .replace('igl: isIgl ? bounded(rating + 5)', `igl: isIgl ? bounded(rating - (p.team === 'EDG' ? ${variant.boost} : 0) + 5)`)
      .replace(attrsNeedle, `    if (p.team === 'EDG') for (const k of Object.keys(attrs) as (keyof Attrs)[]) attrs[k] = bounded(attrs[k] + ${variant.boost})\n${attrsNeedle}`)
      .replace("rating >= 76 ? 'silver'", `rating >= ${variant.silver} ? 'silver'`)
    // No EDG rating is anywhere near the 96 cap in the tested candidates.
    const file = join(temp, `${variant.name}.mjs`)
    await build({ stdin: { contents: "export * from './src/engine/cards'; export * from './src/engine/gacha'; export * from './src/engine/arena'; export * from './src/engine/seoul2024';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: file, logLevel: 'silent', plugins: [{ name: 'event-candidate', setup(b) { b.onLoad({ filter: /[/\\]engine[/\\]seoul2024\.ts$/ }, () => ({ contents: patched, loader: 'ts' })) } }] })
    const E = await import(pathToFileURL(file).href)
    const event = E.SEOUL_CARDS
    assert.equal(event.length, 80)
    assert(event.every(c => c.rating <= 96))
    assert(event.filter(c => c.clubTag === 'EDG').every(c => c.rating === prior.cards.find(p => p.id === c.id).rating + variant.boost))
    for (const card of event) {
      if (variant.name === 'current') baselineAttrs.set(card.id, { ...card.attrs })
      for (const [key, value] of Object.entries(card.attrs)) assert.equal(value, Math.min(96, baselineAttrs.get(card.id)[key] + (card.clubTag === 'EDG' ? variant.boost : 0)), `${variant.name}: ${card.ign}.${key} must receive exactly one boost`)
    }
    const byId = new Map(event.map(c => [c.id, c]))
    const teamCards = E.SEOUL_TEAMS.map(t => event.filter(c => c.clubTag === t.tag))
    const tags = E.SEOUL_TEAMS.map(t => t.tag)
    const result = { variant, cards: event.map(c => ({ id: c.id, ign: c.ign, team: c.clubTag, rating: c.rating, rarity: c.rarity, attrs: c.attrs })), battles: [], milestones: {}, teamCollection: {}, completionByPacks: {}, runs: [] }
    output.variants.push(result)
    const reused = reuse?.variants.find(v => v.variant.name === variant.name)
    if (reused) {
      assert.deepEqual(result.cards.map(({ attrs, ...card }) => card), reused.cards.map(({ attrs, ...card }) => card), 'Only combat attributes may differ when collection paths are reused')
      for (const key of ['milestones', 'teamCollection', 'completionByPacks', 'runs']) result[key] = reused[key]
    }
    if (!reused) {
    E.PACKS.seoul2024.cost = 3100
    // Confirm pricing is orthogonal to RNG on actual openPack calls.
    const pathSamples = prices.map(price => {
      E.PACKS.seoul2024.cost = price
      const g = E.newGacha('S24-PRICE-EQUIVALENCE', 'audit', '2026-09-11'); g.coins = 1e8
      return Array.from({ length: 32 }, () => {
        const before = g.coins
        const pulls = E.openPack(g, 'seoul2024', 'coins', '2026-09-11')
        assert.equal(before - g.coins, price)
        return pulls.map(p => p.card.id)
      })
    })
    assert.deepEqual(pathSamples[0], pathSamples[1]); assert.deepEqual(pathSamples[1], pathSamples[2])
    E.PACKS.seoul2024.cost = 3100
    for (let i = 0; i < accounts; i++) {
      const g = E.newGacha(`S24-LAUNCH-${i}`, 'audit', '2026-09-11'); g.coins = 1e9
      const owned = new Set(), counts = new Map(tags.map(t => [t, 0]))
      const marks = {}, teams = {}
      let refund = 0, packs = 0
      const mark = () => ({ packs, refund })
      while (owned.size < 80 && packs < 10000) {
        const before = g.coins
        const pulls = E.openPack(g, 'seoul2024', 'coins', '2026-09-11'); packs++
        assert.equal(before - g.coins, 3100)
        assert(pulls.some(p => p.card.rarity !== 'bronze'))
        for (const { card, dupe } of pulls) {
          if (dupe) refund += E.salvage(g, card.id, 1)
          else {
            assert(!owned.has(card.id)); owned.add(card.id)
            counts.set(card.clubTag, counts.get(card.clubTag) + 1)
          }
        }
        assert.equal(1e9 - g.coins, packs * 3100 - refund)
        for (const [tag, count] of counts) {
          if (count === 5 && !teams[tag]) { teams[tag] = mark(); marks.anyTeam ??= mark() }
          if (tag === 'EDG' && count >= 3) marks.edg3 ??= mark()
          if (tag === 'EDG' && count >= 4) marks.edg4 ??= mark()
        }
        if (!marks.playable && playable(E, [...owned].map(id => byId.get(id)))) marks.playable = mark()
      }
      assert.equal(owned.size, 80); assert.equal(Object.keys(teams).length, 16)
      marks.edg5 = teams.EDG; marks.all80 = mark()
      result.runs.push({ marks, teams })
    }
    const summarize = marks => ({ packs: stats(marks.map(x => x.packs)), prices: Object.fromEntries(prices.map(price => [price, { gross: stats(marks.map(x => x.packs * price)), net: stats(marks.map(x => x.packs * price - x.refund)) }])) })
    for (const key of ['playable', 'anyTeam', 'edg3', 'edg4', 'edg5', 'all80']) result.milestones[key] = summarize(result.runs.map(r => r.marks[key]))
    for (const tag of tags) result.teamCollection[tag] = summarize(result.runs.map(r => r.teams[tag]))
    for (const n of [10, 20, 30, 50, 80, 100, 150, 200]) result.completionByPacks[n] = Object.fromEntries(['playable', 'anyTeam', 'edg3', 'edg4', 'edg5', 'all80'].map(key => [key, result.runs.filter(r => r.marks[key].packs <= n).length / accounts]))
    }
    console.log(JSON.stringify({ variant: variant.name, collection: Object.fromEntries(Object.entries(result.milestones).map(([key, r]) => [key, { packs: r.packs, net3100: r.prices[3100].net }])), EDG: result.cards.filter(c => c.team === 'EDG').map(c => [c.ign, c.rating, c.rarity]) }))
    await writeFile('analysis/seoul_launch.json', JSON.stringify(output, null, 2) + '\n')
    if (variant.skipBattle) continue
    if (reused && variant.boost === 0) {
      assert.deepEqual(result.cards, reused.cards)
      for (const key of ['battles', 'standings', 'hybrid']) result[key] = reused[key]
      console.log('Reused unchanged baseline battles and collection paths.')
      continue
    }

    const edg = prior.hands.find(h => h.name === 'S24-EDG')
    const legend = prior.hands.find(h => h.name === 'legend-EDG')
    const eventHands = prior.hands.filter(h => h.group === 'event').map(h => ({ ...h, coach: null }))
    const hybrid = best(E, [...E.BASE_PLAYER_CARDS, ...event].filter(c => c.clubTag === 'EDG'), edg.coach, 'hybrid-EDG')
    result.hybrid = hybrid
    const rival = (h, level) => ({ ...h, tag: h.name, levels: Object.fromEntries(h.slots.map(id => [id, level])), div: 4, points: 2000 })
    function measure(a, b, level, n, seedBase) {
      let wins = 0
      for (let k = 0; k < n; k++) {
        const seed = seedBase + k * 7919, away = k % 2 === 1
        const r = away ? E.playRivalMatch(b, () => level, rival(a, level), 3, seed) : E.playRivalMatch(a, () => level, rival(b, level), 3, seed)
        wins += Number(away ? !r.win : r.win)
      }
      return { wins, n }
    }
    for (const level of [0, 5]) {
      for (const [j, opp] of prior.baseClubs.entries()) {
        result.battles.push({ group: 'ordinary', opponent: opp.name, level, ...measure(edg, opp, level, seeds, 911201 + j * 100003) })
        result.battles.push({ group: 'hybrid', opponent: opp.name, level, ...measure(hybrid, opp, level, seeds, 911201 + j * 100003) })
      }
      for (const [j, opp] of eventHands.filter(h => h.name !== edg.name).entries()) result.battles.push({ group: 'event', opponent: opp.name, level, ...measure({ ...edg, coach: null }, opp, level, seeds, 911401 + j * 100003) })
      result.battles.push({ group: 'legend-direct', opponent: legend.name, level, ...measure(edg, legend, level, seeds * 4, 911601) })
      result.battles.push({ group: 'mirror', opponent: edg.name, level, ...measure(edg, edg, level, seeds * 4, 911801) })
      console.log(JSON.stringify({ variant: variant.name, level, groups: Object.fromEntries(['ordinary', 'hybrid', 'event', 'legend-direct', 'mirror'].map(group => { const rs = result.battles.filter(r => r.group === group && r.level === level); return [group, { wins: rs.reduce((n, r) => n + r.wins, 0), n: rs.reduce((n, r) => n + r.n, 0) }] })) }))
      await writeFile('analysis/seoul_launch.json', JSON.stringify(output, null, 2) + '\n')
    }
    // Historical field ranking in a uniform no-coach, level-zero environment.
    // Only baseline non-EDG pairs are needed; each candidate replaces its EDG row.
    if (variant.name === 'current') {
      const others = eventHands.filter(h => h.name !== edg.name)
      for (let i = 0; i < others.length; i++) for (let j = i + 1; j < others.length; j++) output.eventRoundRobin.push({ a: others[i].name, b: others[j].name, ...measure(others[i], others[j], 0, seeds, 920001 + i * 100003 + j * 997) })
      console.log(`Baseline event round robin complete: ${output.eventRoundRobin.length * seeds} BO3`)
    }
    const standings = Object.fromEntries(eventHands.map(h => [h.name, { wins: 0, n: 0 }]))
    for (const r of output.eventRoundRobin) { standings[r.a].wins += r.wins; standings[r.a].n += r.n; standings[r.b].wins += r.n - r.wins; standings[r.b].n += r.n }
    for (const r of result.battles.filter(r => r.group === 'event' && r.level === 0)) { standings[edg.name].wins += r.wins; standings[edg.name].n += r.n; standings[r.opponent].wins += r.n - r.wins; standings[r.opponent].n += r.n }
    result.standings = Object.entries(standings).map(([name, r]) => ({ name, ...r, winRate: r.wins / r.n })).sort((a, b) => b.winRate - a.winRate)
    await writeFile('analysis/seoul_launch.json', JSON.stringify(output, null, 2) + '\n')
  }
  output.meta.matches = output.eventRoundRobin.reduce((n, r) => n + r.n, 0) + output.variants.flatMap(v => v.battles).reduce((n, r) => n + r.n, 0)
  assert.deepEqual(await hashes(), sourceHashes, 'Production sources changed during experiment')
  await writeFile('analysis/seoul_launch.json', JSON.stringify(output, null, 2) + '\n')
  console.log(`Complete: ${output.meta.matches} BO3, ${accounts * variants.length} collection trajectories; production source hashes unchanged.`)
} finally { await rm(temp, { recursive: true, force: true }) }
