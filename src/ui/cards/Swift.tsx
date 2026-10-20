import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import { serverNow } from '../../engine/account'
import { cardById, isPlayerCard } from '../../engine/cards'
import {
  BUY_CN, PLAN_CN, SHIELDS, ULT_CN, ULT_COST, ULT_HINT, ULT_OF, WEAPONS, SWIFT_WIN, SWIFT_HALF,
  loadoutFor, swiftSide, sideStrength,
} from '../../engine/swift'
import type { Buy, Choice, Plan, RoundLog, SwiftView, Ult } from '../../engine/swift'
import { swiftCall, swiftLeave, swiftPause, swiftQueue, swiftRecon, swiftState } from '../../engine/swiftClient'
import type { SwiftMatchView, SwiftState } from '../../engine/swiftClient'
import './swift.css'

const ROLE_VAR: Record<string, string> = { 决斗者: 'var(--duelist)', 先锋: 'var(--initiator)', 控场: 'var(--controller)', 哨卫: 'var(--sentinel)' }
const PLAN_HINT: Record<Plan, string> = {
  A: '克 堆B、前压；怕 堆A', B: '克 堆A、前压；怕 堆B', split: '克 均分；怕 前压', fake: '克 堆点；怕 均分、前压',
  stackA: '克 Rush A；怕 B、假打', stackB: '克 Rush B；怕 A、假打', even: '克 假打；怕 拆分', push: '克 拆分、假打；怕 Rush',
}
const KIND_CN = { live: '真人', ghost: '影子', ai: 'AI' } as const
const gun = (w: number, s: number) => `${WEAPONS[w].name}${s ? `·${SHIELDS[s].name}` : ''}`
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/**
 * 抢五: a round-by-round match the player calls.
 *
 * The page only shows and sends: the server (swift-api.js) holds the match,
 * plays each round when both sides have called it, and runs the clock. A
 * live match is read every second; a ghost or AI match answers each call
 * straight away.
 */
export default function Swift() {
  const { g, version, commit, toast, go, collect } = useCards()
  const [st, setSt] = useState<SwiftState | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<SwiftMatchView | null>(null)
  const matchRef = useRef<string | null>(null)

  const pull = useCallback(async () => {
    const r = await swiftState(matchRef.current ?? undefined)
    if (!r.ok) return
    setSt(r)
    if (r.match) {
      matchRef.current = r.match.id
      if (r.match.status === 'done') { setDone(r.match); matchRef.current = null; void collect(true) }
    }
  }, [collect])
  useEffect(() => { void pull() }, [pull])
  const live = st?.match && st.match.status === 'live' ? st.match : null
  const queued = !!st?.queue
  // a second in a live match or the queue, otherwise only on the clock running out
  useEffect(() => {
    const fast = queued || live?.kind === 'live' || (live && (live.view.locked || live.view.waitingRecon))
    const every = fast ? 1000 : live ? 4000 : 30_000
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') void pull() }, every)
    return () => clearInterval(t)
  }, [queued, live, pull])

  const mine = useMemo(() => swiftSide('我', '', g.squad.slots.slice(0, 5), g.squad.coach, (id) => g.cards[id]?.level ?? 0), [version]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (!mine) { toast('先凑齐五个人。'); go('squad'); return }
    setBusy(true)
    await commit(true)
    const r = await swiftQueue({ slots: g.squad.slots.slice(0, 5), coach: g.squad.coach })
    setBusy(false)
    if (!r.ok) { toast(r.why ?? '没排上，稍后再试。'); return }
    setDone(null)
    if (r.match) matchRef.current = r.match
    void pull()
  }
  const cancel = async () => { await swiftLeave(); void pull() }
  const resign = async () => {
    if (!live) return
    await swiftLeave(live.id, true)
    void pull()
  }
  const apply = (r: { ok: boolean; why?: string; match?: SwiftMatchView }) => {
    if (r.match) {
      setSt((s) => (s ? { ...s, match: r.match } : s))
      if (r.match.status === 'done') { setDone(r.match); matchRef.current = null; void collect(true) }
    }
    if (!r.ok && r.why) toast(r.why)
  }

  if (!st) return <Panel><p className="muted">读取中…</p></Panel>

  if (live) return <MatchScreen m={live} apply={apply} onResign={resign} />

  return (
    <div className="swift">
      {done && <Result m={done} onClose={() => setDone(null)} />}
      <Panel>
        <p className="small">用你的卡组打一场先赢 5 回合的比赛。每回合你和对手同时决定：买什么、打哪里、谁去拿首杀。</p>
        <ul className="swift-rules small muted">
          <li>经济照搬无畏契约：手枪局 800，赢一回合 3000，连输 1900 / 2400 / 2900，下包 300，击杀 200，活下来的人留着枪。</li>
          <li>打法互相克制，没有永远对的选择。看对手的习惯，读他下一回合。</li>
          <li>击杀和阵亡给全队攒大招：先锋侦察、控场封烟、哨卫锁点、决斗者强突。有指挥卡每半场能暂停一次，看对手的钱。</li>
          <li>{st.waitSec} 秒没匹配到真人，就打一个其他玩家的影子（按他的习惯出招）。</li>
        </ul>
        {st.me && <div className="swift-me">
          <div><b>{st.me.rating}</b><span>抢五分</span></div>
          <div><b>{st.me.won}/{st.me.played}</b><span>胜/场</span></div>
          <div><b>{Math.min(st.me.dayWins, st.paidWins)}/{st.paidWins}</b><span>今日奖励</span></div>
        </div>}
        <p className="tiny muted">每天前 {st.paidWins} 场胜利各得 {st.winCoins} 金币（开过 50 张卡、账号满 3 天）。</p>
        <SquadStrip slots={g.squad.slots.slice(0, 5)} strength={mine ? sideStrength(mine) : null} />
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          {queued
            ? <><button disabled>匹配中 <Waited since={st.queue!.since} /></button><button className="ghost" onClick={() => void cancel()}>取消</button></>
            : <button className="primary" disabled={busy} onClick={() => void start()}>开始匹配</button>}
        </div>
      </Panel>
      {st.board.length > 0 && <Panel title="抢五排行">
        <ol className="swift-board">
          {st.board.map((r) => <li key={r.h} className={st.me?.h === r.h ? 'me' : ''}>
            <span className="r">{r.rank}</span><span className="n">{r.name}<i>{r.tag}</i></span><span className="s">{r.rating}</span><span className="w">{r.won}/{r.played}</span>
          </li>)}
        </ol>
      </Panel>}
    </div>
  )
}

