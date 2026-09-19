/**
 * Serves the production build, and collects how it gets played.
 *
 * The static half is deliberately dependency-free: the game is a client-side
 * bundle, so serving `dist/` and falling back to index.html is the whole job.
 *
 * The other half exists because the owner had no way to tell whether anyone
 * came back a second time. It records what people do with the game — never who
 * they are. There are no IP addresses in the database; a browser makes up a
 * random id for itself on first visit and that is the whole of identity.
 * Without a DATABASE_URL the game runs exactly as it did before and every
 * event is dropped on the floor, which is the correct behaviour for a local
 * checkout.
 *
 * The card mode adds the one account this game has, under /api/card — a random
 * string the player keeps, stored only as a hash, holding only a collection.
 * See cards-api.js for why it needs to exist at all. The career mode still has
 * no accounts and still saves in the browser.
 */
import { createReadStream, existsSync, readFile, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { brotliCompress, constants, gzip } from 'node:zlib'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { EVENTS, MAX_BODY, rateLimited, sanitize, tokenOk } from './analytics.js'
import { engine, makeCardApi, normalizeId } from './cards-api.js'
import { displayName } from './names.js'
import { makeProfileApi } from './profile-api.js'
import { makeSiteApi } from './site-api.js'
import { makeMarketApi } from './market-api.js'
import { makeOpenCupApi } from './opencup-api.js'
import { makePhoneApi } from './phone-api.js'
import { validatePhoneSecrets } from './phone-config.js'
import { releaseFingerprint } from './release-fingerprint.js'
import { releaseFeatures } from './release-readiness.js'
import { createMatchComputer } from './match-worker.js'
import { makePlayerProxy } from './player-proxy.js'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { safeTransactions } from './db-transactions.js'
import { createHistoryMaintenance } from './history-maintenance.js'
import { overview, prune, storage } from './stats.js'
import { history, pruneFolded, rollup } from './rollup.js'
import { SCHEMAS, applySchema } from './db-schema.js'
import { dashboardHtml } from './dashboard.js'
import { bucketOf, clientIp } from './client-ip.js'

// A rejected promise is logged and life goes on: the analytics side-car and
// the odd lost client are where those come from, and none of it is worth
// taking the game offline for. An uncaught synchronous throw is different —
// the process is in a state nobody reasoned about — so it is logged and the
// process exits, and the platform restarts it clean within seconds. It used
// to keep serving; a review (2026-09-03) pointed out that nothing would ever
// restart it then.
process.on('unhandledRejection', (err) => console.error('unhandled:', err?.message))
process.on('uncaughtException', (err) => {
  console.error('uncaught, exiting for a clean restart:', err?.stack || err?.message)
  setTimeout(() => process.exit(1), 300).unref?.()
})

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist')
// A public build fingerprint lets release smoke tests verify the running engine,
// even when an older frontend or a previous healthy deployment is still served.
const engineFile = new URL('./dist-server/engine.mjs', import.meta.url)
const ENGINE_SHA256 = existsSync(engineFile)
  ? createHash('sha256').update(readFileSync(engineFile)).digest('hex') : 'unavailable'
const RELEASE_SHA256 = releaseFingerprint()
const PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_PROJECT_ID
const PORT = Number(process.env.PORT) || 8080
const TOKEN = process.env.ANALYTICS_TOKEN || ''
const phoneSecrets = validatePhoneSecrets(process.env)
if (phoneSecrets.mode === 'legacy-admin') console.warn('phone: legacy admin-derived secrets retained for existing accounts; see docs/phone-key-rotation.md before rotation')

/**
 * Where the admin token is read from: a header first. A token in the URL
 * ends up in browser history, screenshots and proxy logs; a header does
 * not. The query string still works, for the one link that opens the
 * dashboard and for a curl typed by hand — the page itself then strips it
 * from the address bar and sends the header from there on.
 */
const tokenFrom = (req, url) => {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
  return (m && m[1].trim()) || req.headers['x-admin-token'] || url.searchParams.get('token')
}

/**
 * How much history the events table is allowed to keep.
 *
 * Env vars because the answer is a disk size, and a disk size is bought rather
 * than committed. At about 92 rows a visitor a day (see check_telemetry.ts),
 * four million rows is roughly 18 days at 2400 daily visitors and 54 days at
 * 800 — raise ANALYTICS_MAX_ROWS when there is room for more, without a deploy
 * that touches anything else.
 */
const num = (v, dflt) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.trunc(Number(v)) : dflt)
// About a day of play at the current volume (2.6M events on 09-01). The raw
// table only has to hold what the hourly rollup has not folded yet; history
// lives in the rollup tables. 4M was a day and a half and, at ~420 bytes a
// row with indexes, already past the byte backstop below — which is how the
// backstop tripped on 2026-09-02 and two days of play went unrecorded.
const MAX_ROWS = num(process.env.ANALYTICS_MAX_ROWS, 3_000_000)
const PRUNE_DAYS = num(process.env.ANALYTICS_KEEP_DAYS, 180)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
}

