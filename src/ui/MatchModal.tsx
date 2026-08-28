import { useState } from 'react'
import WhyPanel from './WhyPanel'
import { mapCn } from '../engine/content'
import { useGame } from './ctx'
import { Modal, MultiRadar, OvrBadge, Roles } from './common'
import RoundRibbon, { RibbonLegend } from './RoundRibbon'
import { ratingOf } from '../engine/match'
import type { Fixture, MapLine, MapScore } from '../engine/types'

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
        <div className={`t a ${aWon ? 'win' : ''}`} title={a.name}>{a.tag}</div>
        <div className="s">
          <span className={aWon ? 'win' : 'muted'}>{r.mapsWonA}</span>
          <span className="muted"> : </span>
          <span className={!aWon ? 'win' : 'muted'}>{r.mapsWonB}</span>
        </div>
        <div className={`t ${!aWon ? 'win' : ''}`} title={b.name}>{b.tag}</div>
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
            <span className="m">{mapCn(m.map)}</span>
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
              {mapCn(m.map)}
            </button>
          ))}
        </div>
      )}

      {involved && map && (
        <div style={{ marginBottom: 16 }}>
          <div className="nav-group" style={{ padding: '0 0 8px' }}>
            为什么是这个结果 · {mapCn(map.map)}
          </div>
          <WhyPanel map={map} mineIsA={mineIsA} />
        </div>
      )}

      {map?.rounds && map.rounds.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="nav-group" style={{ padding: '0 0 8px' }}>回合走势 · {mapCn(map.map)}</div>
          <RoundRibbon
            rounds={map.rounds} mineIsA={mineIsA}
            mineTag={(mineIsA ? a : b)?.tag} theirTag={(mineIsA ? b : a)?.tag}
          />
          <div style={{ marginTop: 8 }}>
            <RibbonLegend />
          </div>
        </div>
      )}

      {map && (
        <Performance map={map} teamA={fixture.teamA} teamB={fixture.teamB} lineups={r.lineups} />
      )}

      {map && (
        <Scoreboard
          map={map} teamA={fixture.teamA} teamB={fixture.teamB}
          onPlayer={openPlayer} mvp={r.mvp} lineups={r.lineups}
        />
      )}

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

/** Six axes computed from what the sim actually records for a map. */
const PERF_AXES = ['火力', '输出', '生存', '突破', '串联', '残局']

function perfOf(l: MapLine): number[] {
  const r = Math.max(1, l.rounds)
  const pct = (v: number, full: number) => Math.max(0, Math.min(100, (v / full) * 100))
  return [
    pct(l.acs, 320),
    pct(l.damage / r, 210),
    pct(1 - l.deaths / r, 0.45),
    pct(l.firstKills / r, 0.22),
    pct(l.assists / r, 0.5),
    pct(l.clutches, 2),
  ]
}

const avgPerf = (lines: MapLine[]): number[] => {
  if (!lines.length) return PERF_AXES.map(() => 0)
  const sums = PERF_AXES.map(() => 0)
  for (const l of lines) perfOf(l).forEach((v, i) => (sums[i] += v))
  return sums.map((s) => s / lines.length)
}

/**
 * Post-match read-out. The radar answers "where did this match get decided",
 * and the table answers "who over- or under-performed their own season" —
 * which is the part that actually drives a lineup decision.
 */
