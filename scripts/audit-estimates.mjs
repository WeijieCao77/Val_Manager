/**
 * Refresh estimatedSeconds in audit-checks.json from CI shard reports, so the
 * shard planner balances on what the runners actually take.
 *
 *   gh run download <run-id> -D <dir> -p 'audit-timings-*'   (one dir per run)
 *   node scripts/audit-estimates.mjs <dir> [<dir>...]
 *
 * Several runs are better than one: GitHub runners vary up to 2x, and the
 * median of each check's times is what gets written.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { checks, label } from './run-audit.mjs'

const reports = dir => statSync(dir).isDirectory()
  ? readdirSync(dir).flatMap(name => reports(join(dir, name)))
  : dir.endsWith('.json') ? [dir] : []

const dirs = process.argv.slice(2)
if (!dirs.length) throw new Error('Pass one or more directories of downloaded audit-timings artifacts')
const times = new Map()
for (const file of dirs.flatMap(reports)) {
  for (const result of JSON.parse(readFileSync(file, 'utf8')).results ?? []) {
    if (result.code !== 0) continue
    if (!times.has(result.name)) times.set(result.name, [])
    times.get(result.name).push(result.seconds)
  }
}
const median = list => [...list].sort((a, b) => a - b)[list.length >> 1]
let updated = 0
const next = checks.map(check => {
  const seen = times.get(label(check))
  if (!seen) return check
  updated++
  return { ...check, estimatedSeconds: Math.max(1, Math.ceil(median(seen))) }
})
writeFileSync(new URL('./audit-checks.json', import.meta.url), JSON.stringify(next, null, 2) + '\n')
console.log(`${updated}/${checks.length} estimates refreshed from ${times.size} measured checks`)
