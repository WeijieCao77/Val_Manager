import { useGame } from './ctx'
import { money } from './common'
import { ORIGINS } from '../engine/manager'

/**
 * The end of a tenure.
 *
 * Shown as a record of the job rather than a failure screen: what you were
 * asked to do, what you actually won, and how long you lasted. Being sacked is
 * the half of a career story the game was missing.
 */
export default function GameOver({ onRestart }: { onRestart: () => void }) {
  const { game } = useGame()
  const club = game.teams[game.myTeam]
  const m = game.manager
  const origin = m ? ORIGINS.find((o) => o.key === m.originKey) : null
  const seasons = game.year - 2026 + 1

  return (
    <div className="modal-bg" style={{ alignItems: 'center' }}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-head">
          <h3>任期结束</h3>
        </div>
        <div className="modal-body">
          <p style={{ marginTop: 0, lineHeight: 1.8 }}>{game.gameOver}</p>

          <div className="grid c3" style={{ gap: 12, margin: '18px 0' }}>
            <div className="stat"><span className="k">执教俱乐部</span><span className="v sm">{club?.name}</span></div>
            <div className="stat"><span className="k">在任赛季</span><span className="v sm">{seasons}</span></div>
            <div className="stat"><span className="k">冠军</span><span className="v sm">{game.honours.length}</span></div>
          </div>

          {game.honours.length > 0 ? (
            <div className="panel">
              <div className="panel-head"><h2>荣誉</h2></div>
              <div className="panel-body">
                {game.honours.map((h, i) => (
                  <div key={i} className="small" style={{ padding: '2px 0' }}>
                    🏆 {h.year} · {h.title}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="small muted">这段任期没能留下任何冠军。</p>
          )}

          {m && (
            <p className="tiny faint" style={{ lineHeight: 1.8 }}>
              {m.name}，{m.age} 岁，{origin?.label}。最终声望 {m.reputation}，
              账面资金 {money(game.finances.balance)}。
            </p>
          )}

          <div className="row" style={{ gap: 10, marginTop: 18 }}>
            <button className="primary" onClick={onRestart}>开始新的职业生涯</button>
          </div>
          <p className="tiny faint" style={{ marginTop: 12, marginBottom: 0 }}>
            董事会不会毫无预兆地解约——被正式警告后，下一个赛段就是你的最后机会。
          </p>
        </div>
      </div>
    </div>
  )
}