// ---------------------------------------------------------------- database

let sql = null
/**
 * Three budgets on one database, so one kind of work cannot starve another.
 *
 * It was one pool of four for everything: a slow dashboard query, an hourly
 * prune or a market settlement each took connections the players' requests
 * were waiting for (2026-09-05, 09-17). Not a bigger pool — more connections
 * do not make Postgres faster, and two containers overlap on every deploy —
 * but a split one, each part bounded and each settable:
 *
 *   sql       DB_POOL        4   what a player is waiting on: accounts, the market, the cups' pages
 *   sqlBg     DB_POOL_BG     1   the clock's work: settling auctions, playing cup rounds
 *   sqlStats  DB_POOL_STATS  2   telemetry in, dashboard out, the hourly fold and prune
 *
 * Seven a process, fourteen while a deploy overlaps. A background job can now
 * be as slow as it likes and costs an interactive request nothing but CPU.
 */
let sqlBg = null
let sqlStats = null
const keepHistory = createHistoryMaintenance({ getSql: () => sqlStats, rollup, pruneFolded, prune, days: PRUNE_DAYS })
/** set when the schema step has finished (or, with no database, at once) — see /readyz */
let schemaReady = false
let schemaError = null
const poolSize = (v, dflt) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 32 ? Number(v) : dflt)
if (process.env.DATABASE_URL?.startsWith('pglite')) {
  // A database in the process, for a local checkout: `npm run dev:server`.
  // The same shim the check scripts use, so a browser can be pointed at the
  // whole card mode — accounts, packs, the ladder, the trading post — with
  // nothing installed. Gone when the process exits, which is the point.
  const { PGlite } = await import('@electric-sql/pglite')
  const { makeSql } = await import('./pglite-sql.js')
  sql = makeSql(new PGlite())
  try {
    // every table the Postgres branch creates, so the dashboard and the
    // analytics routes answer locally too instead of 500ing on a missing
    // relation — which is exactly the kind of thing a local run is for
    for (const schema of SCHEMAS) await sql.unsafe(schema)
    sqlBg = sql
    sqlStats = sql
    schemaReady = true
    console.log('cards: in-process database (pglite), nothing persists')
  } catch (err) {
    console.warn('pglite: schema failed —', err.message)
    sql = null
  }
} else if (process.env.DATABASE_URL) {
  try {
    const { default: postgres } = await import('postgres')
    const pool = (max, statementMs) => safeTransactions(postgres(process.env.DATABASE_URL, {
      max,
      idle_timeout: 20,
      connect_timeout: 10,
      // Railway terminates TLS inside its private network; the certificate is
      // for the internal host, so verification is not meaningful here
      ssl: /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(process.env.DATABASE_URL).hostname)
        || process.env.DATABASE_URL.includes('railway.internal') ? false : 'require',
      onnotice: () => {},
      // nothing may hold a connection for ever: a statement is cut off, and a
      // transaction left open by a crashed request is closed by the server
      connection: { statement_timeout: statementMs, idle_in_transaction_session_timeout: 30_000 },
    }))
    const sizes = { main: poolSize(process.env.DB_POOL, 4), bg: poolSize(process.env.DB_POOL_BG, 1), stats: poolSize(process.env.DB_POOL_STATS, 2) }
    sql = pool(sizes.main, 15_000)
    sqlBg = pool(sizes.bg, 60_000)
    sqlStats = pool(sizes.stats, 120_000)
    console.log(`database: ${sizes.main} interactive + ${sizes.bg} background + ${sizes.stats} stats connections`)
    // The schema and the boot chores run AFTER the port is open, not before.
    // `await applySchema` here held the whole module — and so listen() at
    // the bottom — for as long as the schema step took, and on 09-10 that
    // was four lock-timeout retries, about a minute, during which the new
    // container already had the traffic and every request was a 502. The
    // tables exist in production and every statement is idempotent, so a
    // requests before completion receive 503; readiness keeps traffic away.
    applySchema(sqlBg).then((result) => {
    schemaReady = result?.ready !== false
    if (!schemaReady) { schemaError = 'required migrations incomplete'; return }
    // Settle what the market owes, before anyone trades. Until 2026-09-03 a
    // listing that died of three ignored offers kept the bids still sitting
    // on it; the sweep refunds now, and this pays back whoever it already
    // happened to. The ledger comes out even after the first run, so it is
    // idempotent and cheap enough to simply run on every boot — which is
    // also the only hand this project has on the production database.
    import('./scripts/refund_stranded_offers.js')
      .then(({ repair }) => repair(sqlBg, true))
      .then((debts) => debts.length && console.log(
        `market: refunded ${debts.length} stranded bid(s), ${debts.reduce((a, d) => a + d.coins, 0)} coins`))
      .catch((e) => console.warn('market: stranded-offer repair failed', e.message))
    // Prune on boot rather than on a daily timer. Railway redeploys often
    // enough that a 24-hour interval would rarely reach its first tick, so the
    // retention policy would have been written down and never enforced.
    /**
     * Roll up, THEN prune. Never the other way round.
     *
     * The row ceiling is what bites at this volume — 3.5 million rows is about
     * a day of history — so anything not folded into the permanent tables
     * before the deletion runs is simply gone. That is how a month of it
     * disappeared on 8/31.
     *
     * Hourly rather than daily, and not only on boot: a redeploy is frequent
     * but not dependable, and the gap between two of them is exactly where the
     * ceiling does its work.
     */
    const keep = () => { void keepHistory(MAX_ROWS).catch(e => console.warn('analytics: history maintenance failed', e.message)) }
    // three minutes after boot, not at boot: a redeploy under traffic used
    // to spend its first seconds rolling up and pruning on the same four
    // connections the players were waiting on
    setTimeout(keep, 3 * 60 * 1000).unref?.()
    setInterval(keep, 60 * 60 * 1000).unref?.()
    }).catch((err) => {
      console.warn('analytics: disabled —', err.message)
      schemaError = err.message
      sql = null; sqlBg = null; sqlStats = null
    })
  } catch (err) {
    console.warn('analytics: disabled —', err.message)
    schemaError = err.message
    sql = null; sqlBg = null; sqlStats = null
  }
} else {
  schemaReady = true
  console.log('analytics: no DATABASE_URL, running without it')
}

