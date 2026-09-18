/** Run existing API guarantees on real PostgreSQL, in disposable test databases. */
import postgres from 'postgres'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
const url = process.env.PG_TEST_URL
if (!url) throw new Error('PG_TEST_URL required: dedicated disposable test PostgreSQL only')
const parsed = new URL(url)
if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && process.env.PG_TEST_ISOLATED !== '1')
  throw new Error('Remote database requires PG_TEST_ISOLATED=1 and a dedicated test database; never production')
const admin = postgres(url, { max: 1, onnotice: () => {} })
const jobs = process.argv.slice(2)
const checks = jobs.length ? jobs : ['check_load_race', 'check_idempotency', 'check_refund_repair', 'check_market_sweep', 'check_open_cup', 'check_open_cup_v2', 'check_release_readiness', 'pg/races', 'pg/check_rollup_delay']
let failed = 0
try {
 for (const name of checks) {
  if (!/^(?:pg\/)?check_[a-z0-9_]+$/.test(name) && name !== 'pg/races') throw new Error('Invalid check name')
  const schema = `verify_${Date.now()}_${randomBytes(4).toString('hex')}`
  const folder = await mkdtemp(resolve(tmpdir(), 'kwb-pg-'))
  await admin.unsafe(`create database "${schema}"`)
  try {
   const testUrl = new URL(url); testUrl.pathname = '/' + schema
   const original = resolve('scripts', `${name}.ts`)
   let source = await readFile(original, 'utf8')
   // Storage adapter and driver-specific fixture encoding change; original assertions remain intact.
   source = source.replace(/import \{ PGlite \} from '@electric-sql\/pglite'/, `import postgres from 'postgres';\nimport {safeTransactions} from '${resolve('db-transactions.js')}';\nclass PGlite { sql; constructor() { this.sql = safeTransactions(postgres(process.env.PG_TEST_URL, { max: 12, onnotice: () => {}, connection: { statement_timeout: 30000, lock_timeout: 15000 } })) }; exec(q) { return this.sql.unsafe(q).simple() }; close() { return this.sql.end({timeout: 5}) } }`)
     .replace(/import \{ makeSql \} from '[^']*pglite-sql.js'/, 'const makeSql = (db: PGlite): any => db.sql')
   if (name === 'check_market_sweep') source = source.replace(/\$\{JSON.stringify\((\{[^\n]*\})\)\}/g, '${real.json($1)}').replace("v.map(String)", "v.map(x => typeof x?.value === 'object' ? JSON.stringify(x.value) : String(x?.value ?? x))")
   source = source.replace(/(from\s*|import\s*\()('|")(\.\.?\/[^'"]+)\2/g, (_, prefix, quote, spec) => prefix + quote + resolve(dirname(original), spec) + quote)
   source = source.replace(/new URL\((['"])(\.\.?\/[^'"]+)\1,\s*import.meta.url\)/g, (_, quote, spec) => 'new URL(' + JSON.stringify(pathToFileURL(resolve(dirname(original),spec)).href) + ')')
   const { symlink } = await import('node:fs/promises')
   await symlink(resolve('node_modules'), resolve(folder, 'node_modules'))
   const entry = resolve(folder, 'check.mts'); await writeFile(entry, source)
   console.log(`\nREAL POSTGRES: ${name} (${schema})`)
   const code = await new Promise((done) => { const p = spawn(process.execPath, ['--import', resolve('node_modules/tsx/dist/loader.mjs'), entry], { stdio: 'inherit', env: {...process.env, PG_TEST_URL: testUrl.toString()} }); const timeout = setTimeout(() => p.kill('SIGTERM'), 600000); p.on('exit', c => { clearTimeout(timeout); done(c ?? 1) }); p.on('error', () => { clearTimeout(timeout); done(1) }) })
   if (code) failed++
   console.log(`REAL POSTGRES ${name}: EXIT=${code}`)
  } finally {
   await admin.unsafe(`drop database "${schema}" with (force)`)
   await rm(folder, { recursive: true, force: true })
  }
 }
} finally { await admin.end({ timeout: 5 }) }
process.exitCode = failed ? 1 : 0
