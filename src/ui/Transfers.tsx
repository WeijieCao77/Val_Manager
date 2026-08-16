import { useMemo, useState } from 'react'
import { useGame } from './ctx'
import { logActivity } from '../engine/agenda'
import { useAction } from './useAction'
import ContractTerms, { OfferVerdict } from './ContractTerms'
import { Modal, OvrBadge, Panel, Roles, money, moneyFull, Potential } from './common'
import {
  answerIncoming, askingPrice, committedFunds, enquireAbout, incomingOffers,
  INTEREST_CN, makeOffer, windowOpen,
} from '../engine/transfer'
import { expectedSalary } from '../engine/player'
import { squadOf, wageBill } from '../engine/world'
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
  const [role, setRole] = useState<Role | 'all'>('all')
  const [maxOvr, setMaxOvr] = useState(99)
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<Player | null>(null)

  const open = windowOpen(game.day)

  const pool = useMemo(() => {
    let list = Object.values(game.players).filter((p) => p.teamId !== game.myTeam)
    if (tab === 'free') list = list.filter((p) => p.teamId === null)
    else if (tab === 'listed') list = list.filter((p) => p.teamId !== null && p.listed)
    if (role !== 'all') list = list.filter((p) => p.role === role)
    list = list.filter((p) => p.overall <= maxOvr)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (p) => p.ign.toLowerCase().includes(q) ||
          (game.teams[p.teamId ?? '']?.name ?? '').toLowerCase().includes(q),
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
          转会窗口目前关闭。开放时段：季前准备（第 0–20 天）、Masters II 期间（第 169–194 天）、休赛期（第 311 天起）。
        </p>
      )}

      {incoming.length > 0 && (
        <Panel title={`收到报价 · ${incoming.length} 份`} className="alert" flush>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>我方选手</th><th>求购方</th><th className="num">转会费</th>
                  <th className="num">对方开价</th><th className="num">身价</th><th />
                </tr>
              </thead>
              <tbody>
                {incoming.map((o) => {
                  const p = game.players[o.playerId]
                  if (!p) return null
                  return (
                    <tr key={o.id}>
                      <td className="clickable" onClick={() => openPlayer(p.id)}>
                        <b>{p.ign}</b>
                        {p.listed && <span className="tag warn" style={{ marginLeft: 6 }}>挂牌</span>}
                        {!!p.grievance && p.grievance > 30 && (
                          <span className="tag warn" style={{ marginLeft: 6 }}>想走</span>
                        )}
                      </td>
                      <td className="small muted">{game.teams[o.toTeam]?.name}</td>
                      <td className="num mono pos">{money(o.fee)}</td>
                      <td className="num mono muted">{money(o.salary)}/年</td>
                      <td className="num mono muted">{money(p.value)}</td>
                      <td>
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
                  <th>选手</th><th>现俱乐部</th><th className="num">转会费</th>
                  <th className="num">年薪</th><th className="num">还需等待</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((o) => {
                  const p = game.players[o.playerId]
                  const left = (o.respondOn ?? game.day) - game.day
                  return (
                    <tr key={o.id}>
                      <td><b>{p?.ign ?? '—'}</b></td>
                      <td className="small muted">
                        {o.fromTeam ? game.teams[o.fromTeam]?.name : '自由人'}
                      </td>
                      <td className="num mono">{money(o.fee)}</td>
                      <td className="num mono">{money(o.salary)}</td>
                      <td className="num mono">{left > 0 ? `${left} 天` : '今日答复'}</td>
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


      <Panel title="问价 · 找不在市场上的人">
        <p className="small muted" style={{ marginTop: 0 }}>
          真正想要的人多半既没挂牌也不是自由人。<b>先选一支俱乐部，再挑他们的选手问价</b>——
          花 1 点行动力、不花钱，2~5 天后同时得到<b>对方的真实要价</b>和<b>本人的意向</b>。
          核心球员的要价可能是估值的一倍以上。
        </p>

        <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
          <div className="seg">
            {['all', ...REGIONS].map((r) => (
              <button key={r} className={askRegion === r ? 'on' : ''}
                onClick={() => { setAskRegion(r); setAskClub(null) }}>
                {r === 'all' ? '全部赛区' : REGION_CN[r as Region]}
              </button>
            ))}
          </div>
        </div>

        {!askClub ? (
          <div className="row wrap" style={{ gap: 6 }}>
            {Object.values(game.teams)
              .filter((t) => t.id !== game.myTeam && (askRegion === 'all' || t.region === askRegion))
              .sort((a, b) => b.reputation - a.reputation)
              .map((t) => (
                <button key={t.id} className="sm" onClick={() => setAskClub(t.id)}>
                  {t.name}
                  <span className="tiny faint"> · {t.tier === 1 ? '一级' : '次级'}</span>
                </button>
              ))}
          </div>
        ) : (() => {
          const club = game.teams[askClub]
          const roster = squadOf(game, askClub)
          return (
            <div>
              <div className="row wrap" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <button className="sm ghost" onClick={() => setAskClub(null)}>← 换一支俱乐部</button>
                <b>{club?.name}</b>
                <span className="tag">声望 {club?.reputation}</span>
                <span className="tag">{roster.length} 人</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>选手</th><th>位置</th><th className="num">能力</th>
                      <th className="num">潜力</th><th className="num">年龄</th>
                      <th className="num">估值</th><th>问价结果</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((p) => {
                      const e = enq.get(p.id)
                      const starter = club?.starters.includes(p.id)
                      return (
                        <tr key={p.id}>
                          <td className="clickable" onClick={() => openPlayer(p.id)}>
                            <b>{p.ign}</b>
                            {starter && <span className="tag" style={{ marginLeft: 5 }}>首发</span>}
                            {p.listed && <span className="tag warn" style={{ marginLeft: 5 }}>挂牌</span>}
                          </td>
                          <td><Roles p={p} /></td>
                          <td className="num"><OvrBadge value={p.overall} /></td>
                          <td className="num"><Potential p={p} game={game} /></td>
                          <td className="num">{p.age}</td>
                          <td className="num mono faint">{money(askingPrice(p))}</td>
                          <td className="small">
                            {e?.askingFee ? (
                              <span>
                                <span style={{ color: 'var(--warn)' }}>要价 {money(e.askingFee)}</span>
                                {e.interest && <span className="tag" style={{ marginLeft: 6 }}>{INTEREST_CN[e.interest]}</span>}
                              </span>
                            ) : e && !e.answer ? (
                              <span className="tiny faint">等待答复（{Math.max(0, e.replyOn - game.day)} 天）</span>
                            ) : e?.answer === 'closed' ? (
                              <span className="tiny faint">{e.reason ?? '对方无意出售'}</span>
                            ) : <span className="tiny faint">未问价</span>}
                          </td>
                          <td>
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
                <th>选手</th><th>位置</th><th className="num">能力</th><th className="num">潜力</th>
                <th className="num">年龄</th><th>赛区</th><th>现俱乐部</th>
                <th className="num">身价</th><th className="num">期望年薪</th><th />
              </tr>
            </thead>
            <tbody>
              {pool.map((p) => (
                <tr key={p.id}>
                  <td className="clickable" onClick={() => openPlayer(p.id)}>
                    <b>{p.ign}</b>
                    {p.isIgl && <span className="tag" style={{ marginLeft: 6 }}>IGL</span>}
                    {p.listed && <span className="tag" style={{ marginLeft: 6, borderColor: 'var(--warn)', color: 'var(--warn)' }}>挂牌</span>}
                  </td>
                  <td><Roles p={p} /></td>
                  <td className="num"><OvrBadge value={p.overall} /></td>
                  <td className="num"><Potential p={p} game={game} /></td>
                  <td className="num">{p.age}</td>
                  <td className="small muted">{REGION_CN[p.region]}</td>
                  <td className="small muted">{p.teamId ? game.teams[p.teamId]?.name : '自由人'}</td>
                  <td className="num mono">
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
                  <td>
                    {(() => {
                      const e = enq.get(p.id)
                      // free agents and listed players are already on the market
                      const onMarket = !p.teamId || p.listed
                      if (onMarket || e?.answer === 'open') {
                        return (
                          <div className="row" style={{ gap: 5 }}>
                            {e?.interest && (
                              <span className="tag" title={e.reason ?? ''}>
                                {INTEREST_CN[e.interest]}
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
                        return <span className="tiny faint">{e.reason ?? '对方无意出售'}</span>
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
            logActivity(game, 'transfer', `向 ${target.ign} 提交报价（转会费 ${money(fee)}，年薪 ${money(terms.salary)}）`)
            toast(`报价已提交给 ${target.ign}，${(offer.respondOn ?? game.day) - game.day} 天后给你答复。`)
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
