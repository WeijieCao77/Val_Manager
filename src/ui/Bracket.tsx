import { useGame } from './ctx'
import { Crest, fmtDay } from './common'
import { GROUPS, isGroupLabel, isLowerLabel, swissRecord, swissRoundOf } from '../engine/bracket'
import type { Competition, Fixture } from '../engine/types'

/**
 * A knockout drawn as a bracket rather than listed as placings.
 *
 * Three shapes, all read left to right. A double elimination is two lanes —
 * the upper bracket over the lower, the grand final at the end of the upper
 * lane — because a side that loses in the top lane reappears in the bottom
 * one, and a single row of columns hid that. A Masters opens with its Swiss
 * round: the table of records, then the rounds. Champions opens with its four
 * groups. A Challengers bracket is still one lane.
 */
export default function Bracket({ comp }: { comp: Competition }) {
  const { game } = useGame()
  const own = game.fixtures.filter((f) => f.comp === comp.key)
  const sw = own.filter((f) => f.label.startsWith('SW:'))
  const ko = own.filter((f) => f.label.startsWith('KO:'))
  const groups = ko.filter((f) => isGroupLabel(nameOf(f)))
  const playoff = ko.filter((f) => !isGroupLabel(nameOf(f)))
  if (!sw.length && !ko.length) return null

  return (
    <div className="stages">
      {sw.length > 0 && <Swiss comp={comp} fixtures={sw} />}
      {groups.length > 0 && <Groups comp={comp} fixtures={groups} />}
      {playoff.length > 0 && (
        <>
          {(sw.length > 0 || groups.length > 0) && <div className="nav-group" style={{ padding: '6px 0 8px' }}>季后赛 · 双败淘汰</div>}
          <Lanes fixtures={playoff} byes={comp.byes} />
        </>
      )}
      {!playoff.length && comp.byes?.length ? (
        <p className="tiny muted" style={{ margin: '8px 0 0' }}>
          直接进入季后赛：{comp.byes.map((id) => game.teams[id]?.name).join('、')}
        </p>
      ) : null}
    </div>
  )
}

const nameOf = (f: Fixture) => f.label.split(':')[2] ?? ''
const waveOf = (f: Fixture) => Number(f.label.split(':')[1] || 0)

/** One tie as a two-line card; clickable once it has a result. */
function Tie({ f }: { f: Fixture }) {
  const { game, openMatch } = useGame()
  const r = f.result
  const aWon = r ? r.mapsWonA > r.mapsWonB : false
  const mine = f.teamA === game.myTeam || f.teamB === game.myTeam
  return (
    <button
      className={`bracket-tie${mine ? ' own' : ''}${r ? ' clickable' : ''}`}
      onClick={() => r && openMatch(f)}
      title={r ? '查看这场比赛' : `尚未进行 · BO${f.bo}`}
    >
      {[
        { id: f.teamA, score: r?.mapsWonA, won: r ? aWon : null },
        { id: f.teamB, score: r?.mapsWonB, won: r ? !aWon : null },
      ].map((side, i) => (
        <div key={`${side.id}-${i}`} className={`bracket-side${side.won ? ' win' : ''}`}>
          <Crest id={side.id} size={14} />
          <span className="nm" title={game.teams[side.id]?.name}>{game.teams[side.id]?.tag ?? '—'}</span>
          <span className="sc mono">{side.score ?? '–'}</span>
        </div>
      ))}
      {/* a tie still to be played says when — the final everyone is waiting
          for was a pair of dashes with no date */}
      {!r && (
        <div className="bracket-when">
          {f.day <= game.day ? '今天' : `${fmtDay(f.day, game.year)} · ${f.day - game.day} 天后`} · BO{f.bo}
        </div>
      )}
    </button>
  )
}

/**
 * The double elimination: columns by wave, upper lane above lower lane. A
 * single-lane bracket (Challengers) has nothing in the lower lane and reads
 * as it always did.
 */
