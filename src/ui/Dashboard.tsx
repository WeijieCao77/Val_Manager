import { useState } from 'react'
import { useGame } from './ctx'
import { Bar, Condition, money, OvrBadge, Panel, Roles, Stat, fmtDay } from './common'
import { advanceDay, advanceToNextMatch, acceptJob, makeScrim, scrimReply, nextRealFixtureFor, recentResultsFor, stageName, STAGES } from '../engine/season'
import type { ScrimFormat } from '../engine/season'
import { activePool } from '../engine/match'
import { sortStandings } from '../engine/league'
import { agendaFor, activityOn, logActivity } from '../engine/agenda'
import { SKILL_CN, SKILL_HINT } from '../engine/manager'
import { useAction } from './useAction'
import { cycleDays } from '../engine/actions'
import Digest from './Digest'
import FirstTurn, { firstTurnDone } from './FirstTurn'
import { squadOf, wageBill } from '../engine/world'
import { ATTR_CN } from '../engine/types'

const ACT_CN: Record<string, string> = {
  training: '训练', scrim: '训练赛', transfer: '转会', squad: '阵容', tactics: '战术',
  commercial: '商务',
}
import { ratingOf } from '../engine/match'
import { statLine } from '../engine/player'
import type { DayReport } from '../engine/season'

