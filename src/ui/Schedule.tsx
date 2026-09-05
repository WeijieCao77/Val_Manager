import { useState } from 'react'
import { useGame } from './ctx'
import { Panel, fmtDay, Crest } from './common'
import { STAGES, fixturesFor, stageName } from '../engine/season'
import { INTERNATIONAL_START, eventRounds, nextInEvent, upcomingInternational } from '../engine/qualify'
import { hostCity } from '../engine/hosts'
import { CHAMPIONS, MASTERS_1, MASTERS_2 } from '../engine/endings'
import type { Fixture } from '../engine/types'

/**
 * The calendar, from the club's side.
 *
 * 本队 used to be exactly the club's own fixtures, which had two holes in it.
 * A playoff we had just gone out of vanished — its final was two days away
 * and the page said nothing, so a manager who had finished third did not know
 * when the winner would be decided. And the Masters we had already qualified
 * for was not on it at all until the draw existed, which can be a week later:
 * the page listed a league game forty days out, then a 7-day advance landed
 * on 「G2 · 9 天后」 with nothing in between. So 本队 now also carries the rest
 * of a playoff we are out of, every international event (greyed when we are
 * not in it — it is still the week everyone watches), and a placeholder row
 * for the event we are booked into before its draw.
 */

interface Row {
  key: string
  day: number
  comp: string
  round: string
  a?: string
  b?: string
  bo?: number
  fixture?: Fixture
  /** somebody else's match, shown for context */
  other?: boolean
  /** the draw does not exist yet */
  pending?: string
}

interface Group { key: string; title: string; day: number; dim?: boolean; note?: string; rows: Row[] }

const INTL: { key: 'masters1' | 'masters2' | 'champions'; name: string }[] = [
  { key: 'masters1', name: MASTERS_1 }, { key: 'masters2', name: MASTERS_2 }, { key: 'champions', name: CHAMPIONS },
]

