import { useMemo, useState } from 'react'
import { useGame } from './ctx'
import { Crest, fmtDay, OvrBadge, Panel } from './common'
import { involves, RUMOR_CN, TX_GROUPS, TX_KIND_CN } from '../engine/transferNews'
import type { TxNews } from '../engine/transferNews'
import { REGION_CN, REGIONS } from '../engine/types'
import { asksOut } from '../engine/transfer'
import type { GameState } from '../engine/types'

/**
 * 转会新闻: the whole market, as it happened (engine/transferNews.ts).
 *
 * The group (2026-10-08): 「转会消息不是很清晰」 — moves were lines of prose in the general news,
 * gone after 400 lines, with nothing to tell a rumour from a done deal. Every story here is one
 * row in the shape the group asked for, 「(队标)队伍.选手 → (队标)队伍.选手」, marked with what
 * kind of story it is, filterable by kind and season, and kept across seasons.
 */
const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}K`)

function Side({ game, team, ign, pid, onPlayer }: {
  game: GameState; team: string | null | undefined; ign?: string; pid?: string; onPlayer?: (id: string) => void
}) {
  // a free agent has no club to write before the dot; the name is on the other side of the arrow
  if (!team) return <span className="tx-side faint">自由人</span>
  const t = game.teams[team]
  const name = ign
    ? (pid && onPlayer && game.players[pid]
      ? <button className="tx-name" onClick={() => onPlayer(pid)}><b>{ign}</b></button>
      : <b>{ign}</b>)
    : null
  return (
    <span className="tx-side" title={t?.name}>
      <Crest id={team} size={16} />
      {/* 「队伍.选手」 in one run, no gap around the dot */}
      <span><span className={team === game.myTeam ? 'tx-mine' : undefined}>{t?.tag ?? team}</span>{name && <>.{name}</>}</span>
    </span>
  )
}

export function TxRow({ e, game, onPlayer }: { e: TxNews; game: GameState; onPlayer: (id: string) => void }) {
  const me = { game, onPlayer }
  const fee = e.fee ? <span className="tx-fee">{money(e.fee)}</span> : null
  let body
  switch (e.k) {
    case 'done':
    case 'free':
      body = <>
        <Side {...me} team={e.f} ign={e.n} pid={e.p} /><span className="tx-arrow">→</span><Side {...me} team={e.t} ign={e.n} pid={e.p} />
        {e.k === 'done' ? (fee ?? <span className="tx-fee">免转会费</span>) : null}
      </>
      break
    case 'release':
      body = <><Side {...me} team={e.f} ign={e.n} pid={e.p} /><span className="tx-arrow">→</span><span className="faint">自由人</span></>
      break
    case 'listed':
      body = <><Side {...me} team={e.f} ign={e.n} pid={e.p} /><span className="muted">挂牌出售</span></>
      break
    case 'wants':
      body = <>
        <Side {...me} team={e.f} ign={e.n} pid={e.p} />
        <span className="muted">希望离队</span>
        {e.t && <><span className="tx-arrow">⇢</span><span className="muted">有意</span><Side {...me} team={e.t} /></>}
      </>
      break
    case 'rumor':
    case 'off':
      body = <>
        <Side {...me} team={e.f} ign={e.n} pid={e.p} /><span className="tx-arrow">⇢</span><Side {...me} team={e.t} />
        {e.k === 'rumor' && e.c && <span className={`tag${e.c === 1 ? '' : ' t2'}`}>{RUMOR_CN[e.c]}</span>}
      </>
      break
    case 'bid':
      body = <><Side {...me} team={e.t} /><span className="muted">报价 {e.fee ? money(e.fee) : ''} 求购</span><Side {...me} team={e.f} ign={e.n} pid={e.p} /></>
      break
  }
  return (
    <div className={`tx-row tx-${e.k}${involves(e, game.myTeam) ? ' important' : ''}`}>
      {/* the year too when it is not this season's, or 「所有赛季」 reads two winters as one */}
      <span className="tx-date">{e.y !== game.year ? `${e.y}·` : ''}{fmtDay(e.d, e.y)}</span>
      <span className={`tx-kind tx-kind-${e.k}`}>{TX_KIND_CN[e.k]}</span>
      <span className="tx-body">
        {body}
        {e.o != null && <OvrBadge value={e.o} />}
        {e.w && <span className="tx-why">{e.k === 'off' ? `告吹：${e.w}` : e.w}</span>}
      </span>
    </div>
  )
}

export default function TransferNews() {
  const { game, openPlayer, go } = useGame()
  const feed = game.transferFeed ?? []
  const [group, setGroup] = useState('all')
  // every season by default: in the preseason window the winter's moves are last year's
  const [year, setYear] = useState<number | 'all'>('all')
  const [region, setRegion] = useState<string>('all')
  const [mine, setMine] = useState(false)
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(100)

  const years = useMemo(() => [...new Set(feed.map((e) => e.y))].sort((a, b) => b - a), [feed, feed.length])
  const rows = useMemo(() => {
    const kinds = TX_GROUPS.find((g) => g.key === group)?.kinds ?? []
    const needle = q.trim().toLowerCase()
    const inRegion = (id?: string | null) => !!id && game.teams[id]?.region === region
    return feed.filter((e) =>
      (!kinds.length || kinds.includes(e.k))
      && (year === 'all' || e.y === year)
      && (!mine || involves(e, game.myTeam))
      && (region === 'all' || inRegion(e.f) || inRegion(e.t))
      && (!needle || e.n.toLowerCase().includes(needle)
        || [e.f, e.t].some((id) => id && (game.teams[id]?.tag.toLowerCase().includes(needle) || game.teams[id]?.name.toLowerCase().includes(needle)))),
    ).reverse()
  }, [feed, feed.length, group, year, region, mine, q, game])

  // what is going on right now
  const talks = (game.pursuits ?? [])
    .map((x) => ({ x, p: game.players[x.p] }))
    .filter((r) => r.p && r.p.teamId)
  const wanting = Object.values(game.players)
    .filter((p) => p.teamId && asksOut(game, p))
    .sort((a, b) => b.overall - a.overall)

  return (
    <>
      <p className="small muted" style={{ marginTop: 0 }}>
        全世界的转会、传闻和挂牌都在这里，按时间倒序，往年的也留着。
        <b>传闻</b>分三档：<span className="tag">绯闻</span>只是传言；<span className="tag t2">有消息称</span>有俱乐部在关注；
        <span className="tag t2">谈判中</span>是真的在谈，约一周后见分晓，成交会标「传闻成真」，谈不拢标「告吹」。
        球队成绩长期不好时，队里的好球员会提出离队（<b>意向</b>），AI 球队会把他挂牌。
      </p>

      {(talks.length > 0 || wanting.length > 0) && (
        <div className="grid c2">
          <Panel title={`正在谈 · ${talks.length}`} flush>
            {talks.length ? talks.map(({ x, p }) => (
              <div key={x.tm + x.p} className="tx-row">
                <span className="tx-body">
                  <Side game={game} team={p!.teamId} ign={p!.ign} pid={p!.id} onPlayer={openPlayer} />
                  <span className="tx-arrow">⇢</span>
                  <Side game={game} team={x.tm} />
                  <OvrBadge value={p!.overall} />
                  <span className="tx-fee">{money(x.fee)}</span>
                  {x.n > 0 && <span className="tx-why">第 {x.n + 1} 轮</span>}
                </span>
              </div>
            )) : <p className="small faint" style={{ padding: '8px 13px', margin: 0 }}>眼下没有俱乐部在谈。</p>}
          </Panel>
          <Panel title={`想走的人 · ${wanting.length}`} flush>
            {wanting.length ? wanting.slice(0, 12).map((p) => (
              <div key={p.id} className={`tx-row${p.teamId === game.myTeam ? ' important' : ''}`}>
                <span className="tx-body">
                  <Side game={game} team={p.teamId} ign={p.ign} pid={p.id} onPlayer={openPlayer} />
                  <OvrBadge value={p.overall} />
                  {p.wantsOut?.t && <><span className="muted">有意</span><Side game={game} team={p.wantsOut.t} /></>}
                  {p.listed && <span className="tag">已挂牌</span>}
                </span>
              </div>
            )) : <p className="small faint" style={{ padding: '8px 13px', margin: 0 }}>还没有人提出离队。</p>}
          </Panel>
        </div>
      )}

      <Panel
        title={`转会新闻 · ${rows.length} 条`}
        actions={<button className="sm ghost" onClick={() => go('transfers')}>去转会市场</button>}
        flush
      >
        <div className="tx-filters">
          <div className="seg wrap">
            {TX_GROUPS.map((g) => (
              <button key={g.key} className={group === g.key ? 'on' : ''} onClick={() => { setGroup(g.key); setLimit(100) }}>{g.label}</button>
            ))}
          </div>
          <select value={String(year)} onChange={(ev) => { setYear(ev.target.value === 'all' ? 'all' : Number(ev.target.value)); setLimit(100) }} aria-label="赛季">
            <option value="all">所有赛季</option>
            {(years.includes(game.year) ? years : [game.year, ...years]).map((y) => <option key={y} value={y}>{y} 赛季</option>)}
          </select>
          <select value={region} onChange={(ev) => setRegion(ev.target.value)} aria-label="赛区">
            <option value="all">所有赛区</option>
            {REGIONS.map((r) => <option key={r} value={r}>{REGION_CN[r]}</option>)}
          </select>
          <label className="small"><input type="checkbox" checked={mine} onChange={(ev) => setMine(ev.target.checked)} /> 只看我队</label>
          <input type="search" placeholder="搜选手或战队" value={q} onChange={(ev) => setQ(ev.target.value)} style={{ maxWidth: 160 }} />
        </div>
        {rows.length ? rows.slice(0, limit).map((e) => <TxRow key={`${e.y}:${e.d}:${e.p}:${e.k}:${e.t ?? ''}:${e.c ?? ''}`} e={e} game={game} onPlayer={openPlayer} />) : (
          <p className="small faint" style={{ padding: '10px 13px', margin: 0 }}>
            {feed.length ? '没有符合条件的新闻。' : '转会新闻从这个版本开始记录；更早的转会可以在选手资料卡的履历里看到。'}
          </p>
        )}
        {rows.length > limit && (
          <div style={{ padding: '8px 13px' }}><button className="sm ghost" onClick={() => setLimit(limit + 200)}>再看 200 条（还有 {rows.length - limit} 条）</button></div>
        )}
      </Panel>
    </>
  )
}
