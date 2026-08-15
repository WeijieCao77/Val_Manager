import { SQUAD_ROLE_CN } from '../engine/types'
import type { Contract, SquadRole } from '../engine/types'
import { offerOutlook, scoreOffer } from '../engine/transfer'
import type { GameState, Player, Team } from '../engine/types'
import { moneyFull } from './common'

/**
 * An honest read on how the offer will land, before it is sent.
 *
 * An offer costs 7-10 days of waiting, so guessing blindly at terms is not a
 * decision. The read-out is deliberately coarse — three bands and the single
 * worst term — which teaches the negotiation without solving it.
 */
export function OfferVerdict({
  state, player, team, terms,
}: { state: GameState; player: Player; team: Team; terms: Contract }) {
  const s = scoreOffer(state, player, team, terms)
  const o = offerOutlook(s)
  const color = o.level === 'good' ? 'var(--win)' : o.level === 'fair' ? 'var(--warn)' : 'var(--loss)'
  return (
    <div className="verdict" style={{ borderLeftColor: color }}>
      <b style={{ color }}>{o.label}</b>
      {/* only frame a term as an obstacle when it is actually holding the offer back */}
      {s.worst && o.level !== 'good' && (
        <span className="small muted">最大阻力：{s.worst.why}</span>
      )}
      {s.worst && o.level === 'good' && (
        <span className="small faint">唯一保留：{s.worst.why}</span>
      )}
      {!s.worst && o.level === 'good' && <span className="small muted">条件足够有说服力。</span>}
    </div>
  )
}

const ROLES: SquadRole[] = ['star', 'starter', 'rotation', 'bench']

const ROLE_HINT: Record<SquadRole, string> = {
  star: '球队围绕他建队，几乎每场首发。做不到会严重不满。',
  starter: '常规首发。长期坐板凳会不满。',
  rotation: '轮换出场，对上场时间要求不高。',
  bench: '替补，没有出场承诺，薪资要求也最低。',
}

/**
 * The full package, not just a wage. Each row is a lever that can be traded
 * against the others — cash up front instead of salary, a bigger prize cut
 * instead of either, or a promise about playing time the club must then keep.
 */
export default function ContractTerms({
  terms, onChange, want, monthlyLabel = true,
}: {
  terms: Contract
  onChange: (t: Contract) => void
  /** what the player expects to earn per year */
  want: number
  monthlyLabel?: boolean
}) {
  const set = <K extends keyof Contract>(k: K, v: Contract[K]) => onChange({ ...terms, [k]: v })

  return (
    <>
      <div className="grid c2" style={{ gap: 12 }}>
        <div>
          <label className="small muted">
            年薪（期望约 {moneyFull(want)}）
          </label>
          <input
            type="number" value={terms.salary} min={0} step={5000}
            onChange={(e) => set('salary', Math.max(0, Number(e.target.value)))}
          />
          {monthlyLabel && (
            <div className="tiny faint">月薪约 {moneyFull(Math.round(terms.salary / 12))}</div>
          )}
        </div>
        <div>
          <label className="small muted">签字费（一次性）</label>
          <input
            type="number" value={terms.signingBonus} min={0} step={5000}
            onChange={(e) => set('signingBonus', Math.max(0, Number(e.target.value)))}
          />
          <div className="tiny faint">现金比同等年薪更有吸引力</div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <label className="small muted">奖金分成</label>
          <span className="mono small">{terms.bonusShare}%</span>
        </div>
        <input
          type="range" min={0} max={35} value={terms.bonusShare}
          onChange={(e) => set('bonusShare', Number(e.target.value))}
        />
        <div className="tiny faint">从赛事奖金里分给他的比例，联盟惯例 10% 左右。</div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label className="small muted">承诺地位</label>
        <div className="seg" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          {ROLES.map((r) => (
            <button
              key={r}
              className={terms.promisedRole === r ? 'on' : ''}
              onClick={() => set('promisedRole', r)}
            >
              {SQUAD_ROLE_CN[r]}
            </button>
          ))}
        </div>
        <div className="tiny faint" style={{ marginTop: 5 }}>{ROLE_HINT[terms.promisedRole]}</div>
      </div>

      <div className="grid c2" style={{ gap: 12, marginTop: 14 }}>
        <div>
          <label className="small muted">合同年限</label>
          <div className="seg" style={{ marginTop: 6 }}>
            {[1, 2, 3, 4].map((y) => (
              <button key={y} className={terms.years === y ? 'on' : ''} onClick={() => set('years', y)}>
                {y} 年
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="small muted">解约金（0 = 不设）</label>
          <input
            type="number" value={terms.releaseClause} min={0} step={50000}
            onChange={(e) => set('releaseClause', Math.max(0, Number(e.target.value)))}
          />
          <div className="tiny faint">别的俱乐部可以按这个价直接买走</div>
        </div>
      </div>

      <label className="row" style={{ gap: 8, marginTop: 12, cursor: 'pointer' }}>
        <input
          type="checkbox" checked={terms.noPoach} style={{ width: 15 }}
          onChange={(e) => set('noPoach', e.target.checked)}
        />
        <span className="small">转会限制条款 <span className="tiny faint">
          未经本人同意不得出售。球队更安全，但选手要价更高。
        </span></span>
      </label>
    </>
  )
}
