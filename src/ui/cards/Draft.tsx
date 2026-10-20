import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import CardFace from '../Card'
import { serverNow } from '../../engine/account'
import { cardById, isPlayerCard, squadRating } from '../../engine/cards'
import { Rng, hashStr } from '../../engine/rng'
import { REGION_CN } from '../../engine/types'
import { SEAT_COLORS } from '../../engine/draft'
import { draftBid, draftCreate, draftJoin, draftLeave, draftStart, draftState } from '../../engine/draftClient'
import type { DraftGameRow, DraftRoom, DraftSeat, DraftState } from '../../engine/draftClient'
import './swift.css'

const POS_CN: Record<string, string> = { 决斗者: '决斗者', 先锋: '先锋', 控场: '控场', 哨卫: '哨卫', 自由人: '任意位置', 教练: '教练' }
/** the six picks in draft order, as the lineup shows them */
const SLOTS = [
  { short: '决', role: '决斗者', color: 'var(--duelist)' }, { short: '先', role: '先锋', color: 'var(--initiator)' },
  { short: '控', role: '控场', color: 'var(--controller)' }, { short: '哨', role: '哨卫', color: 'var(--sentinel)' },
  { short: '自', role: '任意', color: 'var(--flex)' }, { short: '教', role: '教练', color: 'var(--gold)' },
]
const UNPAID: Record<string, string> = { idle: '六轮里自己出价不到 4 轮，没有奖励', small: '3 人以上的房间才有奖励', cap: '今天的房间奖励已经领完', gate: '开过 50 张卡、账号满 3 天后才有奖励' }
const seatColor = (seat: number) => SEAT_COLORS[seat % SEAT_COLORS.length]
const seatStyle = (seat: number) => ({ '--seat': seatColor(seat) }) as CSSProperties

/** who a pick is: the name, the club and region (a long shot nobody knows needs both), the role and rating */
function pickInfo(id: string | undefined) {
  const c = id ? cardById(id) : undefined
  if (!c) return null
  const region = c.region ? REGION_CN[c.region] ?? c.region : ''
  if (isPlayerCard(c)) return { name: c.ign, team: [c.clubTag ?? '无队', region].filter(Boolean).join(' · '), role: c.role, rating: c.rating, legend: !!c.legend }
  return { name: c.name, team: [c.clubTag ?? '', region].filter(Boolean).join(' · ') || '教练', role: '教练', rating: c.rating, legend: !!c.legend }
}
const ign = (id: string | undefined) => pickInfo(id)?.name ?? '?'

/** 阵容分: the game's own squad score once five are in; until then the mean rating of those drafted */
function powerOf(picks: string[]): { value: number; full: boolean } {
  const players = picks.slice(0, 5)
  if (players.length >= 5) return { value: squadRating({ slots: players, coach: picks[5] ?? null }), full: true }
  const rs = players.map((id) => cardById(id)?.rating ?? 0)
  return { value: rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) : 0, full: false }
}

