import { useState } from 'react'
import { useGame } from './ctx'
import { NO_ACTIONS_LEFT, spendAction } from '../engine/actions'
import { logActivity } from '../engine/agenda'
import { Bar, Condition, money, OvrBadge, Panel, Roles, Traits, Potential } from './common'
import { squadOf, autoStarters } from '../engine/world'
import { statLine } from '../engine/player'
import { ratingOf } from '../engine/match'
import { releasePlayer } from '../engine/transfer'
import { bondBetween, notableBonds, squadHarmony } from '../engine/bonds'
import { departureImpact, trustLabel, trustOf, trustOnBench } from '../engine/trust'
import { ATTR_CN, ATTR_KEYS } from '../engine/types'
import type { Player } from '../engine/types'

type SortKey = 'overall' | 'age' | 'form' | 'salary' | 'rating' | 'role'

export default function Squad() {
  const { game, commit, toast, openPlayer } = useGame()
  const [sort, setSort] = useState<SortKey>('overall')
  const [view, setView] = useState<'summary' | 'attrs' | 'stats'>('summary')
  const me = game.teams[game.myTeam]
  const squad = squadOf(game, game.myTeam)

  const sorted = squad.slice().sort((a, b) => {
    switch (sort) {
      case 'age': return a.age - b.age
      case 'form': return b.form - a.form
      case 'salary': return b.salary - a.salary
      case 'rating': return ratingOf(b.season) - ratingOf(a.season)
      case 'role': return a.role.localeCompare(b.role)
      default: return b.overall - a.overall
    }
  })

  const toggleStarter = (p: Player) => {
    const idx = me.starters.indexOf(p.id)
    if (idx >= 0) {
      // benching someone who is playing well reads as arbitrary, and costs trust
      trustOnBench(p)
      me.starters = me.starters.filter((id) => id !== p.id)
    } else {
      if (me.starters.length >= 5) {
        toast('首发已满 5 人，请先移除一位。')
        return
      }
      me.starters = [...me.starters, p.id]
    }
    commit()
  }

  const release = (p: Player) => {
    const payoff = Math.round(p.salary * Math.max(0, p.contractYears) * 0.4)
    const hurt = departureImpact(game, p)
    const warn = hurt.length
      ? `\n\n更衣室反应：${hurt.map((h) => `${h.p.ign} 信任 −${h.hit.toFixed(0)}`).join('，')}`
      : ''
    if (!window.confirm(`确定与 ${p.ign} 解约？需支付违约金约 ${money(payoff)}。${warn}`)) return
    if (!spendAction(game, 'release')) { toast(NO_ACTIONS_LEFT); return }
    releasePlayer(game, p)
    commit()
    logActivity(game, 'squad', `与 ${p.ign} 解约`)
    toast(`${p.ign} 已离队。`)
  }

  // count every role a player covers, so a flexed second role closes the gap
  const roleCount = squad.reduce<Record<string, number>>((acc, p) => {
    for (const r of p.roles?.length ? p.roles : [p.role]) acc[r] = (acc[r] ?? 0) + 1
    return acc
  }, {})

  const harmony = squadHarmony(game, game.myTeam)
  const bonds = notableBonds(game, game.myTeam)
  const worst = bonds[0]
  // one continuous scale, so a glance reads the room rather than a lookup table
  const bondBg = (v: number) => {
    const t = Math.min(1, Math.abs(v) / 70)
    return v < 0
      ? `rgba(255, 70, 85, ${0.08 + t * 0.42})`
      : `rgba(61, 214, 140, ${0.06 + t * 0.34})`
  }
  const bondFg = (v: number) =>
    Math.abs(v) < 18 ? 'var(--muted)' : v < 0 ? '#ffb3ba' : '#a9f0cc'

  return (
    <>
      <Panel
        title={`阵容 · ${squad.length} 人（首发 ${me.starters.length}/5）`}
        actions={
          <div className="row" style={{ gap: 8 }}>
            <div className="seg">
              <button className={view === 'summary' ? 'on' : ''} onClick={() => setView('summary')}>概览</button>
              <button className={view === 'attrs' ? 'on' : ''} onClick={() => setView('attrs')}>能力</button>
              <button className={view === 'stats' ? 'on' : ''} onClick={() => setView('stats')}>数据</button>
            </div>
            <button
              className="sm"
              onClick={() => { me.starters = autoStarters(game, game.myTeam); commit(); toast('已自动排出最佳首发。') }}
            >
              自动首发
            </button>
          </div>
        }
        flush
      >
        <div className="row wrap small muted" style={{ gap: 8, padding: '10px 14px' }}>
          {Object.entries(roleCount).map(([r, n]) => (
            <span key={r} className="tag">{r} × {n}</span>
          ))}
          {['决斗者', '先锋', '控场', '哨卫'].filter((r) => !roleCount[r]).map((r) => (
            <span key={r} className="tag warn">缺少 {r}</span>
          ))}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 44 }}>首发</th>
                <th className="clickable" onClick={() => setSort('overall')}>选手</th>
                <th className="clickable" onClick={() => setSort('role')}>位置</th>
                <th className="num clickable" onClick={() => setSort('overall')}>能力</th>
                <th className="num">潜力</th>
                <th className="num clickable" onClick={() => setSort('age')}>年龄</th>
                {view === 'summary' && (
                  <>
                    <th className="num clickable" onClick={() => setSort('form')}>状态</th>
                    <th>体能</th>
                    <th className="num">士气</th>
                    <th>信任</th>
                    <th className="num clickable" onClick={() => setSort('salary')}>年薪</th>
                    <th className="num">合同</th>
                    <th />
                  </>
                )}
                {view === 'attrs' && ATTR_KEYS.map((k) => <th key={k} className="num">{ATTR_CN[k]}</th>)}
                {view === 'stats' && (
                  <>
                    <th className="num clickable" onClick={() => setSort('rating')}>评分</th>
                    <th className="num">ACS</th><th className="num">K/D</th>
                    <th className="num">ADR</th><th className="num">首杀差</th><th className="num">场次</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const starter = me.starters.includes(p.id)
                const s = statLine(p.season)
                return (
                  <tr key={p.id} className={starter ? 'me' : ''}>
                    <td>
                      <input
                        type="checkbox" checked={starter} style={{ width: 15, cursor: 'pointer' }}
                        onChange={() => toggleStarter(p)}
                      />
                    </td>
                    <td className="clickable" onClick={() => openPlayer(p.id)}>
                      <b>{p.ign}</b>
                      {p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>IGL</span>}
                      {p.listed && <span className="tag warn" style={{ marginLeft: 6 }}>挂牌</span>}
                      {p.traits?.length ? (
                        <div style={{ marginTop: 3 }}><Traits traits={p.traits} max={3} /></div>
                      ) : null}
                    </td>
                    <td><Roles p={p} /></td>
                    <td className="num"><OvrBadge value={p.overall} /></td>
                    <td className="num"><Potential p={p} game={game} /></td>
                    <td className="num">{p.age}</td>

                    {view === 'summary' && (
                      <>
                        <td className="num mono">{Math.round(p.form)}</td>
                        <td style={{ width: 110 }}><Condition p={p} day={game.day} /></td>
                        <td className="num mono">{Math.round(p.morale)}</td>
                        <td>
                          {(() => {
                            const t = trustOf(p)
                            const c = t >= 66 ? 'var(--win)' : t >= 48 ? 'var(--muted)'
                              : t >= 30 ? 'var(--warn)' : 'var(--accent)'
                            return (
                              <span className="row" style={{ gap: 6 }}>
                                <Bar value={t} color={c} />
                                <span className="tiny" style={{ color: c, whiteSpace: 'nowrap' }}>
                                  {trustLabel(t)}
                                </span>
                              </span>
                            )
                          })()}
                        </td>
                        <td className="num mono">{money(p.salary)}</td>
                        <td className="num muted">{p.contractYears > 0 ? `${p.contractYears}年` : '到期'}</td>
                        <td>
                          <button className="sm ghost" onClick={() => release(p)}>解约</button>
                        </td>
                      </>
                    )}
                    {view === 'attrs' && ATTR_KEYS.map((k) => (
                      <td key={k} className="num mono" style={{
                        color: p.attrs[k] >= 85 ? 'var(--accent)' : p.attrs[k] >= 72 ? 'var(--warn)' : undefined,
                      }}>
                        {p.attrs[k]}
                      </td>
                    ))}
                    {view === 'stats' && (
                      p.season.maps ? (
                        <>
                          <td className="num"><b>{ratingOf(p.season).toFixed(2)}</b></td>
                          <td className="num mono">{s.acs.toFixed(0)}</td>
                          <td className="num mono">{s.kd.toFixed(2)}</td>
                          <td className="num mono">{s.adr.toFixed(0)}</td>
                          <td className={`num mono ${s.fkDiff >= 0 ? 'pos' : 'neg'}`}>
                            {s.fkDiff > 0 ? '+' : ''}{s.fkDiff}
                          </td>
                          <td className="num muted">{p.season.maps}</td>
                        </>
                      ) : (
                        <td className="muted small" colSpan={6}>本赛季暂无出场</td>
                      )
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title={`更衣室 · 全队默契 ${harmony >= 0 ? '+' : ''}${harmony.toFixed(0)}`} flush>
        <p className="small muted" style={{ padding: '10px 14px 0', margin: 0 }}>
          每两名选手之间有独立的关系值。他们首先是<b>每天一起训练的队友</b>，所以开局都在
          40~70 这一档——<b>差距有，但不会有人一上来就跟队友结怨</b>。拉开差距的因素依次是：
          <b>一起打了多久</b>（取自 Liquipedia 的真实转会履历，四年约 +10）、同国籍、
          位置上要天天配合（决斗↔先锋、控场↔哨卫）、年纪相仿、本身协同沟通就好。
          多年老班底通常比刚拼起来的阵容高十几分。之后：<b>赢球让所有人更亲近</b>；输球时，如果一个人打得
          明显好而另一个明显差，差的一方会被记账，而且<b>矛盾会滚雪球</b>。关系会缓慢回落到
          两人各自的基准线，而不是回到某个统一值。<b>双排练</b>是最直接的修复手段。
        </p>
        <div className="table-wrap">
          <table className="bond-grid">
            <thead>
              <tr>
                <th />
                {squad.map((p) => <th key={p.id} className="num">{p.ign}</th>)}
              </tr>
            </thead>
            <tbody>
              {squad.map((row, ri) => (
                <tr key={row.id}>
                  <th style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{row.ign}</th>
                  {squad.map((col, ci) => {
                    if (row.id === col.id) {
                      return <td key={col.id} className="bond-self" title="同一名选手">—</td>
                    }
                    // the matrix is symmetric, so only the upper half carries
                    // information; the mirror below it is noise
                    if (ci < ri) return <td key={col.id} className="bond-mirror" />
                    const v = bondBetween(game, row.id, col.id)
                    return (
                      <td
                        key={col.id}
                        className="num mono"
                        title={`${row.ign} 与 ${col.ign}：${v.toFixed(0)}`}
                        style={{ background: bondBg(v), color: bondFg(v), fontWeight: 600 }}
                      >
                        {v >= 0 ? '+' : ''}{v.toFixed(0)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row wrap tiny faint" style={{ gap: 12, padding: '10px 14px' }}>
          <span>−100 结怨</span>
          <span className="bond-key" style={{ background: bondBg(-60) }} />
          <span className="bond-key" style={{ background: bondBg(-25) }} />
          <span className="bond-key" style={{ background: bondBg(10) }} />
          <span className="bond-key" style={{ background: bondBg(50) }} />
          <span className="bond-key" style={{ background: bondBg(90) }} />
          <span>+100 生死之交</span>
          {worst && worst.value <= -25 && (
            <span style={{ color: 'var(--accent)' }}>
              ⚠ {worst.a.ign} 和 {worst.b.ign} 关系已经很僵，会拖累全队配合。
            </span>
          )}
        </div>
      </Panel>
    </>
  )
}
