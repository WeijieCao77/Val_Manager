import { useGame } from './ctx'
import { Bar, Panel, money, moneyFull } from './common'
import { sponsorIncome } from '../engine/finance'
import { squadOf, wageBill } from '../engine/world'

export default function Finances() {
  const { game, openPlayer } = useGame()
  const me = game.teams[game.myTeam]
  const wages = wageBill(game, game.myTeam)
  const sponsors = sponsorIncome(game, game.myTeam)
  const squad = squadOf(game, game.myTeam).sort((a, b) => b.salary - a.salary)
  const upkeep = Math.round((me.facilities * 900 + squad.length * 1400) * 12)
  const net = sponsors + me.seasonPrize - wages - upkeep

  const log = game.finances.log.slice(-60).reverse()

  return (
    <>
      <div className="grid c4">
        <Panel>
          <div className="stat"><span className="k">可用资金</span><span className="v">{money(game.finances.balance)}</span></div>
        </Panel>
        <Panel>
          <div className="stat"><span className="k">赛季奖金</span><span className="v" style={{ color: 'var(--win)' }}>{money(me.seasonPrize)}</span></div>
        </Panel>
        <Panel>
          <div className="stat"><span className="k">薪资总额 / 年</span><span className="v">{money(wages)}</span></div>
        </Panel>
        <Panel className={net < 0 ? 'alert' : 'good'}>
          <div className="stat">
            <span className="k">年度盈亏（预估）</span>
            <span className="v" style={{ color: net >= 0 ? 'var(--win)' : 'var(--warn)' }}>
              {net >= 0 ? '+' : ''}{money(net)}
            </span>
          </div>
        </Panel>
      </div>

      <div className="grid c2">
        <Panel title="年度收支结构">
          <Line label="赞助收入" v={sponsors} max={Math.max(sponsors, wages + upkeep)} good />
          <Line label="赛事奖金" v={me.seasonPrize} max={Math.max(sponsors, wages + upkeep)} good />
          <Line label="选手薪资" v={wages} max={Math.max(sponsors, wages + upkeep)} />
          <Line label="运营开支" v={upkeep} max={Math.max(sponsors, wages + upkeep)} />
          <p className="tiny muted" style={{ marginTop: 12, marginBottom: 0 }}>
            薪资与开支每 7 天按 1/48 赛季比例结算一次。资金为负会持续削弱董事会信任度。
          </p>
        </Panel>

        <Panel title="赞助合约" flush>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>赞助商</th><th className="num">赛季收入</th><th className="num">达标名次</th><th className="num">奖金</th></tr>
              </thead>
              <tbody>
                {me.sponsors.map((s) => (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td className="num mono">{money(s.perSeason)}</td>
                    <td className="num muted">前 {s.bonusPlacement}</td>
                    <td className="num mono pos">{money(s.bonus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!me.sponsors.length && <div className="empty">暂无赞助合约。</div>}
          </div>
        </Panel>
      </div>

      <Panel title="薪资明细" flush>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>选手</th><th className="num">年薪</th><th style={{ width: '30%' }}>占比</th>
                <th className="num">合同</th><th className="num">身价</th>
              </tr>
            </thead>
            <tbody>
              {squad.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => openPlayer(p.id)}>
                  <td><b>{p.ign}</b></td>
                  <td className="num mono">{money(p.salary)}</td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <Bar value={wages ? (p.salary / wages) * 100 : 0} max={50} color="var(--accent)" />
                      <span className="tiny mono muted">{wages ? ((p.salary / wages) * 100).toFixed(0) : 0}%</span>
                    </div>
                  </td>
                  <td className="num muted">{p.contractYears > 0 ? `${p.contractYears}年` : '到期'}</td>
                  <td className="num mono muted">{money(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="收支流水" flush>
        <div className="table-wrap">
          <table>
            <thead><tr><th className="num">天</th><th>项目</th><th className="num">金额</th></tr></thead>
            <tbody>
              {log.map((e, i) => (
                <tr key={i}>
                  <td className="num muted mono">{e.day}</td>
                  <td>{e.label}</td>
                  <td className={`num mono ${e.amount >= 0 ? 'pos' : ''}`}>
                    {e.amount >= 0 ? '+' : ''}{moneyFull(e.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!log.length && <div className="empty">还没有流水记录。</div>}
        </div>
      </Panel>
    </>
  )
}

function Line({ label, v, max, good }: { label: string; v: number; max: number; good?: boolean }) {
  return (
    <div style={{ marginBottom: 11 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="small">{label}</span>
        <span className="mono small" style={{ color: good ? 'var(--win)' : 'var(--muted)' }}>
          {good ? '+' : '−'}{money(v)}
        </span>
      </div>
      <Bar value={v} max={max || 1} color={good ? 'var(--win)' : 'var(--loss)'} />
    </div>
  )
}