// ---------------------------------------------------------------- helpers

/**
 * A JSON reply, compressed when it is big enough to be worth it.
 *
 * The card mode posts and receives the WHOLE collection on every save, and a
 * filled-out account is tens of kilobytes of very repetitive JSON — it gzips
 * to about a tenth. On a phone in China that is the difference between a save
 * that lands and one that is still in flight when the app is backgrounded.
 *
 * `res.acceptEncoding` is stashed by the request handler rather than changing
 * this signature: `json` is called from 54 places and from both API modules,
 * and threading `req` through all of them to reach one header is a worse
 * trade than one annotated property.
 *
 * Quality is deliberately low. This runs per request, unlike the static
 * assets which are compressed once and cached — brotli at 4 costs about what
 * gzip does and still beats it, and anything higher would spend more time
 * compressing than it saves in flight.
 */
const JSON_MIN = 1024
/**
 * Compressed OFF the event loop. It was brotliCompressSync: a filled-out
 * account is tens of kilobytes and every act, load and market reply carries
 * one, so each reply held the one thread this whole server runs on for a few
 * milliseconds — and there are a lot of replies. zlib's callback API does the
 * same work on the libuv pool. Bounded: past JSON_ZIP_MAX replies being
 * compressed at once the next ones go out plain, which costs bytes, never
 * latency for everybody else.
 */
