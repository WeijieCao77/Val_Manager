import { useState } from 'react'
import { useDialogFocus } from './useDialogFocus'
import { MULTI_OPEN_MAX, PACKS } from '../../engine/gacha'
import type { PackKind } from '../../engine/gacha'

/**
 * 连开 — how many packs of one kind to open in one go.
 *
 * The stock goes first and coins buy whatever the stock is short of: six in
 * stock and ten asked for is six from the stock and four bought. Before any
 * coin is spent on a run that also uses the stock, the sheet stops and says
 * how many it will buy and what they cost.
 *
 * An in-page sheet rather than confirm(): the WeChat and Xiaohongshu webviews
 * can refuse a confirm() outright (see SalvageConfirm). The server checks the
 * whole run before it opens the first pack (gacha.ts openPacks).
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
  onOpen: (count: number) => void
  onClose: () => void
}) {
  const dialogRef = useDialogFocus(() => { if (!busy) onClose() })
  const def = PACKS[kind]
  const affordable = buyable ? Math.floor(coins / price) : 0
  const max = Math.min(MULTI_OPEN_MAX, own + affordable)
  // the whole stock when there are two to open, otherwise as many as the coins reach
  const [n, setN] = useState(() => Math.max(1, own >= 2 ? Math.min(own, MULTI_OPEN_MAX) : max))
  const [asking, setAsking] = useState(false)
  const count = Math.max(1, Math.min(n, max))
  const fromStock = Math.min(own, count)
  const bought = count - fromStock
  const cost = price * bought
  const quick = [...new Set([2, 5, own, MULTI_OPEN_MAX])].filter((q) => q >= 2 && q <= max).sort((a, b) => a - b)
  const go = () => { if (bought > 0 && own > 0) setAsking(true); else onOpen(count) }
  return (
    <div className="modal-bg" onClick={() => { if (!busy) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`连开${def.name}`} tabIndex={-1} className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>连开 · {def.name}</h2>
          <div className="spacer" />
          <button className="ghost sm" onClick={onClose} disabled={busy}>关闭</button>
        </div>
        {asking ? (
          <div className="modal-body">
            <p style={{ marginTop: 0 }}>
              库存只有 <b>{own}</b> 个{def.name}，另外 <b>{bought}</b> 包要花金币买。
            </p>
            <p className="small" style={{ margin: '8px 0 0' }}>
              {bought} × {price.toLocaleString()} = <b>{cost.toLocaleString()}</b> 金币，开完剩 {(coins - cost).toLocaleString()}。
            </p>
            <div className="row" style={{ gap: 8, marginTop: 14, alignItems: 'center' }}>
              <div className="spacer" />
              <button className="sm" onClick={() => setAsking(false)} disabled={busy}>返回</button>
              <button className="primary sm" onClick={() => onOpen(count)} disabled={busy}>
                {busy ? '开包中…' : `花 ${cost.toLocaleString()} 金币，连开 ${count} 包`}
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <p className="tiny faint" style={{ marginTop: 0 }}>
              一次最多 {MULTI_OPEN_MAX} 包，先用库存，不够的花金币买{buyable ? `（${price}/包）` : ''}。每包的出卡和保底跟一包一包开完全一样。
            </p>
            {max < 1 ? (
              <p className="small">{buyable ? `库存里没有这种卡包，金币也不够，一包要 ${price}。` : '库存里没有这种卡包。'}</p>
            ) : (
              <>
                <div className="row" style={{ gap: 8, alignItems: 'center', justifyContent: 'center' }}>
                  <button className="sm" aria-label="少开一包" disabled={busy || count <= 1} onClick={() => setN(count - 1)}>−</button>
                  <b style={{ fontSize: 28, minWidth: 48, textAlign: 'center' }} aria-live="polite">{count}</b>
                  <button className="sm" aria-label="多开一包" disabled={busy || count >= max} onClick={() => setN(count + 1)}>＋</button>
                </div>
                {quick.length > 1 && (
                  <div className="row wrap" style={{ gap: 6, justifyContent: 'center', marginTop: 8 }}>
                    {quick.map((q) => (
                      <button key={q} className={`sm${q === count ? ' primary' : ''}`} disabled={busy} onClick={() => setN(q)}>
                        {q === own ? `${q} 包（库存）` : `${q} 包`}
                      </button>
                    ))}
                  </div>
                )}
                <p className="small" style={{ textAlign: 'center', margin: '12px 0 0' }}>
                  共 {count * def.draws} 张
                  {fromStock > 0 && ` · 用库存 ${fromStock} 个，剩 ${own - fromStock} 个`}
                  {bought > 0 && ` · 买 ${bought} 包花 ${cost.toLocaleString()} 金币，剩 ${(coins - cost).toLocaleString()}`}
                </p>
              </>
            )}
            <div className="row" style={{ gap: 8, marginTop: 14, alignItems: 'center' }}>
              <div className="spacer" />
              <button className="sm" onClick={onClose} disabled={busy}>取消</button>
              <button className="primary sm" onClick={go} disabled={busy || max < 1}>
                {busy ? '开包中…' : `连开 ${count} 包`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
