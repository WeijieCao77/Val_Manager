import { useState } from 'react'
import { useGame } from './ctx'
import { OvrBadge, Panel, Crest } from './common'
import Bracket from './Bracket'
import { groupTable, sortStandings } from '../engine/league'
import { DRAW_KIND_CN, drawsOf } from '../engine/draw'
import { PLAYOFF_CUT, STAGES } from '../engine/season'
import { POINTS_NOTE, qualification } from '../engine/qualify'
import { ratingOf } from '../engine/match'
import { statLine } from '../engine/player'
import { REGION_CN, REGIONS } from '../engine/types'
import type { Competition } from '../engine/types'

function Table({ comp, members, cut: cutOverride }: { comp: Competition; members?: string[]; cut?: number }) {
  const { game, openPlayer } = useGame()
  void openPlayer
  const concluded = !!comp.champion && comp.finished.length > 0
  // a drawn group is its own table: the competition's rows, its members only
  const order = members
    ? (concluded ? comp.finished.filter((id) => members.includes(id)) : groupTable(comp, members))
    : concluded ? comp.finished : sortStandings(comp)
  const hasPlayed = Object.values(comp.standings).some((r) => r.w + r.l > 0)

  // where each club went out, so a strong regular season that ended early reads
  // as what it was rather than looking like a sorting bug
  const exitAt: Record<string, string> = {}
  for (const f of game.fixtures) {
    if (f.comp !== comp.key || !f.label.startsWith('KO:') || !f.result) continue
    const round = f.label.split(':')[2] ?? ''
    const loser = f.result.mapsWonA > f.result.mapsWonB ? f.teamB : f.teamA
    exitAt[loser] = round
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="num">{concluded ? '名次' : '#'}</th><th>战队</th>
            <th className="num">常规赛</th>
            <th className="num">小局</th><th className="num">净胜局</th><th className="num">回合差</th>
            {concluded && <th>季后赛</th>}
          </tr>
        </thead>
        <tbody>
          {order.map((id, i) => {
            const r = comp.standings[id]
            if (!r) return null
            const cut = Math.min(cutOverride ?? PLAYOFF_CUT[comp.stage] ?? 8, order.length)
            return (
              <tr key={id} className={id === game.myTeam ? 'me' : ''}>
                <td className="num muted">
                  {i + 1}
                  {comp.champion === id && ' 🏆'}
                  {!comp.champion && i + 1 === cut && ''}
                </td>
                <td style={{ borderLeft: !comp.champion && i < cut ? '2px solid var(--accent)' : '2px solid transparent' }}>
                  <span className="club" title={game.teams[id]?.name}>
                    <Crest id={id} /><span>{game.teams[id]?.tag}</span>
                  </span>
                </td>
                <td className="num mono">{r.w}-{r.l}</td>
                <td className="num muted">{r.mapW}-{r.mapL}</td>
                <td className={`num mono ${r.mapW - r.mapL >= 0 ? 'pos' : 'neg'}`}>
                  {r.mapW - r.mapL > 0 ? '+' : ''}{r.mapW - r.mapL}
                </td>
                <td className="num muted mono">{r.roundW - r.roundL > 0 ? '+' : ''}{r.roundW - r.roundL}</td>
                {concluded && (
                  <td className="small muted">
                    {comp.champion === id ? '冠军' : exitAt[id] ? `止步${exitAt[id]}` : '未进季后赛'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {!hasPlayed && <div className="empty">尚未开赛。</div>}
      {concluded && (
        <p className="tiny faint" style={{ padding: '9px 13px', margin: 0 }}>
          本赛段已结束，排序为<b>最终名次</b>（由季后赛决定），「常规赛」列仍是循环赛战绩——
          常规赛第一但止步淘汰赛是正常结果。
        </p>
      )}
    </div>
  )
}

export default function Standings() {
  const { game, openPlayer } = useGame()
  const [tab, setTab] = useState<'leagues' | 'players'>('leagues')
  const myRegion = game.teams[game.myTeam]?.region
  const [region, setRegion] = useState(myRegion ?? 'China')

  // What is being played now sits on top; what is over sinks. The Masters in
  // progress used to be the last panel on the page, under three finished
  // league tables — 「当时正在打的比赛应该提到最上面」.
  const rank = (c: Competition): number => {
    if (c.stage === game.stage) return 0
    const played = game.fixtures.some((f) => f.comp === c.key && f.played)
    if (played && !c.champion) return 1
    return c.champion ? 3 : 2
  }
  // calendar position; the two Challengers splits straddle Stage 1 and Stage 2
  const order = (c: Competition): number => {
    const i = STAGES.findIndex((s) => s.key === c.stage)
    if (i >= 0) return i
    return c.stage === 'challengers1' ? 3.5 : c.stage === 'challengers2' ? 5.5 : 9
  }
  const shown = Object.values(game.comps)
    .filter((c) => !c.region || c.region === region)
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 3 ? order(b) - order(a) : order(a) - order(b)))

  const leaders = Object.values(game.players)
    .filter((p) => p.season.maps >= 8 && p.teamId)
    .sort((a, b) => ratingOf(b.season) - ratingOf(a.season))
    .slice(0, 40)
  // where this stage leads, for the club's own region only
  const qual = region === myRegion ? qualification(game) : null

  return (
    <>
      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <div className="seg">
          <button className={tab === 'leagues' ? 'on' : ''} onClick={() => setTab('leagues')}>联赛</button>
          <button className={tab === 'players' ? 'on' : ''} onClick={() => setTab('players')}>选手榜</button>
        </div>
        {tab === 'leagues' && (
          <div className="seg">
            {REGIONS.map((r) => (
              <button key={r} className={region === r ? 'on' : ''} onClick={() => setRegion(r)}>
                {REGION_CN[r]}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'leagues' ? (
        <>
          {qual && (
            <Panel tut="qualify" title={`晋级形势 · ${qual.event}`} className={qual.tone === 'good' ? 'good' : qual.tone === 'warn' ? 'alert' : ''}>
              <div className={`qual ${qual.tone}`}>
                <div className="lead">{qual.headline}</div>
                {qual.lines.map((l, i) => <p key={i}>{l}</p>)}
                <p className="tiny faint" style={{ margin: 0 }}>{POINTS_NOTE}</p>
              </div>
            </Panel>
          )}
          {shown.length === 0 && <div className="empty">该赛区本阶段没有进行中的赛事。</div>}
          {shown.map((c) => c.region ? (
            <Panel
              key={c.key}
              title={`${c.name}${c.champion ? ` · 冠军 ${game.teams[c.champion]?.name}` : ''}`}
              flush
            >
              {c.format === 'triple' ? (
                <p className="tiny faint" style={{ padding: '9px 13px', margin: 0 }}>
                  三败淘汰：十二队，输三场出局。胜者组、中段组、败者组各有一场决赛，三个冠军就是本赛区去 Masters 的三个名额（依次为第 1、2、3 种子）。
                  上届 Champions 的四队轮空到胜者组第二轮，其余八队抽签进入首轮。
                  {!c.seeds?.length && '签表还没抽——抽签在总览页弹出，抽完对阵才会出现在这里。'}
                </p>
              ) : c.grouped && c.groups ? (
                <div className="grid c2" style={{ gap: 0 }}>
                  {c.groups.map((g, i) => (
                    <div key={i}>
                      <div className="nav-group" style={{ padding: '8px 13px 4px' }}>{c.groupNames?.[i] ?? ['Alpha', 'Omega'][i]} 组 · 前 4 进季后赛</div>
                      <Table comp={c} members={g} cut={4} />
                    </div>
                  ))}
                </div>
              ) : c.grouped ? (
                <div className="empty">分组要等 {c.stage === 'stage1' ? 'Kickoff' : 'Stage 1'} 打完抽签才定。</div>
              ) : (
                <Table comp={c} />
              )}
              {c.bracketStarted && (
                <div style={{ padding: '12px 13px', borderTop: '1px solid var(--line)' }}>
                  <div className="nav-group" style={{ padding: '0 0 8px' }}>
                    {c.format === 'triple' ? '签表 · 三败淘汰' : `季后赛对阵${c.format === 'double' ? ' · 双败淘汰' : ''}`}
                  </div>
                  <Bracket comp={c} />
                </div>
              )}
              <DrawHistory comp={c} />
            </Panel>
          ) : (
            <Panel key={c.key} title={`${c.name}（国际赛事${c.city ? ` · ${c.city}` : ''}）${c.champion ? ` · 冠军 ${game.teams[c.champion]?.name}` : ''}`}>
              <Bracket comp={c} />
              <DrawHistory comp={c} />
              {!!c.champion && c.finished.length > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary className="small muted" style={{ cursor: 'pointer' }}>最终排名</summary>
                  <div className="table-wrap" style={{ marginTop: 8 }}>
                    <table>
                      <thead>
                        <tr><th className="num">#</th><th>战队</th><th>赛区</th></tr>
                      </thead>
                      <tbody>
                        {c.finished.map((id, i) => (
                          <tr key={id} className={id === game.myTeam ? 'me' : ''}>
                            <td className="num muted">{i + 1}{c.champion === id && ' 🏆'}</td>
                            <td><span className="club" title={game.teams[id]?.name}>
                              <Crest id={id} /><span>{game.teams[id]?.tag}</span>
                            </span></td>
                            <td className="small muted">{REGION_CN[game.teams[id]?.region]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </Panel>
          ))}
        </>
      ) : (
        <Panel title="赛季选手排行（至少 8 张图）" flush>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">#</th><th>选手</th><th>战队</th><th className="num">能力</th>
                  <th className="num">评分</th><th className="num">ACS</th><th className="num">K/D</th>
                  <th className="num">ADR</th><th className="num">KPR</th>
                  <th className="num">首杀差</th><th className="num">场次</th>
                </tr>
              </thead>
              <tbody>
                {leaders.map((p, i) => {
                  const s = statLine(p.season)
                  return (
                    <tr
                      key={p.id}
                      className={`clickable ${p.teamId === game.myTeam ? 'me' : ''}`}
                      onClick={() => openPlayer(p.id)}
                    >
                      <td className="num muted">{i + 1}</td>
                      <td><b>{p.ign}</b></td>
                      <td className="small muted">{game.teams[p.teamId ?? '']?.name}</td>
                      <td className="num"><OvrBadge value={p.overall} /></td>
                      <td className="num"><b>{ratingOf(p.season).toFixed(2)}</b></td>
                      <td className="num mono">{s.acs.toFixed(0)}</td>
                      <td className="num mono">{s.kd.toFixed(2)}</td>
                      <td className="num mono">{s.adr.toFixed(0)}</td>
                      <td className="num mono">{s.kpr.toFixed(2)}</td>
                      <td className={`num mono ${s.fkDiff >= 0 ? 'pos' : 'neg'}`}>
                        {s.fkDiff > 0 ? '+' : ''}{s.fkDiff}
                      </td>
                      <td className="num muted">{p.season.maps}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  )
}

/**
 * The draws a competition ran, kept where the bracket is: the pots, every
 * ball in order with any forced placement's reason, and who chose whom.
 * A draw not yet watched can be opened from here too.
 */
function DrawHistory({ comp }: { comp: Competition }) {
  const { game, openDraw } = useGame()
  const draws = drawsOf(game, comp.key)
  if (!draws.length) return null
  return (
    <details style={{ margin: '10px 13px 12px' }}>
      <summary className="small muted" style={{ cursor: 'pointer' }}>抽签记录（{draws.length}）</summary>
      {draws.map((d) => {
        const n = d.phase?.match(/swiss-r(\d)/)?.[1]
        return (
          <div key={d.id} style={{ margin: '8px 0 0', paddingTop: 8, borderTop: '1px solid var(--line-soft)' }}>
            <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
              <b className="small">{DRAW_KIND_CN[d.kind]}{n ? ` 第 ${n} 轮` : ''}</b>
              <span className="tiny faint">{d.status === 'complete' ? '已完成' : d.status === 'awaiting-choice' ? '等待选择' : '未看完'}</span>
              <button className="sm ghost" onClick={() => openDraw(d.id)}>{d.watched ? '回看' : '进入抽签'}</button>
            </div>
            <p className="tiny muted" style={{ margin: '4px 0' }}>{d.rule}</p>
            <ul className="tiny muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              {d.log.map((l, i) => <li key={i}>{l}</li>)}
              {d.steps.filter((st) => st.note).map((st, i) => (
                <li key={`n${i}`}>{game.teams[st.team]?.tag} → {st.slot}：{st.note}</li>
              ))}
            </ul>
          </div>
        )
      })}
    </details>
  )
}