const JSON_ZIP_MAX = 16
let jsonZipping = 0
const json = (res, code, body) => {
  // one answer per request, whichever path gets here first (an error handler
  // racing a reply that is still being compressed must not write a second one)
  if (res.jsonSent) return
  res.jsonSent = true
  const s = JSON.stringify(body)
  const head = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }
  const plain = () => {
    if (res.headersSent || res.writableEnded) return
    res.writeHead(code, head)
    res.end(s)
  }
  const accept = String(res.acceptEncoding || '')
  const enc = Buffer.byteLength(s) < JSON_MIN || jsonZipping >= JSON_ZIP_MAX ? null
    : /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null
  if (!enc) { plain(); return }
  jsonZipping++
  const done = (err, out) => {
    jsonZipping--
    if (err || res.headersSent || res.writableEnded) { plain(); return }
    head['Content-Encoding'] = enc
    head.Vary = 'Accept-Encoding'
    res.writeHead(code, head)
    res.end(out)
  }
  try {
    if (enc === 'br') brotliCompress(s, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }, done)
    else gzip(s, { level: 6 }, done)
  } catch (err) {
    done(err)
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// Which caller a request belongs to, for the rate limiter — see client-ip.js
// for why the rightmost forwarded hop is the only one worth reading, and why
// Cloudflare's CF-Connecting-IP is read instead when that hop is Cloudflare.

// ---------------------------------------------------------------- routes

/**
 * How big the table is allowed to get.
 *
 * The rate limit budgets requests, not rows: 120 requests a minute carrying 50
 * events each is millions of rows a day, and the dedupe index is partial — it
 * only covers rows that carry a sequence number, so omitting one walks past
 * it. Long before the disk fills, three of the dashboard's queries scan the
 * whole table and it simply stops answering.
 *
 * This was 1.5GB and described as "three orders of magnitude above anything
 * this game will organically produce". It was not: 6,282 people on 09-01
 * wrote 2.6M rows, 3.5M rows weighed 1.5GB, and from 2026-09-02 the guard
 * answered every batch 204 and kept nothing — two days of play unrecorded,
 * the dashboard showing 9 visitors, and nothing on the page saying why.
 *
 * Three things changed. The budget is 3GB on a 5GB volume, and settable.
 * Going over it now prunes first — the row ceiling is the policy, this is
 * the backstop — and refuses only if the table is still over afterwards.
 * And refusing is visible: /api/stats carries it, and the dashboard says so
 * in red rather than drawing an empty bar chart.
 */
const MAX_TABLE_BYTES = num(process.env.ANALYTICS_MAX_BYTES, 3_000_000_000)
let sizeChecked = 0
let sizeBytes = 0
let refusing = false

let liveRows = 0
async function measureTable() {
  const r = await sqlStats`
    select pg_total_relation_size('events') as b,
           coalesce((select n_live_tup from pg_stat_user_tables where relname = 'events'), 0) as live`
  sizeBytes = Number(r[0]?.b ?? 0)
  liveRows = Number(r[0]?.live ?? 0)
  return sizeBytes
}

/**
 * Over the byte budget is two different conditions.
 *
 * A DELETE does not shrink the file — the space is reused, not returned — so
 * a table that was once big stays big on disk for good, and refusing on size
 * alone refuses for good (that is how writes stayed off after a prune had
 * already made room). What decides whether the file can still GROW is the
 * live rows: at or under the ceiling, new rows go into the space the deleted
 * ones left. So writes are refused only when the file is over budget AND the
 * live rows are still over the ceiling — the fold and the pruner are behind —
 * and the catching up is started here but never waited for: an ingest
 * request is not where a three-million-row delete belongs.
 */
async function overBudget() {
  const now = Date.now()
  if (now - sizeChecked < 5 * 60_000) return refusing
  sizeChecked = now
  try {
    if (await measureTable() > MAX_TABLE_BYTES) {
      const crowded = liveRows > MAX_ROWS * 1.1
      if (crowded !== refusing) {
        console.warn(`analytics: events table at ${Math.round(sizeBytes / 1e6)}MB with ~${liveRows} live rows — `
          + (crowded ? 'REFUSING WRITES until the pruner catches up' : 'over budget on disk only, space is reusable: writing'))
      }
      refusing = crowded
      if (crowded) {
        keepHistory(Math.floor(MAX_ROWS * 0.7))
          .then(() => { sizeChecked = 0 })
          .catch(() => {})
      }
    } else {
      refusing = false
    }
  } catch { /* if we cannot measure it, do not block on it */ }
  return refusing
}

async function ingest(req, res) {
  if (!sqlStats) { json(res, 204, {}); return }
  if (rateLimited(bucketOf(req), 1200)) { json(res, 429, { ok: false }); return }
  if (await overBudget()) { json(res, 204, {}); return }

  let payload
  try {
    payload = sanitize(JSON.parse(await readBody(req, MAX_BODY)))
  } catch {
    json(res, 400, { ok: false })
    return
  }
  if (!payload) { json(res, 400, { ok: false }); return }

  // A second limit, keyed on the visitor rather than the address. The address
  // limit has to stay — it is the only thing a forged payload cannot dodge —
  // but on its own it punishes exactly this audience: Chinese carriers put a
  // whole neighbourhood behind one egress address, and a live tab flushes
  // roughly twelve requests a minute, so a shared address runs out while every
  // one of those people is playing normally.
  if (rateLimited(`v:${payload.vid}`)) { json(res, 429, { ok: false }); return }

  const rows = payload.events.map((e) => ({
    n: e.n,
    client_t: e.t,
    visitor_id: payload.vid,
    session_id: payload.sid,
    seq: payload.seq,
    device: payload.dev,
    tz: payload.tz,
    name: e.name,
    props: e.props,
  }))
  try {
    await sqlStats`insert into events ${sqlStats(rows,
      'n', 'client_t', 'visitor_id', 'session_id', 'seq', 'device', 'tz', 'name', 'props')}
      on conflict do nothing`
    json(res, 204, {})
  } catch (err) {
    console.warn('analytics: insert failed', err.message)
    json(res, 500, { ok: false })
  }
}

async function stats(req, res, url) {
  if (!tokenOk(tokenFrom(req, url), TOKEN)) {
    json(res, 404, { ok: false })
    return
  }
  if (!sqlStats) { json(res, 503, { ok: false, why: 'no database' }); return }
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30))
  try {
    const [data, disk, hist] = await Promise.all([
      overview(sqlStats, days), storage(sqlStats, MAX_ROWS), history(sqlStats, 120),
    ])
    json(res, 200, {
      ...data,
      storage: { ...disk, maxBytes: MAX_TABLE_BYTES, refusing },
      history: hist,
    })
  } catch (err) {
    console.warn('analytics: query failed', err.message)
    json(res, 500, { ok: false, why: err.message })
  }
}

