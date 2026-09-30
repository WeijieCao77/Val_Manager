import { useState } from 'react'
import { useDialogFocus } from './useDialogFocus'
import { MULTI_OPEN_MAX, PACKS } from '../../engine/gacha'
import type { PackKind } from '../../engine/gacha'

/**
 * 连开 — how many packs of one kind to open in one go, and from where.
 *
 * An in-page sheet rather than confirm(): the WeChat and Xiaohongshu webviews
 * can refuse a confirm() outright (see SalvageConfirm). It says exactly what
 * will be spent before anything is, and the server checks the whole run
 * before it opens the first pack (gacha.ts openPacks).
 */
export default function MultiOpenSheet({
  kind, own, coins, price, buyable, busy, onOpen, onClose,
}: {
  kind: PackKind
  own: number
  coins: number
  /** today's price of one, sales included */
  price: number
  /** the shop sells this kind today */
  buyable: boolean
  busy: boolean
  onOpen: (payWith: 'pack' | 'coins', count: number) => void
  onClose: () => void
}) {
  const dialogRef = useDialogFocus(() => { if (!busy) onClose() })
  const def = PACKS[kind]
  const maxFrom = (src: 'pack' | 'coins') =>
    Math.min(MULTI_OPEN_MAX, src === 'pack' ? own : buyable ? Math.floor(coins / price) : 0)
  const [src, setSrc] = useState<'pack' | 'coins'>(own >= 2 || !buyable ? 'pack' : 'coins')
  const max = maxFrom(src)
  const [n, setN] = useState(() => Math.max(1, maxFrom(own >= 2 || !buyable ? 'pack' : 'coins')))
  const count = Math.max(1, Math.min(n, max))
  const pick = (next: 'pack' | 'coins') => { setSrc(next); setN(maxFrom(next)) }
  const quick = [2, 5, MULTI_OPEN_MAX].filter((q) => q <= max)
  return (
    <div className="modal-bg" onClick={() => { if (!busy) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`连开${def.name}`} tabIndex={-1} className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>连开 · {def.name}</h2>
          <div className="spacer" />
          <button className="ghost sm" onClick={onClose} disabled={busy}>关闭</button>
        </div>
        <div className="modal-body">
          <p className="tiny faint" style={{ marginTop: 0 }}>一次最多 {MULTI_OPEN_MAX} 包，每包的出卡和保底跟一包一包开完全一样。</p>
          {own > 0 && buyable && (
            <div className="seg" style={{ marginBottom: 12 }}>
              <button className={src === 'pack' ? 'on' : ''} onClick={() => pick('pack')} disabled={busy}>用库存（{own}）</button>
              <button className={src === 'coins' ? 'on' : ''} onClick={() => pick('coins')} disabled={busy}>花金币（{price}/包）</button>
            </div>
          )}
          {max < 1 ? (
            <p className="small">{src === 'pack' ? '库存里没有这种卡包。' : `金币不够，一包要 ${price}。`}</p>
          ) : (
            <>
              <div className="row" style={{ gap: 8, alignItems: 'center', justifyContent: 'center' }}>
                <button className="sm" aria-label="少开一包" disabled={busy || count <= 1} onClick={() => setN(count - 1)}>−</button>
                <b style={{ fontSize: 28, minWidth: 48, textAlign: 'center' }} aria-live="polite">{count}</b>
                <button className="sm" aria-label="多开一包" disabled={busy || count >= max} onClick={() => setN(count + 1)}>＋</button>
              </div>
              {quick.length > 1 && (
                <div className="row" style={{ gap: 6, justifyContent: 'center', marginTop: 8 }}>
                  {quick.map((q) => <button key={q} className={`sm${q === count ? ' primary' : ''}`} disabled={busy} onClick={() => setN(q)}>{q} 包</button>)}
                </div>
              )}
              <p className="small" style={{ textAlign: 'center', margin: '12px 0 0' }}>
                共 {count * def.draws} 张 · {src === 'pack'
                  ? `用掉库存 ${count} 个，剩 ${own - count} 个`
                  : `花 ${(price * count).toLocaleString()} 金币，剩 ${(coins - price * count).toLocaleString()}`}
              </p>
            </>
          )}
          <div className="row" style={{ gap: 8, marginTop: 14, alignItems: 'center' }}>
            <div className="spacer" />
            <button className="sm" onClick={onClose} disabled={busy}>取消</button>
            <button className="primary sm" onClick={() => onOpen(src, count)} disabled={busy || max < 1}>
              {busy ? '开包中…' : `连开 ${count} 包`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
