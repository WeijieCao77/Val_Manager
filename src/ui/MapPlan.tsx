/**
 * One map's plan: the five agents, the four dials, and what they add up to.
 *
 * The same panel serves two places. On the 战术 screen it is the standing
 * plan for every map in the pool — set once, remembered, and what scrims and
 * the 跑图 drill rehearse. Before a match it is the same plan for the maps
 * about to be played, with the opponent's likely shape shown next to it, and
 * anything changed there is both tonight's sheet and the new default.
 *
 * Left alone, every map is filled with the composition it is usually played
 * with, handed to whoever on the five can actually play those jobs — so a
 * manager who never opens this never suffers for it. What the panel adds is
 * the reading: this five is a 双决斗, these sliders suit it or fight it, and
 * the club has or has not practised it.
 */
import { useState } from 'react'
import { useGame } from './ctx'
import { selectLineup, sheetFor } from '../engine/match'
import { agentMod, agentRoleGaps, agentWarn, autoAgents, normalizeAgents } from '../engine/agents'
import { COMP_STYLE_CN, compStyle, famBonus, familiarity } from '../engine/comp'
import type { CompStyle } from '../engine/comp'
import { AGENT_ROLE, ALL_AGENTS, MAP_META, agentCn, mapCn } from '../engine/content'
import { AgentIcon, Bar, OvrBadge } from './common'
import TacticSliders from './TacticSliders'

export const STYLE_COLOR: Record<CompStyle, string> = {
  rush: 'var(--duelist)', hold: 'var(--sentinel)', control: 'var(--controller)', standard: 'var(--muted)',
}

export function StyleTag({ style }: { style: CompStyle }) {
  return (
    <span className="tag" style={{ borderColor: STYLE_COLOR[style], color: STYLE_COLOR[style], fontWeight: 700 }}>
      {COMP_STYLE_CN[style].label}
    </span>
  )
}

