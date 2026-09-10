import { useState } from 'react'
import { ask } from './confirm'
import { AGENTS, AGENT_ROLE, agentCn, mapCn } from '../engine/content'
import { useGame } from './ctx'
import { Bar, Condition, money, OvrBadge, Panel, Roles, Potential } from './common'
import { callerOf, squadOf } from '../engine/roster'
import { stageName } from '../engine/season'
import { AGENT_DRILL, AGENT_DRILL_MAX } from '../engine/training'
import { ATTR_CN, ATTR_KEYS, ROLES } from '../engine/types'
import { poolFor } from '../engine/match'
import { logActivity } from '../engine/agenda'
import {
  doPhysio, MAP_DECAY_AFTER, MAP_DECAY_FLOOR, MAP_DECAY_PER_WEEK, mapIdleDays, physioBlock, PHYSIO_COST,
  recommendedTrainingFocus, REST_AT, reviewIglXp,
} from '../engine/training'
import { useAction } from './useAction'
import {
  analystMarket, approachForCoach, askingSalary, clearedCoaches, demoteHead, employedCoaches,
  facilityCost, offerToStaff, promoteToHead, releaseStaff, ROLE_CN, SPEC_CN, STAFF_CAP, staffBonus,
  staffMarket, staffRaw, staffShare, upgradeFacility,
} from '../engine/staff'
import type { AgentPick, Attrs, StaffRole } from '../engine/types'

const OPTIONS: { key: keyof Attrs | 'rest'; label: string }[] = [
  { key: 'rest', label: '休息' },
  ...ATTR_KEYS.map((k) => ({ key: k, label: ATTR_CN[k] })),
]

