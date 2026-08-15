import { useGame } from './ctx'
import { Bar, Condition, OvrBadge, Panel, RoleTag } from './common'
import { squadOf } from '../engine/world'
import { ATTR_CN, ATTR_KEYS } from '../engine/types'
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

  return (
    <>
      <Panel
        title="每周训练安排"
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
                    <td><RoleTag role={p.role} /></td>
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
        训练每 7 天结算一次。疲劳超过 70 会大幅拖慢成长，年轻选手（≤20 岁）的成长速度约为 27 岁以上选手的三倍。
        能力值达到潜力上限后，继续训练只能维持状态。
      </p>
    </>
  )
}
