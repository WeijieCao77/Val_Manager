import { useMemo, useState } from 'react'
import { useGame } from './ctx'
import ContractTerms from './ContractTerms'
import { Modal, OvrBadge, Panel, Roles, money, moneyFull } from './common'
import { askingPrice, committedFunds, makeOffer, windowOpen } from '../engine/transfer'
import { expectedSalary } from '../engine/player'
import { squadOf, wageBill } from '../engine/world'
import { defaultContract, REGION_CN, ROLES } from '../engine/types'
import type { Contract, Player, Role } from '../engine/types'

export default function Transfers() {
  const { game, commit, toast, openPlayer } = useGame()
  const me = game.teams[game.myTeam]
  const [tab, setTab] = useState<'free' | 'listed' | 'all'>('free')
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
            <span className="v sm" style={{ color: open ? 'var(--teal)' : 'var(--red)' }}>
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
                    {p.listed && <span className="tag" style={{ marginLeft: 6, borderColor: 'var(--gold)', color: 'var(--gold)' }}>挂牌</span>}
                  </td>
                  <td><Roles p={p} /></td>
                  <td className="num"><OvrBadge value={p.overall} /></td>
                  <td className="num muted">{p.potential}</td>
                  <td className="num">{p.age}</td>
                  <td className="small muted">{REGION_CN[p.region]}</td>
                  <td className="small muted">{p.teamId ? game.teams[p.teamId]?.name : '自由人'}</td>
                  <td className="num mono">{p.teamId ? money(askingPrice(p)) : '免签'}</td>
                  <td className="num mono">{money(expectedSalary(p, me.tier))}</td>
                  <td>
                    <button className="sm" disabled={!open} onClick={() => setTarget(p)}>报价</button>
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
          onSubmit={(fee, terms) => {
            const offer = makeOffer(game, target.id, game.myTeam, fee, terms)
            commit()
            toast(`报价已提交给 ${target.ign}，${(offer.respondOn ?? game.day) - game.day} 天后给你答复。`)
            setTarget(null)
          }}
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
        <span className="tag">潜力 {player.potential}</span>
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
