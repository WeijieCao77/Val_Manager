/**
 * What a card-mode day is actually worth, in coins.
 *
 * Pack prices were picked by feel and then patched with a purchase cap when
 * they turned out to be wrong, which is backwards: a cap on how many packs you
 * may open is a cap on the thing the mode is FOR. The price should carry the
 * pacing on its own, and to price anything you first have to know what a day
 * earns.
 *
 * So: measure E(coins) per ladder match by division and per cup run by squad
 * strength, from the simulation rather than from the reward table, because the
 * reward table does not know the win rate.
 *
 *   npx tsx scripts/economy_check.ts
 */
import {
  DIVISIONS, PACKS, STAMINA_COST, STAMINA_MAX, STAMINA_REGEN_MS, staminaEvery,
  cupBo, cupOpponent, enterCup, ladderOpponent, newGacha, openPack, recordCup,
  recordLadder, autoSquad,
} from '../src/engine/gacha'
import type { GachaState, PackKind } from '../src/engine/gacha'
import { playArenaMatch } from '../src/engine/arena'
import { squadRating } from '../src/engine/cards'

const HOUR = 3600_000
const money = (n: number) => Math.round(n).toLocaleString('en-US')

/** A collection of roughly the size N ten-pulls would give. */
function accountWith(tens: number, seed: string): GachaState {
  const g = newGacha(seed, 'econ', '2026-08-27')
  g.coins = 1e9
  for (let i = 0; i < tens; i++) {
    g.packs.ten = (g.packs.ten ?? 0) + 1
    openPack(g, 'ten', 'pack')
  }
  g.packs.coach = (g.packs.coach ?? 0) + 1
  openPack(g, 'coach', 'pack')
  g.squad = autoSquad(g)
  g.coins = 0
  return g
}

console.log('=== 天梯：每场期望收益（各段位，400 场采样）===')
const ladderPer: number[] = []
for (let div = 0; div < DIVISIONS.length; div++) {
  const g = accountWith(6, `VM-LAD${div}-LAD${div}-LAD${div}-LAD${div}-LADD`)
  g.ladder.div = div
  g.ladder.best = div
  let coins = 0
  let wins = 0
  const N = 400
  for (let i = 0; i < N; i++) {
    // hold the division still: we are measuring this rung, not the climb
    g.ladder.div = div
    g.ladder.stars = 2
    const r = playArenaMatch(g.squad, (id) => g.cards[id]?.level ?? 0, ladderOpponent(g), 3, i * 31 + div)
    coins += recordLadder(g, r.win).coins
    if (r.win) wins++
  }
  ladderPer[div] = coins / N
  console.log(`  ${DIVISIONS[div].padEnd(3)} 胜率 ${((100 * wins) / N).toFixed(0)}%  `
    + `每场 ${money(ladderPer[div])} 金币  每点体力 ${money(ladderPer[div] / STAMINA_COST.ladder)}`)
}

console.log('\n=== 杯赛：每次报名的期望收益（200 次采样）===')
const cupPer: { rating: number; perLeg: number; perRun: number; legs: number }[] = []
for (const tens of [3, 10, 30]) {
  const g = accountWith(tens, `VM-CUP${tens}-CUP${tens}-CUP${tens}-CUP${tens}-CUPP`)
  const level = (id: string) => g.cards[id]?.level ?? 0
  const rating = squadRating(g.squad, level)
  g.coins = 1e9
  const before = g.coins
  let legs = 0
  const N = 200
  for (let i = 0; i < N; i++) {
    g.daily.stamina = STAMINA_MAX; g.daily.staminaAt = 1
    enterCup(g, rating, 1)
    let round = 0
    while (g.cup && !g.cup.done) {
      const opp = cupOpponent(g)!
      const r = playArenaMatch(g.squad, level, opp, cupBo(g.cup), i * 71 + round)
      recordCup(g, { opponent: opp, win: r.win, mapsWon: r.mapsWon, mapsLost: r.mapsLost })
      legs++
      if (!r.win) break
      round++
    }
    g.cup = null
  }
  const net = g.coins - before
  // a ticket is the only 体力 a cup costs, so the rate is per ticket
  cupPer.push({ rating, perLeg: net / N / STAMINA_COST.cup, perRun: net / N, legs: legs / N })
  console.log(`  阵容分 ${rating}  平均 ${(legs / N).toFixed(1)} 轮/张门票  `
    + `净收益 ${money(net / N)}/张 = ${money(net / legs)}/轮  每点体力 ${money(net / N / STAMINA_COST.cup)}`
    + `  （门票 ${STAMINA_COST.cup} 点体力）`)
}

console.log('\n=== 一天能赚多少（按体力上限折算）===')
const perDayStamina = (24 * HOUR) / STAMINA_REGEN_MS
console.log(`  体力：每 ${staminaEvery()} +1，上限 ${STAMINA_MAX}`
  + ` → 一天最多生成 ${perDayStamina} 点`)
for (const div of [0, 2, 5]) {
  const coins = perDayStamina * (ladderPer[div] / STAMINA_COST.ladder)
  console.log(`  ${DIVISIONS[div].padEnd(3)}：全打天梯 ${Math.floor(perDayStamina / STAMINA_COST.ladder)} 场`
    + ` → ${money(coins)} 金币/天`)
}
const best = cupPer[cupPer.length - 1]
console.log(`  杯赛（阵容分 ${best.rating}）：全打杯赛`
  + ` → ${money(perDayStamina * best.perLeg)} 金币/天`)

console.log('\n=== 定价：一天想开几包，包该卖多少 ===')
const dayCoins = {
  新手: perDayStamina * (ladderPer[0] / STAMINA_COST.ladder),
  中段: perDayStamina * (ladderPer[2] / STAMINA_COST.ladder),
  大师: perDayStamina * (ladderPer[5] / STAMINA_COST.ladder),
}
for (const [who, coins] of Object.entries(dayCoins)) {
  const line = [3, 4, 5, 6].map((n) => `${n}包→${money(coins / n)}`).join('  ')
  console.log(`  ${who}（${money(coins)} 金币/天）: ${line}`)
}
console.log(`\n  现价：试训 ${PACKS.scout.cost} / 选拔 ${PACKS.elite.cost} / 教练 ${PACKS.coach.cost}`)