/**
 * What this release needs from the database, by feature. Checked against the
 * catalogs once the schema step has finished and then remembered; the ping is
 * remembered for five seconds, so a health checker costs a query every five
 * seconds however often it asks.
 */
const loopDelay = monitorEventLoopDelay({ resolution: 20 })
const playerProxy = makePlayerProxy({ clientIp })
if (playerProxy.enabled) console.log('player: /player is passed through to PLAYER_UPSTREAM')
loopDelay.enable()
let featureCache = null
let pingCache = { at: 0, ok: false, ms: null }
async function readiness() {
  const out = { ready: false, release: RELEASE_SHA256, db: 'none', schema: schemaReady ? 'ready' : schemaError ? 'failed' : 'pending', features: {} }
  if (!process.env.DATABASE_URL) { out.ready = !PRODUCTION; return out }
  if (!sql) { out.db = 'down'; out.why = schemaError ?? 'no connection'; return out }
  if (Date.now() - pingCache.at > 5000) {
    const t0 = Date.now()
    try { await sql`select 1 as ok`; pingCache = { at: Date.now(), ok: true, ms: Date.now() - t0 } }
    catch { pingCache = { at: Date.now(), ok: false, ms: null } }
  }
  out.db = pingCache.ok ? 'up' : 'down'
  out.pingMs = pingCache.ms
  if (pingCache.ok && schemaReady && !featureCache) {
    try {
      featureCache = await releaseFeatures(sql)
    } catch { /* asked again next time */ }
  }
  out.features = featureCache ?? {}
  if (_marketApi) out.market = _marketApi.settleStats()
  // A new container must not receive traffic before all of its write guards exist.
  out.ready = pingCache.ok && schemaReady && !!featureCache && Object.values(featureCache).every(Boolean)
  return out
}

// Matches are played on a worker thread and the rival scan runs on the stats
// budget: neither is something a player's connection should be held for.
const matchComputer = sql ? createMatchComputer() : null
const cardApi = () => (_cardApi ??= makeCardApi(sql, { rateLimited, readBody, json, staticRoot: ROOT, matches: matchComputer, slow: sqlStats }))
let _phoneApi
const phoneApi = () => (_phoneApi ??= makePhoneApi(sql, {
  readBody, json, rateLimited, normalizeId, hash: (id) => createHash('sha256').update(String(id)).digest('hex'),
  token: TOKEN, tokenFrom, tokenOk,
}))
let _cardApi = null
const profileApi = () => (_profileApi ??= makeProfileApi(sql, { rateLimited, readBody, json }))
let _profileApi = null
const siteApi = () => (_siteApi ??= makeSiteApi(sql, {
  readBody, json, token: TOKEN, normalizeId, displayName, engine, tokenFrom,
}))
let _siteApi = null
const marketApi = () => (_marketApi ??= makeMarketApi(sql, {
  readBody, json, normalizeId, displayName, rateLimited, engine, token: TOKEN, tokenFrom, tokenOk, bg: sqlBg,
}))
let _marketApi = null
// Scripts buying on the shelf (market-guard.js) are looked at after each 一口价 purchase; this is a look at the
// week before this process started — a log line, it suspends nobody — once the boot rush is over.
if (sql) {
  setTimeout(() => {
    if (!schemaReady) return
    marketApi().guard.scan()
      .then((found) => console.log(`guard: boot scan, ${found.filter((f) => f.verdict === 'ban').length} over the line, ${found.filter((f) => f.verdict === 'watch').length} to watch`))
      .catch((err) => console.warn('guard: boot scan failed', err.message))
  }, 90_000).unref()
}
// A local server may run the 全服杯 on a fast clock (a cup every N seconds, a
// round every M) so a whole bracket can be watched in a browser. Read only
// beside the in-process database: the deployed service cannot be sped up.
const OPEN_CUP_FAST = process.env.DATABASE_URL?.startsWith('pglite') && Number(process.env.OPEN_CUP_EVERY_SEC) >= 30
  ? { everySec: Number(process.env.OPEN_CUP_EVERY_SEC), stepSec: Math.max(5, Number(process.env.OPEN_CUP_STEP_SEC) || 15) }
  : null
const openCupApi = () => (_openCupApi ??= makeOpenCupApi(sql, {
  readBody, json, normalizeId, displayName, rateLimited, engine, fast: OPEN_CUP_FAST, bg: sqlBg, cardPoolVersion: ENGINE_SHA256, engineBundle: readFileSync(engineFile),
}))
let _openCupApi = null

/** Which formats are worth compressing — the rest are already compressed. */
const TEXTY = new Set(['.js', '.css', '.html', '.json', '.svg', '.map', '.txt', '.webmanifest'])

/**
 * The best encoding the client offered, or null to send it raw.
 *
 * Brotli beats gzip by roughly 15% on this bundle and every browser that can
 * run the game supports it; gzip is the fallback for anything else.
 */
