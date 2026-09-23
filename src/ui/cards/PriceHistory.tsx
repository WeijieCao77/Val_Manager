import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { cardHistory } from '../../engine/market'
import type { CardHistory, Fail } from '../../engine/market'

const money = (n: number) => n.toLocaleString('en-US')

/**
 * 成交记录: what this card has gone for on the market, and — on a listing —
 * how many hands the copy has been through. Shown where a price is decided —
 * the bid box and the listing form — and on a card's own page.
 */
export default function PriceHistory({ cardId, level, listing, wide }: {
  cardId: string; level: number; listing?: string; wide?: boolean
}) {
  const [h, setH] = useState<CardHistory | null>(null)
  const [fail, setFail] = useState<Fail | null>(null)
  useEffect(() => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : undefined
    setH(null); setFail(null)
    void cardHistory(cardId, level, listing, ctl?.signal).then((r) => {
      if (r.data?.ok) setH(r.data)
      else if (r.fail !== 'aborted') setFail(r.fail ?? 'server')
    })
    return () => ctl?.abort()
  }, [cardId, level, listing])
  const box: CSSProperties = { marginTop: 6, lineHeight: 1.6, textAlign: 'left', ...(wide ? {} : { fontSize: 11 }) }
  if (fail) return <div className="tiny faint" style={box}>成交记录没读到</div>
  if (!h) return <div className="tiny faint" style={box}>成交记录…</div>
  if (!h.sold) {
    return <div className="tiny faint" style={box}>还没有成交记录{h.hands ? ' · 第 1 手' : ''}</div>
  }
  const lv = h.level && h.level.sold > 0 && h.level.sold < h.sold ? h.level : null
  return (
    <div className="tiny faint" style={box} data-key="price-history">
      <div>成交 <b>{h.sold}</b> 次 · 均价 <b>{money(h.avg ?? 0)}</b></div>
      {lv && <div>+{lv.level} 均价 <b>{money(lv.avg ?? 0)}</b>（{lv.sold} 次）</div>}
      {h.week.sold > 0 && <div>近 7 天均价 <b>{money(h.week.avg ?? 0)}</b>（{h.week.sold} 次）</div>}
      <div>最近 {h.recent.slice(0, wide ? 8 : 3).map((r) => money(r.price) + (r.level ? `(+${r.level})` : '')).join(' · ')}</div>
      {h.hands && (
        <div>
          这张是<b>第 {h.hands.count} 手</b>
          {h.hands.trail.length > 0 && <> · 上一手 {money(h.hands.trail[0].price)}</>}
        </div>
      )}
    </div>
  )
}
