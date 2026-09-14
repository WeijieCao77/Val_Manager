import { useState } from 'react'
import { ask } from './confirm'
import { useGame } from './ctx'
import { NO_ACTIONS_LEFT, spendAction } from '../engine/actions'
import { logActivity } from '../engine/agenda'
import { Bar, Condition, Face, money, OvrBadge, Panel, Roles, Traits, Potential } from './common'
import { appointIgl, autoStarters } from '../engine/world'
import { callerOf, squadOf } from '../engine/roster'
import { statLine } from '../engine/player'
import { ratingOf, selectLineup } from '../engine/match'
import { releasePlayer, squadFloorBlock } from '../engine/transfer'
import { bondBetween, notableBonds, squadHarmony } from '../engine/bonds'
import { departureImpact, trustLabel, trustOf, trustOnBench } from '../engine/trust'
import { ATTR_CN, ATTR_KEYS } from '../engine/types'
import type { Player } from '../engine/types'
import { useAction } from './useAction'
import { fmtDay } from './common'
import { careerDayOf, fromCareerDay, isCoolingOff } from '../engine/clock'
import {
  DISPUTE, DISPUTE_CHOICE_CN, benchBlock, costsAction, disputeBlock, endCoolOff, handleDispute,
} from '../engine/disputes'
import type { Dispute, DisputeChoice } from '../engine/disputes'

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
    if (isCoolingOff(game, p)) { toast(`${p.ign} 在冷静期，先在更衣室恢复他。`); return }
    const idx = me.starters.indexOf(p.id)
    if (idx >= 0) {
      // benching someone who is playing well reads as arbitrary, and costs trust
      trustOnBench(p)
      me.starters = me.starters.filter((id) => id !== p.id)
    } else {
      if (me.starters.length >= 5) {
        toast('首发已满 5 人，先移除一位。')
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
  // his flag comes with him); the club's named main caller is the one
  // actually calling, the rest are deputies
  const iglsInSquad = squad.filter((p) => p.isIgl)
  const caller = callerOf(game, game.myTeam)
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
              onClick={() => { me.starters = autoStarters(game, game.myTeam); commit(); toast('已排出最佳首发。') }}
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
              没有指挥：攻防各扣 4 分，中局决策再扣 3 分。
              {benchedIgl && `把 ${benchedIgl.ign} 放进首发，或让首发里的人指挥：`}
              {hurtIgl && `${hurtIgl.ign} 伤停中，先让别人指挥，伤愈后可以再任命回来：`}
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
                      <Face id={p.id} /><b>{p.ign}</b>
                      {/* The tags beside a name sit on a second line on a phone,
                          so the pinned name column is only as wide as the
                          longest name — beside it, 「推定 IGL」 alone cost the
                          scrolling columns sixty pixels. */}
                      <span className="name-tags">
                      {p.isIgl && (
                        <span className="tag" style={{ opacity: iglsInSquad.length > 1 && p.id !== caller?.id ? 0.55 : 1 }}
                          title={iglsInSquad.length > 1
                            ? (p.id === caller?.id
                              ? `主指挥（指挥 ${p.attrs.igl}），队里有 ${iglsInSquad.length} 名指挥出身的选手`
                              : `副指挥：${caller?.ign} 不在场时由他喊话，点开可任命为主指挥`)
                            : '队内指挥'}>
                          {iglsInSquad.length > 1 ? (p.id === caller?.id ? '主指挥' : '副指挥')
                            : p.iglSource === 'inferred' ? '推定 IGL' : 'IGL'}
                        </span>
                      )}
                      {p.listed && <span className="tag warn">挂牌</span>}
                      {isCoolingOff(game, p) && (
                        <span className="tag warn" title={`暂时替补冷静，到 ${fmtDay(fromCareerDay(p.coolOffUntil!).day, fromCareerDay(p.coolOffUntil!).year)}；更衣室里可以提前恢复`}>
                          冷静中
                        </span>
                      )}
                      {p.retiring && <span className="tag warn" title="已宣布本赛季结束后退役">退役</span>}
                      {(p.grievance ?? 0) > 45 && !p.listed && (
                        <span className="tag warn"
                          title={`不满 ${Math.round(p.grievance ?? 0)}/100，出场承诺、薪资、被拒的转会都会积累；不满高的更容易接受别队报价。`}>
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
          每两名选手之间有独立的关系值。一起打得越久、同国籍、位置上要配合、年纪相仿，关系越高。
          赢球拉近所有人；输球时打得差的一方会被记账，矛盾会滚雪球。<b>双排练</b>是最直接的修复手段。
        </p>
        <Disputes />
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
                  <th style={{ textAlign: 'left', whiteSpace: 'nowrap' }}><Face id={row.id} size={18} />{row.ign}</th>
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
              ⚠ {worst.a.ign} 和 {worst.b.ign} 关系很僵，拖累全队配合。
            </span>
          )}
        </div>
      </Panel>
    </>
  )
}


