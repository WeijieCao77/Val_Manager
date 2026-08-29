/**
 * What the packs actually pay out, as opposed to what the table says.
 *
 * The numbers in PACKS are per-draw base rates, and three separate mechanics
 * move them: gold odds climb from the 25th dry pull and are certain on the
 * 45th, 彩卡 has a 500-pull floor, and 选拔包/十连包 upgrade their best card if
 * it came in under the promise. So the honest answer to "what are the odds"
 * is measured, not read off the constant.
 *
 *     npx tsx scripts/check_odds.ts [packs per kind]
 */
import { PACKS, PACK_ORDER, newGacha, openPack, SOFT_PITY, HARD_PITY, MYTHIC_FLOOR } from '../src/engine/gacha'
import type { PackKind } from '../src/engine/gacha'

const N = Number(process.argv[2] ?? 200_000)
const pct = (n: number, d: number) => d ? `${(n / d * 100).toFixed(3)}%` : '—'
const one = (n: number, d: number) => n ? `1/${Math.round(d / n).toLocaleString()}` : '—'

console.log(`每种卡包各开 ${N.toLocaleString()} 个\n`)
console.log('包名        每包张数   彩卡        金卡        银卡        铜卡')

for (const kind of PACK_ORDER as PackKind[]) {
  const def = PACKS[kind]
  const g = newGacha('ODDS', '审计', '2026-01-01')
  g.coins = Number.MAX_SAFE_INTEGER
  const tally = { mythic: 0, gold: 0, silver: 0, bronze: 0 }
  let cards = 0
  let packsWithGold = 0
  let packsWithMythic = 0
  for (let i = 0; i < N; i++) {
    g.packs[kind] = 1
    const out = openPack(g, kind, 'pack')
    let sawGold = false
    let sawMythic = false
    for (const p of out) {
      tally[p.card.rarity as keyof typeof tally]++
      cards++
      if (p.card.rarity === 'gold') sawGold = true
      if (p.card.rarity === 'mythic') sawMythic = true
    }
    if (sawGold) packsWithGold++
    if (sawMythic) packsWithMythic++
  }
  console.log(
    `${def.name.padEnd(8)} ${String(def.draws).padStart(6)}   `
    + `${pct(tally.mythic, cards).padStart(9)}  ${pct(tally.gold, cards).padStart(9)}  `
    + `${pct(tally.silver, cards).padStart(9)}  ${pct(tally.bronze, cards).padStart(9)}`)
  console.log(
    `${' '.repeat(9)}标称   ${pct(def.mythic, 1).padStart(9)}  ${pct(def.gold, 1).padStart(9)}  `
    + `${pct(def.silver, 1).padStart(9)}  `
    + `${pct(1 - def.mythic - def.gold - def.silver, 1).padStart(9)}`)
  console.log(
    `${' '.repeat(9)}每包至少一张：金 ${pct(packsWithGold, N)}（${one(packsWithGold, N)}）`
    + `｜彩 ${pct(packsWithMythic, N)}（${one(packsWithMythic, N)}）\n`)
}

console.log(`保底：金卡第 ${SOFT_PITY} 抽起概率递增、第 ${HARD_PITY} 抽必出；`
  + `彩卡 ${MYTHIC_FLOOR} 抽硬保底（教练包不计入）`)

// ---- 混开时保底是共用的：pity 和 mythicDry 挂在账号上，不是挂在卡包上
{
  const g = newGacha('MIX', '审计', '2026-01-01')
  g.coins = Number.MAX_SAFE_INTEGER
  let golds = 0
  let cards = 0
  const N2 = 60_000
  for (let i = 0; i < N2; i++) {
    const kind: PackKind = i % 3 === 0 ? 'elite' : 'scout'
    g.packs[kind] = 1
    for (const p of openPack(g, kind, 'pack')) {
      cards++
      if (p.card.rarity === 'gold') golds++
    }
  }
  console.log(`\n混开（试训包+选拔包）：金卡 ${(golds / cards * 100).toFixed(2)}%`
    + `——保底进度是账号级的，换包不会重置`)
}
