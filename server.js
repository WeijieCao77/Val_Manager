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
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVENTS, MAX_BODY, SCHEMA, rateLimited, sanitize, tokenOk } from './analytics.js'
import { CARD_SCHEMA, makeCardApi, normalizeId } from './cards-api.js'
import { displayName } from './names.js'
import { PROFILE_SCHEMA, makeProfileApi } from './profile-api.js'
import { SITE_SCHEMA, makeSiteApi } from './site-api.js'
import { makeMarketApi } from './market-api.js'
import { overview, prune, storage } from './stats.js'
import { dashboardHtml } from './dashboard.js'

// Analytics is a side-car. Nothing in it is worth taking the game offline for,
// so an unexpected throw anywhere is logged and the process keeps serving.
process.on('uncaughtException', (err) => console.error('uncaught:', err?.message))
process.on('unhandledRejection', (err) => console.error('unhandled:', err?.message))

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist')
const PORT = Number(process.env.PORT) || 8080
const TOKEN = process.env.ANALYTICS_TOKEN || ''

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
const MAX_ROWS = num(process.env.ANALYTICS_MAX_ROWS, 4_000_000)
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
}

// ---------------------------------------------------------------- database

let sql = null
if (process.env.DATABASE_URL) {
  try {
    const { default: postgres } = await import('postgres')
    sql = postgres(process.env.DATABASE_URL, {
      max: 4,
      idle_timeout: 20,
      connect_timeout: 10,
      // Railway terminates TLS inside its private network; the certificate is
      // for the internal host, so verification is not meaningful here
      ssl: process.env.DATABASE_URL.includes('railway.internal') ? false : 'require',
      onnotice: () => {},
    })
    await sql.unsafe(SCHEMA)
    await sql.unsafe(CARD_SCHEMA)
    await sql.unsafe(PROFILE_SCHEMA)
    await sql.unsafe(SITE_SCHEMA)
    console.log('analytics: connected, schema ready')
    // Prune on boot rather than on a daily timer. Railway redeploys often
    // enough that a 24-hour interval would rarely reach its first tick, so the
    // retention policy would have been written down and never enforced.
    prune(sql, PRUNE_DAYS, MAX_ROWS)
      .then((n) => n && console.log(`analytics: pruned ${n} old events`))
      .catch((e) => console.warn('analytics: prune failed', e.message))
    setInterval(() => {
      prune(sql, PRUNE_DAYS, MAX_ROWS)
        .catch((e) => console.warn('analytics: prune failed', e.message))
    }, 24 * 60 * 60 * 1000).unref?.()
  } catch (err) {
    console.warn('analytics: disabled —', err.message)
    sql = null
  }
} else {
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
const json = (res, code, body) => {
  const s = JSON.stringify(body)
  const head = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }
  const accept = String(res.acceptEncoding || '')
  if (Buffer.byteLength(s) >= JSON_MIN) {
    try {
      if (/\bbr\b/.test(accept)) {
        const out = brotliCompressSync(s, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
        })
        head['Content-Encoding'] = 'br'
        head.Vary = 'Accept-Encoding'
        res.writeHead(code, head)
        res.end(out)
        return
      }
      if (/\bgzip\b/.test(accept)) {
        const out = gzipSync(s, { level: 6 })
        head['Content-Encoding'] = 'gzip'
        head.Vary = 'Accept-Encoding'
        res.writeHead(code, head)
        res.end(out)
        return
      }
    } catch {
      // fall through and send it plain rather than fail the request
    }
  }
  res.writeHead(code, head)
  res.end(s)
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

/**
 * Only for rate limiting, and only in memory.
 *
 * Railway sits behind a proxy, so the socket address is the proxy's. The
 * forwarded header is what distinguishes callers. It is hashed to a short
 * bucket key immediately and never stored, logged, or written anywhere.
 */
function bucketOf(req) {
  // The client controls the LEFT end of X-Forwarded-For — anyone can prepend a
  // made-up address and get a fresh rate-limit bucket on every request, which
  // is to say no rate limit at all. The proxy appends the peer it actually saw
  // to the right, so that is the only entry worth reading.
  const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean)
  const raw = chain[chain.length - 1] || req.socket.remoteAddress || '?'
  let h = 2166136261
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

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
 * Three orders of magnitude above anything this game will organically produce,
 * so it is a backstop and not a policy.
 */
const MAX_TABLE_BYTES = 1_500_000_000
let sizeChecked = 0
let sizeBytes = 0

