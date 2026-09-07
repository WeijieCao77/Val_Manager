/**
 * The rate limiter must tell players apart behind Cloudflare, and must not let
 * a direct caller pick its own bucket.
 *   npx tsx scripts/check_client_ip.ts
 *
 * Railway appends the peer it saw to the right of X-Forwarded-For. With
 * Cloudflare in front that peer is a Cloudflare node, and CF-Connecting-IP
 * carries the real client — trusted only in that case.
 */
import { CLOUDFLARE_RANGES, bucketOf, clientIp, isCloudflare } from '../client-ip.js'
import { rateLimited } from '../analytics.js'

let fails = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails++
}

const req = (h: Record<string, string>, sock = '10.0.0.1') => ({ headers: h, socket: { remoteAddress: sock } })

// ---- the ranges themselves --------------------------------------------
check('every Cloudflare range parses', CLOUDFLARE_RANGES.length === 22 && CLOUDFLARE_RANGES.every((c) => /\/\d+$/.test(c)))
check('a Cloudflare v4 address is recognised', isCloudflare('172.64.1.1') && isCloudflare('104.16.0.1') && isCloudflare('162.159.255.254'))
check('a Cloudflare v6 address is recognised', isCloudflare('2606:4700::1234') && isCloudflare('2a06:98c0:1::1'))
check('a v4-mapped Cloudflare address is recognised', isCloudflare('::ffff:172.64.1.1'))
check('Railway edges and ordinary clients are not Cloudflare', !isCloudflare('69.46.46.27') && !isCloudflare('1.2.3.4') && !isCloudflare('2001:db8::1'))
check('garbage is not Cloudflare', !isCloudflare('') && !isCloudflare('?') && !isCloudflare('172.64.1.1, 1.2.3.4'))

// ---- without Cloudflare: exactly what was there before ------------------
check('no forwarded header → socket address', clientIp(req({}, '10.9.8.7')) === '10.9.8.7')
check('one hop → that hop', clientIp(req({ 'x-forwarded-for': '1.2.3.4' })) === '1.2.3.4')
check('a client-prepended address is ignored', clientIp(req({ 'x-forwarded-for': '9.9.9.9, 1.2.3.4' })) === '1.2.3.4')
check('a forged CF-Connecting-IP from a direct caller is ignored',
  clientIp(req({ 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '8.8.8.8' })) === '1.2.3.4')
check('a v4-mapped hop is read as v4', clientIp(req({ 'x-forwarded-for': '::ffff:1.2.3.4' })) === '1.2.3.4')
check('a v6 client stays itself', clientIp(req({ 'x-forwarded-for': '2001:db8::1' })) === '2001:db8::1')

// ---- behind Cloudflare ---------------------------------------------------
check('Cloudflare hop → CF-Connecting-IP',
  clientIp(req({ 'x-forwarded-for': '1.2.3.4, 172.64.1.1', 'cf-connecting-ip': '1.2.3.4' })) === '1.2.3.4')
check('Cloudflare v6 hop → CF-Connecting-IP',
  clientIp(req({ 'x-forwarded-for': '1.2.3.4, 2606:4700::1', 'cf-connecting-ip': '1.2.3.4' })) === '1.2.3.4')
check('Cloudflare hop, v6 client', clientIp(req({ 'x-forwarded-for': '2001:db8::1, 172.64.1.1', 'cf-connecting-ip': '2001:db8::1' })) === '2001:db8::1')
check('client-prepended junk still ignored behind Cloudflare',
  clientIp(req({ 'x-forwarded-for': '5.5.5.5, 1.2.3.4, 172.64.1.1', 'cf-connecting-ip': '1.2.3.4' })) === '1.2.3.4')
check('Cloudflare hop without the header → the hop Cloudflare appended',
  clientIp(req({ 'x-forwarded-for': '1.2.3.4, 172.64.1.1' })) === '1.2.3.4')
check('Cloudflare hop with a junk header → the hop Cloudflare appended',
  clientIp(req({ 'x-forwarded-for': '1.2.3.4, 172.64.1.1', 'cf-connecting-ip': 'nope' })) === '1.2.3.4')
check('Cloudflare hop, nothing else known → the Cloudflare hop itself',
  clientIp(req({ 'x-forwarded-for': '172.64.1.1' })) === '172.64.1.1')
check('Railway replacing the chain with just the Cloudflare hop still works',
  clientIp(req({ 'x-forwarded-for': '172.64.1.1', 'cf-connecting-ip': '1.2.3.4' })) === '1.2.3.4')

// ---- buckets -------------------------------------------------------------
const node = '172.64.7.7'
const players = Array.from({ length: 40 }, (_, i) => `100.64.${i >> 8}.${i & 255}`)
const viaCf = new Set(players.map((ip) => bucketOf(req({ 'x-forwarded-for': `${ip}, ${node}`, 'cf-connecting-ip': ip }))))
check('40 players behind one Cloudflare node get 40 buckets', viaCf.size === 40, `${viaCf.size}`)
const direct = new Set(players.map((ip) => bucketOf(req({ 'x-forwarded-for': ip }))))
check('the same players directly get the same 40 buckets', direct.size === 40 && [...direct].every((b) => viaCf.has(b)))
const forged = new Set(players.map((ip) => bucketOf(req({ 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': ip }))))
check('a direct caller cannot pick its bucket by forging the header', forged.size === 1, `${forged.size}`)
check('a bucket key is short and never the address', players.every((ip) => { const b = bucketOf(req({ 'x-forwarded-for': ip })); return b.length <= 8 && !b.includes('.') }))

// ---- the failure this prevents: the market's 90-a-minute browse budget -----
// 40 players, 40 browses each, all through one Cloudflare node
let limitedOld = 0
let limitedNew = 0
for (let round = 0; round < 40; round++) {
  for (const ip of players) {
    const r = req({ 'x-forwarded-for': `${ip}, ${node}`, 'cf-connecting-ip': ip })
    // what the old code keyed on: the rightmost hop, i.e. the Cloudflare node
    if (rateLimited(`old:mb:${node}`, 90)) limitedOld++
    if (rateLimited(`new:mb:${bucketOf(r)}`, 90)) limitedNew++
  }
}
check('keyed on the Cloudflare node, players would be sharing one budget', limitedOld > 1000, `${limitedOld} of 1600 refused`)
check('keyed on the client, nobody is refused', limitedNew === 0, `${limitedNew} of 1600 refused`)

// one player hammering through Cloudflare is still limited
let hammer = 0
for (let i = 0; i < 200; i++) {
  if (rateLimited(`new:one:${bucketOf(req({ 'x-forwarded-for': `1.2.3.4, ${node}`, 'cf-connecting-ip': '1.2.3.4' }))}`, 90)) hammer++
}
check('one player over budget behind Cloudflare is still refused', hammer === 110, `${hammer} of 200 refused`)

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed')
process.exit(fails ? 1 : 0)
