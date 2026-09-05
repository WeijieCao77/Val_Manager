import { ask } from './confirm'
import { DRAW_KIND_CN, drawById } from '../engine/draw'
import { finishDraw } from '../engine/season'
import { useRef, useState } from 'react'
import { earnedNow } from '../engine/achievements'
import { record } from '../engine/profile'
import { mapCn } from '../engine/content'
import { useGame } from './ctx'
import { countTurn, countTurnDone } from '../engine/telemetry'
import { windowEnd, windowOpen } from '../engine/transfer'
import { Bar, Condition, money, OvrBadge, Panel, Roles, Stat, fmtDay } from './common'
import { advanceDay, advanceToNextMatch, acceptJob, makeScrim, scrimReply, nextRealFixtureFor, noticeHint, recentResultsFor, stageName, STAGES } from '../engine/season'
import { nextInEvent, upcomingInternational } from '../engine/qualify'
import type { ScrimFormat } from '../engine/season'
import { poolFor } from '../engine/match'
import { sortStandings } from '../engine/league'
import { agendaFor, activityOn, logActivity } from '../engine/agenda'
import { SKILL_CN, SKILL_HINT } from '../engine/manager'
import { useAction } from './useAction'
import { cycleDays } from '../engine/actions'
import Digest from './Digest'
import { squadOf, wageBill } from '../engine/roster'
import { ATTR_CN } from '../engine/types'

const ACT_CN: Record<string, string> = {
  training: '训练', scrim: '训练赛', transfer: '转会', squad: '阵容', tactics: '战术',
  commercial: '商务',
}
import { ratingOf } from '../engine/match'
import { statLine } from '../engine/player'
import type { DayReport } from '../engine/season'

