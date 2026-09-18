/**
 * What a cup feels like, by the five that enters it.
 *
 *   npx tsx scripts/measure_cup_experience.ts [cups per squad] [out.json]
 *
 * A measurement, not a check: how often the ticket buys one match and nothing
 * else, how many matches it buys on average, how often it ends in the title,
 * and what it pays. Run before and after a change to the bracket or the purse.
 */
import { writeFileSync } from 'node:fs'
import {
  newGacha, autoSquad, enterCup, recordCup, cupOpponent, cupBo, STAMINA_MAX, STAMINA_COST,
} from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import { ALL_CARDS, MAX_LEVEL, squadRating } from '../src/engine/cards'
import { playCupMatch } from '../src/engine/arena'

const N = Number(process.argv[2] ?? 300)
const OUT = process.argv[3]
const now = Date.parse('2026-09-17T01:00:00Z')
const sorted = CUP_TEAMS.slice().sort((a, b) => a.rating - b.rating)
const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
function mythicFive() {
  const g = newGacha('VM-CUPX-CUPX-CUPX-CUPX-CUPY', '彩卡', '2026-09-01')
  for (const c of ALL_CARDS) if (c.rarity === 'mythic' || c.kind === 'coach') g.cards[c.id] = { id: c.id, level: 0, dupes: 0, seen: 1 } as GachaState['cards'][string]
  return autoSquad(g)
}
const fixtures = [
  { name: '最弱俱乐部 +0', team: at(0), lv: 0 },
  { name: '下游 +0', team: at(0.25), lv: 0 },
  { name: '中游 +0', team: at(0.5), lv: 0 },
  { name: '上游 +0', team: at(0.75), lv: 0 },
  { name: '最强俱乐部 +0', team: at(0.999), lv: 0 },
  { name: '最强俱乐部 +5', team: at(0.999), lv: MAX_LEVEL },
  { name: '彩卡五人 +5', team: { squad: mythicFive() }, lv: MAX_LEVEL },
]
const out: Record<string, unknown> = {}
for (const f of fixtures) {
  const g: GachaState = newGacha('VM-CUPX-CUPX-CUPX-CUPX-CUPX', '杯赛体验', '2026-09-01')
  const level = () => f.lv
  const rating = squadRating(f.team.squad, level)
  let title = 0, firstOut = 0, matches = 0, coins = 0, wins = 0
  const packs: Record<string, number> = {}
  for (let i = 0; i < N; i++) {
    g.cup = null
    g.daily.stamina = STAMINA_MAX
    g.daily.staminaAt = now
    g.seed = (g.seed + 7919 * (i + 1)) >>> 0
    const c0 = g.coins, p0 = { ...g.packs }
    enterCup(g, rating, now)
    let k = 0, w = 0
    while (g.cup && !g.cup.done) {
      const opp = cupOpponent(g)!
      const res = playCupMatch(f.team.squad, level, opp, cupBo(g.cup), ((i + 1) * 131 + k++) >>> 0, g.cup.ease ?? 0,
        // the curve the bracket was entered on; BALANCE=1 replays the same cups on the old one
        Number(process.env.BALANCE) || g.cup.balance || 1)
      if (res.win) w++
      recordCup(g, { opponent: opp, win: res.win, mapsWon: res.mapsWon, mapsLost: res.mapsLost })
    }
    matches += k; wins += w
    if (g.cup!.won) title++
    if (w === 0) firstOut++
    coins += g.coins - c0
    for (const [kind, n] of Object.entries(g.packs)) {
      const d = (n ?? 0) - ((p0 as Record<string, number>)[kind] ?? 0)
      if (d) packs[kind] = (packs[kind] ?? 0) + d
    }
  }
  const row = {
    rating, title: title / N, zeroWins: firstOut / N, matches: matches / N, wins: wins / N,
    coins: coins / N, coinsPerStamina: coins / N / STAMINA_COST.cup,
    packs: Object.fromEntries(Object.entries(packs).map(([k, n]) => [k, +(n / N).toFixed(3)])),
  }
  out[f.name] = row
  console.log(`${f.name.padEnd(12)} 分 ${String(rating).padStart(3)}  冠军 ${(100 * row.title).toFixed(1)}%  一场没赢 ${(100 * row.zeroWins).toFixed(1)}%  场次 ${row.matches.toFixed(2)}  胜场 ${row.wins.toFixed(2)}  金币/届 ${row.coins.toFixed(0)}  包 ${JSON.stringify(row.packs)}`)
}
if (OUT) writeFileSync(OUT, JSON.stringify({ cups: N, rows: out }, null, 1))
