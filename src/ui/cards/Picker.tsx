/**
 * A menu for choosing one card out of a pile, with the pile filtered first.
 *
 * A hundred-line <select> is not a way to find a card. Wherever a screen
 * asks 「选一张卡」 — listing one on the market, offering one to a friend,
 * asking for one of theirs — the same bar sits above the menu: metal,
 * region, position, club, and a search box for the handle. The filter is
 * the picker's own, so the market's shelf can be filtered one way while the
 * card you are selling is found another.
 */
import { useState } from 'react'
import { CardFilters, EMPTY_FILTER, matchesFilter } from './Filters'
import type { CardFilter } from './Filters'
import { RARITY_CN, isPlayerCard } from '../../engine/cards'
import type { Card } from '../../engine/cards'

export interface PickRow {
  card: Card
  /** what the menu says after the name — 「多 1 张」, 「+2」, 「仅此一张」 */
  note?: string
}

const nameOf = (c: Card) => (isPlayerCard(c) ? c.ign : c.name)

/** The search box rule: handle or club tag contains the text. Shared with the shelf. */
export const matchesQuery = (c: Card, q: string): boolean => {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return nameOf(c).toLowerCase().includes(s) || (c.clubTag ?? '').toLowerCase().includes(s)
}

export function CardPicker({
  rows, value, onChange, placeholder, disabled,
}: {
  rows: PickRow[]
  value: string
  onChange: (id: string) => void
  placeholder: string
  disabled?: boolean
}) {
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER)
  const [q, setQ] = useState('')
  const shown = rows.filter((r) => matchesFilter(r.card, filter) && matchesQuery(r.card, q))
  // the card already chosen stays in the menu whatever the filter says, so
  // narrowing the list cannot silently un-choose it
  const chosen = value && !shown.some((r) => r.card.id === value) ? rows.find((r) => r.card.id === value) : undefined
  const list = chosen ? [chosen, ...shown] : shown
  const narrowed = list.length !== rows.length

  return (
    <div style={{ marginBottom: 8 }}>
      <CardFilters
        value={filter}
        onChange={setFilter}
        pool={rows.map((r) => r.card)}
        extra={
          <input
            className="sm"
            style={{ width: 150, padding: '4px 7px' }}
            placeholder="搜 ID / 战队"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={disabled}
          />
        }
      />
      <select style={{ width: '100%' }} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">
          {placeholder}（{list.length} 种{narrowed ? `，已筛选，共 ${rows.length}` : ''}）
        </option>
        {list.slice(0, 300).map(({ card, note }) => (
          <option key={card.id} value={card.id}>
            {RARITY_CN[card.rarity]} · {nameOf(card)} · {card.rating}
            {isPlayerCard(card) ? ` · ${card.roles[0]}` : ' · 教练'}
            {card.clubTag ? ` · ${card.clubTag}` : ''}
            {note ? ` · ${note}` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
