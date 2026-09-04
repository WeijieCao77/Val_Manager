import { useState } from 'react'
import { ask } from './confirm'
import { useGame } from './ctx'
import { NO_ACTIONS_LEFT, spendAction } from '../engine/actions'
import { logActivity } from '../engine/agenda'
import { Bar, Condition, money, OvrBadge, Panel, Roles, Traits, Potential } from './common'
import { appointIgl, autoStarters } from '../engine/world'
import { squadOf } from '../engine/roster'
import { statLine } from '../engine/player'
import { ratingOf, selectLineup } from '../engine/match'
import { releasePlayer, squadFloorBlock } from '../engine/transfer'
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

  const release = async (p: Player) => {
    // say no before charging an action point for it, and before asking a
    // question whose answer cannot be honoured
    const blocked = squadFloorBlock(game, game.myTeam)
    if (blocked) { toast(blocked); return }
    const payoff = Math.round(p.salary * Math.max(0, p.contractYears) * 0.4)
    const hurt = departureImpact(game, p)
    const warn = hurt.length
      ? `\n\n更衣室反应：${hurt.map((h) => `${h.p.ign} 信任 −${h.hit.toFixed(0)}`).join('，')}`
      : ''
    if (!(await ask(`确定与 ${p.ign} 解约？需支付违约金约 ${money(payoff)}。${warn}`, '解约'))) return
    if (!spendAction(game, 'release')) { toast(NO_ACTIONS_LEFT); return }
    toast(releasePlayer(game, p))
    commit()
    logActivity(game, 'squad', `与 ${p.ign} 解约`)
  }

  // What plays is what is scored: the five, not the roster. Counting the whole
  // squad meant a bench sentinel closed a gap the starting five actually had.
  // A flexed second role does close it — covering two is an option, not a cost.
  const fielded = me.starters.length ? me.starters.map((id) => game.players[id]).filter(Boolean) : squad
  const roleCount = fielded.reduce<Record<string, number>>((acc, p) => {
    for (const r of p.roles?.length ? p.roles : [p.role]) acc[r] = (acc[r] ?? 0) + 1
    return acc
  }, {})

  // Going out without a caller costs more than any single role gap (-4 to both
  // sides, -3 mid-round) and was the one composition problem the screen never
  // mentioned — several clubs start the game that way, because the five picks
  // itself on rating and the IGL is often the worst fragger on the roster.
  // "no caller" means nobody who will actually walk out and call: an IGL who
  // is named in the five but injured is filtered out on match day, and the
  // game was played without one while this screen showed no warning at all
  // The `>= 5` guard used to hide this warning exactly when it mattered most:
  // selling the caller drops the five to four AND removes the only man who
  // calls, so the one screen that would have said "nobody is calling" went
  // quiet on the same transaction. Judge the men who will actually walk out.
  const willPlay = me.starters.length >= 5
    ? me.starters
    : selectLineup(game, game.myTeam).map((p) => p.id)
  const noIgl = willPlay.length > 0
    && !willPlay.some((id) => {
      const x = game.players[id]
      return x?.isIgl && x.injuredUntil <= game.day
    })
  const benchedIgl = squad.find((p) => p.isIgl && !me.starters.includes(p.id))
  // several IGLs by trade can share a squad (buy another club's caller and
  // his flag comes with him); the best of them is the one actually calling
  const iglsInSquad = squad.filter((p) => p.isIgl)
  const caller = iglsInSquad.slice().sort((a, b) => b.attrs.igl - a.attrs.igl)[0]
  const hurtIgl = squad.find((p) => p.isIgl
    && me.starters.includes(p.id) && p.injuredUntil > game.day)

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
    Math.abs(v) < 18 ? 'var(--muted)' : v < 0 ? 'var(--neg-ink)' : 'var(--pos-ink)'

  return (
    <>
      <Panel
        tut="squad-table"
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
          {noIgl && (
            <span className="tag warn">
              首发无指挥{benchedIgl ? ` · ${benchedIgl.ign} 在替补席`
                : hurtIgl ? ` · 指挥 ${hurtIgl.ign} 伤停中（还需 ${hurtIgl.injuredUntil - game.day} 天）` : ''}
            </span>
          )}
        </div>
        {noIgl && (
          <div className="tiny" style={{ padding: '0 14px 10px', color: 'var(--warn)' }}>
            <div style={{ marginBottom: 6 }}>
              没有指挥的五人组在攻防两端各扣 4 分、中局决策再扣 3 分——比缺任何一个位置都贵。
              {benchedIgl && `把 ${benchedIgl.ign} 放进首发，或让首发里的人接过指挥：`}
              {hurtIgl && `${hurtIgl.ign} 伤停期间上不了场，先让别人接过指挥（伤愈后可以再任命回来）：`}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {me.starters
                .map((id) => game.players[id])
                .filter((x): x is Player => !!x && !x.isIgl)
                .sort((a, b) => b.attrs.igl - a.attrs.igl)
                .slice(0, 3)
                .map((x) => (
                  <button key={x.id} className="sm" onClick={() => {
                    const msg = appointIgl(game, x.id)
                    commit()
                    logActivity(game, 'squad', `任命 ${x.ign} 为队内指挥`)
                    toast(msg)
                  }}>
                    让 {x.ign} 指挥（指挥 {x.attrs.igl}）
                  </button>
                ))}
            </div>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="sticky-pick">首发</th>
                <th className="clickable sticky-name" onClick={() => setSort('overall')}>选手</th>
                <th className="clickable" onClick={() => setSort('role')}>位置</th>
                <th className="num clickable" onClick={() => setSort('overall')}>能力</th>
                <th className="num hide-m">潜力</th>
                <th className="num clickable hide-m" onClick={() => setSort('age')}>年龄</th>
                {view === 'summary' && (
                  <>
                    <th className="num clickable hide-m" onClick={() => setSort('form')}>状态</th>
                    <th className="hide-m">体能</th>
                    <th className="num hide-m">士气</th>
                    <th className="hide-m">信任</th>
                    <th className="num clickable hide-m" onClick={() => setSort('salary')}>年薪</th>
                    <th className="num">合同</th>
                    <th className="sticky-act" />
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
                    <td className="sticky-pick">
                      <input
                        type="checkbox" checked={starter} style={{ width: 15, cursor: 'pointer' }}
                        onChange={() => toggleStarter(p)}
                      />
                    </td>
                    <td className="clickable sticky-name" onClick={() => openPlayer(p.id)}>
                      <b>{p.ign}</b>
                      {/* The tags beside a name sit on a second line on a phone,
                          so the pinned name column is only as wide as the
                          longest name — beside it, 「推定 IGL」 alone cost the
                          scrolling columns sixty pixels. */}
                      <span className="name-tags">
                      {p.isIgl && (
                        <span className="tag" style={{ opacity: iglsInSquad.length > 1 && p.id !== caller?.id ? 0.55 : 1 }}
                          title={iglsInSquad.length > 1
                            ? (p.id === caller?.id
                              ? `队里有 ${iglsInSquad.length} 名指挥出身的选手，由指挥属性最高的他实际喊话（${p.attrs.igl}）`
                              : `指挥出身，但队里由指挥属性更高的 ${caller?.ign} 实际喊话——多名指挥不冲突也不叠加`)
                            : '队内指挥'}>
                          {p.iglSource === 'inferred' ? '推定 IGL' : 'IGL'}
                        </span>
                      )}
                      {p.listed && <span className="tag warn">挂牌</span>}
                      {p.retiring && <span className="tag warn" title="已宣布本赛季结束后退役">退役</span>}
                      {(p.grievance ?? 0) > 45 && !p.listed && (
                        <span className="tag warn"
                          title={`不满 ${Math.round(p.grievance ?? 0)}/100——出场承诺、薪资、被拒的转会都会积累。高不满的选手更容易接受别队报价。`}>
                          想走
                        </span>
                      )}
                      </span>
                      {p.traits?.length ? (
                        <div className="hide-m" style={{ marginTop: 3 }}>
                          <Traits traits={p.traits} max={3} />
                        </div>
                      ) : null}
                    </td>
                    <td><Roles p={p} /></td>
                    <td className="num"><OvrBadge value={p.overall} /></td>
                    <td className="num hide-m"><Potential p={p} game={game} /></td>
                    <td className="num hide-m">{p.age}</td>

                    {view === 'summary' && (
                      <>
                        <td className="num mono hide-m">{Math.round(p.form)}</td>
                        <td className="hide-m" style={{ width: 110 }}><Condition p={p} day={game.day} /></td>
                        <td className="num mono hide-m">{Math.round(p.morale)}</td>
                        <td className="hide-m">
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
                        <td className="num mono hide-m">{money(p.salary)}</td>
                        <td className={p.contractYears > 0 ? 'num muted' : 'num'}
                          style={p.contractYears > 0 ? undefined : { color: 'var(--warn)' }}>
                          {p.contractYears > 0 ? `${p.contractYears}年` : '到期'}
                        </td>
                        <td className="sticky-act">
                          {/* An expiring deal needs the renewal in reach. This
                              column used to offer only 解约, so the visible
                              answer to "他合同到期了" was to let him go. */}
                          <div className="row" style={{ gap: 6 }}>
                            <button
                              className={p.contractYears <= 1 ? 'primary sm' : 'sm'}
                              onClick={() => openPlayer(p.id, true)}
                            >
                              续约
                            </button>
                            <button className="sm ghost" onClick={() => release(p)}>解约</button>
                          </div>
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
