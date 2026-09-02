/**
 * One filter bar for every place a pile of cards is shown.
 *
 * Metal, region, position and club — the four ways people actually look
 * for a card. 「我要一个中国赛区的控场」 was three screens of scrolling on
 * the collection and impossible on the trading post, which had no filter at
 * all. The club list is built from the cards actually in the pile, so it
 * never offers a club with nothing behind it.
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
  role: 'all' | Role
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
  if (f.role !== 'all' && !(isPlayerCard(card) && card.roles.includes(f.role))) return false
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
  const set = (patch: Partial<CardFilter>) => onChange({ ...value, ...patch })
  const clubs = clubsIn(pool)
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