/**
 * 抢人大战: a room of friends drafts from one shared pool and plays a round robin.
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
  // the broadcast: ask again the moment the next match or map is due
  const nextAt = room?.nextAt ?? null
  useEffect(() => {
    if (!nextAt) return
    const wait = nextAt - serverNow() + 150
    if (wait <= 0 || wait > 60_000) return
    const t = setTimeout(() => void pull(), wait)
    return () => clearTimeout(t)
  }, [nextAt, pull])

  // a round just settled: tell me what I got, for a moment, in front of everything
  const [pop, setPop] = useState<{ won: boolean; got: string; wanted?: string; paid: number; auto: boolean } | null>(null)
  const seenRounds = useRef<number | null>(null)
  useEffect(() => {
    if (!room || room.mySeat === null) return
    const n = room.history.length
    if (seenRounds.current === null) { seenRounds.current = n; return }
    if (n > seenRounds.current) {
      const r = room.history[n - 1]
      const a = r.awards.find((x) => x.seat === room.mySeat)
      const bid = r.bids[room.mySeat]
      if (a) setPop({ won: a.won, got: r.lot[a.card], wanted: bid ? r.lot[bid.card] : undefined, paid: a.paid, auto: !!bid?.auto })
    }
    seenRounds.current = n
  }, [room])
  useEffect(() => {
    if (!pop) return
    const t = setTimeout(() => setPop(null), 2800)
    return () => clearTimeout(t)
  }, [pop])

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
      <Panel title="抢人大战">
        <p className="small">和朋友开一个房间（{st.min}–{st.max} 人），从同一个卡池里抢人组五人，选完自动打比赛。</p>
        <ul className="swift-rules small muted">
          <li>六轮：决斗者、先锋、控场、哨卫、任意位置，最后一轮选教练。</li>
          <li>每轮亮出 人数+1 张卡，从顶级到冷门。每人暗中选一张出价，整场预算 {st.budget}。</li>
          <li>出价高的先拿；被抢走的人免费拿剩下最好的一张。</li>
          <li>选完先亮阵容，再打循环赛（每场 BO3，一场一场直播），然后打名次赛：前两名 BO5 决赛，三四名、五六名各打一场。只有 2 人就直接打决赛。</li>
          <li>卡池是全卡库（含彩卡），不用你的收藏，选到的卡也不会进收藏。</li>
          <li>奖励：第一名 {st.prizes[0]}、第二名 {st.prizes[1]}、其他 {st.prizes[2]} 金币。{st.paidMin} 人以上的房间才有，每天前 {st.paidRooms} 个房间；六轮里要自己出价至少 4 轮。</li>
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
      {pop && <RoundPop {...pop} onClose={() => setPop(null)} />}
      <Panel title={`房间 ${room.code}`} actions={room.status === 'lobby' || room.status === 'done'
        ? <button className="ghost sm" disabled={busy} onClick={() => void run(draftLeave())}>{room.status === 'done' ? '离开' : '退出房间'}</button> : undefined}>
        {room.status === 'lobby' && <Lobby room={room} st={st} busy={busy} onStart={() => void run(draftStart())} />}
        {room.status === 'bidding' && <Bidding room={room} busy={busy} onBid={(card, amount) => void run(draftBid(room.round, { card, amount }))} />}
        {room.status === 'playing' && <p className="muted">选完了，正在打比赛…</p>}
        {(room.status === 'showing' || room.status === 'done') && <Broadcast room={room} />}
      </Panel>
      {room.status !== 'lobby' && <Seats room={room} />}
      {room.history.length > 0 && room.status === 'bidding' && <LastRound room={room} />}
    </div>
  )
}

function RoundPop({ won, got, wanted, paid, auto, onClose }: { won: boolean; got: string; wanted?: string; paid: number; auto: boolean; onClose: () => void }) {
  const info = pickInfo(got)
  return <div className="draft-pop-back" onClick={onClose} role="dialog" aria-live="assertive">
    <div className={`draft-pop ${won ? 'won' : 'lost'}`}>
      <div className="draft-pop-head">{auto ? '这一轮你没出价' : won ? `抢到了！花了 ${paid}` : `没抢到 ${ign(wanted)}`}</div>
      <div className="draft-pop-body">
        <span className="tiny muted">{won ? '' : '分配到'}</span>
        <b>{info?.name}</b>
        <small>{info?.team} · {info?.role} · {info?.rating}</small>
      </div>
    </div>
  </div>
}

function Lobby({ room, st, busy, onStart }: { room: DraftRoom; st: DraftState; busy: boolean; onStart: () => void }) {
  const { toast } = useCards()
  const share = `来开瓦包玩抢人大战，房间码 ${room.code}：${location.origin}/cards#draft`
  const copy = async () => { try { await navigator.clipboard.writeText(share); toast('复制好了，发给朋友。') } catch { toast(share) } }
  return <>
    <div className="draft-code"><b>{room.code}</b><button className="sm" onClick={() => void copy()}>复制邀请</button></div>
    <ol className="swift-board">
      {room.seats.map((s) => <li key={s.seat} className={s.me ? 'me' : ''}><span className="r"><i className="draft-dot" style={seatStyle(s.seat)} /></span><span className="n">{s.name}<i>{s.tag}</i></span><span className="s">{s.host ? '房主' : ''}</span><span /></li>)}
    </ol>
    {room.host
      ? <div className="row" style={{ marginTop: 10, gap: 8 }}><button className="primary" disabled={busy || room.seats.length < st.min} onClick={onStart}>开始抢人</button><span className="small muted">{room.seats.length}/{st.max} 人</span></div>
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
      {lot.map((id, i) => {
        const c = cardById(id)
        const info = pickInfo(id)
        return c ? <div key={id} className={`draft-pick${card === i ? ' on' : ''}`}>
          <CardFace card={c} size="sm" selected={card === i} onClick={room.myBid ? undefined : () => setCard(i)} />
          <div className="draft-lot-cap"><b>{info?.name}</b><small>{info?.team}</small></div>
        </div> : null
      })}
    </div>
    {room.myBid
      ? <p className="small">你出了 <b>{room.myBid.amount}</b> 抢 <b>{ign(lot[room.myBid.card])}</b>，等其他人…</p>
      : <div className="draft-bid">
        <span className="small">抢 <b>{ign(lot[card])}</b>，出价</span>
        <input type="number" min={0} max={me.budget} value={amount} onChange={(e) => setAmount(Math.max(0, Math.min(me.budget, Math.floor(Number(e.target.value) || 0))))} style={{ width: 80 }} />
        {[0, 10, 25].filter((x) => x <= me.budget).map((x) => <button key={x} className="sm" onClick={() => setAmount(x)}>{x}</button>)}
        <button className="sm" onClick={() => setAmount(me.budget)}>全部 {me.budget}</button>
        <button className="primary" disabled={busy} onClick={() => onBid(card, amount)}>出价</button>
      </div>}
  </>
}

/** one seat's lineup: colour, name, 阵容分, and all six picks with club, region, role and rating */
function SeatCard({ s, status }: { s: DraftSeat; status: DraftRoom['status'] }) {
  const p = powerOf(s.picks)
  return <div className={`draft-seat${s.me ? ' me' : ''}`} style={seatStyle(s.seat)}>
    <div className="draft-seat-head">
      <b>{s.name}</b><span className="tiny muted">{s.tag}</span>
      {status === 'bidding' && <span className={`draft-status${s.bidIn ? ' in' : ''}`}>{s.bidIn ? '已出价' : '思考中'}</span>}
    </div>
    <div className="draft-seat-meta">
      <span>{p.full ? '阵容分' : '均分'} <b>{p.value || '—'}</b></span>
      <span>预算 {s.budget}</span>
    </div>
    <ul className="draft-roster">
      {SLOTS.map((slot, i) => {
        const info = pickInfo(s.picks[i])
        return <li key={i}>
          <span className="pos" style={{ background: slot.color }} title={slot.role}>{slot.short}</span>
          {info ? <span className="who"><b className={info.legend ? 'legend' : ''}>{info.name}</b><small>{info.team}{i === 4 ? ` · ${info.role}` : ''}</small></span> : <span className="who muted">—</span>}
          {info && <em>{info.rating}</em>}
        </li>
      })}
    </ul>
  </div>
}

