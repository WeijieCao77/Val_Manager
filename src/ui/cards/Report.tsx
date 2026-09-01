import CardFace from '../Card'
import { cardById } from '../../engine/cards'
import { WORLD_TEAMS } from '../../engine/world'
import type { ArenaResult } from '../../engine/arena'

/** The scoreboard after a card match: maps, then who actually did the work. */
export default function MatchReport({
  result, opponentId, opponentName, level, onClose, extra,
}: {
  result: ArenaResult
  opponentId: string
  /** when the opponent is a person rather than a club — 真人卡组 and 好友房 */
  opponentName?: string
  level: (id: string) => number
  onClose: () => void
  extra?: React.ReactNode
}) {
  const opp = WORLD_TEAMS.find((t) => t.id === opponentId)
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            {result.win ? '赢了' : '输了'} · {result.mapsWon}–{result.mapsLost} vs{' '}
            {opponentName ?? opp?.tag ?? '?'}
          </h2>
          <div className="spacer" />
          <button className="ghost sm" onClick={onClose}>关闭</button>
        </div>
        <div className="modal-body">
          {extra}
          <div className="row wrap" style={{ gap: 6, margin: '4px 0 14px' }}>
            {result.result.maps.map((m, i) => (
              <span
                key={i}
                className="chiplet"
                style={{ color: m.scoreA > m.scoreB ? 'var(--win)' : 'var(--loss)' }}
              >
                {m.map} {m.scoreA}–{m.scoreB}
              </span>
            ))}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>选手</th><th className="right">K</th><th className="right">D</th>
                  <th className="right">A</th><th className="right">ACS</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((l) => {
                  const card = cardById(l.cardId)
                  if (!card) return null
                  return (
                    <tr key={l.cardId} className={l.cardId === result.mvpCard ? 'me' : ''}>
                      <td>
                        {card.kind === 'player' ? card.ign : card.name}
                        {l.cardId === result.mvpCard && <span className="tag t1" style={{ marginLeft: 6 }}>MVP</span>}
                      </td>
                      <td className="right mono">{l.kills}</td>
                      <td className="right mono">{l.deaths}</td>
                      <td className="right mono">{l.assists}</td>
                      <td className="right mono">{l.acs}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {result.mvpCard && cardById(result.mvpCard) && (
            <div className="row" style={{ marginTop: 14, gap: 12, alignItems: 'center' }}>
              <CardFace card={cardById(result.mvpCard)!} level={level(result.mvpCard)} size="sm" footer="全场最佳" />
              {!!result.result.highlights.length && (
                <ul className="tiny muted" style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
                  {result.result.highlights.slice(0, 4).map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
