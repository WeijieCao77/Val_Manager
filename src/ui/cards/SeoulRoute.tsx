import { useEffect, useRef, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import MatchReport from './Report'
import { PACKS } from '../../engine/gacha'
import type { ArenaResult } from '../../engine/arena'
import { SEOUL_TEAMS } from '../../engine/seoul2024'
import { ROUTE_LEGS_MAX, SEOUL_FIVES, SEOUL_ROUTES, cleanRoute, placementName } from '../../engine/seoulRoute'
import type { RouteLeg, RouteOutcome, SeoulRouteState } from '../../engine/seoulRoute'
import { track } from '../../engine/telemetry'

/**
 * 首尔征途: a 2024 team's road through Seoul, one match at a time.
 *
 * Played on the server like the cup — the fives, the maps and the seed are its
 * business. What this screen adds is the year: every match is shown beside
 * what happened in August 2024, and the losses stay on the record with the wins.
 */
const teamOf = (tag: string) => SEOUL_TEAMS.find((t) => t.tag === tag)!
const PACK = PACKS.seoul2024.name

export default function SeoulRoute() {
  const { g, act, toast } = useCards()
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<{ team: string; stage: number; res: ArenaResult; out: RouteOutcome } | null>(null)
  // counted up by 出发, so the road that opens is brought into view once it has rendered
  const [jump, setJump] = useState(0)
  const roadRef = useRef<HTMLDivElement>(null)
  const s = cleanRoute(g.seoulRoute)
  const run = s.run

  // The road opens above the picker, and on a phone the tap was sixteen cards
  // further down. Scrolled after the render and without animation: a smooth
  // scroll started before the panel existed was pushed back down by scroll
  // anchoring when the panel appeared, and left the picker on screen.
  useEffect(() => {
    if (jump) roadRef.current?.scrollIntoView({ block: 'start' })
  }, [jump, run?.startedAt])

  const start = async (team: string) => {
    if (run && run.team !== team && !window.confirm(`放弃 ${run.team} 这一趟？进度清零，打过的比赛记录保留。`)) return
    setBusy(true)
    const r = await act('seoul_start', { team })
    setBusy(false)
    if (!r.ok) { toast(r.why); return }
    setJump((n) => n + 1)
  }

  const play = async () => {
    if (!run) return
    const { team, stage } = run
    setBusy(true)
    const r = await act('seoul_play')
    setBusy(false)
    if (!r.ok) { toast(r.why); return }
    const { res, out } = r.result as { res: ArenaResult; out: RouteOutcome }
    track('card_match', { mode: 'seoul', won: res.win, team, stage })
    setShown({ team, stage, res, out })
  }

  const quit = async () => {
    if (!run || !window.confirm('放弃这一趟？进度清零，打过的比赛记录保留。')) return
    const r = await act('seoul_quit')
    if (!r.ok) toast(r.why)
  }

  return (
    <>
      <Panel title="首尔征途" actions={<span className="tiny muted">不花体力 · 输了免费重打</span>}>
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.75 }}>
          选一支 2024 首尔冠军赛的队伍，按当年的赛程一场场打。对手和顺序照当年，双方都是当届五人、当届能力，
          <b>不看收藏和等级</b>。赢了才打下一场；赢下当年输掉的比赛算<b>改写历史</b>，后面的对手不变。
        </p>
        <p className="small muted" style={{ marginBottom: 0, lineHeight: 1.75 }}>
          奖励一共两个{PACK}：第一次赢下一场给一个{s.firstWin ? '（已领）' : ''}，第一次打通任意一支队再给一个{s.firstClear ? '（已领）' : ''}。之后只记纪录：每支队最少输几场打通。
        </p>
      </Panel>

      {run && (
        <div ref={roadRef}>
          <RunPanel s={s} busy={busy} onPlay={() => void play()} onQuit={() => void quit()} />
        </div>
      )}

      <Panel title={run ? '换一支队' : '选一支队'}>
        <Picker s={s} busy={busy} onStart={(tag) => void start(tag)} />
      </Panel>

      {shown && (() => {
        const st = SEOUL_ROUTES[shown.team][shown.stage]
        const { res, out } = shown
        return (
          <MatchReport
            result={res}
            opponentId={st.opp}
            opponentName={teamOf(st.opp).name}
            mySquad={SEOUL_FIVES[shown.team]}
            mineTitle={`${teamOf(shown.team).name} ${shown.team}`}
            level={() => 0}
            onClose={() => setShown(null)}
            extra={
              <>
                <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
                  <span className="chiplet">当年 {st.won}:{st.lost}，你 {res.mapsWon}:{res.mapsLost}</span>
                  {out.rewrote && <span className="chiplet" style={{ color: 'var(--warn)' }}>改写历史</span>}
                  {out.packs > 0 && <span className="chiplet" style={{ color: 'var(--warn)' }}>{PACK} ×{out.packs}</span>}
                  {out.cleared && (
                    <span className="chiplet" style={{ color: 'var(--win)' }}>
                      打通 · 这一趟输了 {out.losses} 场{out.bestBefore === null || out.losses < out.bestBefore ? ' · 新纪录' : ''}
                    </span>
                  )}
                  {!out.win && (
                    <button className="sm primary" disabled={busy} onClick={() => { setShown(null); void play() }}>
                      再打一次
                    </button>
                  )}
                </div>
                <p className="tiny faint" style={{ margin: '0 0 12px' }}>
                  当年：{st.maps.map((m) => `${m.map} ${m.mine}:${m.theirs}`).join(' · ')}
                </p>
              </>
            }
          />
        )
      })()}
    </>
  )
}

