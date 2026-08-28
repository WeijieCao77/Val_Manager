import { useState } from 'react'
import { useGame } from './ctx'
import { rememberedId } from '../engine/account'
import {
  ENDING_COUNT, ENDINGS, endingsFor, factsOf, recordEndings, unlockedEndings,
} from '../engine/endings'
import type { Ending } from '../engine/endings'
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
  // The span, not a count. 2026 through 2036 is eleven seasons but ten
  // years, which is how the endings talk about it and how anyone would
  // say it out loud — printing `11` next to 「十年任期」 just looked wrong.
  const tenure = game.year > 2026 ? `2026–${game.year}` : '2026'

  // A finished career is graded; a sacking is not. Recorded once, on the
  // account the card mode already uses, so the collection follows the person
  // rather than the save.
  const id = rememberedId()
  const [{ earned, fresh, unlocked }] = useState(() => {
    if (!game.finished) {
      return { earned: [] as Ending[], fresh: [] as string[], unlocked: unlockedEndings(id) }
    }
    const list = endingsFor(game)
    const isNew = recordEndings(id, list.map((e) => e.key))
    return { earned: list, fresh: isNew, unlocked: unlockedEndings(id) }
  })
  const ending = earned[0] ?? null

  return (
    // `safe center`, not `center`: centred while it fits, top-aligned once it
    // does not. Plain centring in a scrolling flex container pushes the
    // overflow off BOTH ends, and the top half becomes unreachable — which is
    // what the collection panel did to the title on a short screen.
    <div className="modal-bg" style={{ alignItems: 'safe center' }}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-head">
          <h3>{game.finished ? `结局 · ${ending?.title ?? '十年'}` : '任期结束'}</h3>
        </div>
        <div className="modal-body">
          {game.finished && ending ? (
            <>
              <p style={{ marginTop: 0, fontSize: 17, lineHeight: 1.9 }}>
                {ending.text(game, factsOf(game))}
              </p>
              {earned.length > 1 && (
                <p className="small muted" style={{ marginTop: 8 }}>
                  这段生涯同时达成：
                  {earned.slice(1).map((e) => (
                    <span key={e.key} className="tag" style={{ marginLeft: 5 }}>{e.title}</span>
                  ))}
                </p>
              )}
              {fresh.length > 0 && (
                <p className="small" style={{ color: 'var(--win)', marginTop: 8 }}>
                  ✦ 首次解锁 {fresh.length} 种结局
                </p>
              )}
            </>
          ) : (
            <p style={{ marginTop: 0, lineHeight: 1.8 }}>{game.gameOver}</p>
          )}

          <div className="grid c3" style={{ gap: 12, margin: '18px 0' }}>
            <div className="stat"><span className="k">执教俱乐部</span><span className="v sm">{club?.name}</span></div>
            <div className="stat"><span className="k">在任年份</span><span className="v sm">{tenure}</span></div>
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

          <div className="panel" style={{ marginTop: 14 }}>
            <div className="panel-head">
              <h2>结局收藏 · {unlocked.length}/{ENDING_COUNT}</h2>
            </div>
            <div className="panel-body">
              <div className="row wrap" style={{ gap: 7 }}>
                {ENDINGS.map((e) => {
                  const got = unlocked.includes(e.key)
                  const now = earned.some((x) => x.key === e.key)
                  return (
                    <span
                      key={e.key}
                      className="tag"
                      title={got ? e.brief : `未解锁 · ${e.brief}`}
                      style={now
                        ? { borderColor: 'var(--win)', color: 'var(--win)' }
                        : got ? undefined : { opacity: 0.4 }}
                    >
                      {got ? e.title : '？？？'}
                    </span>
                  )
                })}
              </div>
              <p className="tiny faint" style={{ marginTop: 10, marginBottom: 0 }}>
                {id
                  ? `记在账号 ${id} 名下，和抽卡模式是同一个。`
                  : '记在这台浏览器上。去抽卡模式领一个账号 ID，收藏就能跟着你走。'}
                鼠标悬停可以看到未解锁结局的条件。
              </p>
            </div>
          </div>

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
