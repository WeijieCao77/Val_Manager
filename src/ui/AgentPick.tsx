/**
 * Who plays what, on each map of this match.
 *
 * Left alone, every map is filled with the composition it is usually played
 * with, handed to whoever on the five can actually play those jobs — so a
 * manager who never opens this never suffers for it. Touch it and you can
 * trade: put a man on a job that is not his and he plays it at up to −12%,
 * which is exactly what 练新英雄 in the training screen buys back.
 */
import { useState } from 'react'
import { useGame } from './ctx'
import { selectLineup } from '../engine/match'
import { agentMod, agentRoleGaps, agentWarn, autoAgents, normalizeAgents } from '../engine/agents'
import { AGENT_ROLE, ALL_AGENTS, MAP_META, mapCn } from '../engine/content'
import { OvrBadge } from './common'

export default function AgentPick({ maps }: { maps: string[] }) {
  const { game, commit } = useGame()
  const five = selectLineup(game, game.myTeam)
  const [open, setOpen] = useState(maps[0] ?? '')

  const picksFor = (map: string): Record<string, string> =>
    normalizeAgents(game, game.myTeam, five, map,
      game.agentPicks?.[map] ?? autoAgents(game, game.myTeam, five, map))

  const set = (map: string, playerId: string, agent: string) => {
    const cur = { ...picksFor(map) }
    // A side is five different agents. Whoever already had this one takes the
    // one being given up — a swap, not a hand-off, so nobody is ever left
    // without a character and no two players ever show the same one.
    const holder = Object.keys(cur).find((id) => cur[id] === agent && id !== playerId)
    if (holder) cur[holder] = cur[playerId]
    cur[playerId] = agent
    game.agentPicks = { ...(game.agentPicks ?? {}), [map]: cur }
    commit()
  }

  const reset = (map: string) => {
    const next = { ...(game.agentPicks ?? {}) }
    delete next[map]
    game.agentPicks = Object.keys(next).length ? next : undefined
    commit()
  }

  const picks = picksFor(open)
  const gaps = agentRoleGaps(five, picks)
  const touched = !!game.agentPicks?.[open]

  return (
    <div>
      <p className="tiny faint" style={{ marginTop: 0 }}>
        不改也没关系——默认就是这张图<b>最常见的英雄组合</b>，而且只会交给打得来这个位置的人。
        改动只对这场比赛有效。
      </p>

      {maps.length > 1 && (
        <div className="seg" style={{ marginBottom: 10 }}>
          {maps.map((m) => (
            <button key={m} className={open === m ? 'on' : ''} onClick={() => setOpen(m)}>
              {mapCn(m)}{game.agentPicks?.[m] ? ' ·' : ''}
            </button>
          ))}
        </div>
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
                    <select
                      value={a ?? ''}
                      onChange={(e) => set(open, p.id, e.target.value)}
                      style={{ maxWidth: 160 }}
                    >
                      {/* the map's usual agents first, then everyone else */}
                      <optgroup label={`${mapCn(open)} 常用`}>
                        {(MAP_META[open] ?? []).map((x) => (
                          <option key={x} value={x}>{x}（{AGENT_ROLE[x]}）</option>
                        ))}
                      </optgroup>
                      <optgroup label="全部英雄">
                        {ALL_AGENTS.filter((x) => !(MAP_META[open] ?? []).includes(x)).map((x) => (
                          <option key={x} value={x}>{x}（{AGENT_ROLE[x] ?? '—'}）</option>
                        ))}
                      </optgroup>
                    </select>
                  </td>
                  <td className="num mono" style={{
                    color: mod >= 0.999 ? 'var(--win)' : 'var(--accent)',
                  }} title={warn ?? '本行，随便挑哪个都一样'}>
                    {mod >= 0.999 ? '—' : `${Math.round((mod - 1) * 100)}%`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 10, alignItems: 'baseline' }}>
        {gaps.length > 0 && (
          <span className="tiny" style={{ color: 'var(--warn)' }}>
            ⚠️ 这套阵容没有{gaps.join('、')}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {touched && (
          <button className="sm ghost" onClick={() => reset(open)}>恢复默认组合</button>
        )}
      </div>
    </div>
  )
}
