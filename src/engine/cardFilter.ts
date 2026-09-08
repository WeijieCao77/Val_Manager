/**
 * The four ways people look for a card — metal, region, position, club — and
 * the search box, as a plain predicate over a Card.
 *
 * It lives in the engine rather than beside the filter bar because the SERVER
 * runs it now. The trading post pages its shelf, so a filter has to be applied
 * BEFORE the page is cut: filtering whatever one page happened to contain is
 * how 「筛选了金卡只有三张」 happens on a market with fourteen hundred cards on
 * it. Two copies of the rule, one per side of the wire, is how the two come to
 * disagree about what matches — so there is one copy and both import it.
 *
 * The position menu also has 指挥 (IGL): not a position in the data — an IGL is
 * a controller or a sentinel who also calls — but the one thing after position
 * that people look for a card by.
 */
import { isPlayerCard } from './cards'
import type { Card, Rarity } from './cards'
import type { Series } from './gacha'
import type { Role } from './types'

export interface CardFilter {
  rarity: 'all' | Rarity | 'coach'
  region: 'all' | Series
  /** a position, or 'igl' — the callers, whatever position they play */
  role: 'all' | Role | 'igl'
  club: 'all' | string
}

export const EMPTY_FILTER: CardFilter = { rarity: 'all', region: 'all', role: 'all', club: 'all' }

export const filterActive = (f: CardFilter): boolean =>
  f.rarity !== 'all' || f.region !== 'all' || f.role !== 'all' || f.club !== 'all'

export function matchesFilter(card: Card, f: CardFilter): boolean {
  if (f.rarity === 'coach') { if (card.kind !== 'coach') return false }
  else if (f.rarity !== 'all' && card.rarity !== f.rarity) return false
  if (f.region !== 'all' && card.region !== f.region) return false
  // a coach has no position; asking for one leaves coaches out
  if (f.role === 'igl') { if (!(isPlayerCard(card) && card.isIgl)) return false }
  else if (f.role !== 'all' && !(isPlayerCard(card) && card.roles.includes(f.role))) return false
  if (f.club !== 'all' && (card.clubTag ?? '') !== f.club) return false
  return true
}

/** The search box rule: handle or club tag contains the text. */
export const matchesQuery = (c: Card, q: string): boolean => {
  const s = q.trim().toLowerCase()
  if (!s) return true
  const name = isPlayerCard(c) ? c.ign : c.name
  return name.toLowerCase().includes(s) || (c.clubTag ?? '').toLowerCase().includes(s)
}

/**
 * Read a filter off whatever came over the wire — the server's side, where
 * every field is a stranger. Anything it does not recognise is 'all', so a
 * malformed request browses instead of erroring.
 */
export function readFilter(b: Record<string, unknown> | null | undefined): CardFilter {
  const s = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 40) : 'all')
  return {
    rarity: s(b?.rarity) as CardFilter['rarity'],
    region: s(b?.region) as CardFilter['region'],
    role: s(b?.role) as CardFilter['role'],
    club: s(b?.club) as CardFilter['club'],
  }
}