function Lanes({ fixtures, byes }: { fixtures: Fixture[]; byes?: string[] }) {
  const { game } = useGame()
  const waves = [...new Set(fixtures.map(waveOf))].sort((a, b) => a - b)
  const col = (f: Fixture) => waves.indexOf(waveOf(f))
  const upper = fixtures.filter((f) => !isLowerLabel(nameOf(f)))
  const lower = fixtures.filter((f) => isLowerLabel(nameOf(f)))
  const lane = (list: Fixture[]) => {
    const byCol = new Map<number, Fixture[]>()
    for (const f of list) byCol.set(col(f), [...(byCol.get(col(f)) ?? []), f])
    return waves.map((_, i) => byCol.get(i) ?? [])
  }
  const rows = lower.length ? [lane(upper), lane(lower)] : [lane(upper)]
  return (
    <div className="bracket lanes">
      {rows.map((cols, ri) => (
        <div key={ri} className="bracket-lane">
          {cols.map((fx, ci) => (
            <div key={ci} className="bracket-round" style={{ visibility: fx.length ? 'visible' : 'hidden' }}>
              <div className="bracket-head">{fx[0] ? nameOf(fx[0]) : '·'}</div>
              {fx.map((f) => <Tie key={f.id} f={f} />)}
            </div>
          ))}
          {ri === 0 && byes?.length ? (
            <div className="bracket-round">
              <div className="bracket-head">轮空</div>
              {byes.map((id) => (
                <div key={id} className="bracket-tie">
                  <div className="bracket-side"><Crest id={id} size={14} /><span className="nm" title={game.teams[id]?.name}>{game.teams[id]?.tag}</span></div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** The Swiss round: every team's record, then the rounds as they were paired. */
function Swiss({ comp, fixtures }: { comp: Competition; fixtures: Fixture[] }) {
  const { game } = useGame()
  const teams = comp.swissSeeds ?? [...new Set(fixtures.flatMap((f) => [f.teamA, f.teamB]))]
  const order = teams.slice().sort((a, b) => {
    const ra = swissRecord(comp, a)
    const rb = swissRecord(comp, b)
    return rb.w - ra.w || ra.l - rb.l || teams.indexOf(a) - teams.indexOf(b)
  })
  const rounds = [...new Set(fixtures.map(swissRoundOf))].sort((a, b) => a - b)
  return (
    <div className="swiss">
      <div className="nav-group" style={{ padding: '0 0 8px' }}>
        瑞士轮 · 两胜晋级，两负出局{comp.byes?.length ? `（${comp.byes.map((id) => game.teams[id]?.tag).join('、')} 作为赛区冠军直接进季后赛）` : ''}
      </div>
      <div className="swiss-grid">
        <div className="swiss-table">
          {order.map((id) => {
            const r = swissRecord(comp, id)
            const state = r.w >= 2 ? 'through' : r.l >= 2 ? 'out' : ''
            return (
              <div key={id} className={`swiss-row ${state}${id === game.myTeam ? ' me' : ''}`}>
                <Crest id={id} size={14} />
                <span className="nm" title={game.teams[id]?.name}>{game.teams[id]?.tag}</span>
                <span className="sc mono">{r.w}-{r.l}</span>
                <span className="st tiny">{state === 'through' ? '晋级' : state === 'out' ? '出局' : ''}</span>
              </div>
            )
          })}
        </div>
        <div className="bracket">
          {rounds.map((n) => (
            <div key={n} className="bracket-round">
              <div className="bracket-head">第 {n} 轮</div>
              {fixtures.filter((f) => swissRoundOf(f) === n).map((f) => <Tie key={f.id} f={f} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Champions' four GSL groups, each as its own little column of ties. */
function Groups({ comp, fixtures }: { comp: Competition; fixtures: Fixture[] }) {
  const { game } = useGame()
  return (
    <div className="groups">
      <div className="nav-group" style={{ padding: '0 0 8px' }}>小组赛 · 每组前 2 晋级</div>
      <div className="bracket">
        {GROUPS.map((g, i) => {
          const fx = fixtures.filter((f) => nameOf(f).startsWith(`${g}组`))
          const members = comp.groups?.[i] ?? []
          return (
            <div key={g} className="bracket-round group">
              <div className="bracket-head">{g} 组 · {members.map((id) => game.teams[id]?.tag).join(' ')}</div>
              {fx.map((f) => (
                <div key={f.id}>
                  <div className="tiny faint" style={{ margin: '4px 0 2px' }}>{nameOf(f).replace(/^[A-D]组 /, '')}</div>
                  <Tie f={f} />
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
