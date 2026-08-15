import { Bar, Modal, OvrBadge, Radar, RoleTag, money, moneyFull } from './common'
import { useGame } from './ctx'
import { ratingOf } from '../engine/match'
import { expectedSalary, statLine } from '../engine/player'
import { askingPrice } from '../engine/transfer'
import { ATTR_CN, ATTR_KEYS, REGION_CN } from '../engine/types'
import type { Stats } from '../engine/types'

export default function PlayerModal({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const { game, commit, toast } = useGame()
  const p = game.players[playerId]
  if (!p) return null
  const team = p.teamId ? game.teams[p.teamId] : null
  const mine = p.teamId === game.myTeam
  const me = game.teams[game.myTeam]

  const renew = () => {
    const ask = Math.round(expectedSalary(p, me.tier) * 1.08)
    if (!window.confirm(`与 ${p.ign} 续约 2 年，年薪 ${moneyFull(ask)}？`)) return
    p.salary = ask
    p.contractYears = 2
    p.morale = Math.min(100, p.morale + 8)
    commit()
    toast(`${p.ign} 已续约 2 年。`)
  }

  const toggleList = () => {
    p.listed = !p.listed
    commit()
    toast(p.listed ? `${p.ign} 已挂牌，其他俱乐部会来问价。` : `已取消 ${p.ign} 的挂牌。`)
  }

  return (
    <Modal
      wide
      title={
        <span className="row" style={{ gap: 10 }}>
          <span>{p.ign}</span>
          <RoleTag role={p.role} />
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
            <span className="tag">潜力 {p.potential}</span>
            {p.injuredUntil > game.day && (
              <span className="tag warn">⚕ {p.injuryNote}（{p.injuredUntil - game.day} 天）</span>
            )}
            {p.listed && <span className="tag warn">已挂牌</span>}
          </div>

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
          <div className="row wrap tiny muted" style={{ gap: 10, justifyContent: 'center' }}>
            {p.agentPool.length > 0 && <span>常用英雄：{p.agentPool.join(' · ')}</span>}
          </div>
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
          </div>
          {mine && (
            <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
              <button className="primary sm" onClick={renew}>续约 2 年</button>
              <button className="sm" onClick={toggleList}>
                {p.listed ? '取消挂牌' : '挂牌出售'}
              </button>
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
