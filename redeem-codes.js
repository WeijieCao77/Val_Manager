/**
 * 口令领卡: a card for whoever has the group's code (2026-10-16).
 *
 * 「网站上有一个免费的领取链接，领取前需要输入一串口令，口令只有我的群里有」 —
 * the code is handed out in the owner's WeChat / 抖音 groups, typed on the
 * 账号 page (vctgames.com/cards#redeem), and the right one gives the card,
 * once per account. The engine's `redeem` action only hears WHICH code this
 * request proved (cardActions.ts, env.redeem); the code itself never reaches
 * the browser bundle.
 *
 * This repository is public, so the code is not written here: only a salted
 * hash of a 60-bit random one, which nobody recovers by guessing. A Railway
 * variable named in `env` replaces it — the owner can change the code
 * without a deploy, and the old one stops working at once.
 *
 * What is compared is the code's letters and digits, upper-cased: 「回溯-」,
 * the dashes and any spaces pasted along with it make no difference.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

export const REDEEM_CODES = [
  {
    key: 'lukxo-rewind', cardId: 'egg:lukxo-rewind', env: 'REDEEM_LUKXO_REWIND',
    salt: '0345359ccba03beb859055e04f1acba2',
    hash: '826263363af8a97764c4a583979b72797269442108c567c40ad1286d85da132a',
  },
]

export const normCode = (code) =>
  String(code ?? '').slice(0, 80).normalize('NFKC').toUpperCase().replace(/[^0-9A-Z]/g, '')

const sha = (s) => createHash('sha256').update(s).digest()
const same = (a, b) => timingSafeEqual(sha(a), sha(b))

/** The grant a typed code proves, or null. */
export function redeemFor(code, env = process.env) {
  const c = normCode(code)
  if (c.length < 6) return null
  for (const r of REDEEM_CODES) {
    const own = env[r.env] ? normCode(env[r.env]) : ''
    const ok = own ? same(own, c) : timingSafeEqual(sha(`${r.salt}:${c}`), Buffer.from(r.hash, 'hex'))
    if (ok) return { key: r.key, cardId: r.cardId }
  }
  return null
}
