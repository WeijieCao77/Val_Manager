/**
 * The standing plan: what the club runs on every map in the pool, decided
 * here rather than in the two minutes before a match.
 *
 * Per map — the five agents and the four dials together — because a plan is
 * a map's plan. Scrims are played on it and the 跑图 drill rehearses it, so
 * a comp set here and left alone becomes a familiar one without the manager
 * touching it again. The general dials underneath are what any map without
 * its own setting falls back to.
 */
import { useGame } from './ctx'
import { Bar, Panel, RoleTag } from './common'
import { buildLineup, poolFor, selectLineup, sheetFor } from '../engine/match'
import { familiarity } from '../engine/comp'
import { MAPS, mapCn } from '../engine/content'
import MapPlan, { StyleTag } from './MapPlan'
import TacticSliders from './TacticSliders'

export default function Tactics() {
  const { game, commit } = useGame()
  const me = game.teams[game.myTeam]
  const pool = poolFor(game)

  const lineup = selectLineup(game, game.myTeam)
  const preview = buildLineup(game, game.myTeam, pool[0])

  return (
    <>
      <Panel
        title="各图预案 · 每张图的英雄阵容和战术"
        className="own"
        actions={<span className="tiny faint">训练赛按这里打，跑图练的也是它</span>}
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          在这里把每张图的<b>五个英雄</b>和<b>四条滑杆</b>定好，赛前就不用再调。
          <b>同一套阵容打得越多越熟</b>——熟练度进比赛是加分，临时换五个人从零开始。
        </p>
        <MapPlan maps={pool} mode="plan" />
      </Panel>

      <div className="grid c2">
        <Panel title="通用战术 · 没单独设置的图用这个">
          <TacticSliders game={game} commit={commit} />
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
          <p className="tiny faint" style={{ marginBottom: 0 }}>以 {mapCn(pool[0])} 的预案计算。</p>
        </Panel>
      </div>

      <Panel title="图池一览 · 熟练度" flush>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>地图</th><th>阵容</th><th style={{ width: '32%' }}>地图熟练度</th>
                <th className="num">数值</th><th style={{ width: '22%' }}>阵容熟练度</th><th>状态</th>
              </tr>
            </thead>
            <tbody>
              {MAPS.map((m) => {
                const v = Math.round(me.mapPrefs[m] ?? 50)
                const inPool = pool.includes(m)
                const sheet = sheetFor(game, game.myTeam, m)
                const fam = Math.round(familiarity(game, game.myTeam, m, sheet.agents))
                return (
                  <tr key={m} style={inPool ? undefined : { opacity: 0.42 }}>
                    <td><b>{mapCn(m)}</b> <span className="tiny faint">{m}</span></td>
                    <td><StyleTag style={sheet.style} /></td>
                    <td><Bar value={v} /></td>
                    <td className="num mono">{v}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <Bar value={fam} color={fam >= 50 ? 'var(--win)' : 'var(--accent)'} />
                        <span className="mono small">{fam}</span>
                      </div>
                    </td>
                    <td className="small muted">{inPool ? '现役图池' : '轮换出池'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="tiny muted" style={{ padding: '10px 14px', margin: 0 }}>
          BP 会 ban 掉对手熟练度高的图、留自己擅长的。阵容熟练度看的是这张图预案里那五个英雄，50 是中立。
        </p>
      </Panel>
    </>
  )
}
