import { useState } from 'react'
import { useGame } from './ctx'
import { Condition, fmtDay, money, OvrBadge, Panel, Stat } from './common'
import {
  bookGig, cancelGig, declineSponsor, endStream, freeDays, openGigs, pitchSponsor,
  signSponsor, signStream, startVenture, streamOffer, ventureInfo,
} from '../engine/commercial'
import { logActivity } from '../engine/agenda'
import { useAction } from './useAction'
import { canAct, NO_ACTIONS_LEFT, spendAction } from '../engine/actions'
import { squadOf } from '../engine/world'
import type { Gig, VentureKind } from '../engine/types'

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
  const act = useAction()
  const [picking, setPicking] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [gigDay, setGigDay] = useState<number | null>(null)
  const [venture, setVenture] = useState<VentureKind | null>(null)
  const [vChosen, setVChosen] = useState<string[]>([])
  const squad = squadOf(game, game.myTeam)
  const gigs = openGigs(game)

  const start = (g: Gig) => {
    setPicking(g.id)
    setChosen(g.attendees ?? [])
    setGigDay(freeDays(game, g)[0] ?? null)
  }

  const toggle = (id: string, heads: number) => {
    setChosen((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-heads),
    )
  }

  const confirm = (g: Gig) => {
    if (!canAct(game)) { toast(NO_ACTIONS_LEFT); return }
    const msg = bookGig(game, g.id, chosen, gigDay ?? undefined)
    if (g.accepted) spendAction(game, 'gig')
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
        {/* gig fees only — "已签约收入" read as though it covered sponsorship,
            which is on the finance page and is an order of magnitude larger */}
        <Panel><Stat k="已接活动收入" v={money(bookedFee)} /></Panel>
        <Panel><Stat k="俱乐部声望" v={`${Math.round(game.teams[game.myTeam]?.reputation ?? 0)}`} /></Panel>
      </div>

      <Panel title="主动出击">
        <p className="small muted" style={{ marginTop: 0 }}>
          不必干等着别人来找。你可以自己去谈赞助，也可以自己办活动——办活动要<b>先垫钱</b>，
          回本与否取决于<b>俱乐部声望</b>（上座率）：豪门大概六七成场次赚钱，
          小球队多半亏。<b>线下训练营是唯一注定亏钱的</b>，它买的是体能和士气，不是收入。
        </p>

        <div className="row wrap" style={{ gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <button
            className="primary sm"
            disabled={game.pitchCooldown != null && game.pitchCooldown > game.day}
            onClick={() => act('sponsor', () => {
              toast(pitchSponsor(game)); logActivity(game, 'commercial', '拜访潜在赞助商')
            })}
          >
            去谈一家赞助商
          </button>
          <span className="tiny faint">
            {game.pitchCooldown != null && game.pitchCooldown > game.day
              ? `${(game.pitchCooldown ?? 0) - game.day} 天后可以再谈`
              : '免费，每 14 天一轮。3 天后对方给出具体条件，你再决定签不签'}
          </span>
        </div>

        {(game.sponsorTalks ?? []).filter((t) => t.answer === 'offer').map((t) => (
          <div key={t.id} className="drill-card own" style={{ marginBottom: 12 }}>
            <div className="row wrap" style={{ gap: 8, alignItems: 'baseline' }}>
              <b style={{ fontSize: 15 }}>{t.name}</b>
              <span className="tag">{t.industry}</span>
            </div>
            <div className="row wrap" style={{ gap: 8, margin: '8px 0' }}>
              <span className="tag" style={{ borderColor: 'var(--win)', color: 'var(--win)' }}>
                保底 {money(t.base)}/赛季
              </span>
              <span className="tag">前 {t.bonusPlacement} 名另奖 {money(t.bonus)}</span>
            </div>
            <div className="tiny muted" style={{ marginBottom: 8 }}>
              {t.demands.length ? (
                <>对方要求：{t.demands.map((d) => d.text).join('；')}。<b>要求越多，保底越高。</b></>
              ) : '没有附加要求，保底也相应低一些。'}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="primary sm" onClick={() => {
                toast(signSponsor(game, t.id))
                logActivity(game, 'commercial', `签下赞助商 ${t.name}`)
                commit()
              }}>签下</button>
              <button className="sm ghost" onClick={() => { toast(declineSponsor(game, t.id)); commit() }}>
                拒绝
              </button>
            </div>
          </div>
        ))}
        {(game.sponsorTalks ?? []).some((t) => !t.answer && t.replyOn > game.day) && (
          <div className="small" style={{ marginBottom: 12, color: 'var(--warn)' }}>
            ⏳ 正在等待赞助商给出方案（{Math.max(0, Math.min(...(game.sponsorTalks ?? [])
              .filter((t) => !t.answer && t.replyOn > game.day).map((t) => t.replyOn - game.day)))} 天）
          </div>
        )}

        <div className="grid c2" style={{ gap: 12 }}>
          {(['openday', 'bootcamp', 'watchparty', 'merch'] as VentureKind[]).map((k) => {
            const v = ventureInfo(k)
            const need = Math.min(v.heads, squad.length)
            const active = venture === k
            const pending = (game.ventures ?? []).find((x) => x.kind === k)
            return (
              <div key={k} className={`drill-card${pending ? ' own' : ''}`}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <b>{v.label}</b>
                  <span className="mono tiny" style={{ color: 'var(--warn)' }}>−{money(v.cost)}</span>
                </div>
                <p className="tiny faint" style={{ margin: '6px 0' }}>{v.blurb}</p>
                <div className="row wrap tiny" style={{ gap: 6, marginBottom: 8 }}>
                  <span className="tag">{need} 人参与</span>
                  <span className="tag">{v.fatigue < 0 ? `体能 +${-v.fatigue}` : `体能 −${v.fatigue}`}</span>
                  <span className="tag">士气 +{v.morale}</span>
                </div>
                {pending ? (
                  <div className="tiny">筹备中，{pending.day - game.day} 天后举办</div>
                ) : active ? (
                  <div>
                    <div className="tiny muted" style={{ marginBottom: 5 }}>
                      选 {need} 人（已选 {vChosen.length}）：
                    </div>
                    <div className="row wrap" style={{ gap: 5, marginBottom: 8 }}>
                      {squad.map((p) => (
                        <button key={p.id} className={`sm${vChosen.includes(p.id) ? ' primary' : ''}`}
                          onClick={() => setVChosen((c) =>
                            c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id].slice(-need))}>
                          {p.ign}
                        </button>
                      ))}
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="primary sm" disabled={vChosen.length !== need}
                        onClick={() => act('venture', () => {
                          toast(startVenture(game, k, vChosen))
                          logActivity(game, 'commercial', `筹备${v.label}`)
                          setVenture(null); setVChosen([])
                        })}>确认举办</button>
                      <button className="sm ghost" onClick={() => { setVenture(null); setVChosen([]) }}>取消</button>
                    </div>
                  </div>
                ) : (
                  <button className="sm" disabled={game.finances.balance < v.cost}
                    onClick={() => { setVenture(k); setVChosen(squad.slice(0, need).map((p) => p.id)) }}>
                    {game.finances.balance < v.cost ? '资金不足' : '开始筹备'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="商务邀约">
        <p className="small muted" style={{ marginTop: 0 }}>
          <b>直播合同</b>按 <b>2~3 个月</b>一签，到期自动结束、可以重新谈——平台不会跟一名选手
          锁一整年。签约期间是稳定的被动收入，但每周的直播夜会持续消耗体能；每周 3 晚以上
          还会占掉一天训练。<br />
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
                  <span className="tag">
                    {g.accepted
                      ? (days <= 0 ? '就在今天' : `${days} 天后`)
                      : `${days}~${(g.windowEnd ?? g.day) - game.day} 天内可安排`}
                  </span>
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
                    <div className="tiny muted" style={{ marginBottom: 5 }}>选日期：</div>
                    <div className="row wrap" style={{ gap: 5, marginBottom: 8 }}>
                      {freeDays(game, g).map((d) => (
                        <button key={d} className={`sm${gigDay === d ? ' primary' : ''}`}
                          onClick={() => setGigDay(d)}>
                          {fmtDay(d)}
                          <span className="tiny faint"> {d - game.day}天后</span>
                        </button>
                      ))}
                      {freeDays(game, g).length === 0 && (
                        <span className="tiny" style={{ color: 'var(--accent)' }}>
                          这段时间每天都有比赛，接不了
                        </span>
                      )}
                    </div>
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
                      <button className="primary sm"
                        disabled={chosen.length !== g.heads || gigDay === null}
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
                <th className="num">士气</th><th className="num">本周商务占用</th><th>直播合同</th>
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
                        ? <span className="faint" title="本周没有参加任何商务活动">未占用</span>
                        : <span style={{ color: used >= 2 ? 'var(--accent)' : 'var(--warn)' }}>
                            占用 {used} 天 · 本周训练 −{Math.min(100, used * 25)}%
                          </span>}
                    </td>
                    <td>
                      {p.stream ? (
                        <div className="row" style={{ gap: 6 }}>
                          <span className="tag">{p.stream.platform}</span>
                          <span className="tiny mono">
                            {money(p.stream.fee)}
                            {p.stream.months ? ` / ${p.stream.months} 个月` : ' / 赛季'}
                            {' · '}每周 {p.stream.nights} 晚
                            {p.stream.until != null && (
                              <span className="faint"> · 还剩 {Math.max(0, p.stream.until - game.day)} 天</span>
                            )}
                          </span>
                          <button className="sm ghost" onClick={() => {
                            toast(endStream(game, p.id))
                            logActivity(game, 'commercial', `终止 ${p.ign} 的直播合同`)
                            commit()
                          }}>终止</button>
                        </div>
                      ) : (() => {
                        const o = streamOffer(game, p.id)
                        if (!o) return <span className="tiny faint">暂无平台接洽</span>
                        return (
                          <div className="row" style={{ gap: 6 }}>
                            <span className="tiny faint">
                              {o.platform} 出价 {money(o.fee)} / {o.months} 个月 · 每周 {o.nights} 晚
                            </span>
                            <button className="sm" onClick={() => act('stream', () => {
                              toast(signStream(game, p.id))
                              logActivity(game, 'commercial', `${p.ign} 签下直播合同`)
                            })}>签约</button>
                          </div>
                        )
                      })()}
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
