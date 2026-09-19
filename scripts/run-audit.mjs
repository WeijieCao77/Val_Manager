/** One manifest for local audits and isolated CI shards. Each check keeps its own process. */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
export const checks = JSON.parse(readFileSync(new URL('./audit-checks.json', import.meta.url), 'utf8'))
export const label = check => `${Object.entries(check.env ?? {}).map(([k, v]) => `${k}=${v} `).join('')}${check.file}${check.args?.length ? ` ${check.args.join(' ')}` : ''}`

export function planShards(manifest, count) {
  if (!Number.isInteger(count) || count < 1 || count > manifest.length) throw new Error('Invalid shard count')
  const shards = Array.from({ length: count }, () => ({ seconds: 0, entries: [] }))
  // Long checks first; original order within each shard. Estimates only schedule,
  // never select/skip tests. Unmeasured checks get a conservative six seconds.
  manifest.map((check, index) => ({ check, index }))
    .sort((a, b) => (b.check.estimatedSeconds ?? 6) - (a.check.estimatedSeconds ?? 6) || a.index - b.index)
    .forEach(entry => {
      const shard = shards.reduce((best, candidate) => candidate.seconds < best.seconds ? candidate : best)
      shard.entries.push(entry)
      shard.seconds += entry.check.estimatedSeconds ?? 6
    })
  return shards.map(shard => shard.entries.sort((a, b) => a.index - b.index).map(entry => entry.check))
}

export function commandFor(check) {
  if (check.runtime === 'tsx') return [process.execPath, [require.resolve('tsx/cli'), check.file, ...(check.args ?? [])]]
  if (check.runtime === 'node') return [process.execPath, [check.file, ...(check.args ?? [])]]
  if (check.runtime === 'python3') return ['python3', [check.file, ...(check.args ?? [])]]
  throw new Error(`Unknown audit runtime: ${check.runtime}`)
}

export async function runChecks(selected) {
  const results = []
  for (const check of selected) {
    const name = label(check)
    console.log(process.env.GITHUB_ACTIONS ? `::group::${name}` : `\n>>> ${name}`)
    const start = performance.now()
    const [command, args] = commandFor(check)
    const outcome = await new Promise(resolveResult => {
      const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...check.env } })
      child.once('error', error => resolveResult({ code: 1, error: error.message }))
      child.once('close', (code, signal) => resolveResult({ code: code ?? 1, ...(signal ? { signal } : {}) }))
    })
    const result = { name, ...outcome, seconds: Math.round((performance.now() - start) / 10) / 100 }
    results.push(result)
    console.log(`${result.code === 0 ? 'PASS' : 'FAIL'} ${name} (${result.seconds}s)`)
    if (process.env.GITHUB_ACTIONS) console.log('::endgroup::')
    if (result.code !== 0) break
  }
  return results
}

export async function main(args) {
  let selected = checks, shard = 'all', report
  let list = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--shard') {
      shard = args[++i]
      const match = /^(\d+)\/(\d+)$/.exec(shard ?? '')
      if (!match || +match[1] < 1 || +match[1] > +match[2]) throw new Error('Use --shard INDEX/COUNT (one-based)')
      selected = planShards(checks, +match[2])[+match[1] - 1]
    } else if (args[i] === '--report') {
      report = args[++i]
      if (!report || report.startsWith('--')) throw new Error('--report needs a file path')
    } else if (args[i] === '--list') list = true
    else throw new Error(`Unknown argument: ${args[i]}`)
  }
  if (list) { console.log(selected.map(label).join('\n')); return 0 }
  console.log(`Audit ${shard}: ${selected.length}/${checks.length} checks`)
  const results = await runChecks(selected)
  const passed = results.length === selected.length && results.every(result => result.code === 0)
  if (report) {
    mkdirSync(dirname(resolve(report)), { recursive: true })
    writeFileSync(report, JSON.stringify({ shard, selected: selected.length, passed, results }, null, 2) + '\n')
  }
  const summary = `### Audit ${shard}: ${passed ? 'passed' : 'FAILED'} (${results.length}/${selected.length})\n\n| Check | Seconds | Result |\n| --- | ---: | --- |\n` +
    [...results].sort((a, b) => b.seconds - a.seconds).map(r => `| ${r.name} | ${r.seconds} | ${r.code === 0 ? 'pass' : 'FAIL'} |`).join('\n') + '\n'
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  console.log(`Audit ${shard}: ${passed ? 'passed' : 'FAILED'}; ${results.length}/${selected.length} checks completed`)
  return passed ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }).catch(error => { console.error(error); process.exitCode = 1 })
}
