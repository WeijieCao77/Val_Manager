import { useState } from 'react'
import { useGame } from './ctx'
import { OvrBadge, Panel } from './common'
import Bracket from './Bracket'
import { sortStandings } from '../engine/league'
import { ratingOf } from '../engine/match'
import { statLine } from '../engine/player'
import { REGION_CN, REGIONS } from '../engine/types'
import type { Competition } from '../engine/types'

function Table({ comp }: { comp: Competition }) {
  const { game, openPlayer } = useGame()
  void openPlayer
  const concluded = !!comp.champion && comp.finished.length > 0
  const order = concluded ? comp.finished : sortStandings(comp)
  const hasPlayed = Object.values(comp.standings).some((r) => r.w + r.l > 0)

  // where each club went out, so a strong regular season that ended early reads
  // as what it was rather than looking like a sorting bug
  const exitAt: Record<string, string> = {}
  for (const f of game.fixtures) {
    if (f.comp !== comp.key || !f.label.startsWith('KO:') || !f.result) continue
    const round = f.label.split(':')[2] ?? ''
    const loser = f.result.mapsWonA > f.result.mapsWonB ? f.teamB : f.teamA
    exitAt[loser] = round
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="num">{concluded ? '名次' : '#'}</th><th>战队</th>
            <th className="num">常规赛</th>
            <th className="num">小局</th><th className="num">净胜局</th><th className="num">回合差</th>
            {concluded && <th>季后赛</th>}
          </tr>
        </thead>
        <tbody>
          {order.map((id, i) => {
            const r = comp.standings[id]
            if (!r) return null
            const cut = comp.stage === 'challengers1' || comp.stage === 'challengers2' ? 4 : 8
            return (
              <tr key={id} className={id === game.myTeam ? 'me' : ''}>
                <td className="num muted">
                  {i + 1}
                  {comp.champion === id && ' 🏆'}
                  {!comp.champion && i + 1 === cut && ''}
                </td>
                <td style={{ borderLeft: !comp.champion && i < cut ? '2px solid var(--accent)' : '2px solid transparent' }}>
                  <span title={game.teams[id]?.name}>{game.teams[id]?.tag}</span>
                </td>
                <td className="num mono">{r.w}-{r.l}</td>
                <td className="num muted">{r.mapW}-{r.mapL}</td>
                <td className={`num mono ${r.mapW - r.mapL >= 0 ? 'pos' : 'neg'}`}>
                  {r.mapW - r.mapL > 0 ? '+' : ''}{r.mapW - r.mapL}
                </td>
                <td className="num muted mono">{r.roundW - r.roundL > 0 ? '+' : ''}{r.roundW - r.roundL}</td>
                {concluded && (
                  <td className="small muted">
                    {comp.champion === id ? '冠军' : exitAt[id] ? `止步${exitAt[id]}` : '未进季后赛'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {!hasPlayed && <div className="empty">尚未开赛。</div>}
      {concluded && (
        <p className="tiny faint" style={{ padding: '9px 13px', margin: 0 }}>
          本赛段已结束，排序为<b>最终名次</b>（由季后赛决定），「常规赛」列仍是循环赛战绩——
          常规赛第一但止步淘汰赛是正常结果。
        </p>
      )}
    </div>
  )
}

export default function Standings() {
  const { game, openPlayer } = useGame()
  const [tab, setTab] = useState<'leagues' | 'players'>('leagues')
  const myRegion = game.teams[game.myTeam]?.region
  const [region, setRegion] = useState(myRegion ?? 'China')

  const comps = Object.values(game.comps).filter((c) => !c.region || c.region === region)
  const international = Object.values(game.comps).filter((c) => !c.region)
  const regional = comps.filter((c) => c.region === region)

  const leaders = Object.values(game.players)
    .filter((p) => p.season.maps >= 8 && p.teamId)
    .sort((a, b) => ratingOf(b.season) - ratingOf(a.season))
    .slice(0, 40)

  return (
    <>
      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <div className="seg">
          <button className={tab === 'leagues' ? 'on' : ''} onClick={() => setTab('leagues')}>联赛</button>
          <button className={tab === 'players' ? 'on' : ''} onClick={() => setTab('players')}>选手榜</button>
        </div>
        {tab === 'leagues' && (
          <div className="seg">
            {REGIONS.map((r) => (
              <button key={r} className={region === r ? 'on' : ''} onClick={() => setRegion(r)}>
                {REGION_CN[r]}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'leagues' ? (
        <>
          {regional.length === 0 && <div className="empty">该赛区本阶段没有进行中的赛事。</div>}
          {regional.map((c) => (
            <Panel
              key={c.key}
              title={`${c.name}${c.champion ? ` · 冠军 ${game.teams[c.champion]?.name}` : ''}`}
              flush
            >
              <Table comp={c} />
              {c.bracketStarted && (
                <div style={{ padding: '12px 13px', borderTop: '1px solid var(--line)' }}>
                  <div className="nav-group" style={{ padding: '0 0 8px' }}>季后赛对阵</div>
                  <Bracket comp={c} />
                </div>
              )}
            </Panel>
          ))}
          {international.map((c) => (
            <Panel key={c.key} title={`${c.name}（国际赛事）${c.champion ? ` · 冠军 ${game.teams[c.champion]?.name}` : ''}`}>
              <Bracket comp={c} />
              {c.finished.length > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary className="small muted" style={{ cursor: 'pointer' }}>最终排名</summary>
                  <div className="table-wrap" style={{ marginTop: 8 }}>
                    <table>
                      <thead>
                        <tr><th className="num">#</th><th>战队</th><th>赛区</th></tr>
                      </thead>
                      <tbody>
                        {c.finished.map((id, i) => (
                          <tr key={id} className={id === game.myTeam ? 'me' : ''}>
                            <td className="num muted">{i + 1}{c.champion === id && ' 🏆'}</td>
                            <td><span title={game.teams[id]?.name}>{game.teams[id]?.tag}</span></td>
                            <td className="small muted">{REGION_CN[game.teams[id]?.region]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </Panel>
          ))}
        </>
      ) : (
        <Panel title="赛季选手排行（至少 8 张图）" flush>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">#</th><th>选手</th><th>战队</th><th className="num">能力</th>
                  <th className="num">评分</th><th className="num">ACS</th><th className="num">K/D</th>
                  <th className="num">ADR</th><th className="num">KPR</th>
                  <th className="num">首杀差</th><th className="num">场次</th>
                </tr>
              </thead>
              <tbody>
                {leaders.map((p, i) => {
                  const s = statLine(p.season)
                  return (
                    <tr
                      key={p.id}
                      className={`clickable ${p.teamId === game.myTeam ? 'me' : ''}`}
                      onClick={() => openPlayer(p.id)}
                    >
                      <td className="num muted">{i + 1}</td>
                      <td><b>{p.ign}</b></td>
                      <td className="small muted">{game.teams[p.teamId ?? '']?.name}</td>
                      <td className="num"><OvrBadge value={p.overall} /></td>
                      <td className="num"><b>{ratingOf(p.season).toFixed(2)}</b></td>
                      <td className="num mono">{s.acs.toFixed(0)}</td>
                      <td className="num mono">{s.kd.toFixed(2)}</td>
                      <td className="num mono">{s.adr.toFixed(0)}</td>
                      <td className="num mono">{s.kpr.toFixed(2)}</td>
                      <td className={`num mono ${s.fkDiff >= 0 ? 'pos' : 'neg'}`}>
                        {s.fkDiff > 0 ? '+' : ''}{s.fkDiff}
                      </td>
                      <td className="num muted">{p.season.maps}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  )
}
