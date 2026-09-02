import { useMemo, useState } from 'react'
import { useGame } from './ctx'
import { logActivity } from '../engine/agenda'
import { useAction } from './useAction'
import ContractTerms, { OfferVerdict } from './ContractTerms'
import { Club, clubMatches, fmtDay, Modal, OvrBadge, Panel, Roles, money, moneyFull, Potential } from './common'
import {
  answerIncoming, askingPrice, committedFunds, enquireAbout, incomingOffers,
  INTEREST_CN, makeOffer, rosterBlock, TRANSFER_WINDOWS, windowBlock, windowOpen,
} from '../engine/transfer'
import { expectedSalary } from '../engine/player'
import { IMPORT_MAX, importCount, isImport } from '../engine/imports'
import { squadOf, wageBill } from '../engine/roster'
import { defaultContract, REGION_CN, ROLES } from '../engine/types'
import { REGIONS } from '../engine/types'
import type { Contract, Player, Role, Region } from '../engine/types'

export default function Transfers() {
  const { game, toast, openPlayer } = useGame()
  const act = useAction()
  // enquiries indexed by player, so each row knows what we have already asked
  const enq = new Map((game.enquiries ?? []).map((e) => [e.playerId, e]))
  const me = game.teams[game.myTeam]
  const [tab, setTab] = useState<'free' | 'listed' | 'all'>('free')
  const [askClub, setAskClub] = useState<string | null>(null)
  const [askRegion, setAskRegion] = useState<string>('all')
  // 按位置找人：不先挑俱乐部，而是先说要什么位置
  const [askRole, setAskRole] = useState<string>('')
  const [askMinOvr, setAskMinOvr] = useState<number>(0)
  const [role, setRole] = useState<Role | 'all'>('all')
  const [maxOvr, setMaxOvr] = useState(99)
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<Player | null>(null)

  const open = windowOpen(game.day)

  // What the rest of the market did lately, shown where the shopping happens:
  // a target who moved elsewhere should be old news by the time you look for
  // him. Our own business is excluded — incoming bids have their own panel
  // right above, and our signings were announced when we made them.
  const myName = me?.name ?? ''
  const marketNews = game.news
    .filter((n) => n.kind === 'transfer' &&
      !n.text.includes('我们') && (!myName || !n.text.includes(myName)))
    .slice(-8)
    .reverse()

  // 78 clubs as buttons filled the page before the enquiry itself; a region
  // picker plus a club picker is two clicks and no scrolling
  /**
   * Everyone in the world who plays a given position.
   *
   * The enquiry screen could only be worked club by club, which is the wrong
   * way round: a manager knows he needs a controller long before he knows who
   * has one. Ranked by ability, filtered by region and a floor, and it names
   * the club so the old flow is still one click away.
   */
  const roleHits = useMemo(() => {
    if (!askRole) return []
    return Object.values(game.players)
      .filter((p) => p.teamId && p.teamId !== game.myTeam)
      .filter((p) => (p.roles ?? [p.role]).includes(askRole as Role))
      .filter((p) => p.overall >= askMinOvr)
      .filter((p) => askRegion === 'all' || game.teams[p.teamId!]?.region === askRegion)
      .sort((a, b) => b.overall - a.overall)
      .slice(0, 40)
  }, [game.players, game.teams, game.myTeam, askRole, askMinOvr, askRegion])

  const askClubs = useMemo(
    () => Object.values(game.teams)
      .filter((t) => t.id !== game.myTeam && (askRegion === 'all' || t.region === askRegion))
      .sort((a, b) => b.reputation - a.reputation),
    [game.teams, game.myTeam, askRegion],
  )

  const pool = useMemo(() => {
    let list = Object.values(game.players).filter((p) => p.teamId !== game.myTeam)
    if (tab === 'free') list = list.filter((p) => p.teamId === null)
    else if (tab === 'listed') list = list.filter((p) => p.teamId !== null && p.listed)
    if (role !== 'all') list = list.filter((p) => p.role === role)
    list = list.filter((p) => p.overall <= maxOvr)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        // searching "EDG" must find EDward Gaming's players, and so must the
        // full name — people type whichever comes to mind
        (p) => p.ign.toLowerCase().includes(q) ||
          clubMatches(game.teams[p.teamId ?? ''], q),
      )
    }
    return list.sort((a, b) => b.overall - a.overall).slice(0, 120)
  }, [game, tab, role, maxOvr, search])

  const squad = squadOf(game, game.myTeam)
  const bill = wageBill(game, game.myTeam)
  const pending = game.offers.filter((o) => o.status === 'pending' && o.toTeam === game.myTeam)
  const committed = committedFunds(game)
  const incoming = incomingOffers(game)

  return (
    <>
      <div className="grid c4">
        <Panel>
          <div className="stat">
            <span className="k">可用资金</span>
            <span className="v">{money(game.finances.balance - committed)}</span>
          </div>
          {committed > 0 && (
            <div className="tiny faint">其中 {money(committed)} 已被待回应的报价占用</div>
          )}
        </Panel>
        <Panel><div className="stat"><span className="k">阵容人数</span><span className="v">{squad.length}</span></div></Panel>
        {game.importLimit && (
          <Panel><div className="stat"><span className="k">外援名额</span>
            <span className="v" style={importCount(game, game.myTeam) >= IMPORT_MAX ? { color: 'var(--warn)' } : undefined}>
              {importCount(game, game.myTeam)}/{IMPORT_MAX}
            </span></div></Panel>
        )}
        <Panel><div className="stat"><span className="k">赛季薪资</span><span className="v">{money(bill)}</span></div></Panel>
        <Panel>
          <div className="stat">
            <span className="k">转会窗口</span>
            <span className="v sm" style={{ color: open ? 'var(--win)' : 'var(--accent)' }}>
              {open ? '开启中' : '已关闭'}
            </span>
          </div>
        </Panel>
      </div>

      {!open && (
        <p className="small neg">
          转会窗口目前关闭：<b>不能再提出新的报价或问价，但已经在谈的照常进行</b>——
          对方仍会给你答复，窗口内下的报价谈成了照样成，别队对我们球员的报价也仍需你答复。
          开放时段：{TRANSFER_WINDOWS.map(([a, b]) => `第 ${a}–${b} 天`).join('、')}。
        </p>
      )}

      {/* An answered enquiry used to live only in the row it was asked from —
          inside a club's roster list, three clicks back — and the group chat
          asked where the next step was. It is here, at the top, with the bid
          button on it. */}
      {(() => {
        const answered = (game.enquiries ?? [])
          .filter((e) => e.answer === 'open')
          .map((e) => ({ e, p: game.players[e.playerId] }))
          .filter((x) => x.p && x.p.teamId && x.p.teamId !== game.myTeam)
          .sort((a, b) => b.e.replyOn - a.e.replyOn)
        const refused = (game.enquiries ?? [])
          .filter((e) => e.answer === 'closed')
          .map((e) => ({ e, p: game.players[e.playerId] }))
          .filter((x) => x.p)
        if (!answered.length && !refused.length) return null
        return (
          <Panel
            title={answered.length ? `问价有结果 · ${answered.length} 人可以报价` : '问价有结果 · 都不愿意来'}
            className={answered.length ? 'good' : ''} flush
          >
            {answered.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="sticky-name at-left">选手</th><th>俱乐部</th><th>位置</th>
                      <th className="num">能力</th><th className="num">俱乐部要价</th><th>本人意向</th>
                      <th className="sticky-act" />
                    </tr>
                  </thead>
                  <tbody>
                    {answered.map(({ e, p }) => {
                      const bid = game.offers.find((o) =>
                        o.playerId === p.id && o.status === 'pending' && o.toTeam === game.myTeam)
                      return (
                        <tr key={e.id}>
                          <td className="clickable sticky-name at-left" onClick={() => openPlayer(p.id)}>
                            <b>{p.ign}</b>
                            {p.retiring && <span className="tag warn" style={{ marginLeft: 5 }}>退役</span>}
                          </td>
                          <td className="small"><Club id={p.teamId} game={game} crest /></td>
                          <td><Roles p={p} /></td>
                          <td className="num"><OvrBadge value={p.overall} /></td>
                          <td className="num mono" style={{ color: 'var(--warn)', fontWeight: 700 }}>
                            {money(e.askingFee ?? askingPrice(p))}
                          </td>
                          <td className="small">
                            {e.interest ? <span className="tag">{INTEREST_CN[e.interest]}</span> : '—'}
                            {e.reason && <span className="tiny faint" style={{ marginLeft: 6 }}>{e.reason}</span>}
                          </td>
                          <td className="sticky-act">
                            {bid ? (
                              <span className="tiny faint">
                                已报价 · {Math.max(0, (bid.respondOn ?? game.day) - game.day)} 天后答复
                              </span>
                            ) : (
                              <button className="primary sm" disabled={!open} onClick={() => setTarget(p)}>报价</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {refused.length > 0 && (
              <p className="tiny faint" style={{ padding: '8px 13px', margin: 0 }}>
                本人不想来：{refused.map((x) => `${x.p.ign}（${x.e.reason ?? '不想转会'}）`).join('、')}
              </p>
            )}
          </Panel>
        )
      })()}

      {incoming.length > 0 && (
        <Panel title={`收到报价 · ${incoming.length} 份`} className="alert" flush>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="sticky-name at-left">我方选手</th><th className="hide-m">求购方</th><th className="num">转会费</th>
                  <th className="num hide-m">对方开价</th><th className="num hide-m">身价</th>
                  <th className="sticky-act" />
                </tr>
              </thead>
              <tbody>
                {incoming.map((o) => {
                  const p = game.players[o.playerId]
                  if (!p) return null
                  return (
                    <tr key={o.id}>
                      <td className="clickable sticky-name at-left" onClick={() => openPlayer(p.id)}>
                        <b>{p.ign}</b>
                        {p.listed && <span className="tag warn" style={{ marginLeft: 6 }}>挂牌</span>}
                        {!!p.grievance && p.grievance > 30 && (
                          <span className="tag warn" style={{ marginLeft: 6 }}>想走</span>
                        )}
                      </td>
                      <td className="small muted hide-m">{game.teams[o.toTeam]?.name}</td>
                      <td className="num mono pos">{money(o.fee)}</td>
                      <td className="num mono muted hide-m">{money(o.salary)}/年</td>
                      <td className="num mono muted hide-m">{money(p.value)}</td>
                      <td className="sticky-act">
                        <div className="row" style={{ gap: 6 }}>
                          <button className="primary sm" onClick={() => act('reply', () => {
                            logActivity(game, 'transfer', `接受了 ${game.teams[o.toTeam]?.name} 对 ${p.ign} 的报价`)
                            toast(answerIncoming(game, o.id, true))
                          })}>接受</button>
                          <button className="sm" onClick={() => act('reply', () => {
                            logActivity(game, 'transfer', `拒绝了 ${game.teams[o.toTeam]?.name} 对 ${p.ign} 的报价`)
                            toast(answerIncoming(game, o.id, false))
                          })}>拒绝</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="tiny faint" style={{ padding: '10px 13px', margin: 0 }}>
            拒绝一名想走的选手会加深他的不满。合同里写了解约金的，对方付到价可以直接带走，无需我们同意。
          </p>
        </Panel>
      )}

      {pending.length > 0 && (
        <Panel title={`等待回应 · ${pending.length} 份报价`} flush>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="sticky-name at-left">选手</th><th>现俱乐部</th><th className="num">转会费</th>
                  <th className="num">年薪</th><th className="num">还需等待</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((o) => {
                  const p = game.players[o.playerId]
                  const left = (o.respondOn ?? game.day) - game.day
                  return (
                    <tr key={o.id}>
                      <td className="sticky-name at-left"><b>{p?.ign ?? '—'}</b></td>
                      <td className="small muted">
                        <Club id={o.fromTeam} game={game} />
                      </td>
                      <td className="num mono">{money(o.fee)}</td>
                      <td className="num mono">{money(o.salary)}</td>
                      <td className="num mono">
                        {left > 0 ? `${left} 天` : '今日答复'}
                        {left > 0 && !windowOpen(o.respondOn ?? game.day) && (
                          <span className="tiny faint"> · 窗口已关</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="tiny faint" style={{ padding: '10px 13px', margin: 0 }}>
            报价期间资金已被预留，别的俱乐部也可能抢先签下目标。
          </p>
        </Panel>
      )}


      {marketNews.length > 0 && (
        <Panel title="市场动态 · 其他俱乐部的转会" flush>
          {marketNews.map((n, i) => (
            <div key={i} className={`news-item${n.important ? ' important' : ''}`}>
              <span className="d">{fmtDay(n.day, game.year)}</span>
              <span>{n.text}</span>
            </div>
          ))}
          <p className="tiny faint" style={{ padding: '8px 13px', margin: 0 }}>
            别的俱乐部也在市场上买人签人——盯上了谁就别等太久。
          </p>
        </Panel>
      )}

      <Panel tut="enquire" title="问价 · 找不在市场上的人">
        <p className="small muted" style={{ marginTop: 0 }}>
          想要的人多半不在市场上。问价花 1 点行动力、不花钱，2~5 天后得到<b>俱乐部要价</b>和<b>本人意向</b>，
          <b>有结果会显示在本页最上面</b>，直接在那里报价。
        </p>

        <div className="row wrap" style={{ gap: 8, marginBottom: 10, alignItems: 'center' }}>
          <select className="sm" style={{ width: 130, flex: '0 0 auto' }} value={askRegion}
            onChange={(e) => { setAskRegion(e.target.value); setAskClub(null) }}>
            <option value="all">全部赛区</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>{REGION_CN[r as Region]}</option>
            ))}
          </select>
          <select className="sm" style={{ width: 150, flex: '0 0 auto' }} value={askRole}
            onChange={(e) => { setAskRole(e.target.value); if (e.target.value) setAskClub(null) }}>
            <option value="">按位置找人…</option>
            {ROLES.filter((r) => r !== '自由人').map((r) => (
              <option key={r} value={r}>要一个{r}</option>
            ))}
          </select>
          {askRole && (
            <label className="tiny faint row" style={{ gap: 6, alignItems: 'center' }}>
              能力不低于
              <input
                type="number" className="sm" min={0} max={99} step={1}
                style={{ width: 66 }}
                value={askMinOvr || ''}
                placeholder="0"
                onChange={(e) => setAskMinOvr(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
              />
            </label>
          )}
          <select className="sm" style={{ flex: '1 1 240px', minWidth: 0, maxWidth: 420 }} value={askClub ?? ''}
            onChange={(e) => setAskClub(e.target.value || null)}>
            <option value="">选择俱乐部…</option>
            {askClubs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tag} · {t.name} — {t.tier === 2 ? '次级' : 'VCT'} · 声望 {t.reputation}
              </option>
            ))}
          </select>
          <span className="tiny faint">{askClubs.length} 支俱乐部</span>
        </div>

        {askRole ? (
          <div>
            <div className="row wrap" style={{ gap: 8, alignItems: 'baseline', marginBottom: 8 }}>
              <b>全世界的{askRole}</b>
              <span className="tag">{roleHits.length} 人{roleHits.length === 40 ? '（只列前 40）' : ''}</span>
              <span className="tiny faint">按能力排序 · 兼任这个位置的人也在内</span>
            </div>
            {roleHits.length === 0 ? (
              <p className="tiny faint" style={{ margin: 0 }}>没有符合条件的人，放宽能力下限或换个赛区试试。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="sticky-name at-left">选手</th>
                      <th>俱乐部</th><th>位置</th><th className="num">能力</th>
                      <th className="num hide-m">潜力</th><th className="num hide-m">年龄</th>
                      <th className="num hide-m">估值</th><th>问价结果</th><th className="sticky-act" />
                    </tr>
                  </thead>
                  <tbody>
                    {roleHits.map((p) => {
                      const e = enq.get(p.id)
                      const club = game.teams[p.teamId!]
                      return (
                        <tr key={p.id}>
                          <td className="clickable sticky-name at-left" onClick={() => openPlayer(p.id)}>
                            <b>{p.ign}</b>
                            {p.listed && <span className="tag warn" style={{ marginLeft: 5 }}>挂牌</span>}
                            {p.retiring && <span className="tag warn" style={{ marginLeft: 5 }} title="已宣布本赛季结束后退役——买他打不了几个月">退役</span>}
                          </td>
                          <td className="small">
                            <span className="clickable" onClick={() => { setAskRole(''); setAskClub(p.teamId!) }}>
                              <Club id={p.teamId} game={game} crest />
                            </span>
                          </td>
                          <td><Roles p={p} /></td>
                          <td className="num"><OvrBadge value={p.overall} /></td>
                          <td className="num hide-m"><Potential p={p} game={game} /></td>
                          <td className="num hide-m">{p.age}</td>
                          <td className="num mono faint hide-m">{money(askingPrice(p))}</td>
                          <td className="small">
                            {e?.askingFee ? (
                              <span style={{ color: 'var(--warn)' }}>要价 {money(e.askingFee)}</span>
                            ) : e && !e.answer ? (
                              <span className="tiny faint">问价中（{Math.max(0, e.replyOn - game.day)} 天）</span>
                            ) : <span className="tiny faint">未问价</span>}
                          </td>
                          <td className="sticky-act">
                            <button className="sm" disabled={!!e || !open} onClick={() => act('offer', () => {
                              toast(enquireAbout(game, p.id))
                              logActivity(game, 'transfer', `就 ${p.ign} 向 ${club?.name} 问价`)
                            })}>问价</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : !askClub ? (
          <p className="tiny faint" style={{ margin: 0 }}>
            选一支俱乐部列出他们的全部选手，或者用上面的「按位置找人」直接横扫全世界。
          </p>
        ) : (() => {
          const club = game.teams[askClub]
          const roster = squadOf(game, askClub)
          return (
            <div>
              <div className="row wrap" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <b>{club?.name}</b>
                <span className="tag">声望 {club?.reputation}</span>
                <span className="tag">{roster.length} 人</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="sticky-name at-left">选手</th>
                      <th>位置</th><th className="num">能力</th>
                      <th className="num hide-m">潜力</th><th className="num hide-m">年龄</th>
                      <th className="num hide-m">估值</th><th>问价结果</th><th className="sticky-act" />
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((p) => {
                      const e = enq.get(p.id)
                      const starter = club?.starters.includes(p.id)
                      return (
                        <tr key={p.id}>
                          <td className="clickable sticky-name at-left" onClick={() => openPlayer(p.id)}>
                            <b>{p.ign}</b>
                            {starter && <span className="tag" style={{ marginLeft: 5 }}>首发</span>}
                            {p.listed && <span className="tag warn" style={{ marginLeft: 5 }}>挂牌</span>}
                            {p.retiring && <span className="tag warn" style={{ marginLeft: 5 }} title="已宣布本赛季结束后退役——买他打不了几个月">退役</span>}
                          </td>
                          <td><Roles p={p} /></td>
                          <td className="num"><OvrBadge value={p.overall} /></td>
                          <td className="num hide-m"><Potential p={p} game={game} /></td>
                          <td className="num hide-m">{p.age}</td>
                          <td className="num mono faint hide-m">{money(askingPrice(p))}</td>
                          <td className="small">
                            {e?.askingFee ? (
                              <span>
                                <span style={{ color: 'var(--warn)' }}>俱乐部要价 {money(e.askingFee)}</span>
                                {e.interest && (
                                  <span className="tag" style={{ marginLeft: 6 }}>
                                    选手本人{INTEREST_CN[e.interest]}
                                  </span>
                                )}
                              </span>
                            ) : e && !e.answer ? (
                              <span className="tiny faint">等待答复（{Math.max(0, e.replyOn - game.day)} 天）</span>
                            ) : e?.answer === 'closed' ? (
                              <span className="tiny faint">选手本人拒绝：{e.reason ?? '不想转会'}</span>
                            ) : <span className="tiny faint">未问价</span>}
                          </td>
                          <td className="sticky-act">
                            {e?.answer === 'open' || p.listed ? (
                              <button className="sm" disabled={!open} onClick={() => setTarget(p)}>报价</button>
                            ) : e ? null : (
                              <button className="sm" disabled={!open} onClick={() => act('offer', () => {
                                toast(enquireAbout(game, p.id))
                                logActivity(game, 'transfer', `就 ${p.ign} 向 ${club?.name} 问价`)
                              })}>问价</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}
      </Panel>

      <Panel
        title="转会市场"
        actions={
          <div className="row wrap" style={{ gap: 8 }}>
            <div className="seg">
              <button className={tab === 'free' ? 'on' : ''} onClick={() => setTab('free')}>自由人</button>
              <button className={tab === 'listed' ? 'on' : ''} onClick={() => setTab('listed')}>挂牌</button>
              <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>全部</button>
            </div>
            <select value={role} onChange={(e) => setRole(e.target.value as Role | 'all')} style={{ width: 110, padding: '5px 8px', fontSize: 12 }}>
              <option value="all">全部位置</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索选手 / 战队" style={{ width: 150, padding: '5px 8px', fontSize: 12 }}
            />
          </div>
        }
        flush
      >
        <div className="row" style={{ gap: 10, padding: '10px 14px' }}>
          <span className="small muted" style={{ whiteSpace: 'nowrap' }}>能力上限 {maxOvr}</span>
          <input type="range" min={40} max={99} value={maxOvr} onChange={(e) => setMaxOvr(Number(e.target.value))} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="sticky-name at-left">选手</th>
                <th>位置</th><th className="num">能力</th><th className="num hide-m">潜力</th>
                <th className="num hide-m">年龄</th><th className="hide-m">赛区</th><th className="hide-m">现俱乐部</th>
                <th className="num hide-m">身价</th><th className="num">期望年薪</th><th className="sticky-act" />
              </tr>
            </thead>
            <tbody>
              {pool.map((p) => (
                <tr key={p.id}>
                  <td className="clickable sticky-name at-left" onClick={() => openPlayer(p.id)}>
                    <b>{p.ign}</b>
                    {p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>IGL</span>}
                    {game.importLimit && isImport(p, me) && (
                      <span className="tag warn" style={{ marginLeft: 6 }} title="来自其他赛区，占用外援名额">外援</span>
                    )}
                    {p.listed && <span className="tag" style={{ marginLeft: 6, borderColor: 'var(--warn)', color: 'var(--warn)' }}>挂牌</span>}
                  </td>
                  <td><Roles p={p} /></td>
                  <td className="num"><OvrBadge value={p.overall} /></td>
                  <td className="num hide-m"><Potential p={p} game={game} /></td>
                  <td className="num hide-m">{p.age}</td>
                  <td className="small muted hide-m">{REGION_CN[p.region]}</td>
                  <td className="small muted hide-m"><Club id={p.teamId} game={game} /></td>
                  <td className="num mono hide-m">
                    {(() => {
                      const e = enq.get(p.id)
                      if (!p.teamId) return '免签'
                      // once you have asked, show what they actually want
                      if (e?.askingFee) {
                        return (
                          <span title="对方俱乐部的实际要价" style={{ color: 'var(--warn)' }}>
                            {money(e.askingFee)}
                          </span>
                        )
                      }
                      return <span className="faint">{money(askingPrice(p))}</span>
                    })()}
                  </td>
                  <td className="num mono">{money(expectedSalary(p, me.tier))}</td>
                  <td className="sticky-act">
                    {(() => {
                      const e = enq.get(p.id)
                      // free agents and listed players are already on the market
                      const onMarket = !p.teamId || p.listed
                      if (onMarket || e?.answer === 'open') {
                        return (
                          <div className="row" style={{ gap: 5 }}>
                            {e?.interest && (
                              <span className="tag" title={e.reason ?? ''}>
                                选手本人{INTEREST_CN[e.interest]}
                              </span>
                            )}
                            <button className="sm" disabled={!open} onClick={() => setTarget(p)}>报价</button>
                          </div>
                        )
                      }
                      if (e && !e.answer) {
                        return <span className="tiny faint">问价中（{Math.max(0, e.replyOn - game.day)} 天）</span>
                      }
                      if (e?.answer === 'closed') {
                        return <span className="tiny faint">选手本人拒绝：{e.reason ?? '不想转会'}</span>
                      }
                      // enquiries are made club-first in the panel above
                      return <span className="tiny faint">去上面「问价」按俱乐部找</span>
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pool.length === 0 && <div className="empty">没有符合条件的选手。</div>}
        </div>
      </Panel>

      {target && (
        <OfferModal
          player={target}
          onClose={() => setTarget(null)}
          onSubmit={(fee, terms) => act('offer', () => {
            const offer = makeOffer(game, target.id, game.myTeam, fee, terms)
            if (!offer) {
              toast(windowBlock(game) ?? rosterBlock(game, game.myTeam) ?? '现在不能报价。')
              setTarget(null)
              return
            }
            logActivity(game, 'transfer', `向 ${target.ign} 提交报价（转会费 ${money(fee)}，年薪 ${money(terms.salary)}）`)
            const wait = (offer.respondOn ?? game.day) - game.day
            // a club takes 7-10 days to answer, so a bid made on the last turn
            // of a window is answered after it has shut: the deal still goes
            // through, but there is no second bid if they say no
            const full = rosterBlock(game, game.myTeam)
            toast((windowOpen(offer.respondOn ?? game.day)
              ? `报价已提交给 ${target.ign}，${wait} 天后给你答复。`
              : `报价已提交给 ${target.ign}，${wait} 天后答复——那时窗口已关，成了照样成，` +
                `但被拒就没机会补价了。`)
              + (full ? ` 注意：名单已满（7/7），答复前先放走一人，否则交易会被取消。` : ''))
            setTarget(null)
          })}
        />
      )}
    </>
  )
}

function OfferModal({
  player, onClose, onSubmit,
}: {
  player: Player; onClose: () => void
  onSubmit: (fee: number, terms: Contract) => void
}) {
  const { game } = useGame()
  const me = game.teams[game.myTeam]
  const ask = player.teamId ? askingPrice(player) : 0
  const want = expectedSalary(player, me.tier)
  const [fee, setFee] = useState(ask)
  const [terms, setTerms] = useState<Contract>(() =>
    defaultContract(Math.round(want * 1.05), 2))

  const upfront = fee + terms.signingBonus
  const afford = upfront <= game.finances.balance
  const feeOk = !player.teamId || fee >= ask * 0.85

  return (
    <Modal title={`向 ${player.ign} 报价`} onClose={onClose}>
      <div className="row wrap" style={{ gap: 10, marginBottom: 14 }}>
        <Roles p={player} />
        <OvrBadge value={player.overall} />
        <span className="tag">潜力 <Potential p={player} game={game} /></span>
        <span className="tag">{player.age} 岁</span>
        <span className="tag">{REGION_CN[player.region]}</span>
        <span className="tag">{player.teamId ? game.teams[player.teamId]?.name : '自由人'}</span>
      </div>

      {player.teamId && (
        <div style={{ marginBottom: 14 }}>
          <label className="small muted">转会费（对方要价约 {moneyFull(ask)}）</label>
          <input
            type="number" value={fee} min={0} step={10000}
            onChange={(e) => setFee(Math.max(0, Number(e.target.value)))}
          />
          {!feeOk && <div className="tiny neg">低于对方心理价位，很可能被拒绝。</div>}
          {player.contract?.noPoach && (
            <div className="tiny neg">该选手合同含转会限制条款，原俱乐部可以直接拒绝。</div>
          )}
          {!!player.contract?.releaseClause && (
            <div className="tiny pos">
              解约金 {moneyFull(player.contract.releaseClause)} —— 出到这个价对方必须放人。
            </div>
          )}
        </div>
      )}

      <ContractTerms terms={terms} onChange={setTerms} want={want} />
      <OfferVerdict state={game} player={player} team={me} terms={terms} />

      {!afford && (
        <div className="tiny neg" style={{ marginTop: 10 }}>
          资金不足：需要立刻支付 {moneyFull(upfront)}，你只有 {moneyFull(game.finances.balance)}。
        </div>
      )}

      <div className="row" style={{ gap: 10, marginTop: 18 }}>
        <button className="primary" disabled={!afford} onClick={() => onSubmit(fee, terms)}>
          提交报价
        </button>
        <button onClick={onClose}>取消</button>
        <span className="right tiny muted">
          立即支付 {moneyFull(upfront)} · 合同总额 {moneyFull(terms.salary * terms.years)}
        </span>
      </div>
    </Modal>
  )
}
