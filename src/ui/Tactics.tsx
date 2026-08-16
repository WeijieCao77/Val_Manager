import { useGame } from './ctx'
import { Bar, Panel, RoleTag } from './common'
import { buildLineup, selectLineup } from '../engine/match'
import { activePool } from '../engine/match'
import { MAPS } from '../engine/content'
import type { Tactics } from '../engine/types'

const SLIDERS: { key: keyof Tactics; label: string; lo: string; hi: string; hint: string }[] = [
  { key: 'pace', label: '节奏', lo: '慢速运营', hi: '快速突破', hint: '快节奏提升进攻端压制力，但防守容易被拉扯。' },
  { key: 'utility', label: '道具', lo: '节省', hi: '全开', hint: '道具开销大能提升整体执行力，对道具能力强的阵容收益更高。' },
  { key: 'aggression', label: '侵略性', lo: '保守', hi: '激进', hint: '激进打法进攻收益高，防守端风险更大。' },
  { key: 'adaptability', label: '中局应变', lo: '照战术板', hi: '随机应变', hint: '应变能力依赖指挥（IGL），落后时更容易翻盘。' },
]

export default function Tactics() {
  const { game, commit } = useGame()
  const me = game.teams[game.myTeam]
  const pool = activePool(game.seed + game.year)

  const set = (k: keyof Tactics, v: number) => {
    me.tactics = { ...me.tactics, [k]: v }
    commit()
  }

  const lineup = selectLineup(game, game.myTeam)
  const preview = buildLineup(game, game.myTeam, pool[0])

  return (
    <>
      <div className="grid c2">
        <Panel title="战术设置">
          {SLIDERS.map((s) => (
            <div key={s.key} style={{ marginBottom: 16 }}>
              <div className="slider-row">
                <span className="small">{s.label}</span>
                <input
                  type="range" min={0} max={100} value={me.tactics[s.key]}
                  onChange={(e) => set(s.key, Number(e.target.value))}
                />
                <span className="mono small right">{me.tactics[s.key]}</span>
              </div>
              <div className="row tiny muted" style={{ justifyContent: 'space-between', marginTop: -6 }}>
                <span>{s.lo}</span><span>{s.hi}</span>
              </div>
              <div className="tiny muted" style={{ marginTop: 4 }}>{s.hint}</div>
            </div>
          ))}
          <div className="row" style={{ gap: 8 }}>
            <button className="sm" onClick={() => { me.tactics = { pace: 50, utility: 55, aggression: 50, adaptability: 50 }; commit() }}>
              重置为默认
            </button>
          </div>
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
                const v = me.mapPrefs[m] ?? 50
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
