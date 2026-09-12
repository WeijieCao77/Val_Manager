import CardFace from '../Card'
import { cardById, isPlayerCard } from '../../engine/cards'
import { WORLD_TEAMS } from '../../engine/teams'
import { ATTR_CN } from '../../engine/types'
import type { Attrs, Role } from '../../engine/types'
import type { ArenaLine, ArenaResult } from '../../engine/arena'
import type { PlayerCard, Squad } from '../../engine/cards'

/**
 * The scoreboard after a card match.
 *
 * When the opponent was another player's five, this is the only screen that
 * ever shows you what they were holding — so it shows both sides: the ten
 * cards, both coaches, both scoreboards, and how each map actually went. A
 * club opponent has no cards to lay out, so that half is simply absent rather
 * than faked.
 */
export default function MatchReport({
  result, opponentId, opponentName, mySquad, mineTitle, level, onClose, extra,
}: {
  result: ArenaResult
  opponentId: string
  /** when the opponent is a person rather than a club — 真人卡组 and 好友房 */
  opponentName?: string
  /** the five that played, so the report can lay it out beside theirs */
  mySquad?: Squad
  /** what to call that five when it is not the player's own — 首尔征途 plays 2024's */
  mineTitle?: string
  level: (id: string) => number
  onClose: () => void
  extra?: React.ReactNode
}) {
  const opp = WORLD_TEAMS.find((t) => t.id === opponentId)
  const them = result.opp
  const theirLevel = (id: string) => them?.levels[id] ?? 0

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: them ? 860 : 700 }} onClick={(e) => e.stopPropagation()}>
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

          <MapStrip result={result} />

          {them ? (
            <>
              <SquadRow
                title={mineTitle ?? '我的卡组'}
                slots={mySquad?.slots ?? result.lines.map((l) => l.cardId)}
                coach={mySquad?.coach ?? null}
                level={level}
                mvp={result.mvpCard}
                won={result.win}
              />
              <SquadRow
                title={`${them.name} ${them.tag}`}
                slots={them.slots}
                coach={them.coach}
                level={theirLevel}
                mvp={them.mvpCard}
                won={!result.win}
              />
              <div className="grid c2" style={{ alignItems: 'start', marginTop: 4 }}>
                <Board title="我方数据" lines={result.lines} mvp={result.mvpCard} level={level} />
                <Board title="对方数据" lines={them.lines} mvp={them.mvpCard} level={theirLevel} />
              </div>
            </>
          ) : (
            <Board title="" lines={result.lines} mvp={result.mvpCard} level={level} />
          )}

          {!!result.result.highlights.length && (
            <ul className="tiny muted" style={{ margin: '14px 0 0', paddingLeft: 16, lineHeight: 1.9 }}>
              {result.result.highlights.slice(0, 5).map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Every map, and how it was actually won.
 *
 * The score alone does not say whether 13–9 was a walk or a comeback. The
 * engine keeps the round log, so the bar under each map is the real thing: one
 * tick per round in the order they were played, coloured by who took it, with
 * a gap where the sides swapped and a brighter tick for a round won on an eco.
 */
function MapStrip({ result }: { result: ArenaResult }) {
  return (
    <div className="row wrap" style={{ gap: 10, margin: '4px 0 14px', alignItems: 'flex-start' }}>
      {result.result.maps.map((m, i) => {
        const mine = m.scoreA > m.scoreB
        return (
          <div key={i} style={{ minWidth: 148 }}>
            <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
              <b style={{ fontSize: 13 }}>{m.map}</b>
              <span className="mono" style={{ color: mine ? 'var(--win)' : 'var(--loss)', fontWeight: 800 }}>
                {m.scoreA}–{m.scoreB}
              </span>
            </div>
            {m.rounds?.length ? (
              <div className="rd-strip" title="每一格是一个回合，左边是上半场">
                {m.rounds.map((r) => (
                  <i
                    key={r.n}
                    className={r.winner === 'A' ? 'a' : 'b'}
                    // an eco round won is the one that turns a map, so it is
                    // worth being able to see one
                    data-buy={(r.winner === 'A' ? r.buyA : r.buyB) === 'eco' ? 'eco' : undefined}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** Five cards and a coach, laid out the way the squad screen lays them out. */
function SquadRow({
  title, slots, coach, level, mvp, won,
}: {
  title: string
  slots: (string | null)[]
  coach: string | null
  level: (id: string) => number
  mvp: string | null
  won: boolean
}) {
  const ids = [...slots.filter((x): x is string => !!x)]
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 8, alignItems: 'baseline', marginBottom: 6 }}>
        <b style={{ fontSize: 13 }}>{title}</b>
        <span className={`tag ${won ? 't1' : ''}`}>{won ? '胜' : '负'}</span>
      </div>
      <div className="report-cards">
        {ids.map((id) => {
          const card = cardById(id)
          if (!card) return null
          return (
            <CardFace
              key={id}
              card={card}
              level={level(id)}
              footer={id === mvp ? '全场最佳' : undefined}
              selected={id === mvp}
            />
          )
        })}
        {coach && cardById(coach) && (
          <CardFace card={cardById(coach)!} level={level(coach)} footer="教练" />
        )}
      </div>
    </div>
  )
}

/**
 * The one stat each position is on the server for, and the number on the
 * card that drives it.
 *
 * The group asked how anyone is supposed to see what a card's numbers do in
 * a match. Not with a breakdown — this is a light game, and a list of ± terms
 * is a homework sheet nobody can practise for — but by putting the stat a
 * duelist is judged on next to the number that earns it: first kills beside
 * 枪法, assists beside 道具, survival beside 意识, clutches beside 残局. Read
 * off the card's own position, not the seat it sits in, so a man in the
 * 自由人 seat is still judged as what he is.
 */
const SPOT: Record<Exclude<Role, '自由人'>, { label: string; attr: keyof Attrs; stat: (l: ArenaLine) => string }> = {
  决斗者: { label: '首杀', attr: 'aim', stat: (l) => (l.firstKills == null ? '–' : String(l.firstKills)) },
  先锋: { label: '助攻', attr: 'utility', stat: (l) => String(l.assists) },
  控场: {
    label: '存活', attr: 'awareness',
    stat: (l) => (l.rounds ? `${Math.round(100 * (1 - l.deaths / l.rounds))}%` : '–'),
  },
  哨卫: { label: '残局', attr: 'clutch', stat: (l) => (l.clutches == null ? '–' : String(l.clutches)) },
}

/** A flex player is judged on whichever of the four he is best at. */
function spotFor(card: PlayerCard) {
  if (card.role !== '自由人') return SPOT[card.role]
  const best = (Object.keys(SPOT) as (keyof typeof SPOT)[])
    .sort((a, b) => card.attrs[SPOT[b].attr] - card.attrs[SPOT[a].attr])[0]
  return SPOT[best]
}

function Board({ title, lines, mvp, level }: {
  title: string; lines: ArenaLine[]; mvp: string | null; level: (id: string) => number
}) {
  return (
    <div>
      {title && <div className="tiny faint" style={{ marginBottom: 4 }}>{title}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>选手</th><th className="right">K</th><th className="right">D</th>
              <th className="right">A</th><th className="right">ACS</th><th>位置亮点</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const card = cardById(l.cardId)
              if (!card) return null
              const spot = isPlayerCard(card) ? spotFor(card) : null
              return (
                <tr key={l.cardId} className={l.cardId === mvp ? 'me' : ''}>
                  <td>
                    {card.kind === 'player' ? card.ign : card.name}
                    {l.cardId === mvp && <span className="tag t1" style={{ marginLeft: 6 }}>MVP</span>}
                  </td>
                  <td className="right mono">{l.kills}</td>
                  <td className="right mono">{l.deaths}</td>
                  <td className="right mono">{l.assists}</td>
                  <td className="right mono">{l.acs}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {spot && isPlayerCard(card) && (
                      <>
                        {spot.label} {spot.stat(l)}
                        <span className="tiny faint" style={{ marginLeft: 6 }}>
                          {ATTR_CN[spot.attr]} {Math.min(99, card.attrs[spot.attr] + level(l.cardId))}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
