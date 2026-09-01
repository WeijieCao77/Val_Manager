/**
 * The four series packs, and whether they are worth 2600 金币.
 *
 *   npx tsx scripts/check_series.ts [packs]
 *
 * A region pack is a bet against duplicates, and duplicates are the entire
 * reason it exists: at 607 cards a 选拔包 spends most of its draws on bronzes
 * from a region you were not collecting. The numbers that matter here are
 *
 *   - the pack only ever deals from its own region (the promise on the box)
 *   - the advertised rates hold inside the smaller pool
 *   - a series can actually be finished, and the milestone ladder pays out
 *     once per mark, never twice
 *
 * The last one is the one worth testing mechanically: a reward that can be
 * collected twice is free money, and free money is the only thing in an
 * economy this size that cannot be walked back after it ships.
 */
import {
  FEATURE_OFF, PACKS, PACK_ORDER, SERIES, SERIES_REWARDS,
  claimSeries, featuredSeries, newGacha, openPack, packCost, seriesProgress,
} from '../src/engine/gacha'
import type { Series } from '../src/engine/gacha'
import { REGION_CN } from '../src/engine/types'

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

const N = Number(process.argv[2] ?? 4000)

console.log(`每个赛区开 ${N} 个包\n`)
console.log('赛区      选手卡  出金率   出银率   彩卡   重复率   收齐要多少包   花费')

for (const region of SERIES) {
  const g = newGacha(`VM-${region}`, '审计', '2026-09-01')
  g.coins = 1e9
  const pack = seriesProgress(g).find((p) => p.region === region)!
  let gold = 0, silver = 0, mythic = 0, dupes = 0, cards = 0
  let fullAt = 0

  for (let i = 0; i < N; i++) {
    const out = openPack(g, pack.pack, 'coins')
    for (const p of out) {
      cards++
      if (p.dupe) dupes++
      if (p.card.rarity === 'gold') gold++
      else if (p.card.rarity === 'silver') silver++
      else if (p.card.rarity === 'mythic') mythic++
      // every card a region pack deals belongs to that region — the promise
      check((p.card as { region?: string }).region === region,
        '赛区包只出本赛区的卡', `${region} 开出了 ${(p.card as { region?: string }).region}`)
    }
    if (!fullAt && seriesProgress(g).find((p) => p.region === region)!.owned >= pack.total) {
      fullAt = i + 1
    }
  }

  const def = PACKS[pack.pack]
  const goldRate = gold / cards, silverRate = silver / cards
  console.log(
    `${REGION_CN[region].padEnd(6)}  ${String(pack.total).padStart(4)}  `
    + `${(goldRate * 100).toFixed(1).padStart(6)}%  ${(silverRate * 100).toFixed(1).padStart(6)}%  `
    + `${String(mythic).padStart(4)}  ${(dupes / cards * 100).toFixed(1).padStart(6)}%  `
    + `${fullAt ? String(fullAt).padStart(9) : '   没收齐'}  `
    + `${fullAt ? (fullAt * def.cost).toLocaleString() : '—'}`,
  )

  // the floor guarantees at least a silver, so the two rates together are
  // bounded below by 1/3 of the cards; the gold rate is a floor, not a ceiling,
  // because pity raises it
  check(goldRate >= def.gold * 0.9, `${region} 出金率不低于标称`, `${(goldRate * 100).toFixed(2)}% vs ${(def.gold * 100).toFixed(1)}%`)
  check(goldRate + silverRate >= 1 / 3, `${region} 保底一张银卡起`, `${((goldRate + silverRate) * 100).toFixed(1)}%`)
  check(fullAt > 0, `${region} 这个赛区收得完`)
}

const fresh0 = newGacha('VM-FEAT', '审计', '2026-09-01')

