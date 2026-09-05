/**
 * One filter bar for every place a pile of cards is shown.
 *
 * Metal, region, position and club — the four ways people actually look
 * for a card. 「我要一个中国赛区的控场」 was three screens of scrolling on
 * the collection and impossible on the trading post, which had no filter at
 * all. The club list is built from the cards that pass the other three
 * filters, so it never offers a club with nothing behind it: pick 中国 and
 * the club menu is the Chinese clubs, not all seventy-odd (it used to be
 * built from the whole pile, and 「选了 CN 赛区队伍还是全部」 came back from
 * the group). A club that falls out when the region or metal changes is
 * dropped rather than kept as 「XX（0）」.
 *
 * The position menu also has 指挥 (IGL): not a position in the data — an
 * IGL is a controller or a sentinel who also calls — but the one thing
 * after position that people look for a card by.
 */
import type { ReactNode } from 'react'
import { RARITY_CN, isPlayerCard } from '../../engine/cards'
import type { Card, Rarity } from '../../engine/cards'
import { SERIES } from '../../engine/gacha'
import type { Series } from '../../engine/gacha'
import { REGION_CN } from '../../engine/types'
import type { Role } from '../../engine/types'

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

const ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫']

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

/** The clubs present in a pile, busiest first, for the club menu. */
export function clubsIn(cards: Card[]): { tag: string; n: number }[] {
  const n = new Map<string, number>()
  for (const c of cards) if (c.clubTag) n.set(c.clubTag, (n.get(c.clubTag) ?? 0) + 1)
  return [...n].map(([tag, k]) => ({ tag, n: k }))
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag))
}

const METALS: { key: CardFilter['rarity']; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'mythic', label: RARITY_CN.mythic },
  { key: 'gold', label: RARITY_CN.gold },
  { key: 'silver', label: RARITY_CN.silver },
  { key: 'bronze', label: RARITY_CN.bronze },
  { key: 'coach', label: '教练' },
]

export function CardFilters({
  value, onChange, pool, extra,
}: {
  value: CardFilter
  onChange: (f: CardFilter) => void
  /** the cards the club menu is built from */
  pool: Card[]
  /** anything the screen wants beside the bar — a search box, a toggle */
  extra?: ReactNode
}) {
  // the club menu follows the other three: only clubs with a card that
  // passes metal, region and position, counted after those filters
  const clubs = clubsIn(pool.filter((c) => matchesFilter(c, { ...value, club: 'all' })))
  const set = (patch: Partial<CardFilter>) => {
    const next = { ...value, ...patch }
    // a chosen club that the new region or metal leaves nothing of is let go
    if (next.club !== 'all' && !pool.some((c) => c.clubTag === next.club && matchesFilter(c, { ...next, club: 'all' }))) {
      next.club = 'all'
    }
    onChange(next)
  }
  return (
    <div className="row wrap" style={{ gap: 8, marginBottom: 12, alignItems: 'center' }}>
      <div className="seg">
        {METALS.map((m) => (
          <button key={m.key} className={value.rarity === m.key ? 'on' : ''} onClick={() => set({ rarity: m.key })}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="seg">
        <button className={value.region === 'all' ? 'on' : ''} onClick={() => set({ region: 'all' })}>全部赛区</button>
        {SERIES.map((r) => (
          <button key={r} className={value.region === r ? 'on' : ''} onClick={() => set({ region: r })}>
            {REGION_CN[r]}
          </button>
        ))}
      </div>
      <select
        className="sm" style={{ width: 'auto', padding: '4px 7px' }}
        value={value.role} onChange={(e) => set({ role: e.target.value as CardFilter['role'] })}
      >
        <option value="all">全部位置</option>
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        <option value="igl">指挥（IGL）</option>
      </select>
      <select
        className="sm" style={{ width: 'auto', padding: '4px 7px', maxWidth: 170 }}
        value={value.club} onChange={(e) => set({ club: e.target.value })}
      >
        <option value="all">全部战队</option>
        {clubs.map((c) => <option key={c.tag} value={c.tag}>{c.tag}（{c.n}）</option>)}
        {value.club !== 'all' && !clubs.some((c) => c.tag === value.club) && (
          <option value={value.club}>{value.club}（0）</option>
        )}
      </select>
      {extra}
      {filterActive(value) && (
        <button className="sm ghost" onClick={() => onChange(EMPTY_FILTER)}>清除筛选</button>
      )}
    </div>
  )
}
