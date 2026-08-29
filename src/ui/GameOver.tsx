import { useState } from 'react'
import { useGame } from './ctx'
import {
  DYNASTY_ENDINGS, ENDINGS, ENDING_COUNT, INTL_TITLES, STORY_ENDINGS,
  endingOf, endingsFor, factsOf,
} from '../engine/endings'
import { earnedNow } from '../engine/achievements'
import { claimCareer, readProfile, record, siteId } from '../engine/profile'
import { money } from './common'
import { track } from '../engine/telemetry'
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

  // A finished career is graded; a sacking is not — but both are the end of a
  // job, and both belong in the lifetime record. Written once, to the site id
  // the card mode already uses, so the collection follows the person and not
  // the save file.
  const id = siteId()
  const [{ earned, fresh, unlocked }] = useState(() => {
    const list = game.finished ? endingsFor(game) : []
    // The same list the endings judge by, not a second regex that happens to
    // agree. They did not agree: this one matched 'VALORANT Champions' while
    // the endings asked for 'Champions', so the profile could say 「十座国际
    // 冠军」 on a career the verdict called 「一座也没有」.
    const worlds = game.honours.filter((h) =>
      (INTL_TITLES as readonly string[]).includes(h.title)).length
    const before = readProfile(id)
    const r = before.record
    // This modal mounts every time the career tree renders a finished save, so
    // it can run several times for one career — going to the front page and
    // coming back is enough. The endings and the achievements do not care: a
    // union of sets is the same however often it is taken. The totals are
    // sums, and adding the same career twice made an eleven-season run read as
    // twenty-two. So the sums are written only for a career not yet claimed.
    const first = claimCareer(game.seed, id)
    const { fresh: got, profile } = record({
      endings: list.map((e) => e.key),
      // achievements are checked again here: a career can end on the very turn
      // one is earned, and that turn's dashboard check never runs
      achievements: earnedNow(game),
      record: first ? {
        // Counted when a career ENDS, so it is the number of jobs that are
        // over. It used to be Math.max(r.careers, 1), which is 1 forever — a
        // fifth career never moved it, and 「老江湖」（五段生涯）could not be
        // earned by anybody.
        careers: r.careers + 1,
        finished: r.finished + (game.finished ? 1 : 0),
        sacked: r.sacked + (game.finished ? 0 : 1),
        titles: r.titles + game.honours.length,
        worldTitles: r.worldTitles + worlds,
        bestHaul: Math.max(r.bestHaul, game.honours.length),
        seasons: r.seasons + (game.year - 2026 + 1),
        clubs: [...r.clubs, ...(game.tenures ?? []).map((t) => t.teamId), game.myTeam],
      } : undefined,
    }, id, { announce: false })
    // only keys this build still knows about — see the note in Achievements.tsx
    const live = new Set(ENDINGS.map((e) => e.key))
    // The one outcome that had no event: `sacked` fired from the engine, but
    // reaching 2036 — the whole point of the ten-year rewrite — was invisible.
    track('game_over', {
      finished: game.finished ? 1 : 0,
      seasons: game.year - 2026 + 1,
      honours: game.honours.length,
      dynasty: endingOf(game).dynasty?.key ?? '',
      story: endingOf(game).story?.key ?? '',
    })
    return {
      earned: list,
      fresh: got.endings,
      unlocked: profile.endings.filter((k) => live.has(k)),
    }
  })
  // Two verdicts, not one: what you won and how it went. Both are always
  // present for a finished career — each track ends in a catch-all.
  const { dynasty, story } = endingOf(game)
  const facts = factsOf(game)
  // whatever is left after the two headline endings have taken their place
  const extra = earned.filter((e) => e.key !== dynasty?.key && e.key !== story?.key)

  return (
    // `safe center`, not `center`: centred while it fits, top-aligned once it
    // does not. Plain centring in a scrolling flex container pushes the
    // overflow off BOTH ends, and the top half becomes unreachable — which is
    // what the collection panel did to the title on a short screen.
    <div className="modal-bg" style={{ alignItems: 'safe center' }}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-head">
          <h3>
            {game.finished
              ? `结局 · ${dynasty?.title ?? '十年'}／${story?.title ?? ''}`
              : '任期结束'}
          </h3>
        </div>
        <div className="modal-body">
          {game.finished && dynasty ? (
            <>
              <div className="ending">
                <span className="k">王朝线 · 看战绩</span>
                <b>{dynasty.title}</b>
                <p>{dynasty.text(game, facts)}</p>
              </div>
              {story && (
                <div className="ending">
                  <span className="k">故事线 · 看经历</span>
                  <b>{story.title}</b>
                  <p>{story.text(game, facts)}</p>
                </div>
              )}
              {extra.length > 0 && (
                <p className="small muted" style={{ marginTop: 8 }}>
                  这段生涯同时达成：
                  {extra.map((e) => (
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
              {([['王朝线', DYNASTY_ENDINGS], ['故事线', STORY_ENDINGS]] as const).map(
                ([label, rows]) => (
                  <div key={label} style={{ marginBottom: 8 }}>
                    <span className="tiny faint" style={{ letterSpacing: '.08em' }}>
                      {label} {rows.filter((e) => unlocked.includes(e.key)).length}/{rows.length}
                    </span>
                    <div className="row wrap" style={{ gap: 7, marginTop: 5 }}>
                      {rows.map((e) => {
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
                  </div>
                ),
              )}
              <p className="tiny faint" style={{ marginTop: 10, marginBottom: 0 }}>
                {/* This screen is the one people screenshot to show off an
                    ending, and the id is the account's only password — so it
                    is named, not printed. The full string lives on 成就 and on
                    the front page, both behind a 显示 button. */}
                {id
                  ? '记在你的账号名下，和开瓦包是同一个（完整 ID 在「成就」页里）。'
                  : '记在这台浏览器上。去开瓦包领一个账号 ID，收藏就能跟着你走。'}
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
