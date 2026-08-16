import { useState } from 'react'
import { useGame } from './ctx'
import { Bar, Condition, money, OvrBadge, Panel, Roles, Potential } from './common'
import { squadOf } from '../engine/world'
import { stageName } from '../engine/season'
import { ATTR_CN, ATTR_KEYS, ROLES } from '../engine/types'
import type { Role } from '../engine/types'
import { activePool } from '../engine/match'
import { logActivity } from '../engine/agenda'
import { useAction } from './useAction'
import {
  approachForCoach, askingSalary, clearedCoaches, employedCoaches, facilityCost,
  offerToStaff, releaseStaff, ROLE_CN, staffMarket, upgradeFacility,
} from '../engine/staff'
import type { Attrs, Player, StaffRole } from '../engine/types'

const OPTIONS: { key: keyof Attrs | 'rest'; label: string }[] = [
  { key: 'rest', label: '休息' },
  ...ATTR_KEYS.map((k) => ({ key: k, label: ATTR_CN[k] })),
]

/** Suggest what this player would gain most from working on. */
function suggest(p: Player): keyof Attrs {
  const head = p.potential - p.overall
  if (head <= 0) return 'teamwork'
  return ATTR_KEYS
    .filter((k) => k !== 'igl' || p.isIgl)
    .reduce((a, b) => (p.attrs[a] < p.attrs[b] ? a : b))
}