function RunPanel({ s, busy, onPlay, onQuit }: {
  s: SeoulRouteState; busy: boolean; onPlay: () => void; onQuit: () => void
}) {
  const run = s.run!
  const team = teamOf(run.team)
  const road = SEOUL_ROUTES[run.team]
  const next = road[run.stage]
  const legs = s.records[run.team]?.legs ?? []
  const thisRun = legs.filter((l) => l.at >= run.startedAt)
  return (
    <Panel
      title={`${team.name} · 2024 ${placementName(team.placement)}`}
      actions={<span className="tiny muted">这一趟输了 {run.losses} 场</span>}
    >
      <div className="grid" style={{ gap: 8 }}>
        {road.map((st, i) => {
          const tries = thisRun.filter((l) => l.stage === i)
          const cls = i < run.stage ? 'won' : i === run.stage ? 'now' : ''
          return (
            <div key={st.series} className={`bracket-leg ${cls}`} style={{ flexWrap: 'wrap', rowGap: 4 }}>
              <b style={{ minWidth: '9.5em' }}>{st.stage}</b>
              <span style={{ flex: 1, minWidth: '9em' }}>
                {teamOf(st.opp).name}
                {st.bo === 5 && <span className="tag t1" style={{ marginLeft: 6 }}>BO5</span>}
                <span className="tiny faint"> · 当年 {st.won}:{st.lost}{st.won < st.lost ? '（负）' : ''}</span>
              </span>
              {tries.length ? (
                <span className="mono small">
                  {tries.map((l, k) => (
                    <span key={k} style={{ marginLeft: 6, color: l.won > l.lost ? 'var(--win)' : 'var(--loss)' }}>
                      {l.won}:{l.lost}
                    </span>
                  ))}
                </span>
              ) : i === run.stage ? (
                <span className="tiny" style={{ color: 'var(--accent)' }}>下一场</span>
              ) : (
                <span className="tiny faint">未开始</span>
              )}
            </div>
          )
        })}
      </div>
      <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
        <button className="primary" onClick={onPlay} disabled={busy}>
          {busy ? '比赛中…' : `打${next.stage}（BO${next.bo} · 不扣体力）`}
        </button>
        <button onClick={onQuit} disabled={busy}>放弃这一趟</button>
      </div>
      <History tag={run.team} legs={legs} />
    </Panel>
  )
}

function Picker({ s, busy, onStart }: { s: SeoulRouteState; busy: boolean; onStart: (tag: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
      {SEOUL_TEAMS.map((t) => {
        const road = SEOUL_ROUTES[t.tag]
        const rec = s.records[t.tag]
        const bo5 = road.filter((x) => x.bo === 5).length
        const lostThen = road.filter((x) => x.won < x.lost).length
        const here = s.run?.team === t.tag
        return (
          <div key={t.tag} className={`bracket-leg${here ? ' now' : ''}`} style={{ display: 'block' }}>
            <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
              <b>{t.tag}</b>
              <span className="small muted" style={{ flex: 1 }}>{t.name}</span>
              <span className="tiny muted">{placementName(t.placement)}</span>
            </div>
            <div className="small" style={{ margin: '6px 0 2px' }}>
              至少 {road.length} 场{bo5 ? `，含 ${bo5} 场 BO5` : ''} · 当年输 {lostThen} 场
            </div>
            <div className="tiny muted" style={{ lineHeight: 1.7 }}>{road.map((x) => x.opp).join(' → ')}</div>
            <div className="tiny" style={{ margin: '6px 0 8px' }}>
              {rec?.clears
                ? `打通 ${rec.clears} 次 · ${rec.best === 0 ? '有一趟全胜' : `最少输 ${rec.best} 场`}`
                : rec?.legs.length ? `打过 ${rec.legs.length} 场，还没打通` : '还没打过'}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="sm primary" disabled={busy || here} onClick={() => onStart(t.tag)}>
                {here ? '正在打' : '出发'}
              </button>
              {!!rec?.legs.length && !here && (
                <button className="sm ghost" onClick={() => setOpen(open === t.tag ? null : t.tag)}>
                  {open === t.tag ? '收起' : '记录'}
                </button>
              )}
            </div>
            {open === t.tag && rec && <History tag={t.tag} legs={rec.legs} open />}
          </div>
        )
      })}
    </div>
  )
}

function History({ tag, legs, open }: { tag: string; legs: RouteLeg[]; open?: boolean }) {
  if (!legs.length) return null
  const road = SEOUL_ROUTES[tag]
  return (
    <details style={{ marginTop: 12 }} open={open}>
      <summary className="small">
        打过的比赛（{legs.length} 场{legs.length >= ROUTE_LEGS_MAX ? '，只留最近的' : ''}）
      </summary>
      <div className="grid" style={{ gap: 6, marginTop: 8 }}>
        {legs.slice().reverse().map((l, k) => {
          const st = road[l.stage]
          const win = l.won > l.lost
          return (
            <div key={k} className="small" style={{ lineHeight: 1.6 }}>
              <b style={{ color: win ? 'var(--win)' : 'var(--loss)' }}>你 {l.won}:{l.lost}</b>
              <span className="muted"> · 当年 {st.won}:{st.lost} · {st.stage} vs {st.opp}</span>
              {win && st.won < st.lost && <span style={{ color: 'var(--warn)' }}> · 改写历史</span>}
              <div className="tiny faint">{l.maps.join(' · ')}</div>
            </div>
          )
        })}
      </div>
    </details>
  )
}