function Seats({ room }: { room: DraftRoom }) {
  return <Panel title="各家阵容">
    <div className="draft-seats">{room.seats.map((s) => <SeatCard key={s.seat} s={s} status={room.status} />)}</div>
  </Panel>
}

function LastRound({ room }: { room: DraftRoom }) {
  const r = room.history[room.history.length - 1]
  return <Panel title={`第 ${r.round + 1} 轮结果`}>
    <ul className="draft-awards small">
      {r.awards.map((a) => {
        const s = room.seats[a.seat]
        const bid = r.bids[a.seat]
        return <li key={a.seat}><i className="draft-dot" style={seatStyle(a.seat)} /> <b>{s?.name}</b> {a.won ? `出 ${a.paid} 拿下` : bid?.auto ? '没出价，分到' : `出 ${bid?.amount ?? 0} 抢 ${ign(r.lot[bid?.card ?? 0])} 被抢，免费拿到`} <b>{ign(r.lot[a.card])}</b></li>
      })}
    </ul>
  </Panel>
}

/** The Finals-style entrance: each seat's colour, name, 阵容分 and six picks, one after another */
function IntroStage({ room, seat, left }: { room: DraftRoom; seat: DraftSeat; left: number }) {
  const p = powerOf(seat.picks)
  return <div className="draft-intro" style={seatStyle(seat.seat)} key={seat.seat}>
    <div className="draft-intro-bg" />
    <div className="draft-intro-head">
      <span className="draft-intro-no">{seat.seat + 1}/{room.seats.length}</span>
      <b>{seat.name}</b><span className="tiny">{seat.tag}</span>
      <span className="draft-intro-power">阵容分 <b>{p.value}</b></span>
    </div>
    <div className="draft-intro-cards">
      {seat.picks.map((id, i) => {
        const c = cardById(id)
        const info = pickInfo(id)
        return c ? <div key={id} className="draft-intro-card" style={{ animationDelay: `${0.25 + i * 0.32}s` }}>
          <CardFace card={c} size="sm" />
          <small>{SLOTS[i]?.short} · {info?.team}</small>
        </div> : null
      })}
    </div>
    <div className="draft-intro-foot tiny">{left > 0 ? `${left} 秒后下一位` : '比赛马上开始'}</div>
  </div>
}


