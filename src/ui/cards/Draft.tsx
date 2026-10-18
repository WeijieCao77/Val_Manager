import { useCallback, useEffect, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import CardFace from '../Card'
import { serverNow } from '../../engine/account'
import { cardById, isPlayerCard } from '../../engine/cards'
import { draftBid, draftCreate, draftJoin, draftLeave, draftStart, draftState } from '../../engine/draftClient'
import type { DraftRoom, DraftState } from '../../engine/draftClient'
import './swift.css'

const POS_CN: Record<string, string> = { 决斗者: '决斗者', 先锋: '先锋', 控场: '控场', 哨卫: '哨卫', 自由人: '任意位置' }
const ign = (id: string) => { const c = cardById(id); return isPlayerCard(c) ? c.ign : id }

/**
 * 选秀夜: a room of friends drafts from one shared pool and plays a round robin.
 *
 * The room lives on the server (draft-api.js); the page reads it every second
 * and a half while a draft is on, and sends the one blind bid a round.
 */
export default function Draft() {
  const { toast } = useCards()
  const [st, setSt] = useState<DraftState | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const pull = useCallback(async () => {
    const r = await draftState()
    if (r.ok) setSt(r)
  }, [])
  useEffect(() => { void pull() }, [pull])
  const room = st?.room
  useEffect(() => {
    const fast = room && room.status !== 'done'
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') void pull() }, fast ? 1500 : 30_000)
    return () => clearInterval(t)
  }, [room, pull])

  const run = async (p: Promise<{ ok: boolean; why?: string }>) => {
    setBusy(true)
    const r = await p
    setBusy(false)
    if (!r.ok) toast(r.why ?? '没成功，稍后再试。')
    void pull()
  }

  if (!st) return <Panel><p className="muted">读取中…</p></Panel>
  if (!room) return (
    <div className="swift">
      <Panel title="选秀夜">
        <p className="small">和朋友开一个房间（{st.min}–{st.max} 人），从同一个卡池里抢人组五人，选完自动打循环赛。</p>
        <ul className="swift-rules small muted">
          <li>五轮，每轮一个位置：决斗者、先锋、控场、哨卫，最后一轮任意位置。</li>
          <li>每轮亮出 人数+1 张卡，从顶级到冷门。每人暗中选一张出价，整场预算 {st.budget}。</li>
          <li>出价高的先拿；被抢走的人免费拿剩下最好的一张。</li>
          <li>卡池是全卡库（含彩卡），不用你的收藏，选到的卡也不会进收藏。</li>
        </ul>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="primary" disabled={busy} onClick={() => void run(draftCreate())}>开房间</button>
          <input value={code} maxLength={5} placeholder="房间码" style={{ width: 110, textTransform: 'uppercase' }} onChange={(e) => setCode(e.target.value)} />
          <button disabled={busy || code.trim().length !== 5} onClick={() => void run(draftJoin(code))}>加入</button>
        </div>
      </Panel>
    </div>
  )

  return (
    <div className="swift">
      <Panel title={`房间 ${room.code}`} actions={room.status === 'lobby' || room.status === 'done'
        ? <button className="ghost sm" disabled={busy} onClick={() => void run(draftLeave())}>{room.status === 'done' ? '离开' : '退出房间'}</button> : undefined}>
        {room.status === 'lobby' && <Lobby room={room} st={st} busy={busy} onStart={() => void run(draftStart())} />}
        {room.status === 'bidding' && <Bidding room={room} busy={busy} onBid={(card, amount) => void run(draftBid(room.round, { card, amount }))} />}
        {room.status === 'playing' && <p className="muted">五轮选完了，循环赛进行中…</p>}
        {room.status === 'done' && <Done room={room} />}
      </Panel>
      {room.status !== 'lobby' && <Seats room={room} />}
      {room.history.length > 0 && room.status !== 'done' && <LastRound room={room} />}
    </div>
  )
}

function Lobby({ room, st, busy, onStart }: { room: DraftRoom; st: DraftState; busy: boolean; onStart: () => void }) {
  const { toast } = useCards()
  const share = `来开瓦包玩选秀夜，房间码 ${room.code}：${location.origin}/cards#draft`
  const copy = async () => { try { await navigator.clipboard.writeText(share); toast('复制好了，发给朋友。') } catch { toast(share) } }
  return <>
    <div className="draft-code"><b>{room.code}</b><button className="sm" onClick={() => void copy()}>复制邀请</button></div>
    <ol className="swift-board">
      {room.seats.map((s) => <li key={s.seat} className={s.me ? 'me' : ''}><span className="r">{s.seat + 1}</span><span className="n">{s.name}<i>{s.tag}</i></span><span className="s">{s.host ? '房主' : ''}</span><span /></li>)}
    </ol>
    {room.host
      ? <div className="row" style={{ marginTop: 10, gap: 8 }}><button className="primary" disabled={busy || room.seats.length < st.min} onClick={onStart}>开始选秀</button><span className="small muted">{room.seats.length}/{st.max} 人</span></div>
      : <p className="small muted">等房主开始。</p>}
  </>
}

function Clock({ deadline }: { deadline: number | null }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 250); return () => clearInterval(t) }, [])
  if (!deadline) return null
  const left = Math.max(0, Math.ceil((deadline - serverNow()) / 1000))
  return <span className={`swift-clock${left <= 5 ? ' low' : ''}`}>{left}s</span>
}

