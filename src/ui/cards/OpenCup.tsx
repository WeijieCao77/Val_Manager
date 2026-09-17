import { useCallback, useEffect, useRef, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import MatchReport from './Report'
import {
  fetchOpenCup, fetchOpenCupById, fetchOpenCupMatch, joinOpenCup, leaveOpenCup,
} from '../../engine/openCupClient'
import type { OpenCupMatchDetail, OpenCupMatchRow, OpenCupMine, OpenCupRow, OpenCupState } from '../../engine/openCupClient'
import {
  OPEN_CUP_MIN, OPEN_CUP_RANKED_MIN, OPEN_CUP_WIN_COINS, openCupPlacePrize, openCupRoundName,
} from '../../engine/openCup'
import { PACKS } from '../../engine/gacha'
import { cardById, cardName, squadRating } from '../../engine/cards'
import { serverNow } from '../../engine/account'
import type { ArenaResult } from '../../engine/arena'

const clock = (ms: number) =>
  new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms))
const countdown = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h ? `${h} 小时 ${m} 分` : m ? `${m} 分 ${s % 60} 秒` : `${s} 秒`
}
const prizeText = (n: number, place: 1 | 2 | 4) => {
  const p = openCupPlacePrize(n, place)
  const bits = [p.coins ? `${p.coins} 金币` : '', p.pack ? PACKS[p.pack].name : ''].filter(Boolean)
  return bits.length ? bits.join(' + ') : '—'
}

/**
 * 全服杯: the bracket everybody is in.
 *
 * Nothing here is played on this device, or by pressing anything: the page
 * signs the account up and then watches. It asks the server once a minute
 * while it is open, and again the moment a round falls due.
 */