export default function MapPlan({
  maps, mode, opp,
}: {
  maps: string[]
  /** match: tonight's sheet AND the map's default; plan: the default only */
  mode: 'match' | 'plan'
  /** who we are about to play, so their likely shape can be shown */
  opp?: string
}) {
  const { game, commit } = useGame()
  const me = game.teams[game.myTeam]
  const five = selectLineup(game, game.myTeam)
  const [open, setOpen] = useState(maps[0] ?? '')
  // the veto can change the maps under us; never show a tab that is not there
  const cur = maps.includes(open) ? open : (maps[0] ?? '')

  const picksFor = (map: string): Record<string, string> =>
    normalizeAgents(game, game.myTeam, five, map,
      (mode === 'match' ? game.agentPicks?.[map] : undefined)
      ?? game.mapAgents?.[map]
      ?? autoAgents(game, game.myTeam, five, map))

  const set = (map: string, playerId: string, agent: string) => {
    const next = { ...picksFor(map) }
    // A side is five different agents. Whoever already had this one takes the
    // one being given up — a swap, not a hand-off, so nobody is ever left
    // without a character and no two players ever show the same one.
    const holder = Object.keys(next).find((id) => next[id] === agent && id !== playerId)
    if (holder) next[holder] = next[playerId]
    next[playerId] = agent
    if (mode === 'match') {
      game.agentPicks = { ...(game.agentPicks ?? {}), [map]: next }
    } else if (game.agentPicks?.[map]) {
      // a plan made on the 战术 screen must not be shadowed by a sheet left
      // over from an earlier match on this map
      const picks = { ...game.agentPicks }
      delete picks[map]
      game.agentPicks = Object.keys(picks).length ? picks : undefined
    }
    // and it becomes this map's default either way
    game.mapAgents = { ...(game.mapAgents ?? {}), [map]: next }
    commit()
  }

  const reset = (map: string) => {
    const picks = { ...(game.agentPicks ?? {}) }
    delete picks[map]
    game.agentPicks = Object.keys(picks).length ? picks : undefined
    const saved = { ...(game.mapAgents ?? {}) }
    delete saved[map]
    game.mapAgents = Object.keys(saved).length ? saved : undefined
    commit()
  }

  if (!cur) return null
  const picks = picksFor(cur)
  const style = compStyle(Object.values(picks))
  const info = COMP_STYLE_CN[style]
  const fam = familiarity(game, game.myTeam, cur, picks)
  const famEdge = famBonus(fam)
  const pref = Math.round(me.mapPrefs[cur] ?? 50)
  const gaps = agentRoleGaps(five, picks)
  const planned = !!game.mapAgents?.[cur]
  const oppTeam = opp ? game.teams[opp] : undefined
  const oppStyle = oppTeam ? sheetFor(game, oppTeam.id, cur).style : null

  return (
    <div>
      {maps.length > 1 && (
        <div className="seg wrap" style={{ marginBottom: 10 }}>
          {maps.map((m) => (
            <button key={m} className={cur === m ? 'on' : ''} onClick={() => setOpen(m)}>
              {mapCn(m)}
              {game.mapAgents?.[m] || game.mapTactics?.[m] ? ' ·' : ''}
              {mode === 'plan' && (
                <span className="tiny faint" style={{ marginLeft: 4 }}>{Math.round(me.mapPrefs[m] ?? 50)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* what this five IS, and how well the club knows it */}
      <div className="row wrap" style={{ gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <StyleTag style={style} />
        <span className="small">{info.blurb}</span>
      </div>
      <div className="grid c2" style={{ gap: 12, marginBottom: 10 }}>
        <div>
          <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <span className="small muted">阵容熟练度</span>
            <b className="mono">{Math.round(fam)}</b>
            <span className="small mono" style={{ color: famEdge >= 0 ? 'var(--win)' : 'var(--accent)' }}>
              {famEdge >= 0 ? '+' : ''}{famEdge.toFixed(1)}
            </span>
          </div>
          <Bar value={fam} color={famEdge >= 0 ? 'var(--win)' : 'var(--accent)'} />
        </div>
        <div>
          <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <span className="small muted">地图熟练度</span>
            <b className="mono">{pref}</b>
          </div>
          <Bar value={pref} />
        </div>
      </div>
      {oppTeam && oppStyle && (
        <p className="small" style={{ margin: '0 0 10px' }}>
          对手 <b>{oppTeam.tag}</b> 这张图大概率是 <StyleTag style={oppStyle} />
          <span className="muted"> {COMP_STYLE_CN[oppStyle].counter}</span>
        </p>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>选手</th><th>位置</th><th>英雄</th><th className="num">影响</th>
            </tr>
          </thead>
          <tbody>
            {five.map((p) => {
              const a = picks[p.id]
              const mod = agentMod(p, a)
              const warn = a ? agentWarn(p, a) : null
              const mine = p.roles ?? [p.role]
              return (
                <tr key={p.id}>
                  <td>
                    <b>{p.ign}</b> <OvrBadge value={p.overall} />
                  </td>
                  <td className="tiny muted">{mine.join(' / ')}</td>
                  <td>
                    <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                      {a && <AgentIcon name={a} size={26} />}
                      <select
                        value={a ?? ''}
                        onChange={(e) => set(cur, p.id, e.target.value)}
                        style={{ maxWidth: 160 }}
                      >
                        <optgroup label={`${mapCn(cur)} 常用`}>
                          {(MAP_META[cur] ?? []).map((x) => (
                            <option key={x} value={x}>{agentCn(x)}（{AGENT_ROLE[x]}）</option>
                          ))}
                        </optgroup>
                        <optgroup label="全部英雄">
                          {ALL_AGENTS.filter((x) => !(MAP_META[cur] ?? []).includes(x)).map((x) => (
                            <option key={x} value={x}>{agentCn(x)}（{AGENT_ROLE[x] ?? '—'}）</option>
                          ))}
                        </optgroup>
                      </select>
                    </span>
                  </td>
                  <td className="num mono" style={{
                    color: mod >= 0.999 ? 'var(--win)' : 'var(--accent)', fontWeight: 700,
                  }} title={warn ?? '他本来就打这个位置'}>
                    {mod >= 0.999 ? '—' : `${Math.round((mod - 1) * 100)}%`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 8, alignItems: 'baseline' }}>
        {gaps.length > 0 && (
          <span className="small" style={{ color: 'var(--warn)', fontWeight: 700 }}>
            ⚠️ 这套阵容没有{gaps.join('、')}
          </span>
        )}
        {planned && <span className="tiny faint">这是你给{mapCn(cur)}定的阵容</span>}
        <div style={{ flex: 1 }} />
        {planned && (
          <button className="sm ghost" onClick={() => reset(cur)}>恢复默认组合</button>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="row wrap" style={{ gap: 8, alignItems: 'baseline', marginBottom: 8 }}>
          <b>{mapCn(cur)} 的战术</b>
          <span className="small" style={{ color: STYLE_COLOR[style] }}>{info.advice}</span>
        </div>
        <TacticSliders game={game} commit={commit} compact map={cur} />
      </div>
    </div>
  )
}
