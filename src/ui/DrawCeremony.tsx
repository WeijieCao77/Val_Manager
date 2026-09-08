/**
 * The draw, on screen.
 *
 * One ceremony for every kind of draw: the rule of the day at the top, the
 * pots on the left with the balls already out struck through, the balls as
 * they come out in the middle — the latest lit, a forced placement with its
 * reason under it — and on the right the thing being built: the groups, the
 * pairings, the opening ties. 抽下一签 turns one ball, 全部揭晓 the rest;
 * nothing here changes what was decided when the draw was made.
 *
 * The one draw that IS a decision — the Masters quarter-final pick — shows
 * the candidates with what a coach would want to know and waits for the
 * click, or hands it to the coaches. A pick is written the moment it is
 * made; closing the window does not take it back.
 */
import { useGame } from './ctx'
import { Crest, Modal, fmtDay } from './common'
import { DRAW_KIND_CN, choosePick, drawById, pickerNow, revealNext } from '../engine/draw'
import type { DrawEvent } from '../engine/draw'
import { finishDraw } from '../engine/season'
import { swissRecord } from '../engine/bracket'
import { REGION_CN } from '../engine/types'
import type { Competition } from '../engine/types'

export default function DrawCeremony({ drawId, onClose }: { drawId: string; onClose: () => void }) {
  const { game, commit, toast } = useGame()
  const ev = drawById(game, drawId)
  const comp = ev ? game.comps[ev.competitionKey] : undefined
  if (!ev || !comp) return null
  const shown = ev.steps.slice(0, ev.revealed)
  const revealed = new Set(shown.map((s) => s.team))
  const isPick = ev.kind === 'masters-playoff-pick'
  const myTurn = isPick && ev.status === 'awaiting-choice' && pickerNow(ev) === game.myTeam
  const allOut = ev.revealed >= ev.steps.length
  const n = ev.phase?.match(/swiss-r(\d)/)?.[1]
  const title = `${comp.name}${comp.city ? ` · ${comp.city}` : ''} · ${DRAW_KIND_CN[ev.kind]}${n ? ` 第 ${n} 轮` : ''}`
  const tagOf = (id: string) => game.teams[id]?.tag ?? '—'

  // the last ball out finishes the draw: its ties go into the schedule
  // then and there, and the clock is released
  const next = () => {
    revealNext(ev)
    if (ev.revealed >= ev.steps.length && !isPick) finishDraw(game, ev)
    commit()
  }
  const all = () => {
    if (isPick) finishDraw(game, ev, true); else finishDraw(game, ev)
    commit()
    toast(isPick ? '交给了教练组。' : '对阵已写进赛程。')
  }
  const close = () => {
    if (!ev.consumed) toast('抽签还没抽完，可以从总览页再进来。')
    commit()
    onClose()
  }
  const choose = (cand: string) => {
    const msg = choosePick(game, ev, comp, game.myTeam, cand, '主教练亲自点的')
    finishDraw(game, ev)
    commit()
    toast(msg)
  }
  const delegate = () => {
    finishDraw(game, ev, true)
    commit()
    toast('交给了教练组。')
  }

  return (
    <Modal wide title={title} onClose={close}>
      <p className="small muted" style={{ marginTop: 0, lineHeight: 1.7 }}>
        {ev.rule}
        <span className="tiny faint"> · {fmtDay(ev.day, ev.year)}{ev.status === 'complete' ? ' · 已完成' : ''}</span>
      </p>
      {/* The pick is the one thing on this screen that is ours to do, so it
          comes first: on a phone it used to sit below the pots and the order
          list, and the four qualifiers in the pot — display only — were
          what got tapped (「点下面那四个队伍没反应」, 2026-09-07). The pot
          entries take the pick too now, while it is ours. */}
      {myTurn && <Choice ev={ev} comp={comp} onChoose={choose} onDelegate={delegate} />}
      <div className="draw-grid">
        <div className="draw-pots">
          {ev.pots.map((pot, pi) => (
            <div key={pi} className="draw-pot">
              <div className="tiny muted" style={{ marginBottom: 4 }}>
                {pot.name}
                {myTurn && pot.teams.some((t) => (ev.pickPool ?? []).includes(t)) && <span className="faint"> · 点一队选它</span>}
              </div>
              {pot.teams.map((t) => {
                const pickable = myTurn && (ev.pickPool ?? []).includes(t)
                return (
                  <div
                    key={t}
                    className={`draw-ball${revealed.has(t) ? ' out' : ''}${t === game.myTeam ? ' me' : ''}${pickable ? ' pickable' : ''}`}
                    role={pickable ? 'button' : undefined}
                    tabIndex={pickable ? 0 : undefined}
                    title={pickable ? `选 ${tagOf(t)} 做八强对手` : undefined}
                    onClick={pickable ? () => choose(t) : undefined}
                    onKeyDown={pickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(t) } } : undefined}
                    style={pickable ? { cursor: 'pointer' } : undefined}
                  >
                    <Crest id={t} size={14} /><span className="nm">{tagOf(t)}</span>
                    {pickable && <span className="tiny faint" style={{ marginLeft: 'auto' }}>选它 ›</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="draw-steps">
          {shown.length === 0 && <div className="empty">签球还在碗里。</div>}
          {shown.map((s, i) => (
            <div key={i} className={`draw-step${i === shown.length - 1 ? ' latest' : ''}${s.team === game.myTeam ? ' me' : ''}`}>
              <span className="mono muted tiny">{i + 1}</span>
              <Crest id={s.team} size={14} />
              <b>{tagOf(s.team)}</b>
              <span className="muted">→ {s.slot}</span>
              {s.by && <span className="tiny faint">（{tagOf(s.by)} 选的）</span>}
              {s.note && <div className="tiny faint" style={{ width: '100%', paddingLeft: 22 }}>{s.note}</div>}
            </div>
          ))}
        </div>
        <div className="draw-board">
          <Board ev={ev} comp={comp} revealed={revealed} />
        </div>
      </div>
      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        {!allOut && <button className="primary" onClick={next}>抽下一签</button>}
        {!ev.consumed && !myTurn && <button onClick={all}>快进跳过</button>}
        {ev.consumed && <button className="primary" onClick={close}>关闭</button>}
        {!ev.consumed && <button className="ghost" onClick={close}>先关掉，稍后再抽</button>}
        <span className="tiny faint" style={{ alignSelf: 'center' }}>
          {ev.revealed}/{ev.steps.length} 签 · {ev.consumed ? '对阵已写进赛程' : '抽完才会写进赛程'}
        </span>
      </div>
      {ev.log.length > 0 && allOut && (
        <details style={{ marginTop: 10 }}>
          <summary className="tiny muted" style={{ cursor: 'pointer' }}>抽签记录</summary>
          <ul className="tiny muted" style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
            {ev.log.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </details>
      )}
    </Modal>
  )
}

/** What the draw is building, filled in as the balls come out. */
function Board({ ev, comp, revealed }: { ev: DrawEvent; comp: Competition; revealed: Set<string> }) {
  const { game } = useGame()
  const tagOf = (id: string) => game.teams[id]?.tag ?? '—'
  const cell = (id: string | undefined, hideUntilRevealed = true) => (
    id && (!hideUntilRevealed || revealed.has(id))
      ? <span className={`club${id === game.myTeam ? ' me' : ''}`}><Crest id={id} size={14} /><span>{tagOf(id)}</span></span>
      : <span className="faint">待定</span>
  )
  if (ev.outcome.groups) {
    const names = comp.groupNames ?? (ev.outcome.groups.length === 2 ? ['Alpha', 'Omega'] : ['A', 'B', 'C', 'D'])
    return (
      <div className="draw-groups">
        {ev.outcome.groups.map((g, i) => (
          <div key={i} className="draw-group">
            <div className="tiny muted" style={{ marginBottom: 4 }}>{names[i]} 组</div>
            {g.map((t, k) => <div key={k} className="draw-slot">{cell(t)}</div>)}
          </div>
        ))}
      </div>
    )
  }
  if (ev.kind === 'kickoff-bracket') {
    const s = ev.outcome.seeds ?? []
    return (
      <div className="draw-groups">
        <div className="draw-group">
          <div className="tiny muted" style={{ marginBottom: 4 }}>胜者组第一轮</div>
          {[0, 1, 2, 3].map((k) => (
            <div key={k} className="draw-slot">{cell(s[k * 2])} <span className="faint">vs</span> {cell(s[k * 2 + 1])}</div>
          ))}
        </div>
        <div className="draw-group">
          <div className="tiny muted" style={{ marginBottom: 4 }}>胜者组第二轮（轮空位）</div>
          {[0, 1, 2, 3].map((k) => (
            <div key={k} className="draw-slot"><span className="faint">第 {k + 1} 场胜者 vs</span> {cell(s[8 + k])}</div>
          ))}
        </div>
      </div>
    )
  }
  if (ev.kind === 'masters-playoff-pick') {
    const order = ev.pickOrder ?? []
    const pairs = ev.outcome.pairs ?? []
    return (
      <div className="draw-groups">
        <div className="draw-group">
          <div className="tiny muted" style={{ marginBottom: 4 }}>八强对阵（按选择顺序）</div>
          {order.map((c, k) => (
            <div key={c} className="draw-slot">
              <span className="tiny faint">{k + 1}.</span> {cell(c, false)} <span className="faint">vs</span> {pairs[k] ? cell(pairs[k][1], false) : <span className="faint">{pickerNow(ev) === c ? '选择中…' : '待选'}</span>}
            </div>
          ))}
        </div>
      </div>
    )
  }
  const pairs = ev.outcome.pairs ?? []
  return (
    <div className="draw-groups">
      <div className="draw-group">
        <div className="tiny muted" style={{ marginBottom: 4 }}>对阵</div>
        {pairs.map(([a, b], k) => (
          <div key={k} className="draw-slot">{cell(a)} <span className="faint">vs</span> {cell(b)}</div>
        ))}
      </div>
    </div>
  )
}

/** The manager's pick: the candidates, and what a coach would look at. */
function Choice({ ev, comp, onChoose, onDelegate }: {
  ev: DrawEvent; comp: Competition; onChoose: (id: string) => void; onDelegate: () => void
}) {
  const { game } = useGame()
  const pool = ev.pickPool ?? []
  const met = (id: string) => game.fixtures.filter((f) => f.played
    && ((f.teamA === game.myTeam && f.teamB === id) || (f.teamB === game.myTeam && f.teamA === id)))
  return (
    <div className="draw-choice">
      <div className="nav-group" style={{ padding: '10px 0 6px' }}>轮到我们选八强对手，选定后不能反悔</div>
      {/* The 选 button used to be the seventh column. On a phone the table
          scrolls sideways and that column was off the screen, so the four
          rows read as a list that did nothing when tapped — 「点下面那四个
          队伍没反应」. The row itself is the control now, the button sits
          beside the name, and the columns a phone cannot fit are hidden. */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>队伍</th><th className="hide-m">赛区</th><th className="num">评分</th><th className="num">瑞士轮</th><th className="num hide-m">小局</th><th className="hide-m">交手</th></tr>
          </thead>
          <tbody>
            {pool.map((id) => {
              const t = game.teams[id]
              const r = swissRecord(comp, id)
              const row = comp.standings[id]
              const h = met(id)
              const won = h.filter((f) => (f.result!.mapsWonA > f.result!.mapsWonB) === (f.teamA === game.myTeam)).length
              return (
                <tr key={id} className="clickable" onClick={() => onChoose(id)} title={`选 ${t?.tag} 做八强对手`}>
                  <td>
                    <span className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button className="sm primary" onClick={(e) => { e.stopPropagation(); onChoose(id) }}>选 {t?.tag}</button>
                      <span className="club"><Crest id={id} /><span>{t?.name}</span></span>
                    </span>
                  </td>
                  <td className="small muted hide-m">{t ? REGION_CN[t.region] : ''}</td>
                  <td className="num mono">{t?.rating}</td>
                  <td className="num mono">{r.w}-{r.l}</td>
                  <td className="num mono hide-m">{row ? `${row.mapW}-${row.mapL}` : '—'}</td>
                  <td className="small muted hide-m">{h.length ? `${won} 胜 ${h.length - won} 负` : '未交手'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
        <button className="sm ghost" onClick={onDelegate}>交给教练组</button>
        <span className="tiny faint" style={{ alignSelf: 'center' }}>教练组会挑最有把握的一队。</span>
      </div>
    </div>
  )
}