function Waited({ since }: { since: number }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(t) }, [])
  return <>{Math.max(0, Math.floor((serverNow() - since) / 1000))} 秒</>
}

function SquadStrip({ slots, strength }: { slots: (string | null)[]; strength: number | null }) {
  return <div className="swift-squad">
    {slots.map((id, i) => {
      const c = id ? cardById(id) : undefined
      return <div key={i} className="swift-seat" style={{ borderColor: isPlayerCard(c) ? ROLE_VAR[c.role] : undefined }}>
        {isPlayerCard(c) ? <><b>{c.ign}</b><span>{c.role}</span></> : <span className="muted">空</span>}
      </div>
    })}
    {strength !== null && <div className="swift-strength tiny muted">平均能力 {strength}</div>}
  </div>
}

// ---------------------------------------------------------------- the match

function Clock({ deadline }: { deadline: number | null }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 250); return () => clearInterval(t) }, [])
  if (!deadline) return null
  const left = Math.max(0, Math.ceil((deadline - serverNow()) / 1000))
  return <span className={`swift-clock${left <= 5 ? ' low' : ''}`}>{left}s</span>
}

function MatchScreen({ m, apply, onResign }: { m: SwiftMatchView; apply: (r: { ok: boolean; why?: string; match?: SwiftMatchView }) => void; onResign: () => void }) {
  const v = m.view
  const me = v.me, them = (1 - me) as 0 | 1
  const ours = v.sides[me]
  const [buy, setBuy] = useState<Buy>('full')
  const [plan, setPlan] = useState<Plan>(v.plans[0])
  const [lead, setLead] = useState<number>(0)
  const [ult, setUlt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [quit, setQuit] = useState(false)
  const lastRound = useRef(0)
  // a new round: sensible defaults again
  useEffect(() => {
    if (lastRound.current === v.round) return
    lastRound.current = v.round
    setPlan(v.plans[0]); setUlt(null)
    const want = v.attacking ? '决斗者' : '哨卫'
    const i = ours.seats.findIndex((s) => s.role === want)
    setLead(i >= 0 ? i : 0)
    const avg = sum(v.mine.credits) / 5
    setBuy(v.pistol ? 'full' : avg >= 3900 ? 'full' : avg >= 2000 ? 'force' : 'eco')
  }, [v.round, v.plans, v.attacking, v.pistol, v.mine.credits, ours.seats])

  const send = async () => {
    setBusy(true)
    const choice: Choice = { buy, plan, lead: ult !== null && ULT_OF[ours.seats[ult].role] === 'entry' ? ult : lead, ult }
    apply(await swiftCall(m.id, v.round, choice))
    setBusy(false)
  }
  const recon = async (p: Plan) => { setBusy(true); apply(await swiftRecon(m.id, p)); setBusy(false) }
  const pause = async () => { setBusy(true); apply(await swiftPause(m.id)); setBusy(false) }

  const preview = loadoutFor(v.mine, buy, v.pistol)
  const ultReady = v.mine.ult >= ULT_COST
  const canPause = !v.paused && !v.locked && (v.mine.pauses > 0 || v.mine.coachPause > 0)
  const last = v.log.length ? v.log[v.log.length - 1] : null

  return (
    <div className="swift">
      <div className="swift-score panel">
        <div className="swift-team"><b>{ours.name}</b><span>{v.attacking ? '进攻' : '防守'}</span></div>
        <div className="swift-nums"><b>{v.score[me]}</b><i>:</i><b>{v.score[them]}</b>
          <small>第 {v.round} 回合{v.pistol ? ' · 手枪局' : ''}{v.round === SWIFT_HALF ? ' · 半场前最后一回合' : ''}</small></div>
        <div className="swift-team right"><b>{m.opponent.name}<i className="tiny muted"> {m.opponent.tag}</i></b><span>{KIND_CN[m.kind]} · {v.attacking ? '防守' : '进攻'}</span></div>
      </div>
      <RoundDots log={v.log} me={me} />

      {last && <RoundReveal key={last.round} r={last} me={me} v={v} />}

      <Panel title={v.phase === 'recon' ? '侦察' : `第 ${v.round} 回合`} actions={<Clock deadline={m.deadline} />}>
        {v.scouted ? <div className="swift-recon">
          <p>侦察到对方：<b>{PLAN_CN[v.scouted]}</b>。要改打法吗？</p>
          <div className="swift-opts">{v.plans.map((p) => <button key={p} disabled={busy} className={p === plan ? 'primary' : ''} onClick={() => void recon(p)}>{PLAN_CN[p]}</button>)}</div>
        </div> : v.waitingRecon ? <p className="muted">对方在用侦察，等他定打法…</p>
          : v.locked ? <p className="muted">已经定了。{v.theyLocked ? '' : '等对方…'}</p>
          : <>
            <div className="swift-block">
              <h4>经济 <span className="tiny muted">全队 {sum(v.mine.credits)} · 连输 {v.mine.streak}</span></h4>
              <div className="swift-opts">
                {(['eco', 'force', 'full'] as Buy[]).map((b) => {
                  const k = loadoutFor(v.mine, b, v.pistol)
                  return <button key={b} className={buy === b ? 'primary' : ''} onClick={() => setBuy(b)}>
                    {v.pistol ? (b === 'full' ? '轻甲+技能' : b === 'force' ? '买鬼魅' : '不买') : BUY_CN[b]}
                    <small>花 {sum(k.spend)}</small>
                  </button>
                })}
              </div>
              <div className="swift-kit">{ours.seats.map((s, i) => <span key={i}><b>{s.ign}</b>{gun(preview.weapon[i], preview.shield[i])}<i>{v.mine.credits[i] - preview.spend[i]}</i></span>)}</div>
            </div>
            <div className="swift-block">
              <h4>{v.attacking ? '进攻打法' : '防守站位'}</h4>
              <div className="swift-opts four">
                {v.plans.map((p) => <button key={p} className={plan === p ? 'primary' : ''} onClick={() => setPlan(p)}>{PLAN_CN[p]}<small>{PLAN_HINT[p]}</small></button>)}
              </div>
            </div>
            <div className="swift-block">
              <h4>首杀对枪 <span className="tiny muted">{v.attacking ? '决斗者打首杀有加成' : '哨卫守点、前压时先锋/决斗者有加成'}</span></h4>
              <div className="swift-opts five">
                {ours.seats.map((s, i) => <button key={i} className={lead === i ? 'primary' : ''} style={{ borderBottom: `3px solid ${ROLE_VAR[s.role] ?? 'var(--flex)'}` }} onClick={() => setLead(i)}>{s.ign}<small>{s.role}</small></button>)}
              </div>
            </div>
            <div className="swift-block">
              <h4>大招 <span className="tiny muted">{Math.min(v.mine.ult, ULT_COST)}/{ULT_COST}</span></h4>
              <div className="swift-bar"><i style={{ width: `${Math.min(100, v.mine.ult / ULT_COST * 100)}%` }} /></div>
              {ultReady ? <div className="swift-opts">
                <button className={ult === null ? 'primary' : ''} onClick={() => setUlt(null)}>先留着</button>
                {ours.seats.map((s, i) => {
                  const u = ULT_OF[s.role] as Ult | undefined
                  return u ? <button key={i} className={ult === i ? 'primary' : ''} title={ULT_HINT[u]} onClick={() => setUlt(i)}>{s.ign} · {ULT_CN[u]}<small>{ULT_HINT[u]}</small></button> : null
                })}
              </div> : <p className="tiny muted">击杀、阵亡各 1 点，下包 2 点。</p>}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className="primary" disabled={busy} onClick={() => void send()}>确定</button>
              {canPause && <button disabled={busy} onClick={() => void pause()}>战术暂停（看对手的钱）</button>}
            </div>
          </>}
        <TheirSide v={v} />
      </Panel>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {quit ? <><span className="small muted">认输算输，不给奖励。</span><button className="warn sm" onClick={onResign}>确认认输</button><button className="ghost sm" onClick={() => setQuit(false)}>算了</button></>
          : <button className="ghost sm" onClick={() => setQuit(true)}>认输</button>}
      </div>
      <p className="tiny muted">先赢 {SWIFT_WIN} 回合获胜，打满 {SWIFT_HALF} 回合换边，换边后第一回合也是手枪局。</p>
    </div>
  )
}

function TheirSide({ v }: { v: SwiftView }) {
  const them = (1 - v.me) as 0 | 1
  const t = v.theirs
  return <div className="swift-them">
    <h4>对手 <span className="tiny muted">连输 {t.streak} · 大招 {Math.min(t.ult, ULT_COST)}/{ULT_COST}{v.theyLocked ? ' · 已定' : ''}</span></h4>
    <div className="swift-kit">{v.sides[them].seats.map((s, i) => <span key={i}><b>{s.ign}</b>{gun(t.weapon[i], t.shield[i])}<i>{t.credits ? t.credits[i] : '?'}</i></span>)}</div>
  </div>
}

function RoundDots({ log, me }: { log: RoundLog[]; me: 0 | 1 }) {
  return <div className="swift-dots">
    {log.map((r) => <span key={r.round} className={r.winner === me ? 'w' : 'l'} title={`第 ${r.round} 回合`}>{r.round}</span>)}
  </div>
}

function RoundReveal({ r, me, v }: { r: RoundLog; me: 0 | 1; v: SwiftView }) {
  const them = (1 - me) as 0 | 1
  const mineAtk = r.attacker === me
  // the edge is the attackers'; turn it to ours
  const read = (mineAtk ? r.edge : -r.edge)
  const name = (t: number, i: number) => v.sides[t].seats[i]?.ign ?? '?'
  const ultLine = ([me, them] as const).map((t) => r.ults[t] ? `${t === me ? '我方' : '对方'}${ULT_CN[r.ults[t]!]}` : '').filter(Boolean).join(' · ')
  return <div className={`swift-reveal panel ${r.winner === me ? 'won' : 'lost'}`}>
    <div className="swift-reveal-head">
      <b>第 {r.round} 回合 {r.winner === me ? '拿下' : '丢了'}</b>
      <span className="small">我方 {PLAN_CN[r.choices[me].plan]}{r.firstPlan?.[me] ? `（侦察后从 ${PLAN_CN[r.firstPlan[me]!]} 改）` : ''} · 对方 {PLAN_CN[r.choices[them].plan]}</span>
      <span className={`small ${read > 0.05 ? 'pos' : read < -0.05 ? 'neg' : 'muted'}`}>{read > 0.05 ? '读对了' : read < -0.05 ? '被读到了' : '打法上没占便宜'}</span>
    </div>
    <div className="small muted">装备 {sum(r.loadout[me])} vs {sum(r.loadout[them])} · {r.planted ? (r.winner === r.attacker ? '包炸了' : '下了包被拆') : '没下包'}{ultLine ? ` · ${ultLine}` : ''}</div>
    <ol className="swift-feed">
      {r.kills.map((k, i) => <li key={i} style={{ animationDelay: `${i * 0.28}s` }} className={k.side === me ? 'mine' : 'theirs'}>
        <b className={k.side === me ? 'us' : 'them'}>{name(k.side, k.killer)}</b><span>击杀</span><b className={k.side === me ? 'them' : 'us'}>{name(1 - k.side, k.victim)}</b>
      </li>)}
    </ol>
  </div>
}

function Result({ m, onClose }: { m: SwiftMatchView; onClose: () => void }) {
  const v = m.view
  const won = v.winner === v.me
  return <Panel className={`swift-result ${won ? 'won' : 'lost'}`} title={won ? '赢了' : '输了'} actions={<button className="ghost sm" onClick={onClose}>关闭</button>}>
    <p><b className="swift-final">{v.score[v.me]} : {v.score[1 - v.me]}</b> 对 {m.opponent.name}{m.kind !== 'live' ? `（${KIND_CN[m.kind]}）` : ''}{v.resigned !== null ? (v.resigned === v.me ? ' · 你认输了' : ' · 对方认输') : ''}</p>
    {m.ratings && <p className="small">抢五分 {m.ratings.before} → <b>{m.ratings.after}</b>（{m.ratings.delta >= 0 ? '+' : ''}{m.ratings.delta}）{m.ratings.coins ? ` · 奖励 ${m.ratings.coins} 金币已进信箱` : ''}</p>}
    <RoundDots log={v.log} me={v.me} />
  </Panel>
}
