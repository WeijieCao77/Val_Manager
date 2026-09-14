/**
 * What levelling does to the cup, run through the whole cup.
 *
 *   npx tsx scripts/measure_cup_growth.ts [cups per cell] [out.json]
 *
 * A measurement, not a check. The growth fix (2026-09-13) changes how much a
 * level is worth in a match, and the cup draws its bracket from the squad's
 * own paper rating, which also moves with levels — so a win rate read off
 * PvP cannot say what the cup pays. Three fives, each at +0 and +5, twice:
 *
 *   fixed bracket — brackets drawn at +0, the same paths played at +0 and +5
 *                   with the same seeds: the pure fighting change
 *   full flow     — entered and drawn at each level as a player would: what
 *                   the cup actually pays, by bracket depth
 *
 * Run once on the old engine and once on the new, and compare the files.
 */
import { writeFileSync } from 'node:fs'
import {
  newGacha, openPack, autoSquad, enterCup, recordCup, cupOpponent, cupBo, levelOf,
  STAMINA_MAX, STAMINA_COST,
} from '../src/engine/gacha'
import type { GachaState, PackKind } from '../src/engine/gacha'
import { ALL_CARDS, isPlayerCard, MAX_LEVEL, squadRating } from '../src/engine/cards'
import { playCupMatch } from '../src/engine/arena'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}
;(globalThis as never as { fetch: unknown }).fetch = undefined

const N = Number(process.argv[2] ?? 300)
const OUT = process.argv[3] ?? 'analysis/cup_growth.json'
const now = Date.parse('2026-09-13T01:00:00Z')

function own(g: GachaState, ids: string[]) {
  for (const id of ids) g.cards[id] = { id, level: 0, dupes: 0, seen: 1 } as GachaState['cards'][string]
}
/** three fives: what a fortnight of packs gives, a pack-opener's best golds, and the top 彩卡 */
function fixtures(): { name: string; g: GachaState }[] {
  const packs = newGacha('VM-CUPG-CUPG-CUPG-CUPG-CUPG', '杯赛成长', '2026-09-01')
  packs.packs.ten = 4
  for (let i = 0; i < 4; i++) openPack(packs, 'ten' as PackKind, 'pack')
  packs.squad = autoSquad(packs)

  const players = ALL_CARDS.filter(isPlayerCard).filter((c) => !c.event && c.rarity !== 'mythic')
  const golds = newGacha('VM-CUPG-CUPG-CUPG-CUPG-CUPH', '杯赛成长', '2026-09-01')
  own(golds, players.filter((c) => c.rarity === 'gold').map((c) => c.id))
  golds.squad = autoSquad(golds)

  const mythic = newGacha('VM-CUPG-CUPG-CUPG-CUPG-CUPI', '杯赛成长', '2026-09-01')
  own(mythic, ALL_CARDS.filter((c) => c.rarity === 'mythic').map((c) => c.id))
  mythic.squad = autoSquad(mythic)
  return [{ name: '四个十连的五人', g: packs }, { name: '最好的金卡五人', g: golds }, { name: '彩卡五人', g: mythic }]
}

const setLevel = (g: GachaState, level: number) => { for (const o of Object.values(g.cards)) o.level = level }
const packsOf = (g: GachaState) => ({ ...g.packs })
const diffPacks = (a: Record<string, number>, b: Record<string, number>) => {
  const d: Record<string, number> = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const n = (b[k] ?? 0) - (a[k] ?? 0)
    if (n) d[k] = n
  }
  return d
}

interface CupRun { rounds: number; reached: number; won: boolean; coins: number; packs: Record<string, number> }

function playCup(g: GachaState, seed: number): CupRun {
  const cup = g.cup!
  const coins0 = g.coins
  const packs0 = packsOf(g)
  const level = (id: string) => levelOf(g, id)
  let k = 0
  while (g.cup && !g.cup.done) {
    const opp = cupOpponent(g)!
    const res = playCupMatch(g.squad, level, opp, cupBo(g.cup), (seed * 31 + k++) >>> 0)
    recordCup(g, { opponent: opp, win: res.win, mapsWon: res.mapsWon, mapsLost: res.mapsLost })
  }
  return { rounds: cup.path.length, reached: cup.round, won: cup.won, coins: g.coins - coins0, packs: diffPacks(packs0, packsOf(g)) }
}