/**
 * The room's arguments, as things to do.
 *
 * Each open record names the match it came out of and the two men, and
 * offers the five answers with their price on the button. A talk or a
 * mediation costs an action point and is only charged when the engine says
 * it will be honoured; the free ones are free. What happened stays on the
 * card, and the cooling-off bench has its own recovery button here.
 */
function Disputes() {
  const { game, commit, toast, openPlayer } = useGame()
  const act = useAction()
  const [target, setTarget] = useState<Record<string, string>>({})
  const list = (game.disputes ?? []).slice().reverse()
  const open = list.filter((d) => d.status === 'open')
  const done = list.filter((d) => d.status !== 'open').slice(0, 4)
  const cooling = squadOf(game, game.myTeam).filter((p) => isCoolingOff(game, p))
  if (!open.length && !done.length && !cooling.length) return null

  const run = (d: Dispute, choice: DisputeChoice) => {
    const who = target[d.id]
    const why = disputeBlock(game, d.id, choice, who)
    if (why) { toast(why); return }
    const go = () => {
      const r = handleDispute(game, d.id, choice, who)
      toast(r.text)
      logActivity(game, 'locker', `${DISPUTE_CHOICE_CN[choice]}：${game.players[d.a]?.ign} 和 ${game.players[d.b]?.ign}`)
    }
    if (costsAction(choice)) act(choice as 'talk' | 'mediate', go)
    else { go(); commit() }
  }
  const name = (id: string) => game.players[id]?.ign ?? id
  const when = (d: Dispute) => fmtDay(d.day, d.year)
  const STATUS_CN: Record<Dispute['status'], string> = { open: '待处理', handled: '已处理', ignored: '未介入', expired: '过期', closed: '已失效' }

  return (
    <div style={{ padding: '10px 14px 0' }}>
      {cooling.length > 0 && (
        <div className="row wrap small" style={{ gap: 8, marginBottom: 8 }}>
          {cooling.map((p) => {
            const at = fromCareerDay(p.coolOffUntil!)
            return (
              <span key={p.id} className="row" style={{ gap: 6 }}>
                <span className="tag warn">{p.ign} 冷静中 · 到 {fmtDay(at.day, at.year)}（还 {p.coolOffUntil! - careerDayOf(game)} 天）</span>
                <button className="sm ghost" onClick={() => { toast(endCoolOff(game, p.id)); commit() }}>提前恢复</button>
              </span>
            )
          })}
        </div>
      )}
      {open.map((d) => {
        const a = game.players[d.a]
        const b = game.players[d.b]
        if (!a || !b) return null
        const who = target[d.id]
        const paid = d.attempts.filter((x) => costsAction(x.choice)).length
        const sev = ['', '小摩擦', '正面冲突', '更衣室站队'][d.severity]
        return (
          <div key={d.id} className="panel alert" style={{ marginBottom: 8 }}>
            <div className="panel-body">
              <div className="row wrap" style={{ gap: 8, alignItems: 'baseline' }}>
                <b>💢 {a.ign} 和 {b.ign} 赛后争执</b>
                <span className="tag warn">{sev}</span>
                {d.flareUps > 0 && <span className="tag warn">又吵了 {d.flareUps} 次</span>}
                <span className="tiny faint">{when(d)}{d.opponent ? ` · 对 ${d.opponent} ${d.score ?? ''}` : ''} · {a.ign} 评分 {d.ratings.a.toFixed(2)}，{b.ign} {d.ratings.b.toFixed(2)} · 现在关系 {bondBetween(game, a.id, b.id).toFixed(0)}</span>
              </div>
              <p className="tiny muted" style={{ margin: '4px 0 6px' }}>
                这是本存档里模拟出来的一场争执，谁对谁错由你判断。谈话和暂时替补要先选人；谈话、调解各花 1 行动力，只在能生效时扣。
                {paid > 0 && ` 已谈 ${paid}/${DISPUTE.MAX_PAID} 次。`}
              </p>
              <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
                <span className="tiny faint">针对：</span>
                {[a, b].map((p) => (
                  <button key={p.id} className={`sm${who === p.id ? ' primary' : ''}`} onClick={() => setTarget({ ...target, [d.id]: p.id })}>
                    {p.ign}
                  </button>
                ))}
                <button className="sm ghost" onClick={() => openPlayer(a.id)}>看 {a.ign}</button>
                <button className="sm ghost" onClick={() => openPlayer(b.id)}>看 {b.ign}</button>
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {(['talk', 'mediate', 'duo', 'bench', 'ignore'] as DisputeChoice[]).map((c) => {
                  const why = disputeBlock(game, d.id, c, who)
                  const hint = c === 'talk' ? '1 行动力 · 和选中的人单独谈，成了关系回暖、他更信任你；崩了他信任掉一点'
                    : c === 'mediate' ? '1 行动力 · 两人一起谈，成了关系大幅回暖、双方都松口；崩了更僵'
                    : c === 'duo' ? '免费 · 这周的双排练定为他们两个，随团队训练结算'
                    : c === 'bench' ? `免费 · 选中的人 ${DISPUTE.BENCH_DAYS} 天不上首发，他会不满，但两人有了距离；要有替补`
                    : '免费 · 不管，两周后更衣室自己下结论'
                  return (
                    <button key={c} className="sm" disabled={!!why && !(c === 'talk' || c === 'bench') && why !== '先选一个人。'} title={why ?? hint} onClick={() => run(d, c)}>
                      {DISPUTE_CHOICE_CN[c]}{costsAction(c) ? ' ⚡' : ''}
                    </button>
                  )
                })}
              </div>
              {d.attempts.length > 0 && (
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  {d.attempts.map((x, i) => <div key={i}>{x.ok ? '✓' : '✗'} {DISPUTE_CHOICE_CN[x.choice]}{x.target ? `（${name(x.target)}）` : ''}：{x.text}</div>)}
                </div>
              )}
              {who && benchBlock(game, who) && <div className="tiny neg" style={{ marginTop: 4 }}>{benchBlock(game, who)}</div>}
            </div>
          </div>
        )
      })}
      {done.length > 0 && (
        <details className="small" style={{ marginBottom: 6 }}>
          <summary className="muted">最近处理过的争执（{done.length}）</summary>
          {done.map((d) => (
            <div key={d.id} className="tiny muted" style={{ padding: '3px 0' }}>
              {when(d)} · {name(d.a)} 和 {name(d.b)} · {STATUS_CN[d.status]}
              {d.attempts.length > 0 && `：${d.attempts.map((x) => `${x.ok ? '✓' : '✗'}${DISPUTE_CHOICE_CN[x.choice]}`).join('、')}`}
            </div>
          ))}
        </details>
      )}
    </div>
  )
}
