/**
 * vctgames.com/player: the other game, passed through to its own service.
 *
 *   npx tsx scripts/check_player_proxy.ts
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { makePlayerProxy } from '../player-proxy.js'

// the other game, as far as a proxy can tell: a server that says what it was asked
const seen: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = []
const upstream = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    seen.push({ method: req.method!, url: req.url!, headers: req.headers, body })
    if (req.url!.startsWith('/manager')) { res.writeHead(302, { location: '/', 'cache-control': 'no-store' }).end(); return }
    if (req.url!.startsWith('/music/')) {
      const range = req.headers.range
      if (range) { res.writeHead(206, { 'content-range': 'bytes 0-3/10', 'accept-ranges': 'bytes', 'content-type': 'audio/mp4' }).end('abcd'); return }
      res.writeHead(200, { 'content-type': 'audio/mp4' }).end('abcdefghij'); return
    }
    if (req.url === '/api/e') { res.writeHead(204).end(); return }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', etag: '"v1"' }).end(`<html>${req.url}</html>`)
  })
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
const upPort = (upstream.address() as { port: number }).port

const proxy = makePlayerProxy({ upstream: `http://127.0.0.1:${upPort}`, clientIp: () => '203.0.113.7' })
const front = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x')
  const path = decodeURIComponent(url.pathname)
  if (proxy.handles(path)) { proxy.handle(req, res, url); return }
  res.writeHead(200, { 'content-type': 'text/plain' }).end('val manager')
})
await new Promise<void>((r) => front.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(front.address() as { port: number }).port}`
const get = (p: string, init: RequestInit = {}) => fetch(base + p, { redirect: 'manual', ...init })

let r = await get('/player')
assert.deepEqual([r.status, r.headers.get('location')], [308, '/player/'], '没有斜杠的先补上：相对路径的资源要靠它')
r = await get('/player?u=1')
assert.equal(r.headers.get('location'), '/player/?u=1')

r = await get('/player/')
assert.equal(r.status, 200)
assert.equal(await r.text(), '<html>/</html>', '前缀去掉了，对面看到的是 /')
assert.equal(r.headers.get('etag'), '"v1"', '对面的响应头原样带回')
r = await get('/player/assets/index-abc.js?v=2')
assert.equal(await r.text(), '<html>/assets/index-abc.js?v=2</html>')
const last = seen[seen.length - 1]
assert.equal(last.headers['x-forwarded-for'], '203.0.113.7', '限流看到的是玩家自己的地址，只有这一跳')
assert.equal(last.headers['x-forwarded-prefix'], '/player')
assert.equal(last.headers.host, `127.0.0.1:${upPort}`)
console.log('ok  /player → /player/，去前缀转发，响应头原样带回，只带玩家自己这一跳地址')

r = await get('/player/', { headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' } })
await r.text()
assert.equal(seen[seen.length - 1].headers['x-forwarded-for'], '203.0.113.7', '玩家自己写的 X-Forwarded-For 不往后传')

r = await get('/player/music/a.m4a', { headers: { range: 'bytes=0-3' } })
assert.deepEqual([r.status, r.headers.get('content-range'), await r.text()], [206, 'bytes 0-3/10', 'abcd'], '音乐的分段请求原样过去、206 原样回来')
console.log('ok  Range 请求回 206（Safari 放音乐要它）')

r = await get('/player/manager/old-link')
assert.deepEqual([r.status, r.headers.get('location')], [302, '/player/'], '对面回根目录的跳转留在 /player 里面')
console.log('ok  对面的站内跳转改写到 /player 下')

r = await get('/player/api/e', { method: 'POST', body: JSON.stringify({ n: 'career_start' }), headers: { 'content-type': 'application/json' } })
assert.equal(r.status, 204)
assert.deepEqual([seen[seen.length - 1].method, seen[seen.length - 1].url, seen[seen.length - 1].body], ['POST', '/api/e', '{"n":"career_start"}'])
r = await get('/player/api/e', { method: 'POST', body: 'x'.repeat(70_000) })
assert.equal(r.status, 413, '统计上报不会有这么大')
r = await get('/player/', { method: 'DELETE' })
assert.equal(r.status, 405)
console.log('ok  统计上报转到对面自己的 /api/e；超大的和别的方法不转')

const before = seen.length
for (const p of ['/player/dash', '/player/healthz', '/player/dash/x']) assert.equal((await get(p)).status, 404, p)
assert.equal(seen.length, before, '对面的后台和探活不在这个域名上露面')
assert.equal(await (await get('/playerx')).text(), 'val manager', '/playerx 不是 /player')
assert.equal(await (await get('/cards')).text(), 'val manager')
console.log('ok  /dash、/healthz 不转发；别的路径不受影响')

// the other service is down: a plain answer, and this process carries on
const dead = makePlayerProxy({ upstream: 'http://127.0.0.1:9', clientIp: () => '' })
const front2 = http.createServer((req, res) => dead.handle(req, res, new URL(req.url || '/', 'http://x')))
await new Promise<void>((r2) => front2.listen(0, '127.0.0.1', r2))
r = await fetch(`http://127.0.0.1:${(front2.address() as { port: number }).port}/player/`)
assert.equal(r.status, 502)
assert.match(await r.text(), /稍后再试/)
const off = makePlayerProxy({ upstream: '', clientIp: () => '' })
assert.deepEqual([off.enabled, off.handles('/player/')], [false, false], '没配 PLAYER_UPSTREAM 就没有这条路')
console.log('ok  对面挂了回 502；没配置就不接管 /player')

upstream.close(); front.close(); front2.close()
upstream.closeAllConnections(); front.closeAllConnections(); front2.closeAllConnections()
