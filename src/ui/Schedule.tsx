import { useState } from 'react'
import { useGame } from './ctx'
import { Panel, fmtDay } from './common'
import { STAGES, fixturesFor, stageName } from '../engine/season'

export default function Schedule() {
  const { game, openMatch } = useGame()
  const [scope, setScope] = useState<'mine' | 'all'>('mine')

  const list = scope === 'mine'
    ? fixturesFor(game, game.myTeam)
    : game.fixtures.slice().sort((a, b) => a.day - b.day).filter((f) => Math.abs(f.day - game.day) <= 10)

  const grouped = list.reduce<Record<string, typeof list>>((acc, f) => {
    const key = stageName(f.stage)
    ;(acc[key] ??= []).push(f)
    return acc
  }, {})

  return (
    <>
      <Panel title="赛季日历">
        <div className="row wrap" style={{ gap: 6 }}>
          {STAGES.map((s) => {
            const active = game.stage === s.key
            const done = game.day > s.end
            return (
              <span
                key={s.key}
                className="tag"
                style={{
                  borderColor: active ? 'var(--accent)' : undefined,
                  color: active ? 'var(--accent)' : done ? '#4a5c70' : undefined,
                  fontWeight: active ? 700 : 400,
                }}
                title={`第 ${s.start}–${s.end} 天`}
              >
                {s.name}
              </span>
            )
          })}
        </div>
        <p className="tiny muted" style={{ marginBottom: 0, marginTop: 10 }}>
          次级联赛的两个赛段与一级联赛并行进行；Challengers 第二赛段冠军可通过 Ascension 升入 VCT。
        </p>
      </Panel>

      <Panel
        title="赛程"
        actions={
          <div className="seg">
            <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>本队</button>
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>近期全部</button>
          </div>
        }
        flush
      >
        {Object.keys(grouped).length === 0 && <div className="empty">暂无赛程。</div>}
        {Object.entries(grouped).map(([stage, fs]) => (
          <div key={stage}>
            <div className="nav-group" style={{ padding: '10px 14px 4px' }}>{stage}</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="num sticky-name at-left">日期</th><th className="hide-m">赛事</th><th>轮次</th>
                    <th style={{ textAlign: 'right' }}>主队</th>
                    <th className="center">比分</th>
                    <th>客队</th><th />
                  </tr>
                </thead>
                <tbody>
                  {fs.map((f) => {
                    const a = game.teams[f.teamA]
                    const b = game.teams[f.teamB]
                    const mine = f.teamA === game.myTeam || f.teamB === game.myTeam
                    const r = f.result
                    const aWon = r && r.mapsWonA > r.mapsWonB
                    return (
                      <tr
                        key={f.id}
                        className={`${mine ? 'me' : ''} ${f.played ? 'clickable' : ''}`}
                        onClick={() => f.played && openMatch(f)}
                      >
                        <td className="num muted mono sticky-name at-left">{fmtDay(f.day, game.year)}</td>
                        <td className="small hide-m">{game.comps[f.comp]?.name ?? f.comp}</td>
                        <td className="small muted">{f.label.replace(/^KO:\d+:/, '')}</td>
                        <td style={{ textAlign: 'right' }} className={r && aWon ? 'pos' : ''} title={a?.name}>{a?.tag}</td>
                        <td className="center mono">
                          {r ? <b>{r.mapsWonA} : {r.mapsWonB}</b> : <span className="muted">BO{f.bo}</span>}
                        </td>
                        <td className={r && !aWon ? 'pos' : ''} title={b?.name}>{b?.tag}</td>
                        <td className="tiny muted">{f.played ? '查看 ›' : ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Panel>
    </>
  )
}
