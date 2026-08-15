import { useState } from 'react'
import { useGame } from './ctx'
import { Modal, OvrBadge, RoleTag } from './common'
import RoundRibbon, { RibbonLegend } from './RoundRibbon'
import { ratingOf } from '../engine/match'
import type { Fixture, MapScore } from '../engine/types'

export default function MatchModal({ fixture, onClose }: { fixture: Fixture; onClose: () => void }) {
  const { game, openPlayer } = useGame()
  const [tab, setTab] = useState(0)
  const r = fixture.result
  const a = game.teams[fixture.teamA]
  const b = game.teams[fixture.teamB]
  if (!r || !a || !b) return null

  const mineIsA = fixture.teamA === game.myTeam
  const involved = fixture.teamA === game.myTeam || fixture.teamB === game.myTeam
  const aWon = r.mapsWonA > r.mapsWonB
  const map = r.maps[Math.min(tab, r.maps.length - 1)]

  return (
    <Modal
      wide
      title={
        <span className="row" style={{ gap: 10 }}>
          <span>{game.comps[fixture.comp]?.name ?? fixture.comp}</span>
          <span className="tag">{fixture.label.replace(/^KO:\d+:/, '')}</span>
          <span className="tag">BO{fixture.bo}</span>
        </span>
      }
      onClose={onClose}
    >
      <div className="score-line">
        <div className={`t a ${aWon ? 'win' : ''}`}>{a.name}</div>
        <div className="s">
          <span className={aWon ? 'win' : 'muted'}>{r.mapsWonA}</span>
          <span className="muted"> : </span>
          <span className={!aWon ? 'win' : 'muted'}>{r.mapsWonB}</span>
        </div>
        <div className={`t ${!aWon ? 'win' : ''}`}>{b.name}</div>
      </div>

      {involved && (
        <p className="center small" style={{ marginTop: -8 }}>
          {(mineIsA ? aWon : !aWon)
            ? <span className="pos">胜利。</span>
            : <span className="muted">失利。</span>}
        </p>
      )}

      {/* map results */}
      <div className="panel" style={{ marginTop: 14 }}>
        {r.maps.map((m, i) => (
          <div key={i} className="mapline">
            <span className="m">{m.map}</span>
            <span className="mono" style={{ width: 62 }}>
              <b className={m.scoreA > m.scoreB ? 'pos' : 'muted'}>{m.scoreA}</b>
              <span className="faint"> – </span>
              <b className={m.scoreB > m.scoreA ? 'pos' : 'muted'}>{m.scoreB}</b>
            </span>
            {m.rounds && m.rounds.length > 0 && (
              <RoundRibbon rounds={m.rounds} mineIsA={mineIsA} compact />
            )}
          </div>
        ))}
      </div>

      {/* per-map detail */}
      {r.maps.length > 1 && (
        <div className="seg" style={{ marginBottom: 12 }}>
          {r.maps.map((m, i) => (
            <button key={i} className={tab === i ? 'on' : ''} onClick={() => setTab(i)}>
              {m.map}
            </button>
          ))}
        </div>
      )}

      {map?.rounds && map.rounds.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="nav-group" style={{ padding: '0 0 8px' }}>回合走势 · {map.map}</div>
          <RoundRibbon rounds={map.rounds} mineIsA={mineIsA} />
          <div style={{ marginTop: 8 }}>
            <RibbonLegend mine={mineIsA ? a.name : b.name} theirs={mineIsA ? b.name : a.name} />
          </div>
        </div>
      )}

      {map && <Scoreboard map={map} teamA={fixture.teamA} teamB={fixture.teamB} onPlayer={openPlayer} mvp={r.mvp} />}

      {r.highlights.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="nav-group" style={{ padding: '0 0 6px' }}>高光</div>
          {r.highlights.map((h, i) => (
            <div key={i} className="small" style={{ padding: '3px 0' }}>· {h}</div>
          ))}
        </div>
      )}

      <details style={{ marginTop: 14 }}>
        <summary className="small muted" style={{ cursor: 'pointer' }}>BP 过程</summary>
        <div className="veto" style={{ marginTop: 6 }}>
          {r.vetoLog.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </details>
    </Modal>
  )
}

function Scoreboard({
  map, teamA, teamB, onPlayer, mvp,
}: {
  map: MapScore; teamA: string; teamB: string
  onPlayer: (id: string) => void; mvp: string | null
}) {
  const { game } = useGame()

  const rows = (teamId: string) =>
    Object.entries(map.lines)
      .filter(([pid]) => game.players[pid]?.teamId === teamId)
      .map(([pid, l]) => ({ p: game.players[pid], l }))
      .filter((x) => x.p)
      .sort((x, y) => y.l.acs - x.l.acs)

  const block = (teamId: string) => {
    const list = rows(teamId)
    if (!list.length) return null
    return (
      <div className="panel" style={{ marginBottom: 10 }}>
        <div className="panel-head">
          <h2>{game.teams[teamId]?.name}</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>选手</th><th>位置</th><th className="num">评分</th><th className="num">ACS</th>
                <th className="num">K</th><th className="num">D</th><th className="num">A</th>
                <th className="num">ADR</th><th className="num">首杀</th><th className="num">残局</th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ p, l }) => {
                const rat = ratingOf({ ...l, rounds: l.rounds })
                return (
                  <tr key={p.id} className="clickable" onClick={() => onPlayer(p.id)}>
                    <td>
                      <b>{p.ign}</b>
                      {mvp === p.id && <span className="tag t1" style={{ marginLeft: 6 }}>MVP</span>}
                    </td>
                    <td><RoleTag role={p.role} /></td>
                    <td className="num">
                      <b className={rat >= 1.15 ? 'pos' : rat < 0.85 ? 'muted' : ''}>{rat.toFixed(2)}</b>
                    </td>
                    <td className="num mono">{l.acs}</td>
                    <td className="num mono">{l.kills}</td>
                    <td className="num mono muted">{l.deaths}</td>
                    <td className="num mono muted">{l.assists}</td>
                    <td className="num mono">{l.rounds ? Math.round(l.damage / l.rounds) : 0}</td>
                    <td className={`num mono ${l.firstKills - l.firstDeaths >= 0 ? 'pos' : 'neg'}`}>
                      {l.firstKills}/{l.firstDeaths}
                    </td>
                    <td className="num mono">{l.clutches || '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="nav-group" style={{ padding: '0 0 8px' }}>数据统计 · {map.map}</div>
      {block(teamA)}
      {block(teamB)}
    </>
  )
}

export function TeamStrip({ ids }: { ids: string[] }) {
  const { game } = useGame()
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      {ids.map((id) => {
        const p = game.players[id]
        if (!p) return null
        return (
          <span key={id} className="row" style={{ gap: 4 }}>
            <RoleTag role={p.role} />
            <span className="small">{p.ign}</span>
            <OvrBadge value={p.overall} />
          </span>
        )
      })}
    </div>
  )
}