export default function Dashboard() {
  const { game, commit, toast, openPlayer, openMatch, playLive, go, openDraw } = useGame()
  const act = useAction()
  const [busy, setBusy] = useState(false)
  // set when a turn starts, read when its reports come back
  const simStartRef = useRef(0)
  const [digest, setDigest] = useState<{ reports: DayReport[]; fromDay: number } | null>(null)
  const [scrimOpp, setScrimOpp] = useState<string>('')
  const [scrimMap, setScrimMap] = useState<string>('')
  const [scrimFmt, setScrimFmt] = useState<ScrimFormat>('full24')
  const me = game.teams[game.myTeam]
  const squad = squadOf(game, game.myTeam)
  const next = nextRealFixtureFor(game, game.myTeam)
  const up = upcomingInternational(game)
  const upFirst = up && (!next || up.day < next.day)
  const inEv = nextInEvent(game)
  const inEvFirst = !upFirst && inEv && (!next || inEv.day < next.day)

  const handleReports = (reports: DayReport[], fromDay: number) => {
    const pending = reports.map((r) => r.pendingMine).filter(Boolean)[0]
    commit()
    // Achievements are read off the save rather than raised as events, so the
    // check simply runs after every turn and asks what is true now. `record`
    // returns only what was NOT already unlocked — which is what stops a badge
    // popping again every day once earned — and announces the difference to
    // whoever is listening, which is the card in App.tsx.
    record({ achievements: earnedNow(game) })
    // your own match is handed to the live view, which offers watch or skip;
    // otherwise the turn reports what it did rather than dropping every note
    // but the last one into a toast
    if (pending) { playLive(pending); return }
    // a draw that is ours to hold — reveal, skip, or pick: the clock has
    // stopped on it, and the ceremony opens by itself
    const draw = reports.map((r) => r.pendingDraw).filter(Boolean)[0]
    if (draw) { openDraw(draw); return }

    // A turn that did nothing should not stop you to say so. In-season a turn
    // is one day, and 54% of a season's 203 turns produced a digest whose only
    // content was "这一天平静地过去了" — a modal to dismiss, once a day, saying
    // nothing. The date in the header is the feedback; a toast confirms the
    // click landed without blocking the next one.
    const quiet = !reports.some((r) => r.notes.length || r.playedMine.length || r.stageChanged)
    // The league simulates synchronously on the main thread. A turn that takes
    // three seconds is a frozen phone, and the code already knows whether the
    // turn produced anything at all — both are free to report.
    countTurnDone(performance.now() - simStartRef.current, quiet)
    if (quiet) {
      const span = game.day - fromDay
      toast(span > 1 ? `${fmtDay(game.day, game.year)} · 平静的 ${span} 天` : `${fmtDay(game.day, game.year)} · 平静的一天`)
      return
    }
    setDigest({ reports, fromDay })
  }

  const step = (fast: boolean) => {
    if (busy) return
    // the spine of the funnel: someone who never advances a turn never played
    simStartRef.current = performance.now()
    countTurn(game.day, game.year, fast)
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
          // In the offseason there is no fixture to stop at, so this used to
          // run the clock to the end of the season — a single click spent the
          // whole 25-day transfer window and the rebuild that goes with it.
          // Stop at the edge of an open window instead.
          const stopAt = windowOpen(game.day) ? windowEnd(game.day) : undefined
          const budget = stopAt != null ? Math.max(1, stopAt - game.day) : 40
          reports.push(...advanceToNextMatch(game, budget, { deferMine: true }))
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
  // A scrim is played tomorrow, so it fits whenever tomorrow is not the match
  // day — a two-day gap, not the four the panel used to demand. No upcoming
  // fixture at all (deep offseason) is the widest gap there is.
  const gapDays = next ? next.day - game.day : 99
  const scrimOpponents = Object.values(game.teams)
    .filter((t) => t.id !== game.myTeam && t.region === me.region)
    .sort((a, b) => Math.abs(a.rating - me.rating) - Math.abs(b.rating - me.rating))
    .slice(0, 8)
  const pool = poolFor(game)

  // whatever we are actually playing right now, preferring the current phase
  const myComps = Object.values(game.comps).filter(
    (c) => c.teams.includes(game.myTeam) && !c.champion &&
      game.fixtures.some((f) => f.comp === c.key && !f.played),
  )
  const myComp = myComps.find((c) => c.stage === game.stage) ?? myComps[0]
  const table = myComp ? sortStandings(myComp) : []
  const myRank = table.indexOf(game.myTeam)

  // Where this squad's strength sits among the clubs it actually plays. Read
  // off the same field the engine reads, so the two can never disagree.
  const myTeam = game.teams[game.myTeam]
  const leagueRatings = Object.values(game.teams)
    .filter((t) => t.region === myTeam?.region && t.tier === myTeam?.tier)
    .sort((a, b) => b.rating - a.rating)
  const ratingRank = leagueRatings.findIndex((t) => t.id === game.myTeam)

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
  // counted the same way the transfer window counts, today included: two
  // panels giving 20 and 21 for the same span reads like a lost turn
  const daysLeft = stageDef ? stageDef.end - game.day + 1 : 0

  const offers = (game.jobOffers ?? []).filter((o) => o.expiresOn > game.day)

  const takeJob = async (id: string, name: string) => {
    if (!(await ask(`确定离开 ${game.teams[game.myTeam]?.name} 出任 ${name} 的经理？\n当前阵容、资金与赛段目标都会换成新俱乐部的。`, '接受邀请'))) return
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
                  <button className="sm primary right" onClick={() => void takeJob(o.id, t.name)}>接受</button>
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
                {a.go && a.go !== 'dashboard' && (
                  <span className="tiny faint right" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>前往 ›</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="small muted">目前没有需要处理的事，可以直接推进。</div>
        )}
      </Panel>

      <div className="grid c4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Panel><Stat k="联赛排名" v={myRank >= 0 ? `${myRank + 1} / ${table.length}` : '—'} /></Panel>
        {/* The one number the manager is judged on and could not see anywhere.
            It is not a stored figure: a club's rating IS the mean of its best
            five, so it moves the moment you sign, sell or train somebody. The
            line underneath says where that sits in the league, because 78 on
            its own means nothing without the twelve clubs around it. */}
        <Panel>
          <Stat k="战队综合评分" v={`${Math.round(myTeam?.rating ?? 0)}`} />
          <div className="tiny" style={{ marginTop: 2 }}>
            {ratingRank >= 0 ? (
              <span className={ratingRank < 4 ? 'pos'
                : ratingRank >= leagueRatings.length - 3 ? 'neg' : 'faint'}>
                赛区第 {ratingRank + 1} / {leagueRatings.length} 强
              </span>
            ) : <span className="faint">阵容强度</span>}
            <span className="faint"> · 首发五人的平均能力</span>
          </div>
        </Panel>
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
            {/* the way out has to be ON the screen, not in a tooltip — three
                quarters of this audience is on a phone and never sees one */}
            {game.onNotice && (
              <span className="neg"> · ⚠ 已被警告，{noticeHint(game)}</span>
            )}
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
              <b>现在是空档期，一回合 = {cycleDays(game)} 天，行动力 4 点</b>——转会窗多半开着，
              这是做买卖的时候。{cycleDays(game) < 7 ? '这回合到赛季结束就停。' : '中途遇到正式比赛会自动停下（训练赛自动打完）。'}
            </>
          ) : (
            <>比赛期间一天一回合，行动力 2 点——
              {windowOpen(game.day) ? '转会窗现在开着，别忘了看看市场。' : '转会窗关着，事情本来就少。'}</>
          )}
        </div>
      </div>

      {/* A draw that is ours to hold. It opens by itself when the clock
          reaches it, and the clock does not move until it is drawn or
          skipped; this panel is where it is found again after being closed. */}
      {game.pendingDrawId && (() => {
        const d = drawById(game, game.pendingDrawId)
        const comp = d && game.comps[d.competitionKey]
        const n = d?.phase?.match(/swiss-r(\d)/)?.[1]
        return d ? (
          <Panel title="赛事抽签 · 等你来抽" className="alert">
            <div className="row wrap" style={{ gap: 8, padding: '4px 0', alignItems: 'center' }}>
              <span style={{ flex: '1 1 240px' }}>
                <b>{comp?.name ?? d.competitionKey} · {DRAW_KIND_CN[d.kind]}{n ? ` 第 ${n} 轮` : ''}</b>
                <span className="small muted"> · {d.kind === 'masters-playoff-pick' ? '轮到你选八强对手' : '抽完对阵才会写进赛程'}，抽签结束前赛季不会推进。</span>
              </span>
              <button className="primary sm" onClick={() => openDraw(d.id)}>{d.kind === 'masters-playoff-pick' ? '去选择' : '进入抽签'}</button>
              <button className="sm ghost" onClick={() => { finishDraw(game, d, true); commit(); toast(d.kind === 'masters-playoff-pick' ? '交给了教练组。' : '抽签结果已揭晓，对阵写进了赛程。') }}>快进跳过</button>
            </div>
          </Panel>
        ) : null
      })()}

      <div className="grid c2">
        <Panel title="下一场比赛">
          {upFirst ? (
            <>
              <div className="score-line" style={{ padding: '6px 0 14px' }}>
                <div className="t a" title={game.teams[game.myTeam]?.name}>{game.teams[game.myTeam]?.tag}</div>
                <div className="s muted" style={{ fontSize: 20 }}>vs</div>
                <div className="t muted">待定</div>
              </div>
              <div className="row small muted wrap" style={{ gap: 10, justifyContent: 'center' }}>
                <span className="tag t1">{up.name}</span>
                <span className="tag">{up.swiss ? '瑞士轮 第1轮' : '季后赛'}</span>
                <span className="tag">约 {fmtDay(up.day, game.year)}（{up.day - game.day} 天后）</span>
              </div>
              <p className="tiny faint center" style={{ margin: '10px 0 0' }}>
                已锁定：{up.how}。对阵要等四个赛区都打完才抽，抽出来会写进赛程。
              </p>
            </>
          ) : inEvFirst ? (
            <>
              <div className="score-line" style={{ padding: '6px 0 14px' }}>
                <div className="t a" title={game.teams[game.myTeam]?.name}>{game.teams[game.myTeam]?.tag}</div>
                <div className="s muted" style={{ fontSize: 20 }}>vs</div>
                <div className="t muted">待定</div>
              </div>
              <div className="row small muted wrap" style={{ gap: 10, justifyContent: 'center' }}>
                <span className="tag t1">{inEv.comp.name}</span>
                <span className="tag">{inEv.round}</span>
                <span className="tag">{fmtDay(inEv.day, game.year)}（{inEv.day - game.day} 天后）</span>
              </div>
              <p className="tiny faint center" style={{ margin: '10px 0 0' }}>
                对手要等上一轮打完才知道；日期是定好的。
              </p>
            </>
          ) : next ? (
            <>
              <div className="score-line" style={{ padding: '6px 0 14px' }}>
                <div className="t a" title={game.teams[next.teamA]?.name}>{game.teams[next.teamA]?.tag}</div>
                <div className="s muted" style={{ fontSize: 20 }}>BO{next.bo}</div>
                <div className="t" title={game.teams[next.teamB]?.name}>{game.teams[next.teamB]?.tag}</div>
              </div>
              <div className="row small muted wrap" style={{ gap: 10, justifyContent: 'center' }}>
                <span className="tag">{game.comps[next.comp]?.name ?? next.comp}</span>
                <span className="tag">{next.label.replace(/^KO:\d+:/, '')}</span>
                <span className="tag">{fmtDay(next.day, game.year)}（{next.day - game.day} 天后）</span>
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
                      <span className="tiny faint">{fmtDay(f.day, game.year)}</span>
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
          // A drill only counts while its seven days are still running. The
          // plan is left in state after it settles so the panel can show what
          // was last chosen — printing it here made a finished, idle drill
          // look like it was still training the squad, week after week.
          const drillRunning = game.drillLock != null && game.drillLock > game.day
          const drill = drillRunning ? game.drill : undefined
          const drillText =
            !drill || drill.kind === 'none' ? null
              : drill.kind === 'map' ? `团队跑图 · ${mapCn(drill.map)}`
                : drill.kind === 'review' ? '教练复盘'
                  : `${game.players[drill.playerId]?.ign} 学习${drill.role}（${Math.round(game.players[drill.playerId]?.rolePro?.[drill.role] ?? 0)}%）`
          const duoText = drillRunning && game.duo
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
                    {f.scrim ? ` @ ${mapCn(f.scrim.map)}` : ''}，{f.day - game.day <= 0 ? '今天' : `${f.day - game.day} 天后`}进行
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
                    <td><b>{p.ign}</b>{p.isIgl && (
                      <span className="tag" style={{ marginLeft: 5 }}
                        title={p.iglSource === 'inferred' ? '真实指挥尚未确认，由系统临时代行'
                          : game.teams[game.myTeam]?.igl === p.id ? '主指挥' : '副指挥：主指挥不在场上时由他喊话'}>
                        {p.iglSource === 'inferred' ? '推定 IGL' : game.teams[game.myTeam]?.igl === p.id ? '主指挥' : '副指挥'}
                      </span>
                    )}</td>
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

        {gapDays < 2 && (
          <Panel title="训练赛">
            <p className="small muted" style={{ margin: 0 }}>
              {gapDays <= 0 ? '今天有正式比赛' : '明天就是正式比赛'}，训练赛安排不下——训练赛都约在第二天打，赛后就能再约。
            </p>
          </Panel>
        )}
        {gapDays >= 2 && (
        <Panel title={next ? `空档期 · 距下一场还有 ${gapDays} 天` : '空档期 · 本赛段没有比赛'}>
          <p className="small muted" style={{ marginTop: 0 }}>
            约一场训练赛：<b>不计积分、不进个人数据</b>，没有 BP，地图提前商定。
            <b>按「战术」页给这张图定的英雄阵容打</b>，练的也是那套阵容。
          </p>
          <div className="tiny faint" style={{ margin: '0 0 12px', lineHeight: 1.85 }}>
            每人每张图：<b style={{ color: 'var(--win)' }}>赢 状态 +0.4~2.2</b>／
            <b style={{ color: 'var(--accent)' }}>输 −0.4~2.2</b>，<b>体能 −3.5~6.5</b>，队内默契累积。
            <b style={{ color: 'var(--win)' }}>约在哪张图就练哪张图</b>：地图熟练度 +0.6~1.0（<b>到 80 就到头</b>），阵容熟练度 +6。
          </div>
          <div className="grid c3" style={{ gap: 12, alignItems: 'end' }}>
            <div className="field">
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
            <div className="field">
              <label className="small muted">地图</label>
              <select value={scrimMap} onChange={(e) => setScrimMap(e.target.value)}>
                <option value="">选择地图…</option>
                {pool.map((m) => (
                  <option key={m} value={m}>
                    {mapCn(m)}（熟练度 {Math.round(me.mapPrefs[m] ?? 50)}）
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="small muted">赛制</label>
              <div className="seg">
                {/* the short forms the activity log already uses; the line under
                    the button spells out what each one means */}
                <button className={scrimFmt === 'full24' ? 'on' : ''} onClick={() => setScrimFmt('full24')}>
                  24 回合
                </button>
                <button className={scrimFmt === 'first13' ? 'on' : ''} onClick={() => setScrimFmt('first13')}>
                  先到 13
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
              <span className="d">{fmtDay(n.day, game.year)}</span>
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
      <div className="advance-spacer" />
    </>
  )
}