export default function Dashboard() {
  const { game, commit, toast, openPlayer, openMatch, playLive, go } = useGame()
  const act = useAction()
  const [busy, setBusy] = useState(false)
  const [digest, setDigest] = useState<{ reports: DayReport[]; fromDay: number } | null>(null)
  const [coaching, setCoaching] = useState(() => !firstTurnDone())
  const [scrimOpp, setScrimOpp] = useState<string>('')
  const [scrimMap, setScrimMap] = useState<string>('')
  const [scrimFmt, setScrimFmt] = useState<ScrimFormat>('full24')
  const me = game.teams[game.myTeam]
  const squad = squadOf(game, game.myTeam)
  const next = nextRealFixtureFor(game, game.myTeam)

  const handleReports = (reports: DayReport[], fromDay: number) => {
    const pending = reports.map((r) => r.pendingMine).filter(Boolean)[0]
    commit()
    // your own match is handed to the live view, which offers watch or skip;
    // otherwise the turn reports what it did rather than dropping every note
    // but the last one into a toast
    if (pending) playLive(pending)
    else setDigest({ reports, fromDay })
  }

  const step = (fast: boolean) => {
    if (busy) return
    setBusy(true)
    // let the button paint its disabled state before the sim blocks the thread
    window.setTimeout(() => {
      try {
        // one turn is a day in-season and a week in a long gap, so the plain
        // advance follows the same cadence the action budget is granted on
        const span = cycleDays(game)
        const from = game.day
        const reports: DayReport[] = []
        if (fast) {
          reports.push(...advanceToNextMatch(game, 40, { deferMine: true }))
        } else {
          for (let i = 0; i < span; i++) {
            // over a multi-day turn, practice matches play themselves so the
            // week actually runs; a competitive fixture still stops for you
            reports.push(advanceDay(game, { deferMine: true, autoScrims: span > 1 }))
            const last = reports[reports.length - 1]
            if (last.pendingMine || last.seasonEnded) break
          }
        }
        handleReports(reports, from)
      } finally {
        setBusy(false)
      }
    }, 10)
  }

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

  const starters = me.starters.map((id) => game.players[id]).filter(Boolean)
  const agenda = agendaFor(game)
  const stageDef = STAGES.find((x) => x.key === game.stage)
  const daysLeft = stageDef ? stageDef.end - game.day : 0

  const offers = (game.jobOffers ?? []).filter((o) => o.expiresOn > game.day)

  const takeJob = (id: string, name: string) => {
    if (!window.confirm(`确定离开 ${game.teams[game.myTeam]?.name} 出任 ${name} 的经理？\n当前阵容、资金与赛段目标都会换成新俱乐部的。`)) return
    toast(acceptJob(game, id))
    commit()
  }

  return (
    <>
      {digest && (
        <Digest
          reports={digest.reports} fromDay={digest.fromDay}
          onClose={() => setDigest(null)}
        />
      )}
      {coaching && <FirstTurn onDone={() => setCoaching(false)} />}
      {offers.length > 0 && (
        <Panel title={`执教邀请 · ${offers.length}`} className="alert" flush>
          <div className="agenda">
            {offers.map((o) => {
              const t = game.teams[o.teamId]
              if (!t) return null
              return (
                <div key={o.id} className="agenda-item" style={{ cursor: 'default' }}>
                  <span className="dot" />
                  <span>
                    <b>{t.name}</b>
                    <span className="tag" style={{ marginLeft: 6 }}>声望 {t.reputation}</span>
                    <span className="tag" style={{ marginLeft: 4 }}>{t.tier === 1 ? '一级联赛' : '次级联赛'}</span>
                    <div className="tiny faint" style={{ marginTop: 3 }}>
                      {o.pitch} · {o.expiresOn - game.day} 天内答复
                    </div>
                  </span>
                  <button className="sm primary right" onClick={() => takeJob(o.id, t.name)}>接受</button>
                </div>
              )
            })}
          </div>
          <p className="tiny faint" style={{ padding: '0 14px 12px', margin: 0 }}>
            成绩越好、名气越大，来找你的俱乐部就越强。不接受的话邀请会自行过期。
            也可以去<b>经理</b>页面主动向别的球队投申请。
          </p>
        </Panel>
      )}

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

      <div className="grid c4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Panel><Stat k="联赛排名" v={myRank >= 0 ? `${myRank + 1} / ${table.length}` : '—'} /></Panel>
        <Panel><Stat k="资金" v={money(game.finances.balance)} /></Panel>
        <Panel><Stat k="赛季薪资" v={money(bill)} /></Panel>
        <Panel>
          <Stat k="董事会信任" v={`${Math.round(game.boardConfidence)}%`} />
          <div className="tiny" style={{ marginTop: 2 }}>
            {game.objective ? (
              <span className={myRank >= 0 && myRank + 1 <= game.objective.placeAtLeast
                ? 'pos' : 'neg'}>
                目标：{game.objective.text}
              </span>
            ) : <span className="faint">本赛段暂无目标</span>}
            {game.onNotice && <span className="neg"> · ⚠ 已被警告</span>}
          </div>
        </Panel>
        {game.manager && (
          <Panel>
            <Stat k="经理声望" v={`${Math.round(game.manager.reputation)}`} />
            <div className="row wrap tiny" style={{ gap: 5, marginTop: 6 }}>
              {(Object.keys(SKILL_CN) as (keyof typeof SKILL_CN)[])
                .filter((k) => (game.manager!.skills[k] ?? 50) >= 65)
                .map((k) => (
                  <span key={k} className="tag" title={SKILL_HINT[k]}>
                    {SKILL_CN[k]} {game.manager!.skills[k]}
                  </span>
                ))}
            </div>
            <div className="tiny faint" style={{ marginTop: 2 }}>
              {game.manager.reputation >= 85 ? '顶级豪门也会考虑你'
                : game.manager.reputation >= 72 ? '强队愿意听你开条件'
                : game.manager.reputation >= 58 ? '在圈内有一定名气'
                : '还需要成绩来证明自己'}
            </div>
          </Panel>
        )}
      </div>

      {/* Advancing time is the one thing you always need and the thing players
          could not find, so it gets its own bar rather than a corner button. */}
      <div className="advance-bar">
        <button className="advance-main" disabled={busy} onClick={() => step(false)}>
          {busy ? '模拟中…' : `推进 ${cycleDays(game) > 1 ? `${cycleDays(game)} 天` : '一天'} ▶`}
        </button>
        <button className="advance-alt" disabled={busy} onClick={() => step(true)}>
          直接推进到下一场比赛
        </button>
        <div className="advance-note">
          {cycleDays(game) > 1 ? (
            <>
              <b>现在是空档期，一回合 = 7 天，行动力 4 点</b>——转会窗多半开着，
              这是做买卖的时候。中途遇到正式比赛会自动停下（训练赛自动打完）。
            </>
          ) : (
            <>比赛期间一天一回合，行动力 2 点——转会窗关着，事情本来就少。</>
          )}
        </div>
      </div>

      <div className="grid c2">
        <Panel title="下一场比赛">
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
          {(() => {
            const recent = recentResultsFor(game, game.myTeam, 5)
            if (!recent.length) return null
            return (
              <div style={{ marginTop: 12 }}>
                <div className="tiny faint" style={{ marginBottom: 5 }}>最近比赛 · 点击查看数据</div>
                {recent.map((f) => {
                  const r = f.result!
                  const mine = f.teamA === game.myTeam
                  const won = (r.mapsWonA > r.mapsWonB) === mine
                  const foe = game.teams[mine ? f.teamB : f.teamA]?.tag
                  return (
                    <button key={f.id} className="recent-row" onClick={() => openMatch(f)}>
                      <span className={won ? 'pos' : 'neg'} style={{ width: 14 }}>{won ? '胜' : '负'}</span>
                      <span className="mono" style={{ width: 34 }}>
                        {mine ? r.mapsWonA : r.mapsWonB}–{mine ? r.mapsWonB : r.mapsWonA}
                      </span>
                      <span className="small" style={{ flex: 1, textAlign: 'left' }} title={game.teams[mine ? f.teamB : f.teamA]?.name}>{foe}</span>
                      <span className="tag">{f.comp === 'scrim' ? '训练赛' : game.comps[f.comp]?.name ?? f.comp}</span>
                      <span className="tiny faint">{fmtDay(f.day)}</span>
                    </button>
                  )
                })}
              </div>
            )
          })()}
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

        <Panel title="今日操作" flush>
        {(() => {
          const acts = activityOn(game, game.day)
          const drill = game.drill
          const drillText =
            !drill || drill.kind === 'none' ? null
              : drill.kind === 'map' ? `团队跑图 · ${drill.map}`
                : drill.kind === 'review' ? '教练复盘'
                  : `${game.players[drill.playerId]?.ign} 学习${drill.role}（${Math.round(game.players[drill.playerId]?.rolePro?.[drill.role] ?? 0)}%）`
          const duoText = game.duo
            ? `双排练 · ${game.players[game.duo.a]?.ign} + ${game.players[game.duo.b]?.ign}`
            : null
          const focuses = me.starters
            .map((id) => game.players[id])
            .filter(Boolean)
            .map((p) => {
              const f = game.training[p!.id] ?? 'rest'
              return `${p!.ign}：${f === 'rest' ? '休息' : ATTR_CN[f as keyof typeof ATTR_CN]}`
            })
          const scrimToday = game.fixtures.filter(
            (f) => f.comp === 'scrim' && f.day >= game.day &&
              (f.teamA === game.myTeam || f.teamB === game.myTeam) && !f.played,
          )
          return (
            <>
              {acts.length === 0 && !drillText && !duoText && (
                <div className="news-item"><span className="muted small">今天还没有任何操作。</span></div>
              )}
              {acts.map((a, i) => (
                <div key={i} className="news-item">
                  <span className="d">{ACT_CN[a.kind]}</span><span>{a.text}</span>
                </div>
              ))}
              <div className="news-item">
                <span className="d">训练</span>
                <span className="small">
                  {drillText ? <b>{drillText}</b> : <span className="muted">未安排团队训练</span>}
                  {duoText && <b> ＋ {duoText}</b>}
                  <span className="faint"> · 个人：{focuses.join('，')}</span>
                </span>
              </div>
              {scrimToday.map((f) => (
                <div key={f.id} className="news-item">
                  <span className="d">训练赛</span>
                  <span className="small">
                    已约 {game.teams[f.teamA === game.myTeam ? f.teamB : f.teamA]?.name}
                    {f.scrim ? ` @ ${f.scrim.map}` : ''}，{f.day - game.day <= 0 ? '今天' : `${f.day - game.day} 天后`}进行
                  </span>
                </div>
              ))}
            </>
          )
        })()}
      </Panel>
      </div>

      <Panel title="选手情况" flush>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>首发五人</th><th>位置</th><th className="num">能力</th>
                <th>体能</th><th className="num">士气</th><th>需要注意</th>
              </tr>
            </thead>
            <tbody>
              {starters.map((p) => {
                const notes: string[] = []
                if (p.injuredUntil > game.day) notes.push(`伤停 ${p.injuredUntil - game.day} 天`)
                if (p.fatigue >= 70) notes.push('体能偏低，考虑休息')
                if (p.morale <= 45) notes.push('士气低落')
                if ((p.grievance ?? 0) > 45) notes.push('对出场时间不满')
                if ((game.commercialDays?.[p.id] ?? 0) >= 2) notes.push('本周商务占用多')
                return (
                  <tr key={p.id} className="clickable" onClick={() => openPlayer(p.id)}>
                    <td><b>{p.ign}</b>{p.isIgl && <span className="tag" style={{ marginLeft: 5 }}>IGL</span>}</td>
                    <td><Roles p={p} /></td>
                    <td className="num"><OvrBadge value={p.overall} /></td>
                    <td style={{ width: 110 }}><Condition p={p} day={game.day} /></td>
                    <td className="num mono">{Math.round(p.morale)}</td>
                    <td className="small">
                      {notes.length
                        ? <span style={{ color: 'var(--warn)' }}>{notes.join('，')}</span>
                        : <span className="faint">状态正常</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid c2">
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
                        <td title={game.teams[id]?.name}>{game.teams[id]?.tag}</td>
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
                    {m}（熟练度 {Math.round(me.mapPrefs[m] ?? 50)}）
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
                act('scrim', () => {
                  makeScrim(game, scrimOpp, game.day + 1, scrimMap, scrimFmt)
                  logActivity(game, 'scrim',
                    `约战 ${game.teams[scrimOpp]?.name} @ ${scrimMap}（${scrimFmt === 'full24' ? '24 回合' : '先到 13'}）`)
                  toast(`已约战 ${game.teams[scrimOpp]?.name}，明天在 ${scrimMap} 进行。`)
                  setScrimOpp('')
                })
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
      </div>


      

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