export default function Training() {
  const { game, commit, toast, openPlayer } = useGame()
  const act = useAction()
  const [hiring, setHiring] = useState(false)
  const [role, setRole] = useState<StaffRole>('head')
  const [poach, setPoach] = useState(false)
  const [poachFee, setPoachFee] = useState<Record<string, number>>({})
  const [bidOn, setBidOn] = useState<string | null>(null)
  const [bidPay, setBidPay] = useState(0)
  const [bidYears, setBidYears] = useState(2)
  // Every coach in the world is in these lists now, not the top twenty —
  // 「挖别队的主教练里没有所有的教练可以挖，比如 TEC 的 AfteR 就没有」was the
  // cap, not a rule — so a search box does what the cap was doing for length.
  const [staffQ, setStaffQ] = useState('')
  const hit = (...xs: string[]) => {
    const t = staffQ.trim().toLowerCase()
    return !t || xs.some((x) => x.toLowerCase().includes(t))
  }
  const [duoPick, setDuoPick] = useState<string[]>(
    game.duo ? [game.duo.a, game.duo.b] : [],
  )
  const squad = squadOf(game, game.myTeam)
  const me = game.teams[game.myTeam]

  const setFocus = (id: string, v: keyof Attrs | 'rest') => {
    game.training[id] = v
    commit()
  }

  const restTired = () => {
    let n = 0
    for (const p of squad) {
      if (p.fatigue >= REST_AT) {
        game.training[p.id] = 'rest'
        n++
      }
    }
    commit()
    toast(n ? `已安排 ${n} 名疲劳选手休息。` : '目前没有明显疲劳的选手。')
  }

  const autoFocus = () => {
    let rested = 0
    for (const p of squad) {
      // the shared judgement rests the tired and the finished; an injury is
      // the one thing it cannot see without the calendar
      const focus = p.injuredUntil > game.day ? 'rest' : recommendedTrainingFocus(p)
      if (focus === 'rest') rested++
      game.training[p.id] = focus
    }
    commit()
    toast(rested
      ? `已按位置分配，${rested} 人受伤、疲劳或到潜力上限，改为休息。`
      : '已按位置重点分配训练。')
  }

  const drill = game.drill ?? { kind: 'none' as const }
  // the plan is only committed on 确定, so picking is free until then
  // an unset lock must not read as "locked until day 0": the tutorial runs at
  // day -1, where `?? 0` made every untouched panel inert
  const locked = game.drillLock != null && game.drillLock > game.day

  const setDrill = (d: typeof drill, _label: string) => {
    if (locked) return
    game.drill = d
    commit()
  }
  // 练英雄 holds up to five men, one agent each. Changing one man's pick must
  // leave the other four alone, which a single-learner drill never had to do.
  const agentPicks: AgentPick[] = drill.kind === 'agent' ? drill.picks : []
  const setAgentPick = (playerId: string, agent: string) => {
    const rest = agentPicks.filter((x) => x.playerId !== playerId)
    const next = agent
      ? [...rest, { playerId, agent }].slice(-AGENT_DRILL_MAX)
      : rest
    setDrill(next.length ? { kind: 'agent', picks: next } : { kind: 'none' },
      next.length ? `${next.length} 人练英雄` : '取消团队训练')
  }
  const setDuo = (pair: string[]) => {
    if (locked) return
    setDuoPick(pair)
    game.duo = pair.length === 2 ? { a: pair[0], b: pair[1] } : undefined
    commit()
  }
  // days into the committed seven, for the progress bar
  const drillDone = locked ? 7 - ((game.drillLock ?? game.day) - game.day) : 0

  const describe = () => {
    const d = game.drill
    const main = !d || d.kind === 'none' ? '不安排团队训练'
      : d.kind === 'map' ? `跑图 ${[d.map, d.map2].filter((m): m is string => !!m).map(mapCn).join('＋')}`
        : d.kind === 'review' ? '教练复盘'
          : d.picks.map((x) => `${game.players[x.playerId]?.ign} 练${agentCn(x.agent)}`).join('、')
    const duo = game.duo
      ? ` ＋ 双排 ${game.players[game.duo.a]?.ign}/${game.players[game.duo.b]?.ign}`
      : ''
    return main + duo
  }

  const confirmPlan = () => {
    // seven days from confirmation — the lock is the settlement date
    game.drillLock = game.day + 7
    const focus = squad
      .map((p) => {
        const f = game.training[p.id] ?? 'rest'
        return `${p.ign}:${f === 'rest' ? '休息' : ATTR_CN[f as keyof typeof ATTR_CN]}`
      })
      .join('，')
    logActivity(game, 'training', `确定本周训练：${describe()}｜个人：${focus}`)
    commit()
    toast(`本周训练已确定：${describe()}`)
  }
  const pool = poolFor(game)
  const fit = squad.filter((p) => p.injuredUntil <= game.day)

  return (
    <>
      <Panel
        title={`团队训练 · ${locked
          ? `进行中 ${drillDone}/7 天`
          : '确定后练 7 天，期满结算'}`}
        className={locked ? '' : 'own'}
      >
        {/* The unit, stated once and loudly. 「IGL 指挥 +7」 was read as seven
            points of 指挥 — it is seven points of a hundred-point bar, and
            nothing on this screen had ever said how big the bar is. */}
        <p className="small muted" style={{ marginTop: 0 }}>
          主训练三选一，双排练可以同时安排。
          <span style={{ color: 'var(--warn)' }}>所有 <b>+N</b> 都是经验，<b>攒满 100 才 +1 属性</b></span>，教练和设施再乘 1.2~2 倍。
        </p>

        <div className={`drill-group${locked ? ' locked' : ''}`}>
        <div className="tiny faint" style={{ marginBottom: 6 }}>主训练 · 三选一</div>
        <div className="grid c3" style={{ gap: 12 }}>
          <div className="drill-card">
            <b>跑图</b>
            <p className="tiny muted">
              一周最多两张图。每张地图熟练度 <b>+2</b>（上限 95），阵容熟练度 +12；全队协同 <b>+9</b>、意识 <b>+5</b> 经验。
              四周没练也没打的图每周回落 {MAP_DECAY_PER_WEEK}（最低 {MAP_DECAY_FLOOR}），带 ↓ 的正在掉。
            </p>
            <div className="row wrap" style={{ gap: 5 }}>
              {pool.map((m) => {
                const picked = drill.kind === 'map'
                  ? [drill.map, drill.map2].filter((x): x is string => !!x) : []
                const on = picked.includes(m)
                return (
                  <button key={m}
                    className={`sm${on ? ' primary' : ''}`}
                    onClick={() => {
                      // up to two maps a week: click to add, click again to
                      // drop; with two already chosen, a click swaps the second
                      const next = on ? picked.filter((x) => x !== m)
                        : picked.length < 2 ? [...picked, m] : [picked[0], m]
                      setDrill(
                        next.length ? { kind: 'map', map: next[0], map2: next[1] } : { kind: 'none' },
                        `跑图 ${next.map(mapCn).join('＋')}`,
                      )
                    }}>
                    {mapCn(m)} <span className="tiny faint">{Math.round(me.mapPrefs[m] ?? 50)}</span>
                    {mapIdleDays(me, m, game.day) >= MAP_DECAY_AFTER && (me.mapPrefs[m] ?? 50) > MAP_DECAY_FLOOR && (
                      <span className="tiny neg" title={`${Math.floor(mapIdleDays(me, m, game.day) / 7)} 周没练也没打，正在回落`}> ↓</span>
                    )}
                  </button>
                )
              })}
              <span className="tiny faint">
                {drill.kind !== 'map' ? '选一到两张' : drill.map2 ? '两张一起练' : '还能再选一张'}
              </span>
            </div>
          </div>

          <div className="drill-card">
            <b>教练复盘</b>
            <p className="tiny muted">
              全队意识 <b>+6</b>、沟通 <b>+3</b> 经验，乘教练战术加成。指挥经验只有 IGL 拿，给得多，指挥越低涨得越快。不掉体能，还恢复 1~4。
            </p>
            {/* Who is actually getting the 指挥 experience, and how far along
                he is. The table below only ever showed the attribute a player
                is PERSONALLY focused on, so a drill aimed at 指挥 filled a bar
                nobody could see — which is what 「安排了两次复盘，只涨了 2
                点」 was really asking about. */}
            {(() => {
              const igl = callerOf(game, game.myTeam)
              if (!igl) {
                return (
                  <p className="tiny" style={{ color: 'var(--warn)', margin: '0 0 8px' }}>
                    队里还没有指挥，指挥经验没人拿。去「阵容」页指定一个。
                  </p>
                )
              }
              const xp = igl.xp.igl ?? 0
              const capped = igl.overall >= igl.potential
              const per = reviewIglXp(game, igl)
              const rounds = Math.max(1, Math.ceil((100 - xp) / per))
              return (
                <div className="tiny" style={{ margin: '0 0 8px' }}>
                  <div className="row" style={{ gap: 7 }}>
                    <span className="faint">指挥 <b>{igl.ign}</b> {igl.attrs.igl}</span>
                    <Bar value={xp} color="var(--violet)" />
                    <span className="mono faint">{Math.round(xp)}%</span>
                  </div>
                  {capped ? (
                    <div style={{ color: 'var(--warn)', marginTop: 3 }}>
                      已到潜力上限，再练也不会涨。
                    </div>
                  ) : (
                    <div className="faint" style={{ marginTop: 3 }}>
                      一轮约 <b>+{Math.round(per)}</b> 经验，再 <b>{rounds}</b> 轮（{rounds * 7} 天）指挥 +1。
                    </div>
                  )}
                </div>
              )
            })()}
            <button
              className={drill.kind === 'review' ? 'primary' : ''}
              onClick={() => setDrill({ kind: 'review' }, '教练复盘')}>
              安排复盘{me.coach ? `（${me.coach.name}）` : ''}
            </button>
          </div>

          <div className="drill-card">
            <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
              <b>练英雄</b>
              <div className="spacer" style={{ flex: 1 }} />
              <span className="tiny mono muted">本周 {agentPicks.length}/{AGENT_DRILL_MAX} 人</span>
            </div>
            <p className="tiny muted">
              每人挑一个英雄，熟练度每周约 <b>+{AGENT_DRILL}</b>。练满 100 就能把他当本命用；
              如果不是他的位置，练满还会让他兼任那个位置。
              <b>一周最多 {AGENT_DRILL_MAX} 个人一起练</b>，不多花一周。
            </p>
            {/* One line per man: who, what he is on, and how far along he is.
                Five selects in a wrapped row could not say which bar belonged
                to whom once more than one of them was set. */}
            <div className="agent-drill">
              {fit.map((p) => {
                const on = agentPicks.find((x) => x.playerId === p.id)
                const full = !on && agentPicks.length >= AGENT_DRILL_MAX
                const pro = on ? p.agentPro?.[on.agent] ?? 0 : 0
                const need = on ? AGENT_ROLE[on.agent] : null
                const covers = need ? (p.roles ?? [p.role]).includes(need) : true
                return (
                  <div key={p.id} className={`agent-drill-row${on ? ' on' : ''}`}>
                    <span className="agent-drill-who">{p.ign}</span>
                    <select
                      className="sm agent-drill-pick"
                      aria-label={`${p.ign} 这周练的英雄`}
                      disabled={full}
                      value={on?.agent ?? ''}
                      onChange={(e) => setAgentPick(p.id, e.target.value)}
                    >
                      <option value="">{full ? `已满 ${AGENT_DRILL_MAX} 人` : '不练'}</option>
                      {ROLES.filter((r) => r !== '自由人').map((r) => (
                        <optgroup key={r} label={`${r}${(p.roles ?? [p.role]).includes(r) ? '（本职）' : ''}`}>
                          {(AGENTS[r] ?? []).filter((a) => (p.agentPro?.[a] ?? 0) < 100).map((a) => (
                            <option key={a} value={a}>
                              {agentCn(a)} {Math.round(p.agentPro?.[a] ?? 0)}%
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {on ? (
                      <span className="agent-drill-bar">
                        <Bar value={pro} color="var(--controller)" />
                        <span className="tiny mono">{Math.round(pro)}%</span>
                      </span>
                    ) : <span className="agent-drill-bar" />}
                    {on && !covers && (
                      <span className="tiny faint agent-drill-note">练满可兼任{need}</span>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="tiny faint">
              改练别的英雄不会清空进度。伤停的人这周自动跳过，下周继续。
            </div>
          </div>
        </div>

        <div className="tiny faint" style={{ margin: '14px 0 6px' }}>加练 · 可与上面并行</div>
        <div className="grid" style={{ gap: 12 }}>
          <div className="drill-card" data-tut="pair">
            <b>双排练</b>
            <p className="tiny muted">
              两人协同 <b>+10</b>、沟通 <b>+8</b>、反应 <b>+5</b> 经验，关系 <b>+3~6</b>，体能 −5~10。修复队内矛盾主要靠它。
            </p>
            <div className="row wrap" style={{ gap: 5 }}>
              {fit.map((p) => {
                const on = duoPick.includes(p.id)
                return (
                  <button key={p.id} className={`sm${on ? ' primary' : ''}`}
                    onClick={() => {
                      // hold the half-made choice, so picking the first player sticks
                      const next = on
                        ? duoPick.filter((x) => x !== p.id)
                        : [...duoPick, p.id].slice(-2)
                      setDuo(next)
                    }}>
                    {p.ign}
                  </button>
                )
              })}
              <span className="tiny faint">
                {duoPick.length === 0 ? '选两人' : duoPick.length === 1 ? '再选一人' : '已选定'}
              </span>
              {duoPick.length > 0 && (
                <button className="sm ghost" onClick={() => setDuo([])}>清除</button>
              )}
            </div>
          </div>

        </div>
        </div>

        <div className="row wrap" style={{ gap: 10, marginTop: 14, alignItems: 'center' }}>
          {locked ? (
            <>
              <span className="tag t1">训练中</span>
              <span className="small">{describe()}</span>
              <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="bar-track" style={{ width: 120, height: 6, background: 'var(--panel-2)', borderRadius: 3, overflow: 'hidden', display: 'inline-block' }}>
                  <span style={{ display: 'block', height: '100%', width: `${Math.round(100 * drillDone / 7)}%`, background: 'var(--win)' }} />
                </span>
                <span className="tiny faint">{drillDone}/7 天 · 第 7 天结算</span>
              </span>
              <button className="sm ghost" onClick={async () => {
                if (!(await ask(
                  `重选会荒废已练的 ${drillDone}/7 天，新计划从第 1 天重新数起。确定？`,
                ))) return
                game.drillLock = undefined
                logActivity(game, 'training', `撤销团队训练计划（荒废 ${drillDone}/7 天进度）`)
                commit()
                toast('已放弃当前进度，重新选好后点「确定」。')
              }}>
                重选（荒废进度）
              </button>
            </>
          ) : (
            <>
              <button className="primary" onClick={confirmPlan}>确定本周训练</button>
              <span className="small muted">{describe()}</span>
              {drill.kind !== 'none' && (
                <button className="sm ghost" onClick={() => setDrill({ kind: 'none' }, '取消团队训练')}>
                  清除主训练
                </button>
              )}
            </>
          )}
        </div>
      </Panel>

      <Panel
        tut="focus"
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
                    <td className="num"><Potential p={p} game={game} /></td>
                    <td>
                      <div className="row" style={{ gap: 7 }}>
                        <Bar value={head} max={25} color={head > 8 ? 'var(--win)' : head > 3 ? 'var(--warn)' : 'var(--muted)'} />
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
                            {o.key === recommendedTrainingFocus(p) ? ' ◄ 建议' : ''}
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

      <Panel title={`理疗室 · 每次 ${money(PHYSIO_COST)}`}>
        <p className="small muted" style={{ marginTop: 0 }}>
          花钱不花行动力。大幅恢复体能，伤停中可提前复出，每人每 7 天一次。体能 55 以上几乎不会受伤。
        </p>
        <div className="row wrap" style={{ gap: 8 }}>
          {squad.map((p) => {
            const why = physioBlock(game, p.id)
            const hurt = p.injuredUntil > game.day
            return (
              <button
                key={p.id}
                className="sm"
                disabled={!!why}
                title={why ?? (hurt ? '恢复体能并缩短伤停' : '恢复体能')}
                onClick={() => {
                  const note = doPhysio(game, p.id)
                  if (note) {
                    logActivity(game, 'training', note)
                    toast(note)
                    commit()
                  }
                }}
              >
                💆 {p.ign}
                <span className="tiny faint"> 体能 {Math.round(100 - p.fatigue)}{hurt ? ` · 伤停 ${p.injuredUntil - game.day} 天` : ''}</span>
              </button>
            )
          })}
        </div>
      </Panel>

      <div className="grid c2">
        <Panel title="训练设施">
          <div className="row" style={{ gap: 10, marginBottom: 10 }}>
            <Bar value={me.facilities} />
            <span className="mono">{me.facilities}</span>
          </div>
          <p className="small muted">
            每一级训练收益约 +0.8%。
          </p>
          {me.facilities >= 95 ? (
            <p className="small" style={{ color: 'var(--win)', margin: 0 }}>已是顶级设施。</p>
          ) : (
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <button
                className="primary sm"
                disabled={game.finances.balance < facilityCost(me.facilities)}
                onClick={() => act('facility', () => {
                  toast(upgradeFacility(game))
                  logActivity(game, 'squad', `训练设施升级至 ${game.teams[game.myTeam].facilities}`)
                })}
              >
                升级到 {me.facilities + 1}
              </button>
              <span className="small mono">{money(facilityCost(me.facilities))}</span>
              {game.finances.balance < facilityCost(me.facilities) && (
                <span className="tiny" style={{ color: 'var(--accent)' }}>资金不足</span>
              )}
            </div>
          )}
        </Panel>
        <Panel title="教练组">
          {me.coach ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <b>{me.coach.name}</b>
                <button
                  className="sm ghost"
                  title="降为助理教练，主教练位置空出"
                  onClick={async () => {
                    const head = me.coach
                    if (!head) return
                    if (!(await ask(`确定让 ${head.name} 降为助理教练？俱乐部会暂时没有主教练。`))) return
                    toast(demoteHead(game))
                    logActivity(game, 'squad', `${head.name} 降为助理教练`)
                    commit()
                  }}
                >
                  降为助教
                </button>
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
            <p className="small muted">
              暂无主教练。本作只收录真实人物，不会编造教练；没有教练时按队伍整体水平算加成。
            </p>
          )}
          {(game.staff ?? []).length > 0 && (() => {
            // Contributions stack and then stop. Without this the fifth hire
            // felt identical to the second and nothing on screen explained it.
            const rows = ([['培养', 'development'], ['战术', 'tactics'], ['激励', 'motivation']] as const)
              .map(([label, k]) => ({ label, k, raw: staffRaw(game, k), used: staffBonus(game, k) }))
            const capped = rows.filter((r) => r.raw > r.used + 0.05)
            return (
              <div style={{ marginTop: 12 }}>
                <div className="tiny faint" style={{ marginBottom: 5 }}>教练组加成（合计，各项上限 {STAFF_CAP}）</div>
                {rows.map((r) => (
                  <div key={r.k} className="row" style={{ gap: 10, marginBottom: 6 }}>
                    <span className="small muted" style={{ width: 40 }}>{r.label}</span>
                    <Bar value={(100 * r.used) / STAFF_CAP} />
                    <span className="mono small" style={{ width: 74, textAlign: 'right' }}>
                      +{r.used.toFixed(1)}/{STAFF_CAP}
                    </span>
                  </div>
                ))}
                {capped.length > 0 && (
                  <p className="tiny" style={{ color: 'var(--warn)', margin: '6px 0 0' }}>
                    ⚠️ {capped.map((r) => r.label).join('、')}已封顶，再雇人没有提升
                    （浪费 {capped.map((r) => `${r.label} ${(r.raw - r.used).toFixed(1)}`).join('、')}）。
                    想再变强要换更好的人，或签数据分析师，专精效果不占上限。
                  </p>
                )}
                <div className="tiny faint" style={{ margin: '10px 0 5px' }}>教练组其他成员</div>
              {(game.staff ?? []).map((m) => (
                <div key={m.name} className="row" style={{ gap: 8, marginBottom: 5 }}>
                  <span className="small" style={{ flex: 1 }}>
                    <b>{m.name}</b> <span className="tag">{ROLE_CN[m.role]}</span>
                    {m.spec && (
                      <span className="tag" style={{ marginLeft: 4, borderColor: 'var(--controller)', color: 'var(--controller)' }}
                        title={SPEC_CN[m.spec].blurb}>
                        {SPEC_CN[m.spec].label}
                      </span>
                    )}
                  </span>
                  <span className="tiny faint">战 {m.tactics} / 培 {m.development} / 激 {m.motivation}</span>
                  <span className="tiny mono" title="他贡献的培养加成（高于 55 的部分）">
                    培 +{staffShare(m, 'development').toFixed(1)}
                  </span>
                  <span className="tiny mono">{money(m.salary)}</span>
                  {m.role === 'assistant' && (
                    <button
                      className="sm"
                      title={me.coach
                        ? `升任主教练，${me.coach.name} 转为助理教练；薪资按主教练身价重谈，只升不降`
                        : '升任主教练；薪资按主教练身价重谈，只升不降'}
                      onClick={async () => {
                        const swap = me.coach ? `${me.coach.name} 会转为助理教练。` : ''
                        if (!(await ask(`确定让 ${m.name} 升任主教练？${swap}`))) return
                        toast(promoteToHead(game, m.name))
                        logActivity(game, 'squad', `${m.name} 升任主教练`)
                        commit()
                      }}
                    >
                      升任主教练
                    </button>
                  )}
                  <button className="sm ghost" onClick={async () => {
                    if (!(await ask(`确定与 ${m.name} 解约？`))) return
                    toast(releaseStaff(game, m.name)); commit()
                  }}>解约</button>
                </div>
              ))}
              </div>
            )
          })()}

          {(game.staffOffers ?? []).filter((o) => !o.answer).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="tiny faint" style={{ marginBottom: 5 }}>等待答复</div>
              {(game.staffOffers ?? []).filter((o) => !o.answer).map((o) => (
                <div key={o.id} className="small" style={{ padding: '3px 0' }}>
                  ⏳ {o.name} · {ROLE_CN[o.role]} · {money(o.salary)}/年 ·
                  <span className="faint"> {Math.max(0, o.replyOn - game.day)} 天内答复</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <button className="sm" onClick={() => setHiring((x) => !x)}>
              {hiring ? '收起' : '聘请教练 / 助教 / 分析师'}
            </button>
          </div>

          {hiring && (
            <div style={{ marginTop: 10 }}>
              <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
                <div className="seg">
                  <button className={!poach ? 'on' : ''} onClick={() => setPoach(false)}>自由教练</button>
                  <button className={poach ? 'on' : ''} onClick={() => setPoach(true)}>挖别队主教练</button>
                </div>
                {!poach && (
                  <div className="seg">
                    {(['head', 'assistant', 'analyst'] as StaffRole[]).map((r) => (
                      <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>
                        {ROLE_CN[r]}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  className="sm"
                  style={{ width: 170 }}
                  placeholder="搜教练 / 俱乐部"
                  value={staffQ}
                  onChange={(e) => setStaffQ(e.target.value)}
                />
              </div>
              <p className="tiny faint" style={{ marginTop: 0 }}>
                {role === 'analyst' ? (
                  <>
                    全世界只有<b> {analystMarket(game).length} 名</b>在册分析师，只收录 Liquipedia 有记录的真人。
                    每人各管一件事，签谁看你缺什么。
                  </>
                ) : (
                  <>
                    都是各队真实的助理教练，助教可以升任主教练。发出邀请后 <b>1~7 天内答复</b>，
                    薪资、俱乐部声望和你的履历都影响他是否接受。聘新主教练后，原主教练转为助理教练。助教加成「培养」。
                  </>
                )}
              </p>
              {poach ? (() => {
                // the coaches whose clubs have already said yes, priced as head
                // coaches — the rows below look themselves up in here
                const cleared = clearedCoaches(game)
                const rows = employedCoaches(game).filter(({ team, coach }) => hit(coach.name, team.name, team.tag))
                return (
                <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>主教练</th><th>现俱乐部</th><th className="num">战术</th>
                        <th className="num">培养</th><th className="num">激励</th>
                        <th className="num">参考补偿</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 && (
                        <tr><td colSpan={7} className="tiny faint">没有叫这个名字的主教练或俱乐部。</td></tr>
                      )}
                      {rows.map(({ team, coach, ask }) => {
                        const pending = (game.staffApproaches ?? [])
                          .find((a) => a.teamId === team.id && !a.answer)
                        const granted = (game.staffApproaches ?? [])
                          .find((a) => a.teamId === team.id && a.answer === 'granted')
                        const refused = (game.staffApproaches ?? [])
                          .find((a) => a.teamId === team.id && a.answer === 'refused')
                        const fee = poachFee[team.id] ?? ask
                        return (
                          <tr key={coach.name}>
                            <td><b>{coach.name}</b></td>
                            <td className="small muted">{team.name}</td>
                            <td className="num mono">{coach.tactics}</td>
                            <td className="num mono">{coach.development}</td>
                            <td className="num mono">{coach.motivation}</td>
                            <td className="num mono">{money(ask)}</td>
                            <td>
                              {granted ? (() => {
                                // The club said yes — so the contract talk happens
                                // right here, in the row you were already looking at.
                                // It used to say 「去下面谈合同」 and put him in the
                                // 「自由教练」 tab instead: another tab, another list,
                                // and people wrote in to ask where coach contracts
                                // are negotiated because the answer was nowhere on
                                // this screen.
                                const cand = cleared.find((c) => c.name === coach.name)
                                const waiting = (game.staffOffers ?? [])
                                  .find((o) => o.name === coach.name && !o.answer)
                                if (waiting) {
                                  return (
                                    <span className="tiny faint">
                                      已报价，等他本人答复（{Math.max(0, waiting.replyOn - game.day)} 天）
                                    </span>
                                  )
                                }
                                if (!cand) return <span className="tiny faint">他已经不在这支球队了</span>
                                const wants = askingSalary(cand, 'head')
                                return bidOn === coach.name ? (
                                  <div className="row" style={{ gap: 5 }}>
                                    <input
                                      type="number" className="sm" style={{ width: 92 }}
                                      value={bidPay} step={5000}
                                      onChange={(e) => setBidPay(Number(e.target.value))}
                                    />
                                    <select className="sm" style={{ width: 62 }} value={bidYears}
                                      onChange={(e) => setBidYears(Number(e.target.value))}>
                                      <option value={1}>1年</option>
                                      <option value={2}>2年</option>
                                      <option value={3}>3年</option>
                                    </select>
                                    <button className="sm primary" onClick={() => act('staff', () => {
                                      toast(offerToStaff(game, coach.name, 'head', bidPay, bidYears))
                                      logActivity(game, 'squad', `向 ${coach.name} 发出主教练邀请`)
                                      setBidOn(null)
                                    })}>发出</button>
                                  </div>
                                ) : (
                                  <button className="sm primary"
                                    onClick={() => { setBidOn(coach.name); setBidPay(wants) }}>
                                    ✅ 已获准 · 谈合同（要价 {money(wants)}）
                                  </button>
                                )
                              })() : pending ? (
                                <span className="tiny faint">等待答复（{Math.max(0, pending.replyOn - game.day)} 天）</span>
                              ) : refused ? (
                                <span className="tiny faint">已拒绝：{refused.reason}</span>
                              ) : (
                                <div className="row" style={{ gap: 5 }}>
                                  <input type="number" className="sm" style={{ width: 96 }} step={10000}
                                    value={fee}
                                    onChange={(e) => setPoachFee((x) => ({ ...x, [team.id]: Number(e.target.value) }))} />
                                  <button className="sm" onClick={() => act('staff', () => {
                                    toast(approachForCoach(game, team.id, fee))
                                    logActivity(game, 'squad', `就 ${coach.name} 联系 ${team.name}`)
                                  })}>接触</button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                )
              })() : (
              <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>教练</th><th className="num">战术</th><th className="num">培养</th>
                      <th className="num">激励</th><th className="num">要价</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {(role === 'analyst'
                      ? analystMarket(game)
                      : [...clearedCoaches(game), ...staffMarket(game)]
                    ).filter((c) => hit(c.name, c.from)).map((c) => {
                      const ask = askingSalary(c, role)
                      const bidding = bidOn === c.name
                      return (
                        <tr key={c.name}>
                          <td>
                            <b>{c.name}</b>
                            <div className="tiny faint">
                              {/* a coach cleared from another club is still their
                                  head coach until he signs — calling him an 助教
                                  in this list was the other half of the confusion */}
                              原 {c.from} {role === 'analyst' ? '分析师'
                                : Object.values(game.teams).some((t) => t.coach?.name === c.name)
                                  ? '主教练' : '助教'}
                            </div>
                            {c.spec && (
                              <div className="tiny" style={{ color: 'var(--controller)' }}>
                                {SPEC_CN[c.spec].label} · {SPEC_CN[c.spec].blurb}
                              </div>
                            )}
                          </td>
                          <td className="num mono">{c.tactics}</td>
                          <td className="num mono">{c.development}</td>
                          <td className="num mono">{c.motivation}</td>
                          <td className="num mono">{money(ask)}</td>
                          <td>
                            {bidding ? (
                              <div className="row" style={{ gap: 5 }}>
                                <input
                                  type="number" className="sm" style={{ width: 92 }}
                                  value={bidPay} step={5000}
                                  onChange={(e) => setBidPay(Number(e.target.value))}
                                />
                                <select className="sm" style={{ width: 62 }} value={bidYears}
                                  onChange={(e) => setBidYears(Number(e.target.value))}>
                                  <option value={1}>1年</option>
                                  <option value={2}>2年</option>
                                  <option value={3}>3年</option>
                                </select>
                                <button className="sm primary" onClick={() => act('staff', () => {
                                  toast(offerToStaff(game, c.name, role, bidPay, bidYears))
                                  logActivity(game, 'squad', `向 ${c.name} 发出${ROLE_CN[role]}邀请`)
                                  setBidOn(null)
                                })}>发出</button>
                              </div>
                            ) : (
                              <button className="sm" onClick={() => { setBidOn(c.name); setBidPay(ask) }}>
                                报价
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              )}
              {poach && (
                <p className="tiny faint" style={{ marginTop: 8, marginBottom: 0 }}>
                  先付补偿金请求接触，获准后在这一行和教练本人谈薪资，他也可能不来。<br />
                  「参考补偿」只是身价，不是付了就放人：你声望越低、对方越大牌，越要溢价。
                  新人经理付足额基本不成，<b>1.6 倍约五成、2.2 倍九成</b>。
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>

      <p className="tiny muted">
        个人专项设一次一直生效，每 7 天结算；团队训练一轮 7 天，期满后要重新安排。
        疲劳超过 70 成长大减；20 岁以下成长约是 27 岁以上的三倍；到潜力上限后不再涨。
      </p>
    </>
  )
}
