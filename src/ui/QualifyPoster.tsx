import { Crest } from './common'
import type { Qualified } from '../engine/qualify'

/**
 * The poster for a booked place at an international.
 *
 * Qualifying used to be one agenda line. It is the moment the season is
 * built around, and the sport marks it the way a broadcast does: the crest
 * large, the event and its city, one line on how. A card to be dismissed,
 * not a modal to be worked through — nothing on it is a decision.
 */
export default function QualifyPoster({
  q, club, tag, onClose,
}: { q: Qualified; club: string; tag: string; onClose: () => void }) {
  return (
    <div className="poster-bg" role="dialog" aria-label={`${club} 晋级 ${q.name}`} onClick={onClose}>
      <div className="poster" onClick={(e) => e.stopPropagation()}>
        <div className="poster-band" aria-hidden="true" />
        <div className="poster-eyebrow display">Qualified · {q.year}</div>
        <div className="poster-crest"><Crest id={q.teamId} size={128} /></div>
        <div className="poster-club">{club} <span className="poster-tag">{tag}</span></div>
        <h2 className="poster-title">确认晋级 {q.name}</h2>
        <div className="poster-city display">{q.city}</div>
        <p className="poster-how">{q.how}</p>
        <button className="primary" onClick={onClose}>收下</button>
      </div>
    </div>
  )
}
