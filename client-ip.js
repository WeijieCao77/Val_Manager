/**
 * Which address a request really came from — for rate limiting, and nothing
 * else. Hashed to a bucket key immediately; never stored, logged, or written.
 *
 * Railway sits behind its own proxy, so the socket address is the proxy's and
 * the forwarded chain is what tells callers apart. The client controls the
 * LEFT end of X-Forwarded-For — anyone can prepend a made-up address and get
 * a fresh bucket on every request, which is to say no rate limit at all. The
 * proxy appends the peer it actually saw to the right, so that is the only
 * entry worth reading.
 *
 * With Cloudflare in front of the domain that peer is a Cloudflare node, and
 * every player in the country would land in a few dozen buckets and share
 * their budgets — 429s from the market, the packs and the ladder for people
 * who had done nothing. Cloudflare names the real client in CF-Connecting-IP.
 * That header is trusted only when the rightmost hop is a Cloudflare address:
 * a client talking to Railway directly cannot forge it, because the hop
 * Railway appends is then the client's own, and the header is ignored.
 *
 * Why Cloudflare at all: on 2026-09-07 the Railway edge IP behind the apex
 * domain was blocked from mainland China while the other edge IPs were not,
 * so the domain moved behind Cloudflare's proxy.
 */
import { BlockList, isIP } from 'node:net'

/** https://www.cloudflare.com/ips — as published on 2026-09-07 */
export const CLOUDFLARE_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
]

const cloudflare = new BlockList()
for (const cidr of CLOUDFLARE_RANGES) {
  const [net, bits] = cidr.split('/')
  cloudflare.addSubnet(net, Number(bits), isIP(net) === 6 ? 'ipv6' : 'ipv4')
}

/** An IPv4 address carried inside IPv6 (`::ffff:1.2.3.4`), which is how a dual-stack socket reports it. */
const plain = (ip) => {
  const s = String(ip || '').trim()
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s)
  return m ? m[1] : s
}

/** Whether an address belongs to Cloudflare's published edge ranges. */
export function isCloudflare(ip) {
  const a = plain(ip)
  const v = isIP(a)
  if (!v) return false
  try {
    return cloudflare.check(a, v === 6 ? 'ipv6' : 'ipv4')
  } catch {
    return false
  }
}

/**
 * The address of the caller, as far as it can be trusted: the rightmost hop of
 * the forwarded chain, or — when that hop is Cloudflare — the client Cloudflare
 * says it was talking to.
 */
export function clientIp(req) {
  const headers = req.headers || {}
  const chain = String(headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean)
  const last = chain[chain.length - 1] || req.socket?.remoteAddress || '?'
  if (isCloudflare(last)) {
    const cf = plain(headers['cf-connecting-ip'])
    if (isIP(cf)) return cf
    // Cloudflare appends the client to the chain before Railway appends
    // Cloudflare, so the hop before the last is the same answer
    const prev = plain(chain[chain.length - 2])
    if (isIP(prev)) return prev
  }
  return plain(last)
}

/** The rate-limit bucket for a request: a short hash of the caller's address. */
export function bucketOf(req) {
  const raw = clientIp(req)
  let h = 2166136261
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}
