/**
 * Serves the production build, and collects how it gets played.
 *
 * The static half is deliberately dependency-free: the game is a client-side
 * bundle, so serving `dist/` and falling back to index.html is the whole job.
 *
 * The other half exists because the owner had no way to tell whether anyone
 * came back a second time. It records what people do with the game — never who
 * they are. There are no accounts and no IP addresses in the database; a
 * browser makes up a random id for itself on first visit and that is the whole
 * of identity. Without a DATABASE_URL the game runs exactly as it did before
 * and every event is dropped on the floor, which is the correct behaviour for
 * a local checkout.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVENTS, MAX_BODY, SCHEMA, rateLimited, sanitize, tokenOk } from './analytics.js'
import { overview, prune } from './stats.js'
import { dashboardHtml } from './dashboard.js'

// Analytics is a side-car. Nothing in it is worth taking the game offline for,
// so an unexpected throw anywhere is logged and the process keeps serving.
process.on('uncaughtException', (err) => console.error('uncaught:', err?.message))
process.on('unhandledRejection', (err) => console.error('unhandled:', err?.message))

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist')
const PORT = Number(process.env.PORT) || 8080
const TOKEN = process.env.ANALYTICS_TOKEN || ''

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
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
    console.log('analytics: connected, schema ready')
    // Prune on boot rather than on a daily timer. Railway redeploys often
    // enough that a 24-hour interval would rarely reach its first tick, so the
    // retention policy would have been written down and never enforced.
    prune(sql).then((n) => n && console.log(`analytics: pruned ${n} old events`))
      .catch((e) => console.warn('analytics: prune failed', e.message))
    setInterval(() => {
      prune(sql).catch((e) => console.warn('analytics: prune failed', e.message))
    }, 24 * 60 * 60 * 1000).unref?.()
  } catch (err) {
    console.warn('analytics: disabled —', err.message)
    sql = null
  }
} else {
  console.log('analytics: no DATABASE_URL, running without it')
}

// ---------------------------------------------------------------- helpers

const json = (res, code, body) => {
  const s = JSON.stringify(body)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
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

async function ingest(req, res) {
  if (!sql) { json(res, 204, {}); return }
  if (rateLimited(bucketOf(req))) { json(res, 429, { ok: false }); return }

  let payload
  try {
    payload = sanitize(JSON.parse(await readBody(req, MAX_BODY)))
  } catch {
    json(res, 400, { ok: false })
    return
  }
  if (!payload) { json(res, 400, { ok: false }); return }

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
    json(res, 200, await overview(sql, days))
  } catch (err) {
    console.warn('analytics: query failed', err.message)
    json(res, 500, { ok: false, why: err.message })
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

  if (path === '/api/e') {
    if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
    void ingest(req, res)
    return
  }
  if (path === '/api/stats') { void stats(req, res, url); return }
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
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}).on('clientError', (_err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
}).listen(PORT, () => {
  console.log(`VAL MANAGER serving ${ROOT} on :${PORT}`)
  console.log(`analytics: ${sql ? 'on' : 'off'}, ${EVENTS.size} event names accepted`)
})
