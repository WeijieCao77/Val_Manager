import { useGame } from './ctx'
import { endingOf, factsOf } from '../engine/endings'
import { continuePastFive, settleAtFive } from '../engine/season'
import { track } from '../engine/telemetry'

/**
 * The five-year settlement.
 *
 * After the 2030 season is played — before the off-season touches the squad —
 * the career pauses on a question: take the verdict as it stands and go out on
 * it, or play the back five. Both answers are real endings; only the second
 * can reach 「走完十年」. The engine holds the clock (advanceDay returns while
 * midReview is up), so there is no way to wander off and lose the moment.
 */
export default function MidReview() {
  const { game, commit } = useGame()
  const { dynasty, story } = endingOf(game)
  const facts = factsOf(game)

  const choose = (settle: boolean) => {
    track('mid_review', { settle: settle ? 1 : 0, honours: game.honours.length })
    if (settle) settleAtFive(game)
    else continuePastFive(game)
    commit()
  }

  return (
    <div className="modal-bg" style={{ alignItems: 'safe center' }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-head"><h3>五年之约 · 2026–2030</h3></div>
        <div className="modal-body">
          <p className="small muted" style={{ marginTop: 0, lineHeight: 1.8 }}>
            五个赛季打完了。现在收官，这段生涯就以下面的评价定格，记入你的账号；
            继续的话，合同一路签到 <b>2036</b>——那才是不能再往后的大结局，
            走完的人会有单独的成就。
          </p>

          {dynasty && (
            <div className="ending">
              <span className="k">王朝线 · 目前的评价</span>
              <b>{dynasty.title}</b>
              <p>{dynasty.text(game, facts)}</p>
            </div>
          )}
          {story && (
            <div className="ending">
              <span className="k">故事线 · 目前的评价</span>
              <b>{story.title}</b>
              <p>{story.text(game, facts)}</p>
            </div>
          )}

          <div className="grid c2" style={{ gap: 12, margin: '16px 0' }}>
            <div className="stat"><span className="k">冠军</span><span className="v sm">{game.honours.length}</span></div>
            <div className="stat"><span className="k">经理声望</span><span className="v sm">{Math.round(game.manager?.reputation ?? 0)}</span></div>
          </div>

          <div className="row" style={{ gap: 10, marginTop: 6 }}>
            <button className="primary" onClick={() => choose(false)}>继续执教到 2036</button>
            <button onClick={() => choose(true)}>就此收官，领取结局</button>
          </div>
          <p className="tiny faint" style={{ marginTop: 12, marginBottom: 0 }}>
            收官不算解约——生涯档案里既不记「完成十年」也不记「被解雇」，
            结局和成就照常入账。这个选择只会出现这一次。
          </p>
        </div>
      </div>
    </div>
  )
}