// ---- the milestone ladder pays each mark exactly once
console.log('\n里程碑：')
const g = newGacha('VM-MILE', '审计', '2026-09-01')
g.coins = 1e9
const region: Series = 'China'
const pack = seriesProgress(g).find((p) => p.region === region)!
let paid = 0
let opened = 0
const before = { coins: g.coins, ten: g.packs.ten ?? 0, elite: g.packs.elite ?? 0 }
for (let i = 0; i < 4000; i++) {
  openPack(g, pack.pack, 'coins')
  opened++
  // pressing 领奖 on every single pack must not pay more than pressing it once
  // at the end — this is the double-claim test
  if (claimSeries(g, region)) paid++
  const p = seriesProgress(g).find((x) => x.region === region)!
  if (p.owned >= p.total) break
}
claimSeries(g, region)
const owedCoins = SERIES_REWARDS.reduce((n, r) => n + r.coins, 0)
// coins now = coins before - what the packs cost + what the milestones paid
const gained = g.coins - before.coins + opened * PACKS[pack.pack].cost
console.log(`  ${REGION_CN[region]}：领了 ${paid} 次，累计 +${gained} 金币，十连包 +${(g.packs.ten ?? 0) - before.ten}，选拔包 +${(g.packs.elite ?? 0) - before.elite}，本赛区包 +${g.packs[pack.pack] ?? 0}`)
console.log(`  奖励表合计 ${owedCoins} 金币 / 十连包 ×1 / 选拔包 ×1 / 本赛区包 ×2`)
check(gained === owedCoins, '里程碑金币总额和奖励表一致', `${gained} vs ${owedCoins}`)
check((g.packs.ten ?? 0) - before.ten === 1, '十连包只发一次')
check((g.packs.elite ?? 0) - before.elite === 1, '选拔包只发一次')
check((g.packs[pack.pack] ?? 0) === 2, '90% 送的两个本赛区包到账', String(g.packs[pack.pack] ?? 0))
check(claimSeries(g, region) === null, '收齐之后再点领奖没有东西')
check((g.series?.[region] ?? 0) === SERIES_REWARDS.length, '每一档都记为已领')

// ---- the weekly feature
console.log('\n本周主打：')
const seen = new Map<string, number>()
let last = ''
let flips = 0
for (let d = 0; d < 364; d++) {
  const date = new Date(Date.UTC(2026, 8, 1) + d * 86_400_000).toISOString().slice(0, 10)
  const r = featuredSeries(date)
  seen.set(r, (seen.get(r) ?? 0) + 1)
  if (r !== last) {
    // a rotation that lands mid-week is a rotation nobody notices
    if (last) {
      flips++
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
      check(dow === 1, '换周固定在周一', `${date} 是周 ${dow}`)
    }
    last = r
  }
  // only the featured pack is discounted, and only the series packs at all
  for (const kind of PACK_ORDER) {
    const price = packCost(kind, date)
    const base = PACKS[kind].cost
    const isHot = kind === seriesProgress(fresh0).find((p) => p.region === r)!.pack
    check(price === (isHot ? Math.round(base * (1 - FEATURE_OFF)) : base),
      '只有本周主打打折', `${date} ${kind} ${price} vs ${base}`)
    check(price > 0, '价格是正数', `${kind} ${price}`)
  }
}
console.log(`  一年 ${flips} 次轮换 · ` + [...seen].map(([r, n]) => `${REGION_CN[r as Series]} ${n} 天`).join(' · '))
check(seen.size === SERIES.length, '一年之内四个赛区都轮到过')
check(Math.max(...seen.values()) - Math.min(...seen.values()) <= 7, '轮换是均匀的')
// no date given means no discount — the engine默认按原价算
for (const kind of PACK_ORDER) check(packCost(kind) === PACKS[kind].cost, '不传日期就是原价', kind)

// a fresh account owes nothing
const fresh = newGacha('VM-NEW', '审计', '2026-09-01')
for (const r of SERIES) check(claimSeries(fresh, r) === null, '新号没有可领的系列奖励', r)

console.log(bad ? `\n${bad} 项不通过` : '\n全部通过')
process.exit(bad ? 1 : 0)
