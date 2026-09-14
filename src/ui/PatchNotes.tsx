/**
 * The current version, where a manager can find it.
 *
 * The engine has rolled patches at every international since the style
 * triangle went in, and the only trace was one news line the day it
 * happened — 「逆着版本排阵容要吃亏」 with nowhere to look up which agents.
 * Two surfaces now: a card on 总览 that names the version and says in one
 * line whether the plan is with it, and the full notice on 战术 with the
 * buff / nerf list, what it means for each map's plan, and the last few
 * versions. Everything printed is the number the match reads
 * (engine/patchNotes.ts); nothing here edits a plan.
 */
import { useEffect } from 'react'
import { useGame } from './ctx'
import { Panel, fmtDay } from './common'
import { agentCn, mapCn } from '../engine/content'
import { markPatchSeen } from '../engine/season'
import { coefLabel, patchAdvice, patchLine } from '../engine/patchNotes'
import type { MapNote } from '../engine/patchNotes'

const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}`
const tone = (x: number) => (x >= 0.15 ? 'pos' : x <= -0.15 ? 'neg' : 'faint')
const word = (x: number, yes: string, no: string, mid = '持平') => (x >= 0.15 ? yes : x <= -0.15 ? no : mid)

/** 总览: one card in the stat grid */
export function PatchCard() {
  const { game, go } = useGame()
  const patch = game.patch
  const fresh = !!patch?.id && patch.id !== game.patchSeen
  const advice = patchAdvice(game)
  return (
    <Panel className={fresh ? 'own' : undefined}>
      <div className="stat">
        <span className="k">当前版本{fresh && <span className="tag warn" style={{ marginLeft: 6 }}>新</span>}</span>
        <span className="v sm">{patch ? patch.name : '初始版本'}</span>
      </div>
      <div className="tiny" style={{ marginTop: 2, lineHeight: 1.5 }}>
        {patch ? (
          <>
            <span className="faint">{fmtDay(patch.since, patch.year ?? game.year)} 生效 · {patch.after ?? '本赛段起'}</span>
            <br />
            <span className={advice.maps.some((m) => m.version <= -0.15) ? 'neg' : 'faint'}>{advice.summary}</span>
          </>
        ) : <span className="faint">{advice.summary}</span>}
      </div>
      <button className="sm ghost" style={{ marginTop: 6 }} onClick={() => go('tactics')}>看版本公告和本队建议</button>
    </Panel>
  )
}

function MapRow({ m }: { m: MapNote }) {
  return (
    <tr>
      <td><b>{mapCn(m.map)}</b></td>
      <td className="small">{Object.values(m.agents).map(agentCn).join(' · ')}</td>
      <td className={`num mono ${tone(m.version)}`} title="预案五个英雄的版本系数平均，−100 全逆版本，+100 全版本之子">
        {word(m.version, '顺版本', '逆版本')} {pct(m.version)}
      </td>
      <td className={`num mono ${tone(m.mapFit)}`} title="阵容打法和这张图要的方向">
        {word(m.mapFit, '合适', '不合', '一般')} {pct(m.mapFit)}
      </td>
      <td className={`num mono ${m.familiarity >= 50 ? 'pos' : 'faint'}`} title="这套五人在这张图练过多少，50 中立">{m.familiarity}</td>
      <td className="small">
        {m.issues.length === 0 && m.upside.length === 0 && <span className="faint">不用动</span>}
        {m.upside.length > 0 && (
          <div className="pos">占便宜：{m.upside.map((u) => `${u.ign} 的${agentCn(u.agent)}`).join('、')}</div>
        )}
        {m.issues.map((i) => (
          <div key={i.playerId}>
            <span className="neg">{i.ign} 的{agentCn(i.agent)}被削（{coefLabel(i.coef)}）</span>
            {i.swap
              ? <>，可换{agentCn(i.swap.agent)}（{coefLabel(i.swap.coef)}，熟练度 {Math.floor(i.swap.pro)}%）</>
              : i.train
                ? <>，同位置{agentCn(i.train.agent)}是{coefLabel(i.train.coef)}但他只练到 {Math.floor(i.train.pro)}%，先去训练页练</>
                : <>，同位置没有明显更顺版本的英雄，差得不多，先这样</>}
          </div>
        ))}
      </td>
    </tr>
  )
}

/** 战术: the full notice */
export function PatchPanel() {
  const { game, commit } = useGame()
  const patch = game.patch
  const advice = patchAdvice(game)
  // opening the page is reading the notice
  useEffect(() => {
    if (patch?.id && game.patchSeen !== patch.id) { markPatchSeen(game); commit() }
  }, [patch?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const history = (game.patchLog ?? []).slice().reverse().filter((p) => p.id !== patch?.id).slice(0, 5)

  return (
    <Panel
      title={patch ? `当前版本 · ${patch.name}` : '当前版本 · 初始版本'}
      actions={<span className="tiny faint">本存档内的模拟版本，不是 Riot 的真实公告</span>}
    >
      {!patch ? (
        <p className="small muted" style={{ margin: 0 }}>
          还没有版本调整。第一次调整在第一站大师赛结束后生效，冠军赛之后是休赛期大改。
        </p>
      ) : (
        <>
          <div className="row wrap small" style={{ gap: 14, marginBottom: 8 }}>
            <span><span className="faint">生效</span> {fmtDay(patch.since, patch.year ?? game.year)}</span>
            <span><span className="faint">影响</span> {patch.after ?? '本赛段起'}的比赛（刚结束的赛事用的是上一版）</span>
            <span><span className="faint">幅度</span> {patch.big ? '休赛期大改' : '赛中小改'}</span>
          </div>
          {/* this patch's own changes first — the same names as the news line — then
              whoever the version still favours or has cut from earlier patches */}
          <div className="row wrap small" style={{ gap: 6, marginBottom: 6 }}>
            <span className="faint">这一版：</span>
            {advice.buffed.map((n) => (
              <span key={n.agent} className="tag win" title={`版本系数 ${pct(n.coef)}`}>▲ {agentCn(n.agent)} 加强，现在{coefLabel(n.coef)}</span>
            ))}
            {advice.nerfed.map((n) => (
              <span key={n.agent} className="tag warn" title={`版本系数 ${pct(n.coef)}`}>▼ {agentCn(n.agent)} 削弱，现在{coefLabel(n.coef)}</span>
            ))}
            {!advice.buffed.length && !advice.nerfed.length && <span className="faint">只有微调，没有明显加强或削弱。</span>}
          </div>
          {(advice.darlings.some((n) => !patch.buffed.includes(n.agent)) || advice.weak.some((n) => !patch.nerfed.includes(n.agent))) && (
            <div className="row wrap small" style={{ gap: 6, marginBottom: 10 }}>
              <span className="faint">沿用上几版：</span>
              {advice.darlings.filter((n) => !patch.buffed.includes(n.agent)).map((n) => (
                <span key={n.agent} className="tag win" title={`版本系数 ${pct(n.coef)}`}>{agentCn(n.agent)} {coefLabel(n.coef)}</span>
              ))}
              {advice.weak.filter((n) => !patch.nerfed.includes(n.agent)).map((n) => (
                <span key={n.agent} className="tag warn" title={`版本系数 ${pct(n.coef)}`}>{agentCn(n.agent)} {coefLabel(n.coef)}</span>
              ))}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 0 }}>
            版本、地图适配、熟练度是三件事，表里分开列：顺版本是英雄本身在这一版强，合适是打法对这张图，熟练度是这五个人练过多少。
            这里只是建议，预案不会自动改，要换去上面的各图预案里换。
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>地图</th><th>预案</th><th className="num">版本</th><th className="num">地图适配</th><th className="num">熟练度</th><th>本队建议</th>
                </tr>
              </thead>
              <tbody>
                {advice.maps.map((m) => <MapRow key={m.map} m={m} />)}
              </tbody>
            </table>
          </div>
          {advice.players.length > 0 && (
            <div className="small" style={{ marginTop: 10 }}>
              <div className="faint" style={{ marginBottom: 4 }}>首发各人练过的英雄里（熟练度 60% 以上）</div>
              {advice.players.map((n) => (
                <div key={n.id}>
                  <b>{n.ign}</b>
                  {n.up.length > 0 && <span className="pos">　受益：{n.up.map((a) => agentCn(a.agent)).join('、')}</span>}
                  {n.down.length > 0 && <span className="neg">　受损：{n.down.map((a) => agentCn(a.agent)).join('、')}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {history.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="small muted">最近的版本（{history.length}）</summary>
          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {history.map((p) => (
              <li key={p.id ?? `${p.year}-${p.since}`}>
                <b>{p.name}</b> · {fmtDay(p.since, p.year ?? game.year)} 生效 · {p.after ?? ''} · {patchLine(p)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  )
}