function fullFlow(g: GachaState, level: number): CupRun[] {
  setLevel(g, level)
  const runs: CupRun[] = []
  for (let i = 0; i < N; i++) {
    g.cup = null
    g.daily.stamina = STAMINA_MAX
    g.daily.staminaAt = now
    enterCup(g, squadRating(g.squad, (id) => levelOf(g, id)), now)
    runs.push(playCup(g, 1000 + i))
  }
  return runs
}

function fixedBracket(g: GachaState, level: number, paths: string[][]): { legWins: number[]; legPlayed: number[]; won: number } {
  setLevel(g, level)
  const legWins = [0, 0, 0, 0, 0]
  const legPlayed = [0, 0, 0, 0, 0]
  let won = 0
  paths.forEach((path, i) => {
    g.cup = { path: path.slice(), round: 0, legs: [], done: false, won: false, entry: 0 }
    const level = (id: string) => levelOf(g, id)
    let k = 0
    while (g.cup && !g.cup.done) {
      const r = g.cup.round
      const opp = cupOpponent(g)!
      const res = playCupMatch(g.squad, level, opp, cupBo(g.cup), ((5000 + i) * 31 + k++) >>> 0)
      legPlayed[r]++
      if (res.win) legWins[r]++
      recordCup(g, { opponent: opp, win: res.win, mapsWon: res.mapsWon, mapsLost: res.mapsLost })
    }
    if (g.cup!.won) won++
  })
  return { legWins, legPlayed, won }
}

const summary = (runs: CupRun[]) => {
  const by: Record<number, { cups: number; won: number; coins: number; packs: Record<string, number> }> = {}
  for (const r of runs) {
    const b = (by[r.rounds] ??= { cups: 0, won: 0, coins: 0, packs: {} })
    b.cups++
    if (r.won) b.won++
    b.coins += r.coins
    for (const [k, n] of Object.entries(r.packs)) b.packs[k] = (b.packs[k] ?? 0) + n
  }
  return Object.fromEntries(Object.entries(by).map(([rounds, b]) => [rounds, {
    cups: b.cups,
    champion: b.won / b.cups,
    coinsPerEntry: b.coins / b.cups,
    coinsPerStamina: b.coins / b.cups / STAMINA_COST.cup,
    packsPerEntry: Object.fromEntries(Object.entries(b.packs).map(([k, n]) => [k, n / b.cups])),
  }]))
}

const out: Record<string, unknown> = { cupsPerCell: N, squads: {} }
for (const { name, g } of fixtures()) {
  const paper = { 0: squadRating(g.squad, () => 0), 5: squadRating(g.squad, () => MAX_LEVEL) }
  // brackets a +0 five is dealt, kept for the fixed comparison
  setLevel(g, 0)
  const paths: string[][] = []
  for (let i = 0; i < N; i++) {
    g.cup = null
    g.daily.stamina = STAMINA_MAX
    g.daily.staminaAt = now
    paths.push(enterCup(g, paper[0], now).path.slice())
  }
  const fixed = { 0: fixedBracket(g, 0, paths), 5: fixedBracket(g, MAX_LEVEL, paths) }
  const flow = { 0: summary(fullFlow(g, 0)), 5: summary(fullFlow(g, MAX_LEVEL)) }
  ;(out.squads as Record<string, unknown>)[name] = { paper, fixed, flow }

  console.log(`\n== ${name}  阵容分 +0: ${paper[0]}  +5: ${paper[5]}`)
  for (const lv of [0, 5] as const) {
    const f = fixed[lv]
    const legs = f.legPlayed.map((n, i) => n ? `第${i + 1}轮 ${(100 * f.legWins[i] / n).toFixed(0)}%` : '').filter(Boolean).join('  ')
    console.log(`  固定签表 +${lv}: 冠军 ${(100 * f.won / N).toFixed(1)}%   按轮胜率 ${legs}`)
  }
  for (const lv of [0, 5] as const) {
    for (const [rounds, s] of Object.entries(flow[lv])) {
      const packs = Object.entries(s.packsPerEntry).map(([k, n]) => `${k} ${n.toFixed(2)}`).join(' ')
      console.log(`  完整流程 +${lv} ${rounds} 轮: ${s.cups} 届 冠军 ${(100 * s.champion).toFixed(1)}%  金币/届 ${s.coinsPerEntry.toFixed(0)}  金币/体力 ${s.coinsPerStamina.toFixed(0)}  包/届 ${packs}`)
    }
  }
}
writeFileSync(OUT, JSON.stringify(out, null, 1))
console.log(`\n→ ${OUT}`)
