import { useState } from 'react'
import { useGame } from './ctx'
import { Bar, Condition, money, OvrBadge, Panel, Roles, Stat, fmtDay } from './common'
import { advanceDay, advanceToNextMatch, makeScrim, scrimReply, nextFixtureFor, stageName, STAGES } from '../engine/season'
import type { ScrimFormat } from '../engine/season'
import { activePool } from '../engine/match'
import { sortStandings } from '../engine/league'
import { agendaFor } from '../engine/agenda'
import { squadOf, wageBill } from '../engine/world'
import { ratingOf } from '../engine/match'
import { statLine } from '../engine/player'
import type { DayReport } from '../engine/season'

export default function Dashboard() {
  const { game, commit, toast, openPlayer, openMatch, playLive, go } = useGame()
  const [busy, setBusy] = useState(false)
  const [scrimOpp, setScrimOpp] = useState<string>('')
  const [scrimMap, setScrimMap] = useState<string>('')
  const [scrimFmt, setScrimFmt] = useState<ScrimFormat>('full24')
  const me = game.teams[game.myTeam]
  const squad = squadOf(game, game.myTeam)
  const next = nextFixtureFor(game, game.myTeam)

  const handleReports = (reports: DayReport[]) => {
    const notes = reports.flatMap((r) => r.notes)
    const pending = reports.map((r) => r.pendingMine).filter(Boolean)[0]
    commit()
    // your own match is handed to the live view, which offers watch or skip
    if (pending) playLive(pending)
    else if (notes.length) toast(notes[notes.length - 1])
  }

  const step = (fast: boolean) => {
    if (busy) return
    setBusy(true)
    // let the button paint its disabled state before the sim blocks the thread
    window.setTimeout(() => {
      try {
        handleReports(
          fast
            ? advanceToNextMatch(game, 40, { deferMine: true })
            : [advanceDay(game, { deferMine: true })],
        )
      } finally {
        setBusy(false)
      }
    }, 10)
  }

  // the most recent result, shown compactly rather than forced open
  const lastId = game.lastResults[game.lastResults.length - 1]
  const lastFixture = lastId ? game.fixtures.find((f) => f.id === lastId) : undefined

  // long gaps between fixtures are where scrims belong
  const gapDays = next ? next.day - game.day : 0
  const scrimOpponents = Object.values(game.teams)
    .filter((t) => t.id !== game.myTeam && t.region === me.region)
    .sort((a, b) => Math.abs(a.rating - me.rating) - Math.abs(b.rating - me.rating))
    .slice(0, 8)
  const pool = activePool(game.seed + game.year)

  // whatever we are actually playing right now, preferring the current phase
  const myComps = Object.values(game.comps).filter(
    (c) => c.teams.includes(game.myTeam) && !c.champion &&
      game.fixtures.some((f) => f.comp === c.key && !f.played),
  )
  const myComp = myComps.find((c) => c.stage === game.stage) ?? myComps[0]
  const table = myComp ? sortStandings(myComp) : []
  const myRank = table.indexOf(game.myTeam)

  const recentNews = game.news.slice(-9).reverse()
  const injured = squad.filter((p) => p.injuredUntil > game.day)
  const bill = wageBill(game, game.myTeam)

  const topPerformers = squad
    .filter((p) => p.season.maps > 0)
    .sort((a, b) => ratingOf(b.season) - ratingOf(a.season))
    .slice(0, 5)

  const agenda = agendaFor(game)
  const stageDef = STAGES.find((x) => x.key === game.stage)
  const daysLeft = stageDef ? stageDef.end - game.day : 0

  return (
    <>
      <Panel
        title={`${stageName(game.stage)}${daysLeft > 0 ? ` · 还剩 ${daysLeft} 天` : ''}`}
        className={agenda.some((a) => a.tone === 'urgent') ? 'alert' : 'own'}
      >
        {agenda.length ? (
          <div className="agenda">
            {agenda.map((a) => (
              <button key={a.key} className={`agenda-item ${a.tone}`}
                onClick={() => a.go && go(a.go)}>
                <span className="dot" />
                <span>{a.text}</span>
                {a.go && a.go !== 'dashboard' && <span className="tiny faint right">前往 ›</span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="small muted">目前没有需要处理的事，可以直接推进。</div>
        )}
      </Panel>

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
          {lastFixture?.result && (
            <button
              className="last-result"
              onClick={() => openMatch(lastFixture)}
              title="点击查看完整数据与回合走势"
            >
              <span className="tiny faint">上一场</span>
              <b>{game.teams[lastFixture.teamA]?.name}</b>
              <span className="mono">
                {lastFixture.result.mapsWonA} : {lastFixture.result.mapsWonB}
              </span>
              <b>{game.teams[lastFixture.teamB]?.name}</b>
              {lastFixture.result.mvp && (
                <span className="tiny muted">
                  MVP {game.players[lastFixture.result.mvp]?.ign}
                </span>
              )}
              <span className="tiny faint right">查看详情 ›</span>
            </button>
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

      {gapDays >= 4 && (
        <Panel title={`空档期 · 距下一场还有 ${gapDays} 天`}>
          <p className="small muted" style={{ marginTop: 0 }}>
            约一场训练赛：不计积分与个人数据，但会影响状态与体能。训练赛没有 BP，
            双方提前商定地图。
          </p>
          <div className="grid c3" style={{ gap: 12 }}>
            <div>
              <label className="small muted">对手</label>
              <select value={scrimOpp} onChange={(e) => setScrimOpp(e.target.value)}>
                <option value="">选择对手…</option>
                {scrimOpponents.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}（实力 {t.rating}）
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="small muted">地图</label>
              <select value={scrimMap} onChange={(e) => setScrimMap(e.target.value)}>
                <option value="">选择地图…</option>
                {pool.map((m) => (
                  <option key={m} value={m}>
                    {m}（熟练度 {me.mapPrefs[m] ?? 50}）
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="small muted">赛制</label>
              <div className="seg" style={{ marginTop: 6 }}>
                <button className={scrimFmt === 'full24' ? 'on' : ''} onClick={() => setScrimFmt('full24')}>
                  打满 24 回合
                </button>
                <button className={scrimFmt === 'first13' ? 'on' : ''} onClick={() => setScrimFmt('first13')}>
                  先到 13 分
                </button>
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <button
              className="primary"
              disabled={!scrimOpp || !scrimMap}
              onClick={() => {
                const reply = scrimReply(game, scrimOpp)
                if (!reply.ok) {
                  toast(reply.reason ?? '对方拒绝了。')
                  return
                }
                makeScrim(game, scrimOpp, game.day + 1, scrimMap, scrimFmt)
                commit()
                toast(`已约战 ${game.teams[scrimOpp]?.name}，明天在 ${scrimMap} 进行。`)
                setScrimOpp('')
              }}
            >
              发起约战
            </button>
            <span className="tiny faint">
              {scrimFmt === 'full24'
                ? '双方攻防各打 12 回合，常规训练赛做法，练完整两个半场。'
                : '先到 13 分结束，更接近正赛节奏。'}
            </span>
          </div>
          <p className="tiny faint" style={{ marginTop: 10, marginBottom: 0 }}>
            对方可能拒绝：即将与我们打正赛的球队不愿暴露战术，实力远高于我们的球队也未必愿意。
          </p>
        </Panel>
      )}

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