function Performance({
  map, teamA, teamB, lineups,
}: {
  map: MapScore; teamA: string; teamB: string
  lineups?: { a: string[]; b: string[] }
}) {
  const { game } = useGame()
  const [mode, setMode] = useState<'team' | 'player'>('team')
  const [picked, setPicked] = useState<string[]>([])

  const idsFor = (teamId: string) => {
    const side = teamId === teamA ? lineups?.a : lineups?.b
    return (side?.length
      ? side
      : Object.keys(map.lines).filter((pid) => game.players[pid]?.teamId === teamId)
    ).filter((pid) => map.lines[pid])
  }

  const aIds = idsFor(teamA)
  const bIds = idsFor(teamB)
  const mineIds = game.myTeam === teamB ? bIds : aIds
  const all = [...aIds, ...bIds]

  const toggle = (pid: string) =>
    setPicked((cur) =>
      cur.includes(pid) ? cur.filter((x) => x !== pid) : [...cur, pid].slice(-2))

  const PALETTE = ['var(--accent)', '#5fa8d3']
  const series = mode === 'team'
    ? [
        { label: game.teams[teamA]?.tag ?? 'A', color: PALETTE[0], values: avgPerf(aIds.map((id) => map.lines[id])) },
        { label: game.teams[teamB]?.tag ?? 'B', color: PALETTE[1], values: avgPerf(bIds.map((id) => map.lines[id])) },
      ]
    : picked.map((pid, i) => ({
        label: game.players[pid]?.ign ?? pid,
        color: PALETTE[i] ?? PALETTE[0],
        values: perfOf(map.lines[pid]),
      }))

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="row" style={{ gap: 10, marginBottom: 10 }}>
        <div className="nav-group" style={{ padding: 0 }}>表现对比 · {map.map}</div>
        <div className="spacer" style={{ flex: 1 }} />
        <div className="seg">
          <button className={mode === 'team' ? 'on' : ''} onClick={() => setMode('team')}>队伍</button>
          <button className={mode === 'player' ? 'on' : ''} onClick={() => setMode('player')}>选手</button>
        </div>
      </div>

      {mode === 'player' && (
        <div className="row wrap" style={{ gap: 5, marginBottom: 10 }}>
          {all.map((pid) => {
            const p = game.players[pid]
            if (!p) return null
            const on = picked.indexOf(pid)
            return (
              <button key={pid} className={`sm${on >= 0 ? ' primary' : ''}`} onClick={() => toggle(pid)}>
                {p.ign}
                {on >= 0 && <span className="tiny"> ●</span>}
              </button>
            )
          })}
          <span className="tiny faint">最多选两人对比</span>
        </div>
      )}

      <div className="grid c2" style={{ alignItems: 'center' }}>
        <div className="radar-wrap">
          {series.length ? (
            <MultiRadar axes={PERF_AXES} series={series} />
          ) : (
            <div className="empty">选择 1–2 名选手进行对比。</div>
          )}
        </div>
        <div>
          <div className="row wrap tiny" style={{ gap: 12, marginBottom: 10 }}>
            {series.map((sr) => (
              <span key={sr.label} className="row" style={{ gap: 5 }}>
                <i style={{ width: 9, height: 9, background: sr.color, display: 'inline-block' }} />
                {sr.label}
              </span>
            ))}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>本队选手</th><th className="num">本场</th><th className="num">赛季</th><th className="num">发挥</th></tr>
              </thead>
              <tbody>
                {mineIds.map((pid) => {
                  const p = game.players[pid]
                  const l = map.lines[pid]
                  if (!p || !l) return null
                  const now = ratingOf({ ...l, rounds: l.rounds })
                  const base = p.season.maps ? ratingOf(p.season) : now
                  const d = now - base
                  return (
                    <tr key={pid} className="clickable" onClick={() => { setMode('player'); toggle(pid) }}>
                      <td>{p.ign}</td>
                      <td className="num mono">{now.toFixed(2)}</td>
                      <td className="num mono muted">{base.toFixed(2)}</td>
                      <td className={`num mono ${d >= 0.08 ? 'pos' : d <= -0.08 ? 'neg' : 'muted'}`}>
                        {d > 0 ? '\u25b2' : d < 0 ? '\u25bc' : '\u2013'} {Math.abs(d).toFixed(2)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="tiny faint" style={{ marginTop: 8, marginBottom: 0 }}>
            「发挥」= 本场评分与该选手赛季均值之差。点击一行可将他加入雷达对比。
          </p>
        </div>
      </div>
    </div>
  )
}

function Scoreboard({
  map, teamA, teamB, onPlayer, mvp, lineups,
}: {
  map: MapScore; teamA: string; teamB: string
  onPlayer: (id: string) => void; mvp: string | null
  lineups?: { a: string[]; b: string[] }
}) {
  const { game } = useGame()

  // Prefer the lineup captured at match time. Falling back to current club
  // membership drops anyone who has since transferred.
  const rows = (teamId: string) => {
    const side = teamId === teamA ? lineups?.a : lineups?.b
    const ids = side?.length
      ? side.filter((pid) => map.lines[pid])
      : Object.keys(map.lines).filter((pid) => game.players[pid]?.teamId === teamId)
    return ids
      .map((pid) => ({ p: game.players[pid], l: map.lines[pid] }))
      .filter((x) => x.p && x.l)
      .sort((x, y) => y.l.acs - x.l.acs)
  }

  const block = (teamId: string) => {
    const list = rows(teamId)
    if (!list.length) return null
    return (
      <div className="panel" style={{ marginBottom: 10 }}>
        <div className="panel-head">
          <h2 title={game.teams[teamId]?.name}>{game.teams[teamId]?.tag}</h2>
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
                    <td><Roles p={p} /></td>
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
            <Roles p={p} />
            <span className="small">{p.ign}</span>
            <OvrBadge value={p.overall} />
          </span>
        )
      })}
    </div>
  )
}
