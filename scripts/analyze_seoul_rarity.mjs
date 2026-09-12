/** What a full 首尔 2024 set costs under different gold lines and gold rates.
 * Offline: each variant is a throwaway bundle with the line or the rate swapped
 * in; the production files are never edited. Ratings do not change, so match
 * results do not either — only which tier a card sits in and how often a pack
 * rolls that tier.
 *
 *   node scripts/analyze_seoul_rarity.mjs [accounts=200]
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const accounts = Number(process.argv[2] ?? 200)
const VARIANTS = [
  { name: '现行：金卡线 84、出金 12%', line: 84, gold: 0.12 },
  { name: '改前：出金 8%', line: 84, gold: 0.08 },
  { name: '出金 10%', line: 84, gold: 0.1 },
  { name: '金卡线 85 + 出金 10%', line: 85, gold: 0.1 },
]
const RARITY = "rarity: rating >= 84 ? 'gold'"
const RATE = 'cost: 3000, draws: 3, mythic: 0, gold: .12'
assert(readFileSync('src/engine/seoul2024.ts', 'utf8').includes(RARITY), 'seoul2024.ts gold line moved; update this script')
assert(readFileSync('src/engine/gacha.ts', 'utf8').includes(RATE), 'gacha.ts Seoul pack moved; update this script')

const ENTRY = `
  import { SEOUL_CARDS, SALVAGE } from './src/engine/cards'
  import { PACKS, newGacha, openPack } from './src/engine/gacha'
  export function run(accounts) {
    const tiers = ['gold', 'silver', 'bronze'].map(r => SEOUL_CARDS.filter(c => c.rarity === r).length)
    const paths = []
    for (let i = 0; i < accounts; i++) {
      const g = newGacha('S24-RARITY-' + i, 'audit', '2026-09-11')
      g.coins = 1e9
      let packs = 0, salvage = 0
      const at = {}
      while (Object.keys(g.cards).length < 80 && packs < 20000) {
        for (const p of openPack(g, 'seoul2024', 'coins', '2026-09-11')) {
          const own = g.cards[p.card.id]
          if (own.dupes > 0) { salvage += own.dupes * SALVAGE[p.card.rarity]; own.dupes = 0 }
        }
        packs++
        for (const n of [40, 60, 72, 80]) if (at['p' + n] == null && Object.keys(g.cards).length >= n) {
          at['p' + n] = packs
          at['net' + n] = packs * PACKS.seoul2024.cost - salvage
        }
      }
      paths.push(at)
    }
    const g = newGacha('S24-RARITY-RATES', 'audit', '2026-09-11')
    g.coins = 1e9
    let golds = 0, goldPacks = 0
    for (let i = 0; i < 20000; i++) {
      const pulls = openPack(g, 'seoul2024', 'coins', '2026-09-11')
      const n = pulls.filter(p => p.card.rarity === 'gold').length
      golds += n
      goldPacks += n > 0 ? 1 : 0
    }
    return { tiers, paths, goldPerDraw: golds / 60000, goldPack: goldPacks / 20000 }
  }`

mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true })
const q = (xs, p) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]
const rows = []
for (const v of VARIANTS) {
  const dir = mkdtempSync(join(root, 'node_modules', '.cache', 'seoul-rarity-'))
  const outfile = join(dir, 'run.mjs')
  await build({
    stdin: { resolveDir: root, loader: 'ts', contents: ENTRY },
    bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile, logLevel: 'warning',
    plugins: [{
      name: 'variant',
      setup(b) {
        b.onLoad({ filter: /src[\\/]engine[\\/](seoul2024|gacha)\.ts$/ }, (args) => ({
          loader: 'ts',
          contents: readFileSync(args.path, 'utf8')
            .replace(RARITY, `rarity: rating >= ${v.line} ? 'gold'`)
            .replace(RATE, `cost: 3000, draws: 3, mythic: 0, gold: ${v.gold}`),
        }))
      },
    }],
  })
  const r = (await import(pathToFileURL(outfile).href)).run(accounts)
  rmSync(dir, { recursive: true, force: true })
  const col = (k) => r.paths.map((x) => x[k])
  const row = {
    name: v.name, tiers: r.tiers.join(' / '),
    perGoldCard: (100 * r.goldPerDraw / r.tiers[0]).toFixed(2) + '%',
    goldPerDraw: (100 * r.goldPerDraw).toFixed(1) + '%', goldPack: (100 * r.goldPack).toFixed(1) + '%',
    p40: q(col('p40'), 0.5), p72: q(col('p72'), 0.5), p80: q(col('p80'), 0.5), p80p90: q(col('p80'), 0.9),
    net80: q(col('net80'), 0.5), net72: q(col('net72'), 0.5),
  }
  rows.push(row)
  console.log(`${row.name.padEnd(16)} 金/银/铜 ${row.tiers.padEnd(12)} 每抽出金 ${row.goldPerDraw} 每张金卡 ${row.perGoldCard} 每包见金 ${row.goldPack} | 40/80 ${row.p40} 包 · 72/80 ${row.p72} 包 净 ${row.net72} · 80/80 ${row.p80} 包 (P90 ${row.p80p90}) 净 ${row.net80}`)
}
writeFileSync('analysis/seoul_rarity.json', JSON.stringify({ accounts, price: 3000, rows }, null, 2) + '\n')
console.log('Saved analysis/seoul_rarity.json')
