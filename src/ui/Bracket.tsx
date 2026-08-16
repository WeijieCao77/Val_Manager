import { useGame } from './ctx'
import type { Competition, Fixture } from '../engine/types'

/**
 * A knockout drawn as a bracket rather than listed as placings.
 *
 * Masters and Champions are pure knockouts, so a table of finishing positions
 * hides the only thing worth knowing — who actually had to play whom to get
 * there. Rounds read left to right; an unplayed tie still shows its pairing.
 */
export default function Bracket({ comp }: { comp: Competition }) {
  const { game, openMatch } = useGame()

  const ko = game.fixtures.filter((f) => f.comp === comp.key && f.label.startsWith('KO:'))
  if (!ko.length) return null

  const rounds = new Map<number, Fixture[]>()
  for (const f of ko) {
    const n = Number(f.label.split(':')[1] || 0)
    if (!rounds.has(n)) rounds.set(n, [])
    rounds.get(n)!.push(f)
  }
  const ordered = [...rounds.entries()].sort((a, b) => a[0] - b[0])

  return (
    <div className="bracket">
      {ordered.map(([n, fixtures]) => (
        <div key={n} className="bracket-round">
          <div className="bracket-head">{fixtures[0].label.split(':')[2] ?? `第 ${n} 轮`}</div>
          {fixtures.map((f) => {
            const r = f.result
            const aWon = r ? r.mapsWonA > r.mapsWonB : false
            const mine = f.teamA === game.myTeam || f.teamB === game.myTeam
            return (
              <button
                key={f.id}
                className={`bracket-tie${mine ? ' own' : ''}${r ? ' clickable' : ''}`}
                onClick={() => r && openMatch(f)}
                title={r ? '查看这场比赛' : '尚未进行'}
              >
                {[
                  { id: f.teamA, score: r?.mapsWonA, won: r ? aWon : null },
                  { id: f.teamB, score: r?.mapsWonB, won: r ? !aWon : null },
                ].map((side) => (
                  <div key={side.id} className={`bracket-side${side.won ? ' win' : ''}`}>
                    <span className="nm" title={game.teams[side.id]?.name}>{game.teams[side.id]?.tag ?? '—'}</span>
                    <span className="sc mono">{side.score ?? '–'}</span>
                  </div>
                ))}
              </button>
            )
          })}
        </div>
      ))}
      {comp.byes?.length ? (
        <div className="bracket-round">
          <div className="bracket-head">轮空</div>
          {comp.byes.map((id) => (
            <div key={id} className="bracket-tie">
              <div className="bracket-side"><span className="nm" title={game.teams[id]?.name}>{game.teams[id]?.tag}</span></div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