function pickEncoding(accept, ext) {
  if (!TEXTY.has(ext)) return null
  const a = String(accept || '')
  if (/\bbr\b/.test(a)) return 'br'
  if (/\bgzip\b/.test(a)) return 'gzip'
  return null
}

/**
 * A compressed copy of a built file, without compressing on the request path.
 *
 * The build writes `<file>.br` and `<file>.gz` beside every text asset
 * (scripts/precompress.mjs, brotli 11 — slower and smaller than anything that
 * could be afforded here). Those are read once and kept. It used to be
 * brotliCompressSync at quality 10 on the first request for each file:
 * 361 ms for the world data, 306 for the records, 114 for the card bundle
 * (measured 2026-09-18), during which this process answers nobody — and a
 * deploy empties the cache, so it happened on every deploy, under traffic.
 *
 * A file with no precompressed sibling (a dev build, a file added by hand) is
 * sent as it is THIS time, and compressed on the libuv pool for the next — one
 * at a time, never on the event loop.
 */
const zipped = new Map()
const ZIP_MAX = 96
const zipping = new Set()
let zipBusy = false
function compressed(file, enc) {
  const key = enc + ':' + file
  const hit = zipped.get(key)
  if (hit !== undefined) return hit
  const keep = (v) => { if (zipped.size >= ZIP_MAX) zipped.clear(); zipped.set(key, v); return v }
  try {
    const sibling = file + (enc === 'br' ? '.br' : '.gz')
    if (existsSync(sibling) && statSync(sibling).mtimeMs >= statSync(file).mtimeMs) return keep(readFileSync(sibling))
    // below about a kilobyte the header costs more than the saving
    if (statSync(file).size < 1024) return keep(null)
  } catch {
    return null
  }
  if (!zipBusy && !zipping.has(key)) {
    zipBusy = true
    zipping.add(key)
    readFile(file, (err, raw) => {
      const finish = (e, out) => { zipBusy = false; zipping.delete(key); if (!e && out) keep(out) }
      if (err) { finish(err); return }
      if (enc === 'br') {
        brotliCompress(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }, finish)
      } else gzip(raw, { level: 6 }, finish)
    })
  }
  return null
}

createServer((req, res) => {
  // One request must never take the process down: a throw inside this
  // handler is answered with a 500 and logged, and the server goes on. The
  // process-level handler above is for the state nobody reasoned about —
  // an exception from a callback with no request to answer.
  try {
    handle(req, res)
  } catch (err) {
    console.error('request failed:', req.method, req.url, err?.stack || err?.message)
    if (!res.headersSent) {
      try { res.writeHead(500, { 'Content-Type': 'text/plain' }) } catch { /* nothing sane left to send */ }
    }
    try { res.end('Server error') } catch { /* socket already gone */ }
  }
}).on('clientError', (_err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
}).listen(PORT, () => {
  console.log(`VAL MANAGER serving ${ROOT} on :${PORT}`)
  console.log(`analytics: ${sql ? 'on' : 'off'}, ${EVENTS.size} event names accepted`)
  // The 全服杯 runs on a clock, not on requests: start its timer once the
  // port is open and the schema has had its turn, whether or not anybody
  // has opened the page. A few seconds late costs nothing — it catches up.
  // …and so does the market's settler: it used to start with the first visit to the market
  const startJobs = () => {
    if (!schemaReady || !sql) return false
    openCupApi(); marketApi(); return true
  }
  const bootJobs = setInterval(() => { if (startJobs()) clearInterval(bootJobs) }, OPEN_CUP_FAST ? 500 : 1000)
  bootJobs.unref?.()
})

