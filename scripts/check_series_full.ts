/**
 * A finished region pays its last mark: 「中国包开满了，领不了最后的奖励」.
 *
 *   npx tsx scripts/check_series_full.ts
 *
 * For each region: every card the bar counts must be one its own pack can
 * deal, and an account holding all of them must be able to claim the 100%
 * mark through the server's own action, once.
 */
import { SERIES, SERIES_REWARDS, newGacha, openPack, seriesProgress } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import type { Series } from '../src/engine/gacha'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  if (!ok) { bad++; console.log(`FAIL ${what}${detail ? `  ${detail}` : ''}`) }
}

for (const region of SERIES as readonly Series[]) {
  const probe = newGacha()
  const pack = seriesProgress(probe).find((s) => s.region === region)!.pack
  const dealt = new Set<string>()
  const h = newGacha()
  h.coins = 1e12
  for (let i = 0; i < 8000; i++) for (const c of openPack(h, pack, 'coins')) dealt.add(c.card.id)
  const counted = seriesProgress(h).find((s) => s.region === region)!
  console.log(`${region}: bar counts ${counted.total}, its pack dealt ${dealt.size} distinct in 8000 opens, held ${counted.owned}`)
  check(counted.owned === counted.total, `${region} can be finished from its own pack`, `${counted.owned}/${counted.total}`)
  // the four lower marks already taken, the last one waiting
  h.series = { ...(h.series ?? {}), [region]: SERIES_REWARDS.length - 1 }
  const before = h.coins
  const r1 = runAction(h, 'series', { region }, { now: Date.now(), today: '2026-10-09', seed: 1 }) as { ok: boolean; why?: string }
  check(r1.ok, `${region} 100% mark claims`, r1.why ?? '')
  check(h.coins > before, `${region} 100% mark pays coins`)
  const r2 = runAction(h, 'series', { region }, { now: Date.now(), today: '2026-10-09', seed: 1 }) as { ok: boolean }
  check(!r2.ok, `${region} cannot be claimed twice`)
}

if (bad) { console.log(`${bad} failed`); process.exit(1) }
console.log('ok')
