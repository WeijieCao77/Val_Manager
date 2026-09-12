/** Collection-only experiment for an OPTIONAL one-time chosen-team completion
 * track. Pure opening uses the real gacha engine. Proposed rewards are simulated
 * separately, one missing chosen-team card every N paid packs, up to completion.
 * node scripts/analyze_seoul_targeting.mjs [accounts=2000]
 */
import { build } from 'esbuild'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const accounts = Number(process.argv[2] ?? 2000)
assert(Number.isInteger(accounts) && accounts > 0)
const source = await readFile('src/engine/seoul2024.ts', 'utf8')
const sourceHash = createHash('sha256').update(source).digest('hex')
const temp = await mkdtemp(join(tmpdir(), 'seoul-target-'))
const prices = [3000, 3100, 3200]
const variants = [{ name: 'current', boost: 0, silver: 76 }, { name: 'edg4', boost: 4, silver: 72 }, { name: 'edg6', boost: 6, silver: 72 }]
const quantile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]
const stats = xs => ({ p10: quantile(xs, .1), median: quantile(xs, .5), p90: quantile(xs, .9), max: Math.max(...xs), mean: xs.reduce((a, b) => a + b, 0) / xs.length })
const output = { meta: { accounts, prices, sourceHash, method: 'For EDG only: one-time locked target team, a chosen missing card every 20/30 paid event packs, no pity advancement for chosen rewards. Choose missing gold before silver; deterministic tie by ID. Retain one of every card, recycle all duplicates with real salvage. Stop on five EDG cards, no repeat rewards, upgrades, trading, gifts or daily income.' }, rows: [] }
try {
  for (const variant of variants) {
    const patched = source.replace('const rating = bounded(70 + (p.rating - .75) * 45)', `const rating = bounded(70 + (p.rating - .75) * 45) + (p.team === 'EDG' ? ${variant.boost} : 0)`)
      .replace("rating >= 76 ? 'silver'", `rating >= ${variant.silver} ? 'silver'`)
    const file = join(temp, `${variant.name}.mjs`)
    await build({ stdin: { contents: "export * from './src/engine/cards'; export * from './src/engine/gacha';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: file, logLevel: 'silent', plugins: [{ name: 'target-candidate', setup(b) { b.onLoad({ filter: /[/\\]engine[/\\]seoul2024\.ts$/ }, () => ({ contents: patched, loader: 'ts' })) } }] })
    const E = await import(pathToFileURL(file).href)
    E.PACKS.seoul2024.cost = 3100
    const target = E.SEOUL_CARDS.filter(c => c.clubTag === 'EDG').sort((a, b) => E.rarityRank(b.rarity) - E.rarityRank(a.rarity) || a.id.localeCompare(b.id))
    assert.equal(target.length, 5)
    for (const interval of [0, 20, 30]) {
      const runs = []
      for (let i = 0; i < accounts; i++) {
        const g = E.newGacha(`S24-LAUNCH-${i}`, 'audit', '2026-09-11'); g.coins = 1e9
        let packs = 0, refund = 0, gifts = 0
        while (!target.every(c => g.cards[c.id]) && packs < 10000) {
          for (const p of E.openPack(g, 'seoul2024', 'coins', '2026-09-11')) if (p.dupe) refund += E.salvage(g, p.card.id, 1)
          packs++
          if (interval && packs % interval === 0) {
            const missing = target.find(c => !g.cards[c.id])
            if (missing) {
              // Proposed direct grant, not an implemented production action.
              g.cards[missing.id] = { id: missing.id, level: 0, dupes: 0, seen: 1, got: '2026-09-11' }
              gifts++
            }
          }
        }
        assert(target.every(c => g.cards[c.id])); assert(!interval || packs <= interval * 5)
        assert.equal(1e9 - g.coins, packs * 3100 - refund)
        runs.push({ packs, refund, gifts })
      }
      const row = { variant: variant.name, interval, packs: stats(runs.map(r => r.packs)), gifts: stats(runs.map(r => r.gifts)), prices: Object.fromEntries(prices.map(price => [price, { gross: stats(runs.map(r => r.packs * price)), net: stats(runs.map(r => r.packs * price - r.refund)) }])), completionByPacks: Object.fromEntries([30, 50, 60, 80, 100, 150].map(n => [n, runs.filter(r => r.packs <= n).length / accounts])), runs }
      output.rows.push(row)
      console.log(JSON.stringify({ variant: variant.name, interval, packs: row.packs, net3100: row.prices[3100].net, gifts: row.gifts }))
    }
  }
  assert.equal(createHash('sha256').update(await readFile('src/engine/seoul2024.ts')).digest('hex'), sourceHash)
  await writeFile('analysis/seoul_targeting.json', JSON.stringify(output, null, 2) + '\n')
} finally { await rm(temp, { recursive: true, force: true }) }