function handle(req, res) {
  // A malformed escape — GET /% is enough — makes decodeURIComponent throw,
  // and an uncaught throw in the request handler takes the whole process with
  // it. One anonymous request would have stopped the game for everybody.
  let url
  let path
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'x'}`)
    path = decodeURIComponent(url.pathname)
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad request')
    return
  }
  // A path that decodes to a control character — GET /%0A/ is enough — went
  // on into a Location header and Node threw on the header, which was an
  // uncaught exception, which exited the process (2026-09-07). No file and
  // no route has one; refuse it here so nothing downstream has to think.
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad request')
    return
  }

  // what this client will accept, for `json` — see the note on it
  res.acceptEncoding = req.headers['accept-encoding']

  // Railway's health check. Without one a deploy swaps containers the moment
  // the new process starts, and while it is still retrying the analytics
  // schema (lock timeouts, tens of seconds) nothing answers — the 502 the
  // group saw on 09-10 at 16:19 UTC. With this path in railway.json the old
  // container keeps serving until the new one answers here.
  if (path === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'X-Engine-SHA256': ENGINE_SHA256, 'X-Release-SHA256': RELEASE_SHA256 }).end('ok')
    return
  }

  // Alive is not ready. /healthz says the process answers; this says the
  // release can do its job: the database answers, the schema step is over,
  // and the tables THIS version's features were written against exist. A
  // missing required feature keeps this container unready, so the old healthy
  // deployment can continue serving until the migration is complete.
  if (path === '/readyz') {
    void readiness().then((r) => {
      res.writeHead(r.ready ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(r))
    })
    return
  }

  // vctgames.com/player is the studio's other game, passed through to its own service (player-proxy.js).
  // Before the schema gate below: it needs nothing of this database and should not wait for it.
  if (playerProxy.handles(path)) { playerProxy.handle(req, res, url); return }

  // 「慢在哪里」, for the owner: where actions spend their time by stage, how
  // long transactions wait for each pool, and how late the event loop runs.
  // Numbers the process already has — it asks the database nothing.
  if (path === '/api/admin/perf') {
    if (!tokenOk(tokenFrom(req, url), TOKEN)) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return }
    const ms = (ns) => Math.round(ns / 1e4) / 100
    json(res, 200, {
      ok: true, upSec: Math.round(process.uptime()), rssMb: Math.round(process.memoryUsage().rss / 1048576),
      loop: { p50: ms(loopDelay.percentile(50)), p99: ms(loopDelay.percentile(99)), max: ms(loopDelay.max) },
      pools: { main: sql?.txStats?.() ?? null, bg: sqlBg?.txStats?.() ?? null, stats: sqlStats?.txStats?.() ?? null },
      cards: _cardApi?.timings() ?? null,
    })
    if (url.searchParams.get('reset') === '1') loopDelay.reset()
    return
  }

  if (path.startsWith('/api/') && process.env.DATABASE_URL && !schemaReady) {
    res.setHeader('Retry-After', '5')
    json(res, 503, { ok: false, busy: true, why: '服务正在准备，请稍后重试。' })
    return
  }

  if (path === '/api/e') {
    if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
    void ingest(req, res)
    return
  }
  if (path.startsWith('/api/card/phone/') || path === '/api/admin/verify' || path === '/api/admin/sms' || path === '/api/admin/review') {
    void phoneApi().route(req, res, path, bucketOf(req), url).then((handled) => {
      if (!handled) json(res, 404, { ok: false })
    }).catch((err) => {
      console.warn('phone: route failed', err.message)
      if (!res.headersSent) json(res, 500, { ok: false })
    })
    return
  }
  if (path === '/api/card/opencup' || path.startsWith('/api/card/opencup/')) {
    if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
    void openCupApi().route(req, res, path, bucketOf(req)).then((handled) => {
      if (!handled) json(res, 404, { ok: false })
    }).catch((err) => {
      console.warn('opencup: route failed', err.message)
      if (!res.headersSent) json(res, 500, { ok: false })
    })
    return
  }
  if (path.startsWith('/api/card/')) {
    if (req.method !== 'POST' && path !== '/api/card/day') { json(res, 405, { ok: false }); return }
    void cardApi().route(req, res, path, bucketOf(req)).then((handled) => {
      if (!handled) json(res, 404, { ok: false })
    }).catch((err) => {
      console.warn('cards: route failed', err.message)
      if (!res.headersSent) json(res, 500, { ok: false })
    })
    return
  }
  if (path.startsWith('/api/market/')) {
    if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    void marketApi().route(req, res, path, bucketOf(req)).then((handled) => {
      if (!handled) json(res, 404, { ok: false })
    }).catch((err) => {
      console.warn('market: route failed', err.message)
      if (!res.headersSent) json(res, 500, { ok: false })
    })
    return
  }
  if (path.startsWith('/api/profile/')) {
    if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
    void profileApi().route(req, res, path, bucketOf(req)).then((handled) => {
      if (!handled) json(res, 404, { ok: false })
    }).catch((err) => {
      console.warn('profile: route failed', err.message)
      if (!res.headersSent) json(res, 500, { ok: false })
    })
    return
  }
  // Every admin route the site module owns, not a list of one. Naming them
  // individually is how /api/admin/grant shipped unreachable: the route existed,
  // the module handled it, and the dispatcher above never sent it there — so it
  // fell through to the static handler and answered 200 with index.html, which
  // reads exactly like an ungated endpoint until you look at the body.
  if (path === '/api/site/' || path.startsWith('/api/site/') || path.startsWith('/api/admin/')) {
    void siteApi().route(req, res, path, url).then((handled) => {
      if (!handled) json(res, 404, { ok: false })
    }).catch((err) => {
      console.warn('site: route failed', err.message)
      if (!res.headersSent) json(res, 500, { ok: false })
    })
    return
  }
  if (path === '/api/stats') { void stats(req, res, url); return }
  if (path === '/api/forget') {
    // Remove one visitor's rows. Needed because the ingest endpoint is public:
    // probes, tests and anyone poking at it land in the same table as real
    // players, and waiting 180 days for the pruner is not a remedy. Behind the
    // same token as the dashboard.
    if (req.method !== 'POST' || !tokenOk(tokenFrom(req, url), TOKEN)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
      return
    }
    const vid = url.searchParams.get('vid')
    if (!sqlStats || !vid) { json(res, 400, { ok: false }); return }
    sqlStats`delete from events where visitor_id = ${vid}`
      .then((r) => json(res, 200, { ok: true, deleted: r.count ?? 0 }))
      .catch((e) => json(res, 500, { ok: false, why: e.message }))
    return
  }
  // The build's asset URLs are relative (base './', so the same bundle works
  // under a GitHub Pages subpath), which resolves correctly from /cards and
  // NOT from /cards/ — there the browser would ask for /cards/assets/index-*.js,
  // get the index.html fallback, and render nothing. One redirect is cheaper
  // than an absolute base.
  //
  // Written for /cards when /cards was the only route below the root. The site
  // now has a front page and the career lives at /manager, so this has to hold
  // for every app route rather than one hard-coded name — a visitor typing the
  // trailing slash gets a blank page otherwise, and typing it is normal.
  if (path.length > 1 && path.endsWith('/')) {
    // the encoded pathname, as the client sent it: a decoded one can carry
    // characters a header may not
    res.writeHead(301, { Location: url.pathname.replace(/\/+$/, '') || '/' }).end()
    return
  }

  if (path === '/admin') {
    // 404 rather than 401: an endpoint that admits it exists is an endpoint
    // someone comes back to
    if (!tokenOk(tokenFrom(req, url), TOKEN)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(dashboardHtml())
    return
  }

  // Anything under /api/ that no module claimed is a wrong address, and it
  // should say so: falling through to index.html answered a mistyped route
  // with HTTP 200 and a page, which is how a broken deploy looks fine.
  if (path.startsWith('/api/')) { json(res, 404, { ok: false, why: 'no such route' }); return }

  // The build's asset URLs are relative, so a page served at /manager/test
  // asks for /manager/assets/… and /manager/faces/… — one directory up from
  // the page, which is where './assets' points from two segments deep.
  // Anything under /manager/ that is not the test page itself is the same
  // file at the root.
  const served = path.startsWith('/manager/') && path !== '/manager/test' ? path.slice('/manager'.length) : path
  let file = join(ROOT, normalize(served).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) file = join(ROOT, 'index.html')

  const ext = extname(file)
  const hashed = /-[A-Za-z0-9_]{8,}\./.test(file)
  // Photographs and crests are named after the player or the club, so the
  // filename cannot change when the picture does — which is why every URL for
  // one carries ?v=<content hash> and a replaced image is a different URL.
  // Given that, a long cache is correct: the day-long compromise that was here
  // before meant a photograph swapped by hand stayed invisible for a day, and
  // that is exactly what happened.
  const face = file.includes(`${sep}faces${sep}`) || file.includes(`${sep}logos${sep}`)
    // agent portraits and map banners change about as often as the game does —
    // a week of cache costs nothing and saves ~400KB of revalidation churn
    || file.includes(`${sep}agents${sep}`) || file.includes(`${sep}maps${sep}`)
    // the background music is four megabytes and its URL carries a version
    || file.includes(`${sep}music${sep}`)
  const head = {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable'
      : face ? 'public, max-age=604800'
        : 'no-cache',
  }

  // Compress the text, and only the text.
  //
  // Nothing here did, and the bundle is a megabyte: every first-time visitor
  // was sent 1,053,546 bytes of JavaScript that gzips to 279,805. Over a phone
  // connection from the other side of the Pacific that is most of the wait
  // before the game appears — a bigger difference than the server's region,
  // and it costs nothing.
  //
  // The photographs and crests are already compressed formats; running them
  // through gzip spends CPU to make them very slightly larger.
  const enc = pickEncoding(req.headers['accept-encoding'], ext)
  if (enc) {
    const body = compressed(file, enc)
    if (body) {
      head['Content-Encoding'] = enc
      head['Content-Length'] = String(body.length)
      // caches key on this, or a proxy hands a gzipped body to a client that
      // never asked for one
      head.Vary = 'Accept-Encoding'
      res.writeHead(200, head)
      res.end(req.method === 'HEAD' ? undefined : body)
      return
    }
  }
  // A media player asks for a file in pieces — the first few kilobytes to
  // read the header, then wherever the listener drags to — and Safari will
  // not play audio at all from a server that answers a range request with
  // the whole file. Honoured for everything; it costs nothing.
  const size = statSync(file).size
  head['Accept-Ranges'] = 'bytes'
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      return
    }
    head['Content-Range'] = `bytes ${start}-${end}/${size}`
    head['Content-Length'] = String(end - start + 1)
    res.writeHead(206, head)
    if (req.method === 'HEAD') { res.end(); return }
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  head['Content-Length'] = String(size)
  res.writeHead(200, head)
  if (req.method === 'HEAD') { res.end(); return }
  createReadStream(file).pipe(res)
}
