/**
 * What the packs actually pay, worked out from the packs themselves.
 *
 * The numbers in PACKS are per-draw base rates and three separate mechanics
 * move them: gold odds climb from the 25th dry pull and are certain on the
 * 45th, 彩卡 has a hard floor, and 选拔包/十连包 upgrade their best card when it
 * comes in under the promise. Published rates that ignore any of that are
 * wrong — 试训包's 彩卡 rate is several times its `mythic` constant, because at
 * one draw a pack the floor pays far more often than the roll does.
 *
 * So this does not restate anything. It opens real packs with the real
 * `openPack` and counts what falls out. A disclosure page built on a table
 * typed by hand is a table that goes stale the first time somebody tunes a
 * number, and this game has already shipped one bug of exactly that shape.
 *
 * ~160ms for 30,000 packs of each kind, which is a page that thinks for a
 * moment rather than a build step somebody has to remember to re-run.
 */
import { PACKS, PACK_ORDER, newGacha, openPack } from './gacha'
import type { PackKind } from './gacha'
import type { Rarity } from './cards'

export interface PackOdds {
  kind: PackKind
  name: string
  cost: number
  draws: number
  /** buyable in the shop, as opposed to earned */
  shop: boolean
  /** share of all cards from this pack, by metal */
  perCard: Record<Rarity, number>
  /** chance that one pack contains at least one of that metal */
  perPack: Record<Rarity, number>
  /** what the constants say, before pity and floors */
  base: { mythic: number; gold: number; silver: number; bronze: number }
}

/** How many packs of each kind to open. Enough that the third digit is stable. */
const TRIALS = 30_000

const zero = (): Record<Rarity, number> => ({ mythic: 0, gold: 0, silver: 0, bronze: 0 })

/**
 * Open a lot of packs and report what came out.
 *
 * Every kind gets a fresh account, because pity and the 彩卡 floor are
 * per-account: measuring them on one shared state would let one pack's dry run
 * pay out inside another's.
 */
export function measureOdds(trials = TRIALS): PackOdds[] {
  const out: PackOdds[] = []
  for (const kind of PACK_ORDER) {
    const def = PACKS[kind]
    const g = newGacha('ODDS', '概率', '2026-01-01')
    g.coins = Number.MAX_SAFE_INTEGER
    const cards = zero()
    const packs = zero()
    let total = 0
    for (let i = 0; i < trials; i++) {
      g.packs[kind] = 1
      const pulled = openPack(g, kind, 'pack')
      const seen = new Set<Rarity>()
      for (const p of pulled) {
        const r = p.card.rarity as Rarity
        cards[r]++
        total++
        seen.add(r)
      }
      for (const r of seen) packs[r]++
    }
    const perCard = zero()
    const perPack = zero()
    for (const r of Object.keys(cards) as Rarity[]) {
      perCard[r] = total ? cards[r] / total : 0
      perPack[r] = packs[r] / trials
    }
    out.push({
      kind, name: def.name, cost: def.cost, draws: def.draws,
      shop: def.shop !== false,
      perCard, perPack,
      base: {
        mythic: def.mythic, gold: def.gold, silver: def.silver,
        bronze: Math.max(0, 1 - def.mythic - def.gold - def.silver),
      },
    })
  }
  return out
}