/**
 * The match on air, as two sides squaring up: rounds tick up map by map until the window closes and the
 * result lands in the list. Each map's rounds are dealt in a fixed order from its seed (the winner takes
 * the last one), so every screen in the room ticks the same way.
 */
function roundOrder(m: { map: string; a: number; b: number }, key: string): number[] {
  const aWon = m.a > m.b
  const rest: number[] = []
  for (let i = 0; i < (aWon ? m.a - 1 : m.a); i++) rest.push(0)
  for (let i = 0; i < (aWon ? m.b : m.b - 1); i++) rest.push(1)
  const rng = new Rng(hashStr(key) >>> 0)
  return [...rng.shuffle(rest), aWon ? 0 : 1]
}
function Versus({ room, powers }: { room: DraftRoom; powers: number[] }) {
  const live = room.live!
  const [, tick] = useState(0)
  useEffect(() => { const h = setInterval(() => tick((x) => x + 1), 120); return () => clearInterval(h) }, [])
  const span = Math.max(1, live.to - live.from)
  const p = Math.max(0, Math.min(1, (serverNow() - live.from) / span))
  const playing = live.maps.slice(live.mapsDone)
  // each map gets an equal slice, the last tenth of it held on the final score
  const slice = 1 / Math.max(1, playing.length)
  const cur = Math.min(playing.length - 1, Math.floor(p / slice))
  const within = Math.min(1, (p - cur * slice) / slice / 0.9)
  const m = playing[cur]
  const order = roundOrder(m, `${room.code}:${live.a}:${live.b}:${live.mapsDone + cur}:${m.map}`)
  const shown = Math.floor(within * order.length)
  const ra = order.slice(0, shown).filter((x) => x === 0).length, rb = shown - ra
  const before = live.maps.slice(0, live.mapsDone + cur)
  const sa = before.filter((x) => x.a > x.b).length, sb = before.length - sa
  const side = (seat: number, rounds: number, maps: number) => {
    const s = room.seats[seat]
    return <div className="vs-team" style={seatStyle(seat)}>
      <div className="vs-name"><b>{s?.name}</b><span>阵容分 {powers[seat]}</span></div>
      <div className="vs-roster">{(s?.picks ?? []).slice(0, 5).map((id) => <span key={id}>{ign(id)}</span>)}</div>
      <div className="vs-nums"><b key={rounds} className="vs-rounds">{rounds}</b><small>地图 {maps}</small></div>
    </div>
  }
  return <div className="vs-stage">
    <div className="vs-head"><span className="vs-live">LIVE</span> {live.label} · 第 {live.mapsDone + cur + 1} 图 {m.map}</div>
    <div className="vs-grid">
      {side(live.a, ra, sa)}
      <div className="vs-mid"><span>VS</span><small>{before.map((x) => `${x.a}-${x.b}`).join(' · ') || '第一张图'}</small></div>
      {side(live.b, rb, sb)}
    </div>
    <div className="vs-bar"><i style={{ width: `${p * 100}%` }} /></div>
  </div>
}

