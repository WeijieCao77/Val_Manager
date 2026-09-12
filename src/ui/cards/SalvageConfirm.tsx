import { RARITY_CN, cardById, cardName, isPlayerCard } from '../../engine/cards'

/** One card about to be sold, however many spares of it. */
export interface SalvageAsk {
  lines: { cardId: string; count: number; coins: number }[]
  onConfirm: () => void
}

/**
 * 「确认分解以下卡片」 — the list, then the button.
 *
 * Every way of selling spares used to go through either a bare confirm()
 * with a count in it, or nothing at all: the card page's 全部分解 and the
 * reveal's 分解重复卡 sold on the first tap. A count is not a list — the
 * thing people want to see before they press is WHICH cards are going,
 * and the WeChat and Xiaohongshu webviews this audience lives in can
 * refuse a confirm() outright (see the ID gate in CardMode.tsx), which
 * left the button dead. So: one in-page sheet for all three, naming every
 * card, its metal, how many spares go and what they pay.
 *
 * Sits above the reveal (.pack-stage is z-index 60, an ordinary modal 50).
 */
export default function SalvageConfirm({
  ask, busy, onClose,
}: {
  ask: SalvageAsk
  busy: boolean
  onClose: () => void
}) {
  const rows = ask.lines
    .map((l) => ({ ...l, card: cardById(l.cardId) }))
    .filter((l) => l.card && l.count > 0)
  const total = rows.reduce((n, l) => n + l.count, 0)
  const coins = rows.reduce((n, l) => n + l.coins, 0)
  return (
    <div className="modal-bg" style={{ zIndex: 70 }} onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>确认分解以下卡片</h2>
          <div className="spacer" />
          <button className="ghost sm" onClick={onClose}>关闭</button>
        </div>
        <div className="modal-body">
          <p className="tiny faint" style={{ marginTop: 0 }}>
            只分解重复的那几张，收藏里的卡和等级都不动。分解了就换不回来。
          </p>
          <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table>
              <tbody>
                {rows.map((l) => {
                  const c = l.card!
                  return (
                    <tr key={l.cardId}>
                      <td><span className={`tag r-${c.rarity}`}>{RARITY_CN[c.rarity]}</span></td>
                      <td>
                        <b>{cardName(c)}</b>
                        {isPlayerCard(c) && c.legend
                          ? <span className="tiny muted"> {c.legend.title}</span>
                          : c.clubTag ? <span className="tiny muted"> {c.clubTag}</span> : null}
                      </td>
                      <td className="right mono">×{l.count}</td>
                      <td className="right mono">+{l.coins.toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'center' }}>
            <span className="small">共 {total} 张，+{coins.toLocaleString()} 金币</span>
            <div className="spacer" />
            <button className="sm" onClick={onClose} disabled={busy}>取消</button>
            <button className="primary sm" onClick={ask.onConfirm} disabled={busy || !total}>
              {busy ? '分解中…' : '确认分解'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