export default function Schedule() {
  const { game, openMatch } = useGame()
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const me = game.myTeam
  const myRegion = game.teams[me]?.region

  const rowOf = (f: Fixture, other = false): Row => ({
    key: f.id, day: f.day, comp: game.comps[f.comp]?.name ?? f.comp,
    round: f.label.replace(/^(KO|SW):\d+:/, ''), a: f.teamA, b: f.teamB, bo: f.bo, fixture: f, other,
  })

  const groups: Group[] = []
  if (scope === 'all') {
    const list = game.fixtures.slice().sort((a, b) => a.day - b.day).filter((f) => Math.abs(f.day - game.day) <= 10)
    const byStage = new Map<string, Row[]>()
    for (const f of list) {
      const k = stageName(f.stage)
      byStage.set(k, [...(byStage.get(k) ?? []), rowOf(f, f.teamA !== me && f.teamB !== me)])
    }
    for (const [title, rows] of byStage) groups.push({ key: title, title, day: rows[0].day, rows })
  } else {
    const mine = fixturesFor(game, me)
    const intlKeys = new Set(INTL.map((x) => x.key))
    // our own games, by stage — internationals get their own sections below
    const byStage = new Map<string, Row[]>()
    for (const f of mine) {
      if (intlKeys.has(f.comp as 'masters1')) continue
      const k = stageName(f.stage)
      byStage.set(k, [...(byStage.get(k) ?? []), rowOf(f)])
    }
    // a playoff we are out of still has a winner to find: its remaining ties
    // join our stage's section, greyed, so the final's date is on the page
    for (const comp of Object.values(game.comps)) {
      if (comp.region !== myRegion || comp.champion || !comp.bracketStarted) continue
      const rest = game.fixtures.filter((f) => f.comp === comp.key && !f.played
        && f.label.startsWith('KO:') && f.teamA !== me && f.teamB !== me)
      if (!rest.length) continue
      const k = stageName(comp.stage)
      byStage.set(k, [...(byStage.get(k) ?? []), ...rest.map((f) => rowOf(f, true))].sort((x, y) => x.day - y.day))
    }
    // The rounds of a regional playoff that have not been drawn are on the
    // calendar all the same: a side beaten in the upper final is in the
    // lower final two days on, and the page used to show nothing between
    // that loss and a league game nine weeks away. Ours says 对手待定; a
    // round that may or may not be ours says 待定 vs 待定.
    const inRegional = nextInEvent(game)
    for (const comp of Object.values(game.comps)) {
      if (comp.region !== myRegion || (comp.format !== 'double' && comp.format !== 'triple') || comp.champion) continue
      // a bracket whose draw has not been held has no ties, but its days are
      // known — every round shows as 待定 vs 待定 until the balls are out
      if (!comp.bracketStarted && comp.plannedStart == null) continue
      const k = stageName(comp.stage)
      const rows = byStage.get(k) ?? []
      for (const r of eventRounds(game, comp)) {
        if (r.drawn) continue
        const ours = inRegional?.comp.key === comp.key && inRegional.day === r.day
        // our own row names the round we are actually in — a side on a bye
        // is in 胜者组第二轮, not in the wave's 「胜者组第二轮 / 中段组第一轮」
        rows.push({
          key: `${comp.key}:${r.name}`, day: r.day, comp: comp.name,
          round: ours ? inRegional!.round.replace(/^季后赛 /, '') : r.name,
          a: ours ? me : undefined, other: !ours, pending: ours ? '对手待定' : '待定 vs 待定',
        })
      }
      byStage.set(k, rows.sort((x, y) => x.day - y.day))
    }
    for (const [title, rows] of byStage) groups.push({ key: title, title, day: rows[0].day, rows })

    // every international event, whether or not we are in it
    const up = upcomingInternational(game)
    const inEv = nextInEvent(game)
    for (const ev of INTL) {
      const comp = game.comps[ev.key]
      if (comp) {
        const inIt = comp.teams.includes(me)
        const rows = game.fixtures.filter((f) => f.comp === ev.key).sort((a, b) => a.day - b.day)
          .map((f) => rowOf(f, f.teamA !== me && f.teamB !== me))
        // the rounds not drawn yet are on the calendar all the same — the
        // opponent is the only unknown, and our own next round says so
        if (!comp.champion) {
          for (const r of eventRounds(game, comp)) {
            if (r.drawn) continue
            const ours = inEv?.comp.key === ev.key && inEv.day === r.day
            rows.push({
              key: `${ev.key}:${r.name}`, day: r.day, comp: ev.name, round: r.name,
              a: ours ? me : undefined, other: !ours, pending: ours ? '对手待定' : '待定 vs 待定',
            })
          }
          rows.sort((x, y) => x.day - y.day)
        }
        groups.push({
          key: ev.key, title: comp.city ? `${ev.name} · ${comp.city}` : ev.name, day: rows[0]?.day ?? game.day, dim: !inIt,
          note: inIt ? undefined : '本届没有我们，看看别人怎么打。', rows,
        })
      } else if (up?.key === ev.key) {
        groups.push({
          key: ev.key, title: `${ev.name} · ${hostCity(game, ev.key)}`, day: up.day,
          note: `已锁定：${up.how}。对阵要等四个赛区都打完才抽，抽出来会补进这里。`,
          rows: [{ key: ev.key + ':pending', day: up.day, comp: ev.name, round: up.swiss ? '瑞士轮 第1轮' : '季后赛', a: me, pending: '对手待定' }],
        })
      } else if (game.day <= INTERNATIONAL_START[ev.key] + 30 && game.stage !== 'offseason') {
        // not decided yet: name the week so the calendar has its shape
        const feederDone = !!game.comps[ev.key === 'masters1' ? `kickoff:${myRegion}` : ev.key === 'masters2' ? `stage1:${myRegion}` : `stage2:${myRegion}`]?.champion
        groups.push({
          key: ev.key, title: ev.name, day: INTERNATIONAL_START[ev.key], dim: true,
          note: feederDone ? '本届没有我们。' : `约 ${fmtDay(INTERNATIONAL_START[ev.key], game.year)} 开打，名额还没决出。`,
          rows: [],
        })
      }
    }
  }
  groups.sort((x, y) => x.day - y.day)

  return (
    <>
      <Panel title="赛季日历">
        <div className="row wrap" style={{ gap: 6 }}>
          {STAGES.map((s) => {
            const active = game.stage === s.key
            const done = game.day > s.end
            return (
              <span
                key={s.key}
                className="tag"
                style={{
                  borderColor: active ? 'var(--accent)' : undefined,
                  color: active ? 'var(--accent)' : done ? 'var(--faint)' : undefined,
                  fontWeight: active ? 700 : 400,
                }}
                title={`第 ${s.start}–${s.end} 天`}
              >
                {s.name}
              </span>
            )
          })}
        </div>
        <p className="tiny muted" style={{ marginBottom: 0, marginTop: 10 }}>
          次级联赛的两个赛段与一级联赛并行进行；Challengers 第二赛段冠军可通过 Ascension 升入 VCT。
        </p>
      </Panel>

      <Panel
        title="赛程"
        actions={
          <div className="seg">
            <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>本队</button>
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>近期全部</button>
          </div>
        }
        flush
      >
        {groups.length === 0 && <div className="empty">暂无赛程。</div>}
        {groups.map((g) => (
          <div key={g.key} className={g.dim ? 'sched-dim' : ''}>
            <div className="nav-group" style={{ padding: '10px 14px 4px' }}>
              {g.title}
              {g.note && <span className="sched-note">{g.note}</span>}
            </div>
            {g.rows.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="num sticky-name at-left">日期</th><th className="hide-m">赛事</th><th>轮次</th>
                      <th style={{ textAlign: 'right' }}>主队</th>
                      <th className="center">比分</th>
                      <th>客队</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((row) => {
                      const f = row.fixture
                      const a = row.a ? game.teams[row.a] : undefined
                      const b = row.b ? game.teams[row.b] : undefined
                      const mine = !row.other && (row.a === me || row.b === me)
                      const r = f?.result
                      const aWon = r && r.mapsWonA > r.mapsWonB
                      return (
                        <tr
                          key={row.key}
                          className={`${mine ? 'me' : ''} ${row.other ? 'other' : ''} ${f?.played ? 'clickable' : ''}`}
                          onClick={() => f?.played && openMatch(f)}
                        >
                          <td className="num muted mono sticky-name at-left">{fmtDay(row.day, game.year)}</td>
                          <td className="small hide-m">{row.comp}</td>
                          <td className="small muted">{row.round}</td>
                          <td style={{ textAlign: 'right' }} className={r && aWon ? 'pos' : ''} title={a?.name}>
                            <span className="club" style={{ justifyContent: 'flex-end' }}>
                              <span>{a?.tag ?? (row.pending && !row.a ? '待定' : '')}</span>{row.a && <Crest id={row.a} />}</span>
                          </td>
                          <td className="center mono">
                            {r ? <b>{r.mapsWonA} : {r.mapsWonB}</b> : <span className="muted">{row.bo ? `BO${row.bo}` : 'vs'}</span>}
                          </td>
                          <td className={r && !aWon ? 'pos' : ''} title={b?.name}>
                            {row.pending
                              ? <span className="muted">{row.a ? row.pending : '待定'}</span>
                              : <span className="club">{row.b && <Crest id={row.b} />}<span>{b?.tag}</span></span>}
                          </td>
                          <td className="tiny muted">{f?.played ? '查看 ›' : ''}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </Panel>
    </>
  )
}
