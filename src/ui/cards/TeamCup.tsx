import { useCallback, useEffect, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import { teamCupJoin, teamCupLeave, teamCupState } from '../../engine/teamCupClient'
import type { TeamCupMine, TeamCupState, TeamMember, TeamTie } from '../../engine/teamCupClient'
import { TEAM_CUP_HOURS, TEAM_CUP_MIN_TEAMS, TEAM_DUEL_COINS, TEAM_SIZE, teamCupPrize } from '../../engine/teamCup'
import { PACKS } from '../../engine/gacha'
import { serverNow } from '../../engine/account'

const clock = (ms: number) =>
  new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms))
const countdown = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h ? `${h} 小时 ${m} 分` : m ? `${m} 分 ${s % 60} 秒` : `${s} 秒`
}
const roundName = (rounds: number, round: number) => {
  const left = rounds - 1 - round
  return left === 0 ? '决赛' : left === 1 ? '半决赛' : left === 2 ? '八强' : `第 ${round + 1} 轮`
}
const prizeText = (teams: number, place: 1 | 2 | 4 | 8) => {
  const p = teamCupPrize(teams, place)
  const bits = [p.pack ? `${PACKS[p.pack].name}${(p.count ?? 1) > 1 ? ` ×${p.count}` : ''}` : '', p.coins ? `${p.coins} 金币` : ''].filter(Boolean)
  return bits.length ? bits.join(' + ') : '—'
}
const placeName = (p: number | null | undefined) => (p === 1 ? '冠军' : p === 2 ? '亚军' : p === 4 ? '四强' : p === 8 ? '八强' : null)

/**
 * 全服组队杯: strangers dealt into fives.
 *
 * Nothing is played on this device. The page signs the account up, then shows
 * the team it was dealt into and each tie as the server plays it: five duels,
 * first seat against first seat, and the side with three of them goes on.
 */
export default function TeamCup() {
  const { toast } = useCards()
  const [st, setSt] = useState<TeamCupState | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => serverNow())

  const pull = useCallback(async () => {
    const r = await teamCupState()
    if (r.ok) { setSt(r); setWhy(null) } else setWhy(r.why ?? '读不到组队杯。')
  }, [])
  useEffect(() => {
    void pull()
    const hidden = () => document.visibilityState === 'hidden'
    const poll = setInterval(() => { if (!hidden()) void pull() }, 45_000)
    const tick = setInterval(() => { if (!hidden()) setNow(serverNow()) }, 1000)
    const onVis = () => { if (!hidden()) void pull() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(poll); clearInterval(tick); document.removeEventListener('visibilitychange', onVis) }
  }, [pull])
  // a round or a start falling due: ask again a few seconds after it
  const dueAt = st?.live?.nextAt ?? st?.next?.starts ?? null
  useEffect(() => {
    if (!dueAt) return
    const wait = dueAt - serverNow() + 4000
    if (wait <= 0 || wait > 3600_000) return
    const t = setTimeout(() => void pull(), wait)
    return () => clearTimeout(t)
  }, [dueAt, pull])

  const join = async () => {
    setBusy(true)
    const r = await teamCupJoin()
    setBusy(false)
    if (!r.ok) { toast(r.why ?? '没报上，稍后再试。'); return }
    toast(`报上了，${clock(r.starts)} 开赛。开赛那一刻的阵容（综合分 ${r.score}）就是你的参赛阵容。`)
    void pull()
  }
  const leave = async () => {
    setBusy(true)
    await teamCupLeave()
    setBusy(false)
    void pull()
  }

  const next = st?.next, live = st?.live, last = st?.last
  const guess = Math.floor((next?.signed ?? 0) / TEAM_SIZE)
  return (
    <>
      <Panel title="全服组队杯">
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.8 }}>
          报名的人按阵容分<b>发成五人队</b>：每队从高到低五档各一人，队和队实力拉平。队伍对决是<b>五场单挑</b>，
          一号位对一号位、五号位对五号位，各打一场 BO3，<b>赢三场的队晋级</b>，单败到决赛。
          <b>全队奖励一样</b>；自己每赢一场单挑另得 <b>{TEAM_DUEL_COINS} 金币</b>。免费报名，不耗体力。
        </p>
        <p className="tiny faint" style={{ lineHeight: 1.7 }}>
          每天 {TEAM_CUP_HOURS.map((h) => `${String(h).padStart(2, '0')}:00`).join('、')} 开赛（北京时间），凌晨不办。不够 {TEAM_CUP_MIN_TEAMS * TEAM_SIZE} 人不开。
          多出来不满五人的，各自加入一支队当第六人，轮流上场。
        </p>
        {why && <p className="small warn">{why}</p>}
        {next && (
          <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
            <span className="small">下一场 <b>{clock(next.starts)}</b> · 还有 {countdown(next.starts - now)} · 已报名 <b>{next.signed}</b> 人{guess >= TEAM_CUP_MIN_TEAMS ? `（约 ${guess} 队）` : ''}</span>
            {next.joined
              ? <button className="sm ghost" disabled={busy} onClick={() => void leave()}>已报名 · 退出</button>
              : <button className="sm primary" disabled={busy} onClick={() => void join()}>报名</button>}
          </div>
        )}
        {next && guess >= 1 && (
          <p className="tiny faint" style={{ marginBottom: 0 }}>
            按现在的人数：冠军 {prizeText(guess, 1)} · 亚军 {prizeText(guess, 2)} · 四强 {prizeText(guess, 4)} · 八强 {prizeText(guess, 8)}（每人）
          </p>
        )}
      </Panel>

      {live && (
        <Panel title={`进行中 · ${live.teams} 队 · ${roundName(live.rounds, live.round)}`}>
          <p className="small muted" style={{ marginTop: 0 }}>
            {live.entrants} 人参赛，共 {live.rounds} 轮。{live.nextAt ? <>下一轮 <b>{clock(live.nextAt)}</b>（{countdown(live.nextAt - now)}）</> : null}
          </p>
          {live.me ? <Mine cup={live} mine={live.me} /> : <p className="small faint" style={{ marginBottom: 0 }}>这一场你没报名。</p>}
        </Panel>
      )}

      {last && (
        <Panel title={`上一场 · ${clock(last.starts)} · ${last.teams} 队`}>
          {last.final && (
            <>
              <p className="small" style={{ marginTop: 0 }}>
                冠军队：{last.final.champions.map((m) => <b key={m.tag} style={{ marginRight: 8 }}>{m.name} <span className="faint">{m.tag}</span></b>)}
              </p>
              {/* the asker's own run below already shows the final if they were in it */}
              {!last.me?.ties?.some((t) => t.round === last.final!.tie.round) && <Tie tie={last.final.tie} rounds={last.rounds} />}
            </>
          )}
          {last.me && <Mine cup={last} mine={last.me} done />}
        </Panel>
      )}
    </>
  )
}

