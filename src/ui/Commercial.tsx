import { useState } from 'react'
import { useGame } from './ctx'
import { Condition, money, OvrBadge, Panel, Stat } from './common'
import { bookGig, cancelGig, openGigs } from '../engine/commercial'
import { logActivity } from '../engine/agenda'
import { squadOf } from '../engine/world'
import type { Gig } from '../engine/types'

const ICON: Record<string, string> = {
  fanmeet: '🎤', brand: '🤝', campus: '🎓', shoot: '📷', stream: '📺',
}

/**
 * The commercial calendar.
 *
 * Deliberately built as a trade rather than a reward: each card shows the fee
 * next to what the day costs, because taking every offer that comes in is the
 * mistake the screen is meant to let you make knowingly.
 */
export default function Commercial() {
  const { game, commit, toast } = useGame()
  const [picking, setPicking] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const squad = squadOf(game, game.myTeam)
  const gigs = openGigs(game)

  const start = (g: Gig) => {
    setPicking(g.id)
    setChosen(g.attendees ?? [])
  }

  const toggle = (id: string, heads: number) => {
    setChosen((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-heads),
    )
  }

  const confirm = (g: Gig) => {
    const msg = bookGig(game, g.id, chosen)
    if (!g.accepted) { toast(msg); return }
    logActivity(game, 'commercial', `${g.label}（${g.partner}）· ${chosen.length} 人出席`)
    commit()
    setPicking(null)
    setChosen([])
    toast(msg)
  }

  const drop = (g: Gig) => {
    toast(cancelGig(game, g.id))
    logActivity(game, 'commercial', `取消 ${g.label}`)
    commit()
  }

  const bookedFee = gigs.filter((g) => g.accepted).reduce((s, g) => s + g.fee, 0)

  return (
    <>
      <div className="grid c4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Panel><Stat k="可用资金" v={money(game.finances.balance)} /></Panel>
        <Panel><Stat k="待办活动" v={`${gigs.filter((g) => g.accepted).length}`} /></Panel>
        <Panel><Stat k="已签约收入" v={money(bookedFee)} /></Panel>
        <Panel><Stat k="俱乐部声望" v={`${Math.round(game.teams[game.myTeam]?.reputation ?? 0)}`} /></Panel>
      </div>

      <Panel title="商务邀约">
        <p className="small muted" style={{ marginTop: 0 }}>
          活动是不用靠成绩就能拿到的钱，代价是选手的时间：<b>出席一天，这一周的训练收益就少四分之一</b>，
          还会掉体能。有比赛的日子不能安排。邀约会过期，不接就没了。
        </p>

        {gigs.length === 0 && <div className="empty">暂时没有商务邀约，过几天再看看。</div>}

        <div className="grid c2" style={{ gap: 12 }}>
          {gigs.map((g) => {
            const days = g.day - game.day
            const isPicking = picking === g.id
            return (
              <div key={g.id} className={`drill-card${g.accepted ? ' own' : ''}`}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <b>{ICON[g.kind]} {g.label}</b>
                  <span className="mono" style={{ color: 'var(--win)' }}>{money(g.fee)}</span>
                </div>
                <div className="tiny muted" style={{ marginTop: 2 }}>{g.partner}</div>
                <p className="tiny faint" style={{ margin: '6px 0' }}>{g.blurb}</p>

                <div className="row wrap tiny" style={{ gap: 6, marginBottom: 8 }}>
                  <span className="tag">{days <= 0 ? '就在今天' : `${days} 天后`}</span>
                  <span className="tag">{g.heads} 人出席</span>
                  <span className="tag">体能 −{g.fatigue}</span>
                  <span className="tag">士气 {g.morale >= 0 ? '+' : ''}{g.morale}</span>
                  <span className="tag">人气 +{g.fans}</span>
                </div>

                {g.accepted ? (
                  <div>
                    <div className="tiny" style={{ marginBottom: 6 }}>
                      出席：{(g.attendees ?? []).map((id) => game.players[id]?.ign).join('、')}
                    </div>
                    <button className="sm ghost" onClick={() => drop(g)}>取消安排</button>
                  </div>
                ) : isPicking ? (
                  <div>
                    <div className="tiny muted" style={{ marginBottom: 5 }}>
                      选 {g.heads} 人（已选 {chosen.length}）：
                    </div>
                    <div className="row wrap" style={{ gap: 5, marginBottom: 8 }}>
                      {squad.map((p) => (
                        <button
                          key={p.id}
                          className={`sm${chosen.includes(p.id) ? ' primary' : ''}`}
                          onClick={() => toggle(p.id, g.heads)}
                          title={p.injuredUntil > game.day ? '伤停中，但仍可出席商务活动' : ''}
                        >
                          {p.ign} <OvrBadge value={p.overall} />
                        </button>
                      ))}
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="primary sm" disabled={chosen.length !== g.heads}
                        onClick={() => confirm(g)}>
                        确认接下
                      </button>
                      <button className="sm ghost" onClick={() => { setPicking(null); setChosen([]) }}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="sm" onClick={() => start(g)}>安排出席</button>
                )}
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="选手状态" flush>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>选手</th><th className="num">能力</th><th>体能</th>
                <th className="num">士气</th><th className="num">本周商务</th>
              </tr>
            </thead>
            <tbody>
              {squad.map((p) => {
                const used = game.commercialDays?.[p.id] ?? 0
                return (
                  <tr key={p.id}>
                    <td><b>{p.ign}</b></td>
                    <td className="num"><OvrBadge value={p.overall} /></td>
                    <td style={{ width: 120 }}><Condition p={p} day={game.day} /></td>
                    <td className="num mono">{Math.round(p.morale)}</td>
                    <td className="num">
                      {used === 0
                        ? <span className="faint">—</span>
                        : <span style={{ color: used >= 2 ? 'var(--accent)' : 'var(--warn)' }}>
                            {used} 天（训练 −{Math.min(100, used * 25)}%）
                          </span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}
