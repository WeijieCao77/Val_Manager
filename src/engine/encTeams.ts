/**
 * 国家队杯 (ENC) opponents: one national side for every country with five real players in the game.
 *
 * Nobody is invented. A national team is the strongest five the card pool holds for that country — the
 * same ordinary, unlevelled cards and the same paper score a club in the club cup is seated by — with the
 * country's best-rated coach on the bench when it has one. tw/hk/mo play for 中国, as chemistry already
 * counts them (natCountry). Built on first use and cached: it is a search, and most requests never ask.
 */
import { BASE_PLAYER_CARDS, COACH_CARDS, SQUAD_SLOTS, squadPaper, squadRating } from './cards'
import type { Squad } from './cards'
import { natCountry, natName } from './nat'

export interface EncTeam { id: string; nat: string; name: string; tag: string; squad: Squad; rating: number }

/** how deep into a country's cards the search looks: its best eight, every five of them, every seating */
const DEPTH = 8
export const ENC_PREFIX = 'enc-'

let built: EncTeam[] | null = null

function build(): EncTeam[] {
  const byNat = new Map<string, typeof BASE_PLAYER_CARDS>()
  for (const c of BASE_PLAYER_CARDS) {
    const nat = natCountry(c.nat)
    if (!nat) continue
    const list = byNat.get(nat) ?? []
    list.push(c)
    byNat.set(nat, list)
  }
  const teams: EncTeam[] = []
  for (const [nat, all] of [...byNat].sort(([a], [b]) => a.localeCompare(b))) {
    // one card a person (the base pool is), best first
    const seen = new Set<string>()
    const pool = all.slice().sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))
      .filter((c) => (seen.has(c.playerId) ? false : (seen.add(c.playerId), true)))
      .slice(0, DEPTH)
    if (pool.length < SQUAD_SLOTS.length) continue
    const coach = COACH_CARDS.filter((c) => !c.legend && natCountry(c.nat) === nat)
      .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))[0]?.id ?? null
    let best: Squad | null = null
    let bestScore = -Infinity
    const slots: string[] = []
    const used = new Set<number>()
    const visit = () => {
      if (slots.length === SQUAD_SLOTS.length) {
        const candidate = { slots: [...slots], coach }
        const score = squadPaper(candidate).score
        if (score > bestScore) { best = candidate; bestScore = score }
        return
      }
      for (let i = 0; i < pool.length; i++) {
        if (used.has(i)) continue
        used.add(i); slots.push(pool[i].id)
        visit()
        slots.pop(); used.delete(i)
      }
    }
    visit()
    if (!best) continue
    const name = natName(nat)
    teams.push({ id: `${ENC_PREFIX}${nat}`, nat, name: `${name}国家队`, tag: nat.toUpperCase(), squad: best, rating: squadRating(best) })
  }
  return teams
}

export const encTeams = (): EncTeam[] => (built ??= build())
export const encTeam = (id: string): EncTeam | undefined =>
  id.startsWith(ENC_PREFIX) ? encTeams().find((t) => t.id === id) : undefined