function Mine({ cup, mine, done = false }: { cup: { teams: number; rounds: number }; mine: TeamCupMine; done?: boolean }) {
  if (!mine.seated) return <p className="small faint" style={{ marginBottom: 0 }}>开赛时你的阵容不满五人，这一场没排上。</p>
  const place = placeName(mine.place)
  return (
    <div style={{ marginTop: 8 }}>
      <div className="small" style={{ marginBottom: 6 }}>
        你在 <b>第 {(mine.team ?? 0) + 1} 队</b>
        {done || !mine.alive
          ? <> · {place ? <b>{place}</b> : '已出局'}{mine.prize?.pack ? <> · {prizeText(cup.teams, mine.place as 1 | 2 | 4 | 8)}</> : null}</>
          : <> · 还在比赛中</>}
        {' '}· 你的单挑 {mine.duelWins}/{mine.duels} 胜{mine.duelWins ? `（${(mine.duelWins ?? 0) * TEAM_DUEL_COINS} 金币）` : ''}
      </div>
      <Members members={mine.members ?? []} />
      {(mine.ties ?? []).slice().reverse().map((t) => <Tie key={`${t.round}-${t.slot}`} tie={t} rounds={cup.rounds} mineTeam={mine.team} />)}
      {done && (place || mine.duelWins) ? <p className="tiny faint" style={{ marginBottom: 0 }}>奖励已发到信箱。</p> : null}
    </div>
  )
}

function Members({ members }: { members: TeamMember[] }) {
  return (
    <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
      {members.map((m, i) => (
        <span key={m.tag + i} className={`tag${m.me ? ' t1' : ''}`} style={{ whiteSpace: 'nowrap' }}>
          {i + 1} 号位 {m.name} <span className="faint">{m.tag}</span> · {m.score ?? '—'}
        </span>
      ))}
    </div>
  )
}

function Tie({ tie, rounds, mineTeam }: { tie: TeamTie; rounds: number; mineTeam?: number }) {
  if (tie.bye) return <div className="tiny faint" style={{ padding: '4px 0' }}>{roundName(rounds, tie.round)}：轮空</div>
  const flip = mineTeam !== undefined && tie.teamB === mineTeam
  const mine = (flip ? tie.winsB : tie.winsA) ?? 0, theirs = (flip ? tie.winsA : tie.winsB) ?? 0
  return (
    <div style={{ borderTop: '1px solid var(--line-soft)', padding: '6px 0' }}>
      <div className="small" style={{ marginBottom: 4 }}>
        <b>{roundName(rounds, tie.round)}</b> · 第 {(flip ? tie.teamB! : tie.teamA) + 1} 队 vs 第 {(flip ? tie.teamA : tie.teamB!) + 1} 队
        {tie.played ? <> · <b style={mineTeam === undefined ? undefined : { color: mine > theirs ? 'var(--win)' : 'var(--loss)' }}>{mine} : {theirs}</b></> : <span className="faint"> · 还没打</span>}
      </div>
      {tie.duels.map((d, i) => {
        const l = flip ? d.b : d.a, r = flip ? d.a : d.b
        const lWon = flip ? !d.aWon : d.aWon
        return (
          <div key={i} className="tiny mono" style={{ display: 'flex', gap: 6, padding: '2px 0', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <span className="faint" style={{ flex: 'none' }}>{i + 1} 号位</span>
            <span style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: l.me ? 700 : undefined }}>{l.name} {l.score ?? ''}</span>
            <b style={{ flex: 'none', color: lWon ? 'var(--win)' : 'var(--loss)' }}>{flip ? d.mapsB : d.mapsA} : {flip ? d.mapsA : d.mapsB}</b>
            <span style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right', fontWeight: r.me ? 700 : undefined }}>{r.score ?? ''} {r.name}</span>
          </div>
        )
      })}
    </div>
  )
}
