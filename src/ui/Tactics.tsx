import { useGame } from './ctx'
import { Bar, Panel, RoleTag } from './common'
import { buildLineup, selectLineup } from '../engine/match'
import { activePool } from '../engine/match'
import { MAPS } from '../engine/content'
import { SLIDERS } from './TacticSliders'

export default function Tactics() {
  const { game } = useGame()
  const me = game.teams[game.myTeam]
  const pool = activePool(game.seed + game.year)

  const lineup = selectLineup(game, game.myTeam)
  const preview = buildLineup(game, game.myTeam, pool[0])

  return (
    <>
      <div className="grid c2">
        <Panel title="战术板">
          <p className="small muted" style={{ marginTop: 0 }}>
            四条战术滑杆已经移到<b>比赛开始前</b>设置——每场比赛的对手和地图都不一样，
            赛季初定一次然后一直不动是不合理的。观战时<b>叫暂停也能临场调整</b>。
          </p>
          <div className="grid c2" style={{ gap: 10 }}>
            {SLIDERS.map((s) => (
              <div key={s.key}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="small" style={{ width: 56 }}>{s.label}</span>
                  <Bar value={me.tactics[s.key]} />
                  <span className="mono small" style={{ width: 24 }}>{me.tactics[s.key]}</span>
                </div>
                <div className="tiny faint" style={{ marginTop: 2 }}>{s.hint}</div>
              </div>
            ))}
          </div>
          <p className="tiny faint" style={{ marginBottom: 0 }}>
            以上是当前保存的设置，下一场比赛会以此为起点。
          </p>
        </Panel>

        <Panel title="当前阵容评估">
          <div className="grid c2" style={{ gap: 10, marginBottom: 14 }}>
            <div>
              <div className="small muted">进攻端强度</div>
              <div className="row" style={{ gap: 8 }}>
                <Bar value={preview.atk} max={110} />
                <span className="mono small">{preview.atk.toFixed(1)}</span>
              </div>
            </div>
            <div>
              <div className="small muted">防守端强度</div>
              <div className="row" style={{ gap: 8 }}>
                <Bar value={preview.def} max={110} />
                <span className="mono small">{preview.def.toFixed(1)}</span>
              </div>
            </div>
            <div>
              <div className="small muted">团队默契</div>
              <div className="row" style={{ gap: 8 }}>
                <Bar value={preview.chem} />
                <span className="mono small">{preview.chem.toFixed(0)}</span>
              </div>
            </div>
            <div>
              <div className="small muted">中局应变</div>
              <div className="row" style={{ gap: 8 }}>
                {/* a swing modifier, not a 0-100 rating — show it as the ± it is */}
                <Bar value={preview.midRound + 6} max={12} />
                <span className="mono small">
                  {preview.midRound >= 0 ? '+' : ''}{preview.midRound.toFixed(1)}
                </span>
              </div>
            </div>
          </div>

          <div className="small muted" style={{ marginBottom: 6 }}>出场阵容</div>
          <div className="row wrap" style={{ gap: 8 }}>
            {lineup.map((p) => (
              <span key={p.id} className="row" style={{ gap: 5 }}>
                <RoleTag role={p.role} />
                <span className="small">{p.ign}</span>
              </span>
            ))}
          </div>
          {!lineup.some((p) => p.isIgl) && (
            <p className="small neg">⚠ 首发中没有指挥（IGL），中局应变会受到明显惩罚。</p>
          )}
        </Panel>
      </div>

      <Panel title="地图熟练度" flush>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>地图</th><th style={{ width: '55%' }}>熟练度</th>
                <th className="num">数值</th><th>状态</th>
              </tr>
            </thead>
            <tbody>
              {MAPS.map((m) => {
                const v = Math.round(me.mapPrefs[m] ?? 50)
                const inPool = pool.includes(m)
                return (
                  <tr key={m} style={inPool ? undefined : { opacity: 0.42 }}>
                    <td><b>{m}</b></td>
                    <td><Bar value={v} /></td>
                    <td className="num mono">{v}</td>
                    <td className="small muted">{inPool ? '现役图池' : '轮换出池'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="tiny muted" style={{ padding: '10px 14px', margin: 0 }}>
          BP 阶段会优先 ban 掉对手熟练度高的地图、留下自己擅长的图。熟练度随赛季轮换的图池变化。
        </p>
      </Panel>
    </>
  )
}
