import type { PlayerCard } from '../../engine/cards'
import type { CardFaceProps } from '../Card'
import './egg.css'

/**
 * 彩蛋卡: the card's own art (engine/eggCards.ts) on the 480×672 (5:7) canvas
 * the 余晖 and 曼谷 faces use. The art already carries the name and the joke;
 * the face adds what every card shows — the rating, positions, level, spares.
 */
export function EggFace({ card, level = 0, evolved = false, dupes = 0, selected, dimmed, onClick, footer }: CardFaceProps & { card: PlayerCard; evolved?: boolean }) {
  const egg = card.egg!
  const roles = card.roles.length > 1 ? `${card.roles.slice(0, 2).map((r) => r.slice(0, 2)).join('/')}${card.roles.length > 2 ? '+' : ''}` : card.role
  return <div className={`egg-face${selected ? ' sel' : ''}${dimmed ? ' dim' : ''}${onClick ? ' tap' : ''}`}
    onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
    onKeyDown={(ev) => { if (onClick && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onClick() } }}
    title={`${card.ign} · ${egg.title} · 彩蛋卡 · 游戏能力 ${card.rating}${level > 0 ? `（+${level}）` : ''}`}>
    <article className="egg-card" aria-label={`${card.ign} 彩蛋卡 ${egg.title} ${card.rating}`}>
      <img className="egg-art" src={egg.art} alt="" draggable={false} />
      <div className="egg-rating">
        <b>{card.rating}</b>
        <span>{roles}{level > 0 ? ` +${level}` : ''}{evolved ? ' 进修' : ''}</span>
      </div>
    </article>
    {footer && <span className="egg-footer">{footer}</span>}
    {dupes > 0 && <span className="egg-dupes">×{dupes + 1}</span>}
  </div>
}
