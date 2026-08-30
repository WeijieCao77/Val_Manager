import { useGame } from './ctx'
import { Bar, Panel, money, moneyFull } from './common'
import { seasonUpkeep, sponsorIncome } from '../engine/finance'
import { dropSponsor, sponsorSlots } from '../engine/commercial'
import {
  answerBundle, BUNDLE_BUYOUT, betPot, bundlePot, LEAGUE_STIPEND, leagueDealOf,
  negotiateShare, setDealMode, SHARE_MAX,
} from '../engine/leagueShare'
import { useAction } from './useAction'
import { squadOf, wageBill } from '../engine/world'

export default function Finances() {
  const { game, commit, toast, openPlayer } = useGame()
  const act = useAction()
  const me = game.teams[game.myTeam]
  const wages = wageBill(game, game.myTeam)
  const sponsors = sponsorIncome(game, game.myTeam)
  const squad = squadOf(game, game.myTeam).sort((a, b) => b.salary - a.salary)
  const upkeep = seasonUpkeep(game, game.myTeam)
  const deal = leagueDealOf(game)
  const stipend = LEAGUE_STIPEND[me.tier] ?? 0
  const bundleNow = Math.round(bundlePot(game) * deal.share / 100)
  const league = stipend + bundleNow
  const net = sponsors + league + me.seasonPrize - wages - upkeep

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
          <Line label="赞助收入" v={sponsors} max={Math.max(sponsors + league, wages + upkeep)} good />
          <Line label="联盟分成（津贴+捆绑包）" v={league} max={Math.max(sponsors + league, wages + upkeep)} good />
          <Line label="赛事奖金" v={me.seasonPrize} max={Math.max(sponsors + league, wages + upkeep)} good />
          <Line label="选手薪资" v={wages} max={Math.max(sponsors + league, wages + upkeep)} />
          <Line label="运营开支" v={upkeep} max={Math.max(sponsors + league, wages + upkeep)} />
          <p className="tiny muted" style={{ marginTop: 12, marginBottom: 0 }}>
            薪资与开支每 7 天按 1/48 赛季比例结算一次。资金为负会持续削弱董事会信任度。
          </p>
        </Panel>

        <Panel title={`赞助合约 · ${me.sponsors.length}/${sponsorSlots(me)} 栏位`} flush>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>赞助商</th><th className="num">赛季收入</th><th className="num">达标名次</th><th className="num">奖金</th><th className="sticky-act" /></tr>
              </thead>
              <tbody>
                {me.sponsors.map((s, i) => (
                  <tr key={`${s.name}#${i}`}>
                    <td>{s.name}</td>
                    <td className="num mono">{money(s.perSeason)}</td>
                    <td className="num muted">前 {s.bonusPlacement}</td>
                    <td className="num mono pos">{money(s.bonus)}</td>
                    <td className="sticky-act">
                      <button className="sm ghost" onClick={() => {
                        if (!window.confirm(`与 ${s.name} 解约？本赛季剩余保底（${money(s.perSeason)}/赛季）不再支付，栏位立即空出。`)) return
                        toast(dropSponsor(game, i))
                        commit()
                      }}>解约</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!me.sponsors.length && <div className="empty">暂无赞助合约。</div>}
          </div>
        </Panel>
      </div>

      <Panel title={`联盟分成 · ${deal.share}% 捆绑包分成`}>
        <p className="small muted" style={{ marginTop: 0 }}>
          联盟每赛季付给每支{me.tier === 1 ? ' VCT ' : ' Challengers '}俱乐部
          <b> {money(stipend)} </b>津贴（随每周结算到账），另有一笔<b>年度捆绑包</b>在赛季结束时结算——
          你拿其中 <b>{deal.share}%</b>，比例可以每年和联盟谈一次。
        </p>
        <div className="row wrap" style={{ gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <span className="tag">结算方式</span>
          <div className="seg">
            <button
              className={deal.mode === 'fixed' ? 'on' : ''}
              onClick={() => { const m = setDealMode(game, 'fixed'); if (m) { toast(m); commit() } }}
            >
              固定
            </button>
            <button
              className={deal.mode === 'sales' ? 'on' : ''}
              onClick={() => { const m = setDealMode(game, 'sales'); if (m) { toast(m); commit() } }}
            >
              销量
            </button>
          </div>
          <span className="tiny faint">
            固定＝旱涝保收；销量＝跟声望和成绩走。只能在赛季初（Masters I 前）改，一年一次。
          </span>
        </div>
        <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
          <button
            className="sm primary"
            disabled={deal.talkedYear === game.year || deal.share >= SHARE_MAX}
            onClick={() => act('league', () => { toast(negotiateShare(game)) })}
          >
            和联盟谈分成
          </button>
          <span className="tiny faint">
            {deal.share >= SHARE_MAX ? `已是最高档 ${SHARE_MAX}%`
              : deal.talkedYear === game.year ? '今年已谈过，明年再来'
              : '成功率取决于谈判技能、声望和最近的冠军。一年一次。'}
          </span>
          <div style={{ flex: 1 }} />
          <span className="small mono">
            按当前成绩估算，今年捆绑包 ≈ <b className="pos">{money(bundleNow)}</b>
          </span>
        </div>
        {game.leagueOffer && game.leagueOffer.year === game.year && game.day <= game.leagueOffer.expires && (
          <div className="panel own" style={{ marginTop: 12 }}>
            <div className="panel-body">
              <p className="small" style={{ marginTop: 0 }}>
                📦 <b>联盟特别企划</b>：为你的俱乐部推出主题捆绑包。
                现在买断拿 <b>{money(BUNDLE_BUYOUT)}</b>，或者按销量对赌——赛季结束时按声望和成绩结算
                （照现在的水平约 {money(betPot(game))}，打得更好还会涨）。
                还剩 {Math.max(0, game.leagueOffer.expires - game.day)} 天答复。
              </p>
              <div className="row" style={{ gap: 8 }}>
                <button className="sm" onClick={() => { toast(answerBundle(game, 'cash')); commit() }}>
                  买断 {money(BUNDLE_BUYOUT)}
                </button>
                <button className="sm primary" onClick={() => { toast(answerBundle(game, 'bet')); commit() }}>
                  按销量对赌
                </button>
              </div>
            </div>
          </div>
        )}
      </Panel>

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
