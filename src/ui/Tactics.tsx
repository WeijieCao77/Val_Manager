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
import { Bar, Face, Panel, RoleTag } from './common'
import { buildLineup, poolFor, selectLineup, sheetFor, tacticsFor } from '../engine/match'
import { PREP_FLOOR, heatLabel, readOf } from '../engine/scouting'
import { DIFFICULTY, difficultyOf, spec } from '../engine/difficulty'
import { familiarity } from '../engine/comp'
import { MAPS, mapCn } from '../engine/content'
import { mapReleased } from '../engine/eras'
import MapPlan, { StyleTag } from './MapPlan'
import TacticSliders from './TacticSliders'
import { PatchPanel } from './PatchNotes'

export default function Tactics() {
  const { game, commit } = useGame()
  const me = game.teams[game.myTeam]
  const pool = poolFor(game)

  const lineup = selectLineup(game, game.myTeam)
  const preview = buildLineup(game, game.myTeam, pool[0])

  return (
    <>
      <PatchPanel />
      <Panel
        title="各图预案 · 每张图的英雄阵容和战术"
        className="own"
        actions={<span className="tiny faint">训练赛和跑图都按这里练</span>}
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          定好每张图的五个英雄和四条滑杆，赛前不用再调。同一套阵容打得越多越熟，熟练度进比赛是加分。
        </p>
        <MapPlan maps={pool} mode="plan" />
      </Panel>

      <ScoutPanel />

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
                <Face id={p.id} size={18} />
                <span className="small">{p.ign}</span>
              </span>
            ))}
          </div>
          {!lineup.some((p) => p.isIgl) && (
            <p className="small neg">⚠ 首发没有指挥（IGL），中局应变大减。</p>
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
                <th className="num">数值</th><th style={{ width: '22%' }}>阵容熟练度</th>
                <th className="num" title="这张图的预案被对手看过多少">被摸透</th><th>状态</th>
              </tr>
            </thead>
            <tbody>
              {MAPS.filter((m) => pool.includes(m) || mapReleased(game, m)).map((m) => {
                const v = Math.round(me.mapPrefs[m] ?? 50)
                const inPool = pool.includes(m)
                const sheet = sheetFor(game, game.myTeam, m)
                const fam = Math.round(familiarity(game, game.myTeam, m, sheet.agents))
                const read = Math.round(readOf(game, m, sheet.agents, tacticsFor(game, game.myTeam, m)).read * 100)
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
                    <td className={`num mono small${read >= 60 ? ' neg' : ''}`}>{read}%</td>
                    <td className="small muted">{inPool ? '现役图池' : '轮换出池'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="tiny muted" style={{ padding: '10px 14px', margin: 0 }}>
          BP 会 ban 对手熟练的图、留自己擅长的。阵容熟练度看这张图预案的五个英雄，50 是中立。
        </p>
      </Panel>
    </>
  )
}

/**
 * 对手针对: how closely the league is watching, and which maps it has read.
 * See engine/scouting.ts for the numbers.
 */
function ScoutPanel() {
  const { game } = useGame()
  const heat = Math.round(game.scout?.heat ?? 0)
  const pool = poolFor(game)
  const nem = game.nemesis && game.nemesis.year === game.year ? game.teams[game.nemesis.teamId] : undefined
  const max = spec(game).prepMax
  const rows = pool.map((m) => {
    const sheet = sheetFor(game, game.myTeam, m)
    const read = readOf(game, m, sheet.agents, tacticsFor(game, game.myTeam, m)).read
    return { m, read, prep: max * (heat / 100) * (PREP_FLOOR + (1 - PREP_FLOOR) * read) }
  })
  return (
    <Panel
      title="对手针对"
      actions={<span className="tiny faint">难度：{DIFFICULTY[difficultyOf(game)].label}</span>}
    >
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <span className="small muted" style={{ whiteSpace: 'nowrap' }}>针对度</span>
        <Bar value={heat} color={heat >= 75 ? 'var(--accent)' : heat >= 45 ? 'var(--warn)' : 'var(--win)'} />
        <span className="mono small">{heat}</span>
        <b className="small" style={{ whiteSpace: 'nowrap' }}>{heatLabel(heat)}</b>
      </div>
      {nem && (
        <p className="small" style={{ margin: '8px 0 0' }}>
          ⚔️ 宿敌 <b>{nem.name}</b>：对我们的准备多四成，转会窗口每周都在买人。
        </p>
      )}
      {heat > 0 && (
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          {rows.map((r) => (
            <span key={r.m} className={`chip small${r.read >= 0.6 ? ' neg' : ''}`}
              title={`被摸透 ${Math.round(r.read * 100)}%`}>
              {mapCn(r.m)} <b className="mono">+{r.prep.toFixed(1)}</b>
            </span>
          ))}
        </div>
      )}
      <p className="tiny muted" style={{ margin: '10px 0 0' }}>
        赢得越多，对手越研究你：每张图上数字是对手的额外备战分。
        同一套英雄和滑杆连打三场就被摸透；换英雄、或把一条滑杆拨动 10 以上，他们的准备就白做一部分。
        赢一场针对度 +3，输一场 −8，拿冠军涨得更多。训练赛不算。
      </p>
    </Panel>
  )
}