async function overBudget() {
  const now = Date.now()
  if (now - sizeChecked < 5 * 60_000) return sizeBytes > MAX_TABLE_BYTES
  sizeChecked = now
  try {
    const r = await sql`select pg_total_relation_size('events') as b`
    sizeBytes = Number(r[0]?.b ?? 0)
    if (sizeBytes > MAX_TABLE_BYTES) {
      console.warn(`analytics: events table at ${Math.round(sizeBytes / 1e6)}MB — refusing writes`)
    }
  } catch { /* if we cannot measure it, do not block on it */ }
  return sizeBytes > MAX_TABLE_BYTES
}

async function ingest(req, res) {
  if (!sql) { json(res, 204, {}); return }
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
    await sql`insert into events ${sql(rows,
      'n', 'client_t', 'visitor_id', 'session_id', 'seq', 'device', 'tz', 'name', 'props')}
      on conflict do nothing`
    json(res, 204, {})
  } catch (err) {
    console.warn('analytics: insert failed', err.message)
    json(res, 500, { ok: false })
  }
}

async function stats(req, res, url) {
  if (!tokenOk(url.searchParams.get('token'), TOKEN)) {
    json(res, 404, { ok: false })
    return
  }
  if (!sql) { json(res, 503, { ok: false, why: 'no database' }); return }
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30))
  try {
    const [data, disk] = await Promise.all([overview(sql, days), storage(sql, MAX_ROWS)])
    json(res, 200, { ...data, storage: disk })
  } catch (err) {
    console.warn('analytics: query failed', err.message)
    json(res, 500, { ok: false, why: err.message })
  }
}

const cardApi = () => (_cardApi ??= makeCardApi(sql, { rateLimited, readBody, json }))
let _cardApi = null
const profileApi = () => (_profileApi ??= makeProfileApi(sql, { rateLimited, readBody, json }))
let _profileApi = null
const siteApi = () => (_siteApi ??= makeSiteApi(sql, { readBody, json, token: TOKEN }))
let _siteApi = null
const marketApi = () => (_marketApi ??= makeMarketApi(sql, {
  readBody, json, normalizeId, displayName, rateLimited,
}))
let _marketApi = null

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
 * Compress a file once and keep it.
 *
 * The built assets are immutable — their names carry a content hash — so a
 * compressed copy is valid for the life of the process, and brotli at a high
 * quality is far too slow to run per request. Bounded because the cache is
 * keyed by path and a request can name any file under dist/.
 */
const zipped = new Map()
const ZIP_MAX = 64
function compressed(file, enc) {
  const key = enc + ':' + file
  const hit = zipped.get(key)
  if (hit) return hit
  try {
    const raw = readFileSync(file)
    // below about a kilobyte the header costs more than the saving
    if (raw.length < 1024) return null
    const out = enc === 'br'
      ? brotliCompressSync(raw, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 10,
          [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
        },
      })
      : gzipSync(raw, { level: 8 })
    if (zipped.size >= ZIP_MAX) zipped.clear()
    zipped.set(key, out)
    return out
  } catch {
    // unreadable, or too big to hold — fall through to streaming it raw
    return null
  }
}

createServer((req, res) => {
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

  // what this client will accept, for `json` — see the note on it
  res.acceptEncoding = req.headers['accept-encoding']

  if (path === '/api/e') {
    if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
    void ingest(req, res)
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
  if (path === '/api/site/' || path.startsWith('/api/site/') || path === '/api/admin/wechat') {
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
    if (req.method !== 'POST' || !tokenOk(url.searchParams.get('token'), TOKEN)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
      return
    }
    const vid = url.searchParams.get('vid')
    if (!sql || !vid) { json(res, 400, { ok: false }); return }
    sql`delete from events where visitor_id = ${vid}`
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
    res.writeHead(301, { Location: path.replace(/\/+$/, '') || '/' }).end()
    return
  }

  if (path === '/admin') {
    // 404 rather than 401: an endpoint that admits it exists is an endpoint
    // someone comes back to
    if (!tokenOk(url.searchParams.get('token'), TOKEN)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(dashboardHtml())
    return
  }

  let file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''))
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
  res.writeHead(200, head)
  createReadStream(file).pipe(res)
}).on('clientError', (_err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
}).listen(PORT, () => {
  console.log(`VAL MANAGER serving ${ROOT} on :${PORT}`)
  console.log(`analytics: ${sql ? 'on' : 'off'}, ${EVENTS.size} event names accepted`)
})
