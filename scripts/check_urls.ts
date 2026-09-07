/**
 * A request nobody meant must never take the server down.
 *
 *   npx tsx scripts/check_urls.ts
 *
 * GET /%0A/ decoded to a newline, went into a Location header, and Node's
 * refusal to write that header was an uncaught exception — which the process
 * treats as a reason to exit for a clean restart (2026-09-07). Railway
 * restarts it, three times, and then not. This boots the real server.js on
 * an in-process database, throws the awkward URLs at it, and checks that
 * every one is answered and the process is still there afterwards.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

const port = await new Promise<number>((resolve) => {
  const s = createServer(); s.listen(0, () => { const a = s.address(); s.close(() => resolve(typeof a === 'object' && a ? a.port : 8097)) })
})
const child = spawn('node', ['server.js'], {
  env: { ...process.env, DATABASE_URL: 'pglite://', PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
child.stdout.on('data', (d) => { log += d })
child.stderr.on('data', (d) => { log += d })
let exited: number | null = null
child.on('exit', (code) => { exited = code })

const deadline = Date.now() + 30_000
while (!/serving .* on :/.test(log) && Date.now() < deadline && exited === null) await new Promise((r) => setTimeout(r, 100))

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
check('server.js came up on an in-process database', exited === null && /serving/.test(log), log.slice(-200))

const base = `http://127.0.0.1:${port}`
const status = async (p: string) => {
  try {
    const r = await fetch(base + p, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
    return { code: r.status, location: r.headers.get('location') }
  } catch (e) { return { code: 0, location: null, err: String(e) } }
}
const alive = async () => (await status('/api/card/day')).code === 200

check('the api answers first', await alive())
const nasty = ['/%0A/', '/manager/%0A/', '/assets/%0A/', '/faces/%0D%0A/', '/%0A', '/a%0Ab/', '/%00/', '/x%2F%0A/', '/%7F/', '/%', '/%E0%A4%A/', '/assets/../server.js', '/faces/', '/assets/index-nope.js/']
for (const p of nasty) {
  const r = await status(p)
  check(`${JSON.stringify(p)} is answered (${r.code})`, r.code > 0 && r.code < 600, r.err ?? '')
  check(`…and the process is still alive`, exited === null && await alive(), `exit=${exited}`)
}
{
  const r = await status('/cards/')
  check('a plain trailing slash still redirects', r.code === 301 && r.location === '/cards', JSON.stringify(r))
  const enc = await status('/%E6%B5%8B/')
  check('an encoded but harmless path redirects to its encoded self', enc.code === 301 && enc.location === '/%E6%B5%8B', JSON.stringify(enc))
  const ctl = await status('/%0A/')
  check('a control character is a 400, not a redirect', ctl.code === 400, JSON.stringify(ctl))
}
check('nothing was logged as uncaught', !/uncaught, exiting/.test(log), log.slice(-300))

child.kill()
console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