function Bidding({ room, busy, onBid }: { room: DraftRoom; busy: boolean; onBid: (card: number, amount: number) => void }) {
  const me = room.seats.find((s) => s.me)!
  const [card, setCard] = useState(0)
  const [amount, setAmount] = useState(0)
  useEffect(() => { setCard(0); setAmount(0) }, [room.round])
  const lot = room.lot ?? []
  const left = room.rounds - room.round
  return <>
    <div className="draft-head">
      <b>第 {room.round + 1}/{room.rounds} 轮 · {POS_CN[room.position ?? '自由人']}</b>
      <span className="small muted">预算 {me.budget} · 还剩 {left} 轮</span>
      <Clock deadline={room.deadline} />
    </div>
    <div className="draft-lot">
      {lot.map((id, i) => { const c = cardById(id); return c ? <div key={id} className={`draft-pick${card === i ? ' on' : ''}`}>
        <CardFace card={c} size="sm" selected={card === i} onClick={room.myBid ? undefined : () => setCard(i)} />
      </div> : null })}
    </div>
    {room.myBid
      ? <p className="small">你出了 <b>{room.myBid.amount}</b> 抢 <b>{ign(lot[room.myBid.card] ?? '')}</b>，等其他人…</p>
      : <div className="draft-bid">
        <span className="small">抢 <b>{ign(lot[card] ?? '')}</b>，出价</span>
        <input type="number" min={0} max={me.budget} value={amount} onChange={(e) => setAmount(Math.max(0, Math.min(me.budget, Math.floor(Number(e.target.value) || 0))))} style={{ width: 80 }} />
        {[0, 10, 25].filter((x) => x <= me.budget).map((x) => <button key={x} className="sm" onClick={() => setAmount(x)}>{x}</button>)}
        <button className="sm" onClick={() => setAmount(me.budget)}>全部 {me.budget}</button>
        <button className="primary" disabled={busy} onClick={() => onBid(card, amount)}>出价</button>
      </div>}
  </>
}

function Seats({ room }: { room: DraftRoom }) {
  return <Panel title="各家阵容">
    <div className="draft-seats">
      {room.seats.map((s) => <div key={s.seat} className={`draft-seat${s.me ? ' me' : ''}`}>
        <div className="draft-seat-head"><b>{s.name}</b><span className="tiny muted">{s.tag}</span>
          <span className="tiny">{room.status === 'bidding' ? (s.bidIn ? '已出价' : '思考中') : ''}</span>
          <span className="tiny muted">预算 {s.budget}</span></div>
        <div className="draft-mini">{[0, 1, 2, 3, 4].map((i) => <span key={i}>{s.picks[i] ? ign(s.picks[i]) : '—'}</span>)}</div>
      </div>)}
    </div>
  </Panel>
}

function LastRound({ room }: { room: DraftRoom }) {
  const r = room.history[room.history.length - 1]
  return <Panel title={`第 ${r.round + 1} 轮结果`}>
    <ul className="draft-awards small">
      {r.awards.map((a) => {
        const s = room.seats[a.seat]
        const bid = r.bids[a.seat]
        return <li key={a.seat}><b>{s?.name}</b> {a.won ? `出 ${a.paid} 拿下` : `出 ${bid?.amount ?? 0} 抢 ${ign(r.lot[bid?.card ?? 0])} 被抢，免费拿到`} <b>{ign(r.lot[a.card])}</b></li>
      })}
    </ul>
  </Panel>
}

function Done({ room }: { room: DraftRoom }) {
  const name = (seat: number) => room.seats[seat]?.name ?? '?'
  return <>
    <ol className="swift-board">
      {(room.table ?? []).map((t) => <li key={t.seat} className={room.seats[t.seat]?.me ? 'me' : ''}>
        <span className="r">{t.place}</span><span className="n">{name(t.seat)}</span><span className="s">{t.wins} 胜</span><span className="w">图 {t.maps >= 0 ? '+' : ''}{t.maps}</span>
      </li>)}
    </ol>
    <h4 style={{ margin: '14px 0 6px' }}>比赛</h4>
    <ul className="draft-awards small">
      {(room.games ?? []).map((g, i) => <li key={i}><b className={g.aWon ? 'pos' : ''}>{name(g.a)}</b> {g.mapsA}:{g.mapsB} <b className={!g.aWon ? 'pos' : ''}>{name(g.b)}</b>
        <span className="tiny muted"> {g.maps.map((m) => `${m.map} ${m.a}-${m.b}`).join(' · ')}</span></li>)}
    </ul>
  </>
}
