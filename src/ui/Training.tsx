import { useState } from 'react'
import { useGame } from './ctx'
import { Bar, Condition, OvrBadge, Panel, Roles } from './common'
import { squadOf } from '../engine/world'
import { stageName } from '../engine/season'
import { ATTR_CN, ATTR_KEYS, ROLES } from '../engine/types'
import type { Role } from '../engine/types'
import { activePool } from '../engine/match'
import { logActivity } from '../engine/agenda'
import type { Attrs, Player } from '../engine/types'

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
  const [duoPick, setDuoPick] = useState<string[]>(
    game.duo ? [game.duo.a, game.duo.b] : [],
  )
  const squad = squadOf(game, game.myTeam)
  const me = game.teams[game.myTeam]

  const setFocus = (id: string, v: keyof Attrs | 'rest') => {
    game.training[id] = v
    logActivity(game, 'training',
      `${game.players[id]?.ign} 的训练重点设为${v === 'rest' ? '休息' : ATTR_CN[v]}`)
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
    logActivity(game, 'training', `确定本周训练：${describe()}`)
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
            <p className="tiny muted">提升指定地图熟练度，同时练全队协同与意识。</p>
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
              全队意识与指挥提升，效果取决于教练战术水平；还能恢复少量体能。
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
              让一名选手学习别的位置的英雄。练成后他就能<b>兼任该位置</b>，阵容更灵活。
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
            <p className="tiny muted">两人配合训练：协同、沟通、反应，收益比单练高但更累。</p>
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
              <button className="sm ghost" onClick={() => { game.drillLock = undefined; commit() }}>
                改主意（撤销确定）
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
                    <td className="num muted">{p.potential}</td>
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
          <p className="small muted" style={{ marginBottom: 0 }}>
            设施等级直接影响训练收益。教练组的“培养”属性同样重要。
          </p>
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
            <p className="small muted" style={{ margin: 0 }}>
              暂无主教练记录。本作只收录真实人物，缺失的教练不会用虚构人名补齐；
              没有教练时按队伍整体水平计算训练与战术加成。
            </p>
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
