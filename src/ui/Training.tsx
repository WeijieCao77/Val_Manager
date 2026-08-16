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
  const setDrill = (d: typeof drill, label: string) => {
    game.drill = d
    logActivity(game, 'training', `本周团队训练：${label}`)
    commit()
    toast(`本周团队训练：${label}`)
  }
  const pool = activePool(game.seed + game.year)
  const fit = squad.filter((p) => p.injuredUntil <= game.day)

  return (
    <>
      <Panel title="团队训练 · 每周一项">
        <p className="small muted" style={{ marginTop: 0 }}>
          团队训练与每位选手的个人专项**同时生效**，而且一次影响多个方面。
        </p>
        <div className="grid c2" style={{ gap: 12 }}>
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
            <b>双排练</b>
            <p className="tiny muted">两人配合训练：协同、沟通、反应，收益比单练高但更累。</p>
            <div className="row wrap" style={{ gap: 5 }}>
              {fit.map((p) => {
                const on = drill.kind === 'duo' && (drill.a === p.id || drill.b === p.id)
                return (
                  <button key={p.id} className={`sm${on ? ' primary' : ''}`}
                    onClick={() => {
                      const cur = drill.kind === 'duo' ? [drill.a, drill.b] : []
                      const next = cur.includes(p.id)
                        ? cur.filter((x) => x !== p.id) : [...cur, p.id].slice(-2)
                      if (next.length === 2) {
                        setDrill({ kind: 'duo', a: next[0], b: next[1] },
                          `双排练 ${game.players[next[0]]?.ign} + ${game.players[next[1]]?.ign}`)
                      }
                    }}>
                    {p.ign}
                  </button>
                )
              })}
              <span className="tiny faint">选两人</span>
            </div>
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
                    setDrill({ kind: 'agent', playerId: p.id, role, progress: 0 },
                      `${p.ign} 学习${role}英雄`)
                  }}>
                  <option value="">{p.ign}…</option>
                  {ROLES.filter((r) => r !== '自由人' && !(p.roles ?? [p.role]).includes(r))
                    .map((r) => <option key={r} value={r}>{p.ign} 学 {r}</option>)}
                </select>
              ))}
            </div>
            {drill.kind === 'agent' && (
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <span className="tiny muted">
                  {game.players[drill.playerId]?.ign} 学习{drill.role}中
                </span>
                <Bar value={drill.progress} color="var(--violet)" />
                <span className="tiny mono">{Math.round(drill.progress)}%</span>
              </div>
            )}
          </div>
        </div>
        {drill.kind !== 'none' && (
          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button className="sm ghost" onClick={() => setDrill({ kind: 'none' }, '取消团队训练')}>
              取消团队训练
            </button>
          </div>
        )}
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
                        <Bar value={head} max={25} color={head > 8 ? 'var(--teal)' : head > 3 ? 'var(--gold)' : 'var(--muted)'} />
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
