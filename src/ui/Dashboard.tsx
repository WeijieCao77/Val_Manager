import { useState } from 'react'
import { useGame } from './ctx'
import { Bar, Condition, money, OvrBadge, Panel, Roles, Stat, fmtDay } from './common'
import { advanceDay, advanceToNextMatch, nextFixtureFor, stageName } from '../engine/season'
import { sortStandings } from '../engine/league'
import { squadOf, wageBill } from '../engine/world'
import { ratingOf } from '../engine/match'
import { statLine } from '../engine/player'
import type { DayReport } from '../engine/season'

export default function Dashboard() {
  const { game, commit, toast, openPlayer, openMatch, go } = useGame()
  const [busy, setBusy] = useState(false)
  const me = game.teams[game.myTeam]
  const squad = squadOf(game, game.myTeam)
  const next = nextFixtureFor(game, game.myTeam)

  const handleReports = (reports: DayReport[]) => {
    const played = reports.flatMap((r) => r.playedMine)
    const notes = reports.flatMap((r) => r.notes)
    commit()
    if (played.length) openMatch(played[played.length - 1])
    else if (notes.length) toast(notes[notes.length - 1])
  }

  const step = (fast: boolean) => {
    if (busy) return
    setBusy(true)
    // let the button paint its disabled state before the sim blocks the thread
    window.setTimeout(() => {
      try {
        handleReports(fast ? advanceToNextMatch(game) : [advanceDay(game)])
      } finally {
        setBusy(false)
      }
    }, 10)
  }

  const myComp = Object.values(game.comps).find(
    (c) => c.teams.includes(game.myTeam) && !c.champion &&
      (c.stage === 'stage1' || c.stage === 'stage2' || c.stage === 'challengers1' || c.stage === 'challengers2'),
  )
  const table = myComp ? sortStandings(myComp) : []
  const myRank = table.indexOf(game.myTeam)

  const recentNews = game.news.slice(-9).reverse()
  const injured = squad.filter((p) => p.injuredUntil > game.day)
  const bill = wageBill(game, game.myTeam)

  const topPerformers = squad
    .filter((p) => p.season.maps > 0)
    .sort((a, b) => ratingOf(b.season) - ratingOf(a.season))
    .slice(0, 5)

  return (
    <>
      <div className="grid c4">
        <Panel><Stat k="联赛排名" v={myRank >= 0 ? `${myRank + 1} / ${table.length}` : '—'} /></Panel>
        <Panel><Stat k="资金" v={money(game.finances.balance)} /></Panel>
        <Panel><Stat k="赛季薪资" v={money(bill)} /></Panel>
        <Panel><Stat k="董事会信任" v={`${Math.round(game.boardConfidence)}%`} /></Panel>
      </div>

      <div className="grid c2">
        <Panel
          title="下一场比赛"
          actions={
            <div className="row" style={{ gap: 8 }}>
              <button className="sm" disabled={busy} onClick={() => step(false)}>推进一天</button>
              <button className="primary sm" disabled={busy} onClick={() => step(true)}>
                {busy ? '模拟中…' : '推进到下一场 ▶'}
              </button>
            </div>
          }
        >
          {next ? (
            <>
              <div className="score-line" style={{ padding: '6px 0 14px' }}>
                <div className="t a">{game.teams[next.teamA]?.name}</div>
                <div className="s muted" style={{ fontSize: 20 }}>BO{next.bo}</div>
                <div className="t">{game.teams[next.teamB]?.name}</div>
              </div>
              <div className="row small muted wrap" style={{ gap: 10, justifyContent: 'center' }}>
                <span className="tag">{game.comps[next.comp]?.name ?? next.comp}</span>
                <span className="tag">{next.label.replace(/^KO:\d+:/, '')}</span>
                <span className="tag">{fmtDay(next.day)}（{next.day - game.day} 天后）</span>
              </div>
            </>
          ) : (
            <div className="empty">
              当前没有安排比赛。
              {game.stage === 'preseason' || game.stage === 'offseason'
                ? '休赛期是处理转会与续约的好时机。'
                : ''}
            </div>
          )}
          {injured.length > 0 && (
            <p className="small neg" style={{ marginBottom: 0 }}>
              ⚕ 伤停：{injured.map((p) => p.ign).join('、')}
            </p>
          )}
          {squad.length < 5 && (
            <p className="small neg" style={{ marginBottom: 0 }}>
              ⚠ 阵容不足 5 人（当前 {squad.length} 人），请尽快在
              <button className="sm ghost" onClick={() => go('transfers')}>转会市场</button>
              补强。
            </p>
          )}
        </Panel>

        <Panel title={myComp ? myComp.name : '积分榜'} flush>
          {myComp ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="num">#</th><th>战队</th>
                    <th className="num">胜</th><th className="num">负</th><th className="num">小分</th>
                  </tr>
                </thead>
                <tbody>
                  {table.slice(0, 8).map((id, i) => {
                    const r = myComp.standings[id]
                    return (
                      <tr key={id} className={id === game.myTeam ? 'me' : ''}>
                        <td className="num muted">{i + 1}</td>
                        <td>{game.teams[id]?.name}</td>
                        <td className="num">{r.w}</td>
                        <td className="num">{r.l}</td>
                        <td className="num muted">{r.mapW - r.mapL > 0 ? '+' : ''}{r.mapW - r.mapL}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">{stageName(game.stage)} 期间没有进行中的联赛。</div>
          )}
        </Panel>
      </div>

      <div className="grid c2">
        <Panel title="首发阵容" flush>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>选手</th><th>位置</th><th className="num">能力</th>
                  <th className="num">状态</th><th>体能</th>
                </tr>
              </thead>
              <tbody>
                {me.starters.map((id) => {
                  const p = game.players[id]
                  if (!p) return null
                  return (
                    <tr key={id} className="clickable" onClick={() => openPlayer(id)}>
                      <td><b>{p.ign}</b>{p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>IGL</span>}</td>
                      <td><Roles p={p} /></td>
                      <td className="num"><OvrBadge value={p.overall} /></td>
                      <td className="num mono">{Math.round(p.form)}</td>
                      <td style={{ width: 110 }}><Condition p={p} day={game.day} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="赛季数据领跑" flush>
          {topPerformers.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>选手</th><th className="num">评分</th><th className="num">ACS</th>
                    <th className="num">K/D</th><th className="num">场次</th>
                  </tr>
                </thead>
                <tbody>
                  {topPerformers.map((p) => {
                    const s = statLine(p.season)
                    return (
                      <tr key={p.id} className="clickable" onClick={() => openPlayer(p.id)}>
                        <td>{p.ign}</td>
                        <td className="num"><b>{ratingOf(p.season).toFixed(2)}</b></td>
                        <td className="num">{s.acs.toFixed(0)}</td>
                        <td className="num">{s.kd.toFixed(2)}</td>
                        <td className="num muted">{p.season.maps}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">本赛季还没有比赛数据。</div>
          )}
        </Panel>
      </div>

      <Panel title="新闻" flush>
        {recentNews.length ? (
          recentNews.map((n, i) => (
            <div key={i} className={`news-item${n.important ? ' important' : ''}`}>
              <span className="d">{fmtDay(n.day)}</span>
              <span>{n.text}</span>
            </div>
          ))
        ) : (
          <div className="empty">还没有新闻。</div>
        )}
      </Panel>

      {me.sponsors.length > 0 && (
        <Panel title="赞助商">
          <div className="row wrap" style={{ gap: 10 }}>
            {me.sponsors.map((s) => (
              <span key={s.name} className="tag" title={`赛季收入 ${money(s.perSeason)}`}>
                {s.name} · {money(s.perSeason)}
              </span>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="small muted">董事会信任度</div>
            <Bar value={game.boardConfidence} />
          </div>
        </Panel>
      )}
    </>
  )
}
