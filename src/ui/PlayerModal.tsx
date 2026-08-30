import { useState } from 'react'
import { AgentIcon, Bar, Modal, OvrBadge, Radar, Roles, Traits, money, moneyFull, Potential } from './common'
import ContractTerms, { OfferVerdict } from './ContractTerms'
import { Rng, hashStr } from '../engine/rng'
import { playerAcceptsTerms } from '../engine/transfer'
import { SQUAD_ROLE_CN, defaultContract } from '../engine/types'
import type { Contract } from '../engine/types'
import { useGame } from './ctx'
import { NO_ACTIONS_LEFT, spendAction } from '../engine/actions'
import { logActivity } from '../engine/agenda'
import { appointIgl } from '../engine/world'
import { ratingOf } from '../engine/match'
import { expectedSalary, statLine } from '../engine/player'
import { askingPrice } from '../engine/transfer'
import { ATTR_CN, ATTR_KEYS, REGION_CN } from '../engine/types'
import { agentCn } from '../engine/content'
import type { Stats } from '../engine/types'

export default function PlayerModal(
  { playerId, onClose, startRenewing = false }:
  { playerId: string; onClose: () => void; startRenewing?: boolean },
) {
  const { game, commit, toast } = useGame()
  const p = game.players[playerId]
  if (!p) return null
  const team = p.teamId ? game.teams[p.teamId] : null
  const mine = p.teamId === game.myTeam
  const me = game.teams[game.myTeam]

  const want = expectedSalary(p, me.tier)
  const [renewing, setRenewing] = useState(startRenewing)
  const [terms, setTerms] = useState<Contract>(() => ({
    ...(p.contract ?? defaultContract(p.salary || want, 2)),
    salary: Math.round((p.salary || want) * 1.08),
    years: 2,
  }))

  const submitRenewal = () => {
    const rng = new Rng(hashStr(`renew:${game.seed}:${p.id}:${game.day}`))
    const verdict = playerAcceptsTerms(game, p, me, terms, rng)
    if (!verdict.ok) {
      toast(verdict.reason ?? `${p.ign} 拒绝了这份续约。`)
      return
    }
    p.contract = { ...terms }
    p.salary = terms.salary
    p.contractYears = terms.years
    p.grievance = 0
    p.morale = Math.min(100, p.morale + 8)
    if (terms.signingBonus > 0) {
      game.finances.balance -= terms.signingBonus
      game.finances.log.push({ day: game.day, label: `续约签字费 ${p.ign}`, amount: -terms.signingBonus })
    }
    commit()
    setRenewing(false)
    logActivity(game, 'transfer', `与 ${p.ign} 续约 ${terms.years} 年（年薪 ${money(terms.salary)}）`)
    toast(`${p.ign} 续约 ${terms.years} 年。`)
  }

  const toggleList = () => {
    if (!spendAction(game, 'list')) { toast(NO_ACTIONS_LEFT); return }
    p.listed = !p.listed
    commit()
    logActivity(game, 'transfer', p.listed ? `将 ${p.ign} 挂牌出售` : `取消 ${p.ign} 的挂牌`)
    toast(p.listed ? `${p.ign} 已挂牌，其他俱乐部会来问价。` : `已取消 ${p.ign} 的挂牌。`)
  }

  return (
    <Modal
      wide
      title={
        <span className="row" style={{ gap: 10 }}>
          <span>{p.ign}</span>
          <Roles p={p} />
          <OvrBadge value={p.overall} />
          {p.isIgl && <span className="tag">IGL</span>}
        </span>
      }
      onClose={onClose}
    >
      <div className="grid c2" style={{ marginBottom: 14 }}>
        <div>
          {(p.realName || p.nat) && (
            <div className="small muted" style={{ marginBottom: 8 }}>
              {p.realName}
              {p.realName && p.nat ? ' · ' : ''}
              {p.nat ? p.nat.toUpperCase() : ''}
            </div>
          )}
          <div className="row wrap" style={{ gap: 7, marginBottom: 12 }}>
            <span className="tag">{team?.name ?? '自由人'}</span>
            <span className="tag">{REGION_CN[p.region]}</span>
            <span className="tag" title={p.birth ? `生日 ${p.birth}` : '未收录生日，年龄为推算值'}>
              {p.age} 岁{p.ageEstimated ? '（推算）' : ''}
            </span>
            <span className="tag">潜力 <Potential p={p} game={game} /></span>
            {p.injuredUntil > game.day && (
              <span className="tag warn">⚕ {p.injuryNote}（{p.injuredUntil - game.day} 天）</span>
            )}
            {p.listed && <span className="tag warn">已挂牌</span>}
          </div>
          {p.traits?.length ? (
            <div style={{ marginBottom: 12 }}>
              <Traits traits={p.traits} />
            </div>
          ) : null}

          {ATTR_KEYS.map((k) => (
            <div key={k} className="row" style={{ gap: 10, marginBottom: 5 }}>
              <span className="small muted" style={{ width: 34 }}>{ATTR_CN[k]}</span>
              <Bar
                value={p.attrs[k]}
                color={p.attrs[k] >= 85 ? 'var(--accent)' : p.attrs[k] >= 72 ? 'var(--warn)' : 'var(--loss)'}
              />
              <span className="mono small" style={{ width: 22, textAlign: 'right' }}>{p.attrs[k]}</span>
            </div>
          ))}

          <div className="grid c3" style={{ marginTop: 14, gap: 10 }}>
            <Meter label="状态" v={p.form} />
            <Meter label="士气" v={p.morale} />
            <Meter label="体能" v={100 - p.fatigue} />
          </div>
        </div>

        <div className="radar-wrap" style={{ flexDirection: 'column', gap: 10 }}>
          <Radar
            values={ATTR_KEYS.map((k) => p.attrs[k])}
            labels={ATTR_KEYS.map((k) => ATTR_CN[k])}
            size={236}
          />
          {p.agentPool.length > 0 && (
            <div className="row wrap tiny muted" style={{ gap: 6, justifyContent: 'center', alignItems: 'center' }}>
              <span>常用英雄：</span>
              {p.agentPool.map((a) => (
                <span key={a} className="row" style={{ gap: 3, alignItems: 'center' }}>
                  <AgentIcon name={a} size={18} />{agentCn(a)}
                </span>
              ))}
            </div>
          )}
          {p.vlr?.rating != null && (
            <div className="tiny faint center" style={{ lineHeight: 1.7 }}>
              属性来源 · vlr.gg 2026 赛季真实数据<br />
              Rating {p.vlr.rating.toFixed(2)}
              {p.vlr.acs != null && <> · ACS {p.vlr.acs.toFixed(0)}</>}
              {' '}· {p.vlr.rounds} 回合
            </div>
          )}
        </div>
      </div>

      <div className="grid c2">
        <StatBlock title="本赛季" s={p.season} />
        <StatBlock title="生涯" s={p.career} />
      </div>

      <div className="panel">
        <div className="panel-head"><h2>合同</h2></div>
        <div className="panel-body">
          <div className="grid c4" style={{ gap: 12 }}>
            <div className="stat"><span className="k">年薪</span><span className="v sm">{money(p.salary)}</span></div>
            <div className="stat">
              <span className="k">剩余年限</span>
              <span className="v sm">{p.contractYears > 0 ? `${p.contractYears} 年` : '已到期'}</span>
            </div>
            <div className="stat"><span className="k">身价</span><span className="v sm">{money(p.value)}</span></div>
            <div className="stat">
              <span className="k">{mine ? '外队报价参考' : '要价'}</span>
              <span className="v sm">{p.teamId ? money(askingPrice(p)) : '免签'}</span>
            </div>
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
            <span className="tag">忠诚 {p.loyalty}</span>
            <span className="tag">野心 {p.ambition}</span>
            {p.contract && (
              <>
                <span className="tag">月薪 {money(Math.round(p.contract.salary / 12))}</span>
                <span className="tag">奖金分成 {p.contract.bonusShare}%</span>
                <span className="tag">承诺 {SQUAD_ROLE_CN[p.contract.promisedRole]}</span>
                {!!p.contract.releaseClause && (
                  <span className="tag warn">解约金 {money(p.contract.releaseClause)}</span>
                )}
                {p.contract.noPoach && <span className="tag">转会限制</span>}
              </>
            )}
            {!!p.grievance && p.grievance > 15 && (
              <span className="tag warn">不满 {Math.round(p.grievance)}</span>
            )}
          </div>
          {renewing && mine && (
            <div className="panel own" style={{ marginTop: 14 }}>
              <div className="panel-head"><h2>续约谈判</h2></div>
              <div className="panel-body">
                <ContractTerms terms={terms} onChange={setTerms} want={want} />
                <OfferVerdict state={game} player={p} team={me} terms={terms} />
                <div className="row" style={{ gap: 10, marginTop: 16 }}>
                  <button className="primary" onClick={submitRenewal}>提交</button>
                  <button onClick={() => setRenewing(false)}>取消</button>
                  <span className="right tiny muted">
                    立即支付 {moneyFull(terms.signingBonus)} · 合同总额 {moneyFull(terms.salary * terms.years)}
                  </span>
                </div>
              </div>
            </div>
          )}
          {mine && (
            <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
              <button className="primary sm" onClick={() => setRenewing(true)}>续约 / 谈条件</button>
              <button className="sm" onClick={toggleList}>
                {p.listed ? '取消挂牌' : '挂牌出售'}
              </button>
              {!p.isIgl && (
                <button className="sm" title={`他的指挥属性 ${p.attrs.igl}`} onClick={() => {
                  const msg = appointIgl(game, p.id)
                  commit()
                  logActivity(game, 'squad', `任命 ${p.ign} 为队内指挥`)
                  toast(msg)
                }}>
                  任命为指挥
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function Meter({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="tiny muted">{label}</span>
        <span className="tiny mono">{Math.round(v)}</span>
      </div>
      <Bar value={v} />
    </div>
  )
}

function StatBlock({ title, s }: { title: string; s: Stats }) {
  const l = statLine(s)
  if (!s.maps) {
    return (
      <div className="panel">
        <div className="panel-head"><h2>{title}</h2></div>
        <div className="empty">暂无出场记录。</div>
      </div>
    )
  }
  return (
    <div className="panel">
      <div className="panel-head"><h2>{title}</h2></div>
      <div className="panel-body">
        <div className="grid c4" style={{ gap: 10 }}>
          <div className="stat"><span className="k">评分</span><span className="v sm">{ratingOf(s).toFixed(2)}</span></div>
          <div className="stat"><span className="k">ACS</span><span className="v sm">{l.acs.toFixed(0)}</span></div>
          <div className="stat"><span className="k">K/D</span><span className="v sm">{l.kd.toFixed(2)}</span></div>
          <div className="stat"><span className="k">ADR</span><span className="v sm">{l.adr.toFixed(0)}</span></div>
        </div>
        <div className="row wrap tiny muted" style={{ gap: 12, marginTop: 12 }}>
          <span>场次 {s.maps}</span>
          <span>击杀 {s.kills}</span>
          <span>死亡 {s.deaths}</span>
          <span>助攻 {s.assists}</span>
          <span>首杀差 {s.firstKills - s.firstDeaths > 0 ? '+' : ''}{s.firstKills - s.firstDeaths}</span>
          <span>残局 {s.clutches}</span>
          <span>MVP {s.mvps}</span>
        </div>
      </div>
    </div>
  )
}
