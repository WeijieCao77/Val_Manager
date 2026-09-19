/**
 * vctgames.com/player — the studio's other game, served from where it lives.
 *
 * 无畏契约选手生涯模拟 (github.com/WeijieCao77/val_player) is its own repository
 * and its own Railway service: a static build, a zero-dependency server that
 * hands it out and counts anonymous events. It keeps all of that. This puts it
 * under this domain by passing /player/… through to that service with the
 * prefix taken off, and the answer back as it came — status, headers, ranges
 * (its music needs 206s for Safari), compression and all. A push to val_player
 * is live here the moment its own deploy is; nothing in this repository is
 * rebuilt for it.
 *
 * PLAYER_UPSTREAM names the service, e.g. http://val-player.railway.internal:8080.
 * The private address, not the public one: val_player rate-limits by the last
 * hop of X-Forwarded-For, which over the private network is the one written
 * here (the caller's address as client-ip.js works it out) and over the public
 * edge would be THIS service's address for every player at once. Unset, the
 * route does not exist and the home page keeps its 「新作预告」 card.
 *
 * Not passed through: /dash and /healthz. The first is that game's owner page
 * and has no business answering on this domain; the second is Railway's probe.
 *
 * The page must sit at /player/ with the slash — its build is relative
 * (vite base './'), so /player would resolve ./assets/… against the root.
 */
import http from 'node:http'
import https from 'node:https'

export const PLAYER_PREFIX = '/player'
const MAX_POST = 64 * 1024
const TIMEOUT_MS = 20_000
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host'])
const HIDDEN = /^\/(dash|healthz)(\/|$)/

export function makePlayerProxy({ upstream = process.env.PLAYER_UPSTREAM, clientIp = () => '' } = {}) {
  let target = null
  try { if (upstream) target = new URL(upstream) } catch { console.warn('player: PLAYER_UPSTREAM is not a URL, /player is off') }
  if (target && !/^https?:$/.test(target.protocol)) target = null
  const lib = target?.protocol === 'https:' ? https : http
  const agent = target ? new lib.Agent({ keepAlive: true, maxSockets: 64 }) : null

  const plain = (res, code, text, extra = {}) => {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra }).end(text)
  }

  return {
    enabled: !!target,
    /** Whether this request is the other game's. `path` is the decoded pathname. */
    handles: (path) => !!target && (path === PLAYER_PREFIX || path.startsWith(`${PLAYER_PREFIX}/`)),
    /** `url` is the parsed request URL; its pathname is forwarded as it arrived (still encoded). */
    handle(req, res, url) {
      const raw = url.pathname
      if (raw === PLAYER_PREFIX) { plain(res, 308, '', { Location: `${PLAYER_PREFIX}/${url.search}` }); return }
      if (!raw.startsWith(`${PLAYER_PREFIX}/`)) { plain(res, 404, 'Not found'); return }
      const rest = raw.slice(PLAYER_PREFIX.length)
      if (HIDDEN.test(rest)) { plain(res, 404, 'Not found'); return }
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) { plain(res, 405, 'Method not allowed'); return }
      if (req.method === 'POST' && Number(req.headers['content-length'] ?? 0) > MAX_POST) { plain(res, 413, 'Too large'); return }

      const headers = {}
      for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && !k.startsWith('x-forwarded-') && v !== undefined) headers[k] = v
      headers.host = target.host
      // one hop, the caller's own: what val_player's limiter reads (see the note at the top)
      const ip = clientIp(req)
      if (ip) headers['x-forwarded-for'] = ip
      headers['x-forwarded-host'] = String(req.headers.host ?? '')
      headers['x-forwarded-proto'] = 'https'
      headers['x-forwarded-prefix'] = PLAYER_PREFIX

      let up
      const fail = (code, text) => {
        if (res.headersSent) { res.destroy(); return }
        plain(res, code, text)
      }
      try {
        up = lib.request({
          protocol: target.protocol, hostname: target.hostname, port: target.port || undefined,
          method: req.method, path: `${target.pathname.replace(/\/$/, '')}${rest}${url.search}`,
          headers, agent, timeout: TIMEOUT_MS,
        })
      } catch {
        // a path Node will not put on the wire (a raw control character): nothing to pass on
        fail(400, 'Bad request')
        return
      }
      up.on('response', (from) => {
        const out = {}
        for (const [k, v] of Object.entries(from.headers)) if (!HOP.has(k) && v !== undefined) out[k] = v
        // its redirects are written for a game at the root (/manager → /): keep them inside the prefix
        if (typeof out.location === 'string' && out.location.startsWith('/') && !out.location.startsWith('//')) {
          out.location = `${PLAYER_PREFIX}${out.location}`
        }
        res.writeHead(from.statusCode ?? 502, out)
        from.pipe(res)
        from.on('error', () => res.destroy())
      })
      up.on('timeout', () => up.destroy(new Error('timeout')))
      up.on('error', () => fail(502, '选手生涯模拟暂时打不开，稍后再试。'))
      res.on('close', () => { if (!res.writableEnded) up.destroy() })
      if (req.method === 'POST') {
        let seen = 0
        req.on('data', (chunk) => {
          seen += chunk.length
          if (seen > MAX_POST) { up.destroy(); fail(413, 'Too large'); req.destroy() }
        })
        req.pipe(up)
      } else up.end()
    },
  }
}
