import { useState } from 'react'
import { useGame } from './ctx'
import { Condition, money, OvrBadge, Panel, RoleTag } from './common'
import { squadOf, autoStarters } from '../engine/world'
import { statLine } from '../engine/player'
import { ratingOf } from '../engine/match'
import { releasePlayer } from '../engine/transfer'
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
    if (!window.confirm(`确定与 ${p.ign} 解约？需支付违约金约 ${money(payoff)}。`)) return
    releasePlayer(game, p)
    commit()
    toast(`${p.ign} 已离队。`)
  }

  const roleCount = squad.reduce<Record<string, number>>((acc, p) => {
    acc[p.role] = (acc[p.role] ?? 0) + 1
    return acc
  }, {})

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
            <span key={r} className="tag" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
              缺少 {r}
            </span>
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
                      {p.listed && <span className="tag" style={{ marginLeft: 6, borderColor: 'var(--gold)', color: 'var(--gold)' }}>挂牌</span>}
                    </td>
                    <td><RoleTag role={p.role} /></td>
                    <td className="num"><OvrBadge value={p.overall} /></td>
                    <td className="num muted">{p.potential}</td>
                    <td className="num">{p.age}</td>

                    {view === 'summary' && (
                      <>
                        <td className="num mono">{Math.round(p.form)}</td>
                        <td style={{ width: 110 }}><Condition p={p} day={game.day} /></td>
                        <td className="num mono">{Math.round(p.morale)}</td>
                        <td className="num mono">{money(p.salary)}</td>
                        <td className="num muted">{p.contractYears > 0 ? `${p.contractYears}年` : '到期'}</td>
                        <td>
                          <button className="sm ghost" onClick={() => release(p)}>解约</button>
                        </td>
                      </>
                    )}
                    {view === 'attrs' && ATTR_KEYS.map((k) => (
                      <td key={k} className="num mono" style={{
                        color: p.attrs[k] >= 85 ? 'var(--red)' : p.attrs[k] >= 72 ? 'var(--gold)' : undefined,
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
    </>
  )
}