export default function OpenCup() {
  const { g, cloud, commit, toast, go, collect } = useCards()
  // the countdowns here are in seconds, so this page keeps its own second hand on the server's clock
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    const t = window.setInterval(() => setNow(serverNow()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const [st, setSt] = useState<OpenCupState | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [board, setBoard] = useState<'today' | 'all'>('today')
  const [report, setReport] = useState<{ detail: OpenCupMatchDetail; flip: boolean; mine: boolean } | null>(null)
  const [old, setOld] = useState<(OpenCupRow & { top: OpenCupMatchRow[]; me: OpenCupMine | null }) | null>(null)
  const paid = useRef<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetchOpenCup()
    if (r.ok) { setSt(r); setWhy(null) } else setWhy(r.why ?? '全服杯暂时读不到。')
  }, [])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => { if (!document.hidden) void load() }, 60_000)
    return () => window.clearInterval(t)
  }, [load])

  // a round has just fallen due: look again a few seconds after it, once
  const dueAt = st?.live?.nextAt ?? (st?.next && st.next.joined ? st.next.starts : null)
  // and again every ten seconds until the server has played it — a big round takes it a few
  const asked = useRef(0)
  useEffect(() => {
    if (!dueAt || now < dueAt + 4000 || now - asked.current < 10_000) return
    asked.current = now
    void load()
  }, [dueAt, now, load])

  // my cup is over and it paid: bring the prize in from the inbox, once
  const lastMe = st?.last?.me
  useEffect(() => {
    if (!st?.last || !lastMe || (!lastMe.wins && !lastMe.place)) return
    if (paid.current === st.last.id) return
    paid.current = st.last.id
    void collect(true)
  }, [st?.last, lastMe, collect])

  const filled = g.squad.slots.filter(Boolean).length
  const join = async () => {
    if (filled < 5) { toast('先凑齐五个人。'); go('squad'); return }
    setBusy(true)
    // the server reads the five it holds, so the five on screen has to be there first
    await commit(true)
    const r = await joinOpenCup()
    setBusy(false)
    if (!r.ok) { toast(r.why ?? '报不了名。'); return }
    toast(`报名成功，${clock(r.starts)} 开赛。开赛时用你当时的卡组。`)
    void load()
  }
  const leave = async () => {
    setBusy(true)
    const r = await leaveOpenCup()
    setBusy(false)
    if (!r.ok) { toast(r.why ?? '退不了。'); return }
    void load()
  }
  const open = async (cup: string, m: OpenCupMatchRow) => {
    if (!m.played || m.bye) return
    const r = await fetchOpenCupMatch(cup, m.round, m.slot)
    if (!r.ok) { toast(r.why ?? '读不到这场比赛。'); return }
    setReport({ detail: r, flip: m.mine === 'b', mine: !!m.mine })
  }
  const openOld = async (id: string) => {
    const r = await fetchOpenCupById(id)
    if (!r.ok) { toast(r.why ?? '读不到这一场。'); return }
    setOld(r.cup)
  }

  if (!cloud) return <Panel title="全服杯"><p className="small muted">需要联网。</p></Panel>
  if (!st) return <Panel title="全服杯"><p className="small muted">{why ?? '读取中…'}</p></Panel>

  const myScore = filled === 5 ? squadRating(g.squad, (id) => g.cards[id]?.level ?? 0) : null
  const rows = board === 'today' ? st.boards.today : st.boards.all

  return (
    <>
      <Panel
        title="全服杯"
        actions={<span className="tiny muted">免费报名 · 每 2 小时一场</span>}
      >
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.75 }}>
          所有玩家打同一张签表，<b>单败淘汰</b>，每 15 分钟自动打一轮，不用在线。人数凑不齐时第一轮有人轮空，之后不再轮空。
          <b>开赛时读取你当时的卡组</b>，之后本场不再变。BO3，决赛 BO5。
          每赢一场 {OPEN_CUP_WIN_COINS} 金币，名次奖励看参赛人数；奖励发到信箱。
          不足 {OPEN_CUP_MIN} 人取消，{OPEN_CUP_RANKED_MIN} 人以上的冠军计入冠军榜。
        </p>

        {st.next && (
          <div className={`bracket-leg ${st.next.joined ? 'won' : 'now'}`} style={{ flexWrap: 'wrap' }}>
            <b>{clock(st.next.starts)} 场</b>
            <span style={{ flex: 1, minWidth: 150 }}>
              <span className="tiny muted">
                已报名 {st.next.signed} 人 · {countdown(st.next.starts - now)}后开赛
              </span>
            </span>
            {st.next.joined ? (
              <>
                <span className="tiny" style={{ color: 'var(--win)' }}>已报名{myScore ? ` · 现在 ${myScore} 分` : ''}</span>
                <button className="sm" disabled={busy} onClick={() => void leave()}>退赛</button>
              </>
            ) : (
              <button className="primary" disabled={busy} onClick={() => void join()}>
                {filled < 5 ? '先去组队' : '报名'}
              </button>
            )}
          </div>
        )}
        {st.next && (
          <p className="tiny faint" style={{ margin: '8px 0 0', lineHeight: 1.7 }}>
            {st.next.signed < OPEN_CUP_MIN
              ? `满 ${OPEN_CUP_MIN} 人开赛。32 人以上冠军是${PACKS.ten.name}。`
              : `按现在 ${st.next.signed} 人算：冠军 ${prizeText(st.next.signed, 1)}，亚军 ${prizeText(st.next.signed, 2)}，四强 ${prizeText(st.next.signed, 4)}。32 人以上冠军是${PACKS.ten.name}。`}
          </p>
        )}
      </Panel>

      {st.live && (
        <Panel
          title={`${clock(st.live.starts)} 场 · 进行中`}
          actions={<span className="tiny muted">{st.live.entrants} 人参赛 · 还剩 {st.live.alive} 人</span>}
        >
          <p className="small" style={{ marginTop: 0 }}>
            已打 {st.live.round}/{st.live.rounds} 轮
            {st.live.nextAt && (
              <span className="muted"> · {openCupRoundName(st.live.rounds, st.live.round)} {clock(st.live.nextAt)} 开打（{countdown(st.live.nextAt - now)}后）</span>
            )}
          </p>
          <MyRun cup={st.live} me={st.live.me ?? null} onOpen={(m) => void open(st.live!.id, m)} />
          <Top cup={st.live} rows={st.live.top} onOpen={(m) => void open(st.live!.id, m)} />
        </Panel>
      )}

      {st.last && (
        <Panel
          title={`${clock(st.last.starts)} 场 · 已结束`}
          actions={<span className="tiny muted">{st.last.entrants} 人参赛</span>}
        >
          {st.last.champion && (
            <div className="bracket-leg won" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
              <b style={{ color: 'var(--warn)' }}>🏆 冠军</b>
              <span style={{ flex: 1, minWidth: 160 }}>
                {st.last.champion.name} <span className="tiny faint mono">{st.last.champion.tag}</span>
                <span className="tiny faint"> · 阵容分 {st.last.champion.score}</span>
                {st.last.champion.five && (
                  <span className="tiny muted" style={{ display: 'block', lineHeight: 1.7 }}>
                    {[...st.last.champion.five.slots, st.last.champion.five.coach]
                      .filter((id): id is string => !!id)
                      .map((id) => {
                        const c = cardById(id)
                        const lv = st.last!.champion!.five!.levels[id] ?? 0
                        return `${c ? cardName(c) : id}${lv ? ` +${lv}` : ''}`
                      }).join(' · ')}
                  </span>
                )}
              </span>
            </div>
          )}
          <MyRun cup={st.last} me={st.last.me ?? null} onOpen={(m) => void open(st.last!.id, m)} />
          <Top cup={st.last} rows={st.last.top} onOpen={(m) => void open(st.last!.id, m)} />
        </Panel>
      )}

      <Panel
        title="冠军榜"
        actions={
          <div className="seg">
            <button className={board === 'today' ? 'on' : ''} onClick={() => setBoard('today')}>今日</button>
            <button className={board === 'all' ? 'on' : ''} onClick={() => setBoard('all')}>总榜</button>
          </div>
        }
      >
        {st.titles && (
          <p className="small muted" style={{ marginTop: 0 }}>
            我的冠军：今日 <b>{st.titles.today}</b> · 累计 <b>{st.titles.all}</b>
          </p>
        )}
        {rows.length ? (
          <div className="grid" style={{ gap: 6 }}>
            {rows.map((r) => (
              <div key={`${r.rank}${r.tag}`} className={`bracket-leg ${r.me ? 'now' : ''}`}>
                <b className="mono" style={{ width: 28 }}>{r.rank}</b>
                <span style={{ flex: 1 }}>{r.name} <span className="tiny faint mono">{r.tag}</span></span>
                <span className="mono" style={{ color: 'var(--warn)' }}>🏆 {r.titles}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted">{board === 'today' ? '今天还没有产生冠军。' : '还没有产生冠军。'}</p>
        )}
      </Panel>

      {!!st.recent.length && (
        <Panel title="往届">
          <div className="grid" style={{ gap: 6 }}>
            {st.recent.map((c) => (
              <div key={c.id} className="bracket-leg" style={{ cursor: c.void ? 'default' : 'pointer' }} onClick={() => { if (!c.void) void openOld(c.id) }}>
                <b style={{ width: 52 }}>{clock(c.starts)}</b>
                <span style={{ flex: 1 }}>
                  {c.void
                    ? <span className="muted">人数不足，取消</span>
                    : <>{c.champion?.name ?? '?'} <span className="tiny faint mono">{c.champion?.tag}</span></>}
                </span>
                <span className="tiny faint">{c.entrants} 人</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {old && (
        <div className="modal-bg" onClick={() => setOld(null)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{clock(old.starts)} 场 · {old.entrants} 人</h2>
              <div className="spacer" />
              <button className="ghost sm" onClick={() => setOld(null)}>关闭</button>
            </div>
            <div className="modal-body">
              <MyRun cup={old} me={old.me} onOpen={(m) => void open(old.id, m)} />
              <Top cup={old} rows={old.top} onOpen={(m) => void open(old.id, m)} />
            </div>
          </div>
        </div>
      )}

      {report && <Replay report={report} onClose={() => setReport(null)} />}
    </>
  )
}

/** Where this account stands in a cup, and the ties it played. */
function MyRun({ cup, me, onOpen }: { cup: OpenCupRow; me: OpenCupMine | null; onOpen: (m: OpenCupMatchRow) => void }) {
  if (!me) return null
  const stand = me.outRound === -1 ? '开赛时阵容不满五人，没有参赛'
    : me.place === 1 ? '🏆 冠军'
      : me.place === 2 ? '亚军'
        : me.place === 4 ? '四强'
          : me.alive ? `还在 · 已赢 ${me.wins} 场`
            : `止步${openCupRoundName(cup.rounds, me.outRound ?? 0)} · 赢了 ${me.wins} 场`
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="small" style={{ marginBottom: 6 }}>
        <b>我的战绩</b>　<span style={{ color: me.alive || me.place === 1 ? 'var(--win)' : undefined }}>{stand}</span>
        {me.score != null && <span className="tiny faint">　参赛阵容 {me.score} 分</span>}
      </div>
      <div className="grid" style={{ gap: 6 }}>
        {me.matches.map((m) => <MatchLine key={`${m.round}:${m.slot}`} cup={cup} m={m} onOpen={onOpen} />)}
      </div>
    </div>
  )
}

/** The quarter-finals on. */
function Top({ cup, rows, onOpen }: { cup: OpenCupRow; rows: OpenCupMatchRow[]; onOpen: (m: OpenCupMatchRow) => void }) {
  if (!rows.length) return null
  return (
    <div>
      <div className="small" style={{ marginBottom: 6 }}><b>后三轮</b></div>
      <div className="grid" style={{ gap: 6 }}>
        {rows.map((m) => <MatchLine key={`${m.round}:${m.slot}`} cup={cup} m={m} onOpen={onOpen} />)}
      </div>
    </div>
  )
}

function MatchLine({ cup, m, onOpen }: { cup: OpenCupRow; m: OpenCupMatchRow; onOpen: (m: OpenCupMatchRow) => void }) {
  const iWon = m.mine ? (m.mine === 'a') === m.aWon : null
  const cls = !m.played ? 'now' : m.mine ? (m.bye || iWon ? 'won' : 'lost') : ''
  // one side a line: two names, two tags and two scores do not fit across a phone
  const side = (w: OpenCupMatchRow['a'] | null, won: boolean | null, maps: number | null) => w && (
    <div className="row" style={{ gap: 6, alignItems: 'baseline', opacity: won === false ? 0.6 : 1 }}>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: won ? 700 : 400 }}>
        {w.name} <span className="tiny faint mono">{w.tag}</span>
        {w.score != null && <span className="tiny faint"> · {w.score} 分</span>}
      </span>
      {maps != null && <span className="mono" style={{ fontWeight: won ? 700 : 400 }}>{maps}</span>}
    </div>
  )
  return (
    <div
      className={`bracket-leg ${cls}`}
      style={{ cursor: m.played && !m.bye ? 'pointer' : 'default' }}
      onClick={() => onOpen(m)}
    >
      <b style={{ width: 52, flex: 'none' }}>{openCupRoundName(cup.rounds, m.round)}</b>
      <div style={{ flex: 1, minWidth: 0 }}>
        {side(m.a, m.played && !m.bye ? m.aWon : null, m.bye ? null : m.mapsA)}
        {m.bye
          ? <div className="tiny muted">轮空晋级</div>
          : side(m.b, m.played ? !m.aWon : null, m.mapsB)}
      </div>
      {!m.played && <span className="tiny" style={{ color: 'var(--accent)', flex: 'none' }}>未开打</span>}
    </div>
  )
}

/**
 * One tie, in the report the ladder uses. The server keeps the maps and the
 * two scoreboards, not the round log, so the strip under each map is absent;
 * everything else is the same screen. `flip` puts the asker's five on top.
 */
function Replay({ report, onClose }: { report: { detail: OpenCupMatchDetail; flip: boolean; mine: boolean }; onClose: () => void }) {
  const { detail: d, flip, mine } = report
  const top = flip ? d.b : d.a
  const bottom = flip ? d.a : d.b
  if (!top || !bottom) return null
  const topSide = flip ? d.detail.b : d.detail.a
  const bottomSide = flip ? d.detail.a : d.detail.b
  const topWon = flip ? !d.aWon : d.aWon
  const result = {
    win: topWon,
    mapsWon: flip ? d.mapsB : d.mapsA,
    mapsLost: flip ? d.mapsA : d.mapsB,
    lines: topSide.lines,
    mvpCard: topSide.mvpCard,
    result: {
      maps: d.detail.maps.map((m) => ({ map: m.map, scoreA: flip ? m.b : m.a, scoreB: flip ? m.a : m.b })),
      highlights: [],
    },
    opp: {
      name: bottom.name, tag: bottom.tag, slots: bottom.five.slots, coach: bottom.five.coach,
      levels: bottom.five.levels ?? {}, lines: bottomSide.lines, mvpCard: bottomSide.mvpCard,
    },
  } as unknown as ArenaResult
  return (
    <MatchReport
      result={result}
      opponentId=""
      opponentName={mine ? `${bottom.name} ${bottom.tag}` : bottom.name}
      mySquad={{ slots: top.five.slots, coach: top.five.coach }}
      mineTitle={mine ? '我的卡组' : top.name}
      neutral={!mine}
      level={(id) => top.five.levels?.[id] ?? 0}
      onClose={onClose}
      extra={
        <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
          <span className="chiplet">全服杯 · {openCupRoundName(d.rounds, d.round)} · BO{d.detail.bo}</span>
        </div>
      }
    />
  )
}