export default function Training() {
  const { game, commit, toast, openPlayer } = useGame()
  const act = useAction()
  const [hiring, setHiring] = useState(false)
  const [role, setRole] = useState<StaffRole>('head')
  const [poach, setPoach] = useState(false)
  const [poachFee, setPoachFee] = useState<Record<string, number>>({})
  const [bidOn, setBidOn] = useState<string | null>(null)
  const [bidPay, setBidPay] = useState(0)
  const [bidYears, setBidYears] = useState(2)
  const [duoPick, setDuoPick] = useState<string[]>(
    game.duo ? [game.duo.a, game.duo.b] : [],
  )
  const squad = squadOf(game, game.myTeam)
  const me = game.teams[game.myTeam]

  const setFocus = (id: string, v: keyof Attrs | 'rest') => {
    game.training[id] = v
    commit()
  }

  const restTired = () => {
    let n = 0
    for (const p of squad) {
      if (p.fatigue >= 55) {
        game.training[p.id] = 'rest'
        n++
      }
    }
    commit()
    toast(n ? `已安排 ${n} 名疲劳选手休息。` : '目前没有明显疲劳的选手。')
  }

  const autoFocus = () => {
    for (const p of squad) {
      game.training[p.id] = p.fatigue >= 70 ? 'rest' : suggest(p)
    }
    commit()
    toast('已按短板自动分配训练重点。')
  }

  const drill = game.drill ?? { kind: 'none' as const }
  // the plan is only committed on 确定, so picking is free until then
  const locked = (game.drillLock ?? 0) > game.day

  const setDrill = (d: typeof drill, _label: string) => {
    if (locked) return
    game.drill = d
    commit()
  }
  const setDuo = (pair: string[]) => {
    if (locked) return
    setDuoPick(pair)
    game.duo = pair.length === 2 ? { a: pair[0], b: pair[1] } : undefined
    commit()
  }
  const untilRun = 7 - (game.day % 7)

  const describe = () => {
    const d = game.drill
    const main = !d || d.kind === 'none' ? '不安排团队训练'
      : d.kind === 'map' ? `跑图 ${d.map}`
        : d.kind === 'review' ? '教练复盘'
          : `${game.players[d.playerId]?.ign} 练${d.role}`
    const duo = game.duo
      ? ` ＋ 双排 ${game.players[game.duo.a]?.ign}/${game.players[game.duo.b]?.ign}`
      : ''
    return main + duo
  }

  const confirmPlan = () => {
    game.drillLock = game.day + untilRun
    const focus = squad
      .map((p) => {
        const f = game.training[p.id] ?? 'rest'
        return `${p.ign}:${f === 'rest' ? '休息' : ATTR_CN[f as keyof typeof ATTR_CN]}`
      })
      .join('，')
    logActivity(game, 'training', `确定本周训练：${describe()}｜个人：${focus}`)
    commit()
    toast(`本周训练已确定：${describe()}`)
  }
  const pool = activePool(game.seed + game.year)
  const fit = squad.filter((p) => p.injuredUntil <= game.day)

  return (
    <>
      <Panel
        title={`团队训练 · ${locked ? `本周已确定，${untilRun} 天后可重新安排` : `还有 ${untilRun} 天结算`}`}
        className={locked ? '' : 'own'}
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          下面三项<b>争抢同一段训练时间，只能选一项</b>；<b>双排练</b>是两个人留下来加练，
          不占用其他人，可以和上面任意一项同时进行。团队训练与每位选手的个人专项也同时生效。
        </p>

        <div className={`drill-group${locked ? ' locked' : ''}`}>
        <div className="tiny faint" style={{ marginBottom: 6 }}>主训练 · 三选一</div>
        <div className="grid c3" style={{ gap: 12 }}>
          <div className="drill-card">
            <b>跑图</b>
            <p className="tiny muted">
              指定地图熟练度 <b>+2/周</b>（上限 95），全队协同 <b>+9</b>、意识 <b>+5</b> 经验。
            </p>
            <div className="row wrap" style={{ gap: 5 }}>
              {pool.map((m) => (
                <button key={m}
                  className={`sm${drill.kind === 'map' && drill.map === m ? ' primary' : ''}`}
                  onClick={() => setDrill({ kind: 'map', map: m }, `跑图 ${m}`)}>
                  {m} <span className="tiny faint">{me.mapPrefs[m] ?? 50}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="drill-card">
            <b>教练复盘</b>
            <p className="tiny muted">
              全队意识 <b>+6</b>、沟通 <b>+3</b> 经验，IGL 指挥 <b>+7</b>；
              数值再乘教练战术加成。<b>不掉体能，反而恢复 1~4</b>。
            </p>
            <button
              className={drill.kind === 'review' ? 'primary' : ''}
              onClick={() => setDrill({ kind: 'review' }, '教练复盘')}>
              安排复盘{me.coach ? `（${me.coach.name}）` : ''}
            </button>
          </div>

          <div className="drill-card">
            <b>练新英雄</b>
            <p className="tiny muted">
              位置熟练度约 <b>+3/周</b>（看意识与道具，满 100 约需半个赛季）。
              满了就能<b>兼任该位置</b>，中途每 34% 解锁一个该位置英雄。
            </p>
            <div className="row wrap" style={{ gap: 5 }}>
              {fit.map((p) => (
                <select key={p.id} className="sm" style={{ width: 'auto', padding: '4px 7px', fontSize: 12 }}
                  value={drill.kind === 'agent' && drill.playerId === p.id ? drill.role : ''}
                  onChange={(e) => {
                    const role = e.target.value as Role
                    if (!role) return
                    setDrill({ kind: 'agent', playerId: p.id, role }, `${p.ign} 学习${role}英雄`)
                  }}>
                  <option value="">{p.ign}…</option>
                  {ROLES.filter((r) => r !== '自由人' && !(p.roles ?? [p.role]).includes(r))
                    .map((r) => <option key={r} value={r}>{p.ign} 学 {r}</option>)}
                </select>
              ))}
            </div>
            {drill.kind === 'agent' && (() => {
              const learner = game.players[drill.playerId]
              const pro = learner?.rolePro?.[drill.role] ?? 0
              return (
                <div style={{ marginTop: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="tiny muted">{learner?.ign} 的{drill.role}熟练度</span>
                    <Bar value={pro} color="var(--controller)" />
                    <span className="tiny mono">{Math.round(pro)}%</span>
                  </div>
                  <div className="tiny faint" style={{ marginTop: 4 }}>
                    满 100% 才算真正兼任，中途会陆续解锁该位置的英雄。改练别的位置不会清空已有进度。
                  </div>
                </div>
              )
            })()}
          </div>
        </div>

        <div className="tiny faint" style={{ margin: '14px 0 6px' }}>加练 · 可与上面并行</div>
        <div className="grid" style={{ gap: 12 }}>
          <div className="drill-card">
            <b>双排练</b>
            <p className="tiny muted">
              两人协同 <b>+10</b>、沟通 <b>+8</b>、反应 <b>+5</b> 经验，
              并让这两人的<b>关系 +3~6</b>——修复队内矛盾的主要手段。体能 −5~10。
            </p>
            <div className="row wrap" style={{ gap: 5 }}>
              {fit.map((p) => {
                const on = duoPick.includes(p.id)
                return (
                  <button key={p.id} className={`sm${on ? ' primary' : ''}`}
                    onClick={() => {
                      // hold the half-made choice, so picking the first player sticks
                      const next = on
                        ? duoPick.filter((x) => x !== p.id)
                        : [...duoPick, p.id].slice(-2)
                      setDuo(next)
                    }}>
                    {p.ign}
                  </button>
                )
              })}
              <span className="tiny faint">
                {duoPick.length === 0 ? '选两人' : duoPick.length === 1 ? '再选一人' : '已选定'}
              </span>
              {duoPick.length > 0 && (
                <button className="sm ghost" onClick={() => setDuo([])}>清除</button>
              )}
            </div>
          </div>

        </div>
        </div>

        <div className="row wrap" style={{ gap: 10, marginTop: 14, alignItems: 'center' }}>
          {locked ? (
            <>
              <span className="tag t1">本周已确定</span>
              <span className="small">{describe()}</span>
              <span className="tiny faint">· {untilRun} 天后结算，届时可重新安排</span>
              <button className="sm ghost" onClick={() => {
                if (!window.confirm(
                  '撤销后，本周的团队训练直接作废，不会产生任何效果。\n' +
                  '新计划要等下一个 7 天周期才开始生效。确定吗？',
                )) return
                game.drillLock = undefined
                game.drillVoid = true
                logActivity(game, 'training', '撤销本周训练计划（本周作废）')
                commit()
                toast('本周团队训练已作废，新计划从下个周期开始生效。')
              }}>
                改主意（本周作废）
              </button>
            </>
          ) : (
            <>
              <button className="primary" onClick={confirmPlan}>确定本周训练</button>
              <span className="small muted">{describe()}</span>
              {drill.kind !== 'none' && (
                <button className="sm ghost" onClick={() => setDrill({ kind: 'none' }, '取消团队训练')}>
                  清除主训练
                </button>
              )}
            </>
          )}
        </div>
      </Panel>

      <Panel
        title={`训练计划 · ${stageName(game.stage)}`}
        actions={
          <div className="row" style={{ gap: 8 }}>
            <button className="sm" onClick={restTired}>让疲劳选手休息</button>
            <button className="sm" onClick={autoFocus}>自动分配</button>
          </div>
        }
        flush
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>选手</th><th>位置</th><th className="num">能力</th><th className="num">潜力</th>
                <th style={{ width: 130 }}>成长空间</th>
                <th>体能</th><th className="num">士气</th>
                <th>训练重点</th><th style={{ width: 120 }}>本项进度</th>
              </tr>
            </thead>
            <tbody>
              {squad.map((p) => {
                const focus = game.training[p.id] ?? 'rest'
                const head = p.potential - p.overall
                const xp = focus !== 'rest' ? (p.xp[focus as keyof Attrs] ?? 0) : 0
                return (
                  <tr key={p.id}>
                    <td className="clickable" onClick={() => openPlayer(p.id)}><b>{p.ign}</b></td>
                    <td><Roles p={p} /></td>
                    <td className="num"><OvrBadge value={p.overall} /></td>
                    <td className="num"><Potential p={p} game={game} /></td>
                    <td>
                      <div className="row" style={{ gap: 7 }}>
                        <Bar value={head} max={25} color={head > 8 ? 'var(--win)' : head > 3 ? 'var(--warn)' : 'var(--muted)'} />
                        <span className="tiny mono muted">+{head}</span>
                      </div>
                    </td>
                    <td style={{ width: 110 }}><Condition p={p} day={game.day} /></td>
                    <td className="num mono">{Math.round(p.morale)}</td>
                    <td>
                      <select
                        value={focus}
                        onChange={(e) => setFocus(p.id, e.target.value as keyof Attrs | 'rest')}
                        style={{ padding: '4px 7px', fontSize: 12 }}
                        disabled={p.injuredUntil > game.day}
                      >
                        {OPTIONS.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.label}{o.key !== 'rest' ? ` (${p.attrs[o.key as keyof Attrs]})` : ''}
                            {o.key === suggest(p) ? ' ◄ 建议' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {focus === 'rest'
                        ? <span className="tiny muted">恢复体能</span>
                        : <div className="row" style={{ gap: 7 }}>
                            <Bar value={xp} color="var(--violet)" />
                            <span className="tiny mono muted">{Math.round(xp)}%</span>
                          </div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid c2">
        <Panel title="训练设施">
          <div className="row" style={{ gap: 10, marginBottom: 10 }}>
            <Bar value={me.facilities} />
            <span className="mono">{me.facilities}</span>
          </div>
          <p className="small muted">
            设施等级直接影响训练收益：每一级大约让训练收益 +0.8%。
          </p>
          {me.facilities >= 95 ? (
            <p className="small" style={{ color: 'var(--win)', margin: 0 }}>已是顶级设施。</p>
          ) : (
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <button
                className="primary sm"
                disabled={game.finances.balance < facilityCost(me.facilities)}
                onClick={() => act('facility', () => {
                  toast(upgradeFacility(game))
                  logActivity(game, 'squad', `训练设施升级至 ${game.teams[game.myTeam].facilities}`)
                })}
              >
                升级到 {me.facilities + 1}
              </button>
              <span className="small mono">{money(facilityCost(me.facilities))}</span>
              {game.finances.balance < facilityCost(me.facilities) && (
                <span className="tiny" style={{ color: 'var(--accent)' }}>资金不足</span>
              )}
            </div>
          )}
        </Panel>
        <Panel title="教练组">
          {me.coach ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <b>{me.coach.name}</b>
              </div>
              {([['战术', me.coach.tactics], ['培养', me.coach.development],
                 ['激励', me.coach.motivation]] as const).map(([label, v]) => (
                <div key={label} className="row" style={{ gap: 10, marginBottom: 7 }}>
                  <span className="small muted" style={{ width: 40 }}>{label}</span>
                  <Bar value={v} />
                  <span className="mono small">{v}</span>
                </div>
              ))}
            </>
          ) : (
            <p className="small muted">
              暂无主教练记录。本作只收录真实人物，缺失的教练不会用虚构人名补齐；
              没有教练时按队伍整体水平计算训练与战术加成。
            </p>
          )}
          {(game.staff ?? []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="tiny faint" style={{ marginBottom: 5 }}>教练组其他成员</div>
              {(game.staff ?? []).map((m) => (
                <div key={m.name} className="row" style={{ gap: 8, marginBottom: 5 }}>
                  <span className="small" style={{ flex: 1 }}>
                    <b>{m.name}</b> <span className="tag">{ROLE_CN[m.role]}</span>
                  </span>
                  <span className="tiny faint">战 {m.tactics} / 培 {m.development} / 激 {m.motivation}</span>
                  <span className="tiny mono">{money(m.salary)}</span>
                  <button className="sm ghost" onClick={() => {
                    if (!window.confirm(`确定与 ${m.name} 解约？`)) return
                    toast(releaseStaff(game, m.name)); commit()
                  }}>解约</button>
                </div>
              ))}
            </div>
          )}

          {(game.staffOffers ?? []).filter((o) => !o.answer).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="tiny faint" style={{ marginBottom: 5 }}>等待答复</div>
              {(game.staffOffers ?? []).filter((o) => !o.answer).map((o) => (
                <div key={o.id} className="small" style={{ padding: '3px 0' }}>
                  ⏳ {o.name} · {ROLE_CN[o.role]} · {money(o.salary)}/年 ·
                  <span className="faint"> {Math.max(0, o.replyOn - game.day)} 天内答复</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <button className="sm" onClick={() => setHiring((x) => !x)}>
              {hiring ? '收起' : '聘请教练 / 助教 / 分析师'}
            </button>
          </div>

          {hiring && (
            <div style={{ marginTop: 10 }}>
              <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
                <div className="seg">
                  <button className={!poach ? 'on' : ''} onClick={() => setPoach(false)}>自由教练</button>
                  <button className={poach ? 'on' : ''} onClick={() => setPoach(true)}>挖别队主教练</button>
                </div>
                {!poach && (
                  <div className="seg">
                    {(['head', 'assistant', 'analyst'] as StaffRole[]).map((r) => (
                      <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>
                        {ROLE_CN[r]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="tiny faint" style={{ marginTop: 0 }}>
                都是各队真实的助理教练。发出邀请后对方会在 <b>1~7 天内答复</b>，可能拒绝——
                薪资、俱乐部声望和你的执教履历都会影响他的决定。
                聘请新主教练时，<b>原主教练会转为助理教练</b>而不是凭空消失。
                助教加成「培养」，分析师加成「战术」。
              </p>
              {poach ? (
                <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>主教练</th><th>现俱乐部</th><th className="num">战术</th>
                        <th className="num">培养</th><th className="num">激励</th>
                        <th className="num">参考补偿</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {employedCoaches(game).slice(0, 20).map(({ team, coach, ask }) => {
                        const pending = (game.staffApproaches ?? [])
                          .find((a) => a.teamId === team.id && !a.answer)
                        const granted = (game.staffApproaches ?? [])
                          .find((a) => a.teamId === team.id && a.answer === 'granted')
                        const refused = (game.staffApproaches ?? [])
                          .find((a) => a.teamId === team.id && a.answer === 'refused')
                        const fee = poachFee[team.id] ?? ask
                        return (
                          <tr key={coach.name}>
                            <td><b>{coach.name}</b></td>
                            <td className="small muted">{team.name}</td>
                            <td className="num mono">{coach.tactics}</td>
                            <td className="num mono">{coach.development}</td>
                            <td className="num mono">{coach.motivation}</td>
                            <td className="num mono">{money(ask)}</td>
                            <td>
                              {granted ? (
                                <span className="tag t1">已获准，去下面谈合同</span>
                              ) : pending ? (
                                <span className="tiny faint">等待答复（{Math.max(0, pending.replyOn - game.day)} 天）</span>
                              ) : refused ? (
                                <span className="tiny faint">已拒绝：{refused.reason}</span>
                              ) : (
                                <div className="row" style={{ gap: 5 }}>
                                  <input type="number" className="sm" style={{ width: 96 }} step={10000}
                                    value={fee}
                                    onChange={(e) => setPoachFee((x) => ({ ...x, [team.id]: Number(e.target.value) }))} />
                                  <button className="sm" onClick={() => act('staff', () => {
                                    toast(approachForCoach(game, team.id, fee))
                                    logActivity(game, 'squad', `就 ${coach.name} 联系 ${team.name}`)
                                  })}>接触</button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
              <div className="table-wrap" style={{ maxHeight: 250, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>教练</th><th className="num">战术</th><th className="num">培养</th>
                      <th className="num">激励</th><th className="num">要价</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {[...clearedCoaches(game), ...staffMarket(game)].slice(0, 20).map((c) => {
                      const ask = askingSalary(c, role)
                      const bidding = bidOn === c.name
                      return (
                        <tr key={c.name}>
                          <td><b>{c.name}</b><div className="tiny faint">原 {c.from} 助教</div></td>
                          <td className="num mono">{c.tactics}</td>
                          <td className="num mono">{c.development}</td>
                          <td className="num mono">{c.motivation}</td>
                          <td className="num mono">{money(ask)}</td>
                          <td>
                            {bidding ? (
                              <div className="row" style={{ gap: 5 }}>
                                <input
                                  type="number" className="sm" style={{ width: 92 }}
                                  value={bidPay} step={5000}
                                  onChange={(e) => setBidPay(Number(e.target.value))}
                                />
                                <select className="sm" style={{ width: 62 }} value={bidYears}
                                  onChange={(e) => setBidYears(Number(e.target.value))}>
                                  <option value={1}>1年</option>
                                  <option value={2}>2年</option>
                                  <option value={3}>3年</option>
                                </select>
                                <button className="sm primary" onClick={() => act('staff', () => {
                                  toast(offerToStaff(game, c.name, role, bidPay, bidYears))
                                  logActivity(game, 'squad', `向 ${c.name} 发出${ROLE_CN[role]}邀请`)
                                  setBidOn(null)
                                })}>发出</button>
                              </div>
                            ) : (
                              <button className="sm" onClick={() => { setBidOn(c.name); setBidPay(ask) }}>
                                报价
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              )}
              {poach && (
                <p className="tiny faint" style={{ marginTop: 8, marginBottom: 0 }}>
                  两步走：先给对方俱乐部一笔补偿金请求接触，获准后这名教练会出现在
                  「自由教练」列表里，再和<b>本人</b>谈薪资——他也可能不想来。<br />
                  「参考补偿」只是这名教练的身价，<b>不是付了就一定放人</b>：你的声望越低、
                  对方俱乐部越大牌，就越要溢价。实测新人经理付足额基本不成，
                  <b>1.6 倍约五成、2.2 倍九成</b>；等你有名气了才谈得下来平价。
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>

      <p className="tiny muted">
        训练计划设一次就会一直生效到你改动为止，<b>不需要每天来管</b>；系统每 7 天结算一次收益。
        疲劳超过 70 会大幅拖慢成长，年轻选手（≤20 岁）的成长速度约为 27 岁以上选手的三倍。
        能力值达到潜力上限后，继续训练只能维持状态。
      </p>
    </>
  )
}
