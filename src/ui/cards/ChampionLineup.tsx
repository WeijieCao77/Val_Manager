import CardFace from '../Card'
import TeamBoard from './TeamBoard'
import { cardById } from '../../engine/cards'

/** A champion's five and coach, as the cup read them on the day, with the levels they had. */
export interface Lineup { slots: (string | null)[]; coach: string | null; levels: Record<string, number> }

/**
 * 夺冠阵容: the six cards that won a cup.
 *
 * `big` is the headline one (the latest champion), in the full-team frame when
 * all six share a club; the rest are a strip of small cards, one per past cup,
 * that scrolls sideways on a phone rather than stacking six rows deep.
 */
export default function ChampionLineup({ five, big = false }: { five: Lineup; big?: boolean }) {
  const ids = [...five.slots, five.coach].filter((id): id is string => !!id && !!cardById(id))
  if (!ids.length) return null
  const cards = (
    <div className={big ? 'champ-lineup' : 'champ-lineup-strip'}>
      {ids.map((id, i) => (
        <CardFace key={`${id}-${i}`} card={cardById(id)!} level={five.levels[id] ?? 0} size="sm" />
      ))}
    </div>
  )
  return big ? <TeamBoard squad={{ slots: five.slots, coach: five.coach }}>{cards}</TeamBoard> : cards
}