function Broadcast({ room }: { room: DraftRoom }) {
  const [, tick] = useState(0)
  const powers = useMemo(() => room.seats.map((s) => powerOf(s.picks).value), [room.seats])
  const introMs = room.introSec * 1000
  const t = room.revealAt ? serverNow() - room.revealAt : Infinity
  const inIntro = room.status === 'showing' && t < introMs * room.seats.length
  useEffect(() => {
    if (!inIntro) return
    const h = setInterval(() => tick((x) => x + 1), 250)
    return () => clearInterval(h)
  }, [inIntro])
  const name = (seat: number) => room.seats[seat]?.name ?? '?'
  if (room.failed) return <p className="muted">比赛没打成，房间结束了。</p>
  if (inIntro) {
    const k = Math.min(room.seats.length - 1, Math.floor(t / introMs))
    return <IntroStage room={room} seat={room.seats[k]} left={Math.ceil((introMs * (k + 1) - t) / 1000)} />
  }
  const done = room.status === 'done'
  const f = room.final
  const won = (g: { maps: { a: number; b: number }[] }) => g.maps.reduce((n, m) => n + (m.a > m.b ? 1 : 0), 0)
  // 以下犯上: the lower 阵容分 beat the higher
  const upset = (g: { a: number; b: number; aWon?: boolean }) => {
    if (g.aWon === undefined) return 0
    const [w, l] = g.aWon ? [g.a, g.b] : [g.b, g.a]
    return powers[l] - powers[w]
  }
  const Side = ({ seat, win }: { seat: number; win: boolean }) => <span className="draft-side" style={seatStyle(seat)}>
    <i className="draft-dot" /><b className={win ? 'pos' : ''}>{name(seat)}</b><small>{powers[seat]}</small>
  </span>
  const Match = ({ g }: { g: DraftGameRow & { place?: number } }) => {
    const u = upset(g)
    return <li className="draft-game">
      <Side seat={g.a} win={g.aWon} /> <span className="draft-score">{g.mapsA}:{g.mapsB}</span> <Side seat={g.b} win={!g.aWon} />
      {u > 0 && <span className="draft-upset">以下犯上 +{u}</span>}
      <span className="tiny muted draft-maps"> {g.maps.map((m) => `${m.map} ${m.a}-${m.b}`).join(' · ')}</span>
    </li>
  }
  const all = [...(room.games ?? []), ...(room.placements ?? []), ...(done && f ? [f as DraftGameRow] : [])]
  const biggest = done ? all.reduce<{ g: DraftGameRow | null; u: number }>((best, g) => (upset(g) > best.u ? { g, u: upset(g) } : best), { g: null, u: 0 }) : null
  const order = done ? [...room.seats].sort((a, b) => (a.place ?? 9) - (b.place ?? 9)) : null
  return <>
    {!done && room.live && <Versus room={room} powers={powers} />}
    {!done && !room.live && <p className="small muted">比赛直播中 {room.nextAt ? <Clock deadline={room.nextAt} /> : null}</p>}
    {done && room.reward && <p className="small">你是第 <b>{room.reward.place}</b> 名{room.reward.coins ? `，奖励 ${room.reward.coins} 金币已进信箱` : room.reward.unpaid ? `（${UNPAID[room.reward.unpaid]}）` : ''}</p>}
    {done && order && <ol className="swift-board draft-final-table">
      {order.map((s) => <li key={s.seat} className={s.me ? 'me' : ''}><span className="r">{s.place}</span><span className="n"><i className="draft-dot" style={seatStyle(s.seat)} /> {s.name}</span><span className="s">{powers[s.seat]}</span><span className="w">阵容分</span></li>)}
    </ol>}
    {done && biggest?.g && <p className="small">最大冷门：<b>{name(biggest.g.aWon ? biggest.g.a : biggest.g.b)}</b>（阵容分 {powers[biggest.g.aWon ? biggest.g.a : biggest.g.b]}）赢了 <b>{name(biggest.g.aWon ? biggest.g.b : biggest.g.a)}</b>（{powers[biggest.g.aWon ? biggest.g.b : biggest.g.a]}）</p>}
    {!done && (room.table?.length ?? 0) > 0 && <ol className="swift-board">
      {room.table!.map((r) => <li key={r.seat} className={room.seats[r.seat]?.me ? 'me' : ''}>
        <span className="r">{r.place}</span><span className="n"><i className="draft-dot" style={seatStyle(r.seat)} /> {name(r.seat)}</span><span className="s">{r.wins} 胜</span><span className="w">图 {r.maps >= 0 ? '+' : ''}{r.maps}</span>
      </li>)}
    </ol>}
    {(room.games?.length ?? 0) > 0 && <>
      <h4 style={{ margin: '14px 0 6px' }}>循环赛</h4>
      <ul className="draft-awards small">{room.games!.map((g, i) => <Match key={i} g={g} />)}</ul>
    </>}
    {(room.placements?.length ?? 0) > 0 && <>
      <h4 style={{ margin: '14px 0 6px' }}>名次赛</h4>
      <ul className="draft-awards small">{room.placements!.map((g, i) => <div key={i}><span className="tiny muted">第 {g.place}–{g.place + 1} 名</span><Match g={g} /></div>)}</ul>
    </>}
    {f && <>
      <h4 style={{ margin: '14px 0 6px' }}>决赛 BO5{done ? '' : ' · 直播中'}</h4>
      <p className="draft-final"><Side seat={f.a} win={done && !!f.aWon} /> <span>{won(f)} : {f.maps.length - won(f)}</span> <Side seat={f.b} win={done && !f.aWon} /></p>
      <ul className="draft-awards small">
        {f.maps.map((m, i) => <li key={i} className="draft-game">第 {i + 1} 图 {m.map}：<b className={m.a > m.b ? 'pos' : ''}>{m.a}</b> - <b className={m.b > m.a ? 'pos' : ''}>{m.b}</b></li>)}
      </ul>
      {done && <p className="small">冠军：<b>{name(f.aWon ? f.a : f.b)}</b>{upset(f as DraftGameRow) > 0 ? ` · 以下犯上 +${upset(f as DraftGameRow)}` : ''}</p>}
    </>}
  </>
}
