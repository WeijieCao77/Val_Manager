import { useMemo, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import { track } from '../../engine/telemetry'
import {
  allChoices, CHALLENGE_COST, CHALLENGE_TRIES, challengeBlock, challengeToday,
  evaluate, guessChallenge, KIND_CN, revealed, triesLeft,
} from '../../engine/challenge'
import type { GuessRow, HintMark } from '../../engine/challenge'

const MARK_STYLE: Record<HintMark, { bg: string; fg: string; suffix?: string }> = {
  hit: { bg: 'var(--win-wash)', fg: 'var(--win)' },
  near: { bg: 'var(--warn-wash)', fg: 'var(--warn)' },
  miss: { bg: 'var(--panel-2)', fg: 'var(--faint)' },
  up: { bg: 'var(--panel-2)', fg: 'var(--muted)', suffix: ' ↑' },
  down: { bg: 'var(--panel-2)', fg: 'var(--muted)', suffix: ' ↓' },
}

const assetBase = (): string =>
  typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : './'

/**
 * 每日挑战.
 *
 * The one screen in this mode that is neither a slot machine nor a spectator
 * seat — the session was four minutes long because everything in it resolved
 * in fifteen seconds, and this is the part that asks the player to actually
 * know something. Same puzzle for everybody, so it is a thing to argue about.
 */
export default function Challenge() {
  const { g, today, commit, toast } = useCards()
  const [query, setQuery] = useState('')

  const { kind, answer, state, rows } = challengeToday(g, today)
  // One list, all four kinds. The screen deliberately does not say which sort
  // of thing today is — working that out is the first half of the puzzle.
  const choices = useMemo(() => allChoices(), [])
  const used = state.guesses.length
  const left = triesLeft(state)
  const block = challengeBlock(g, today)

  const guessed = new Set(state.guesses)
  const matches = query.trim()
    ? choices
      .filter((c) => !guessed.has(c.id))
      .filter((c) => {
        const q = query.trim().toLowerCase()
        return c.name.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q)
      })
      .slice(0, 8)
    : []

  const submit = (id: string) => {
    const why = challengeBlock(g, today)
    if (why) { toast(why); return }
    const turn = guessChallenge(g, today, id)
    setQuery('')
    if (turn.finished) {
      track('card_challenge', {
        kind, solved: turn.solved ? 1 : 0, tries: state.guesses.length,
        streak: state.streak,
      })
      if (turn.solved) {
        const r = turn.reward
        toast(`猜中了！第 ${state.guesses.length} 次 · +${r?.coins ?? 0} 金币`
          + (r?.pack ? ` + ${r.pack === 'ten' ? '十连包' : r.pack === 'elite' ? '选拔包' : '试训包'}` : '')
          + (r?.streakPack ? ' + 连签七天的十连包' : ''))
      } else {
        toast(`没猜中，答案是 ${answerRow.name}。退回 ${turn.reward?.coins ?? 0} 金币，明天再来。`)
      }
    }
    commit(true)
  }

  // the answer's own row, used for the reveal — built here rather than stored
  const answerRow: GuessRow = evaluate(kind, answer, answer)

  // how much of the picture is showing: nothing at the start, all of it at the end
  const show = state.done ? 1 : revealed(used)
  const blur = Math.round((1 - show) * 22)
  const zoom = 1 + (1 - show) * 1.6

  return (
    <>
      <Panel
        title="每日挑战"
        actions={
          <span className="tiny muted">
            {state.streak > 0 && <b style={{ color: 'var(--warn)' }}>连续 {state.streak} 天 · </b>}
            累计解开 {state.total}
          </span>
        }
      >
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.7 }}>
          今天要猜的可能是<b>一名选手、一支战队、一张地图或者一个英雄</b>——
          题目不会告诉你是哪一类，<b>先猜出它是什么，再猜出它是哪个</b>。
          图会糊到看不出是人是队；每猜错一次清楚一点。
          <br />
          全世界今天是<b>同一道题</b>，日期以服务器为准。一天一次，
          入场 <b>{CHALLENGE_COST} 金币</b>——猜中按用了几次给卡包（<b>一次猜中给十连包</b>），
          没猜中退一半。
        </p>

        {/* The subject.
            Three of the four kinds are square — faces are 192², agents 128²,
            crests 256² — and only a map is a 4.55:1 strip. A flat banner frame
            with object-fit:cover therefore sliced a band out of the middle of
            every portrait, and was the one shape a map filled naturally, which
            gave the kind away from across the room.
            So: the image whole, on a backdrop of itself blown up and blurred.
            Nothing is cropped, the letterbox that would betray the aspect
            ratio is filled in, and at the opening blur the whole box is one
            smudge whatever is under it. */}
        <div style={{
          position: 'relative', height: 210, borderRadius: 4, overflow: 'hidden',
          background: 'var(--panel-2)', marginBottom: 12,
          display: answerRow.img ? undefined : 'grid', placeItems: 'center',
        }}>
          {/* the answer always has a picture — answerPool sees to that — but a
              data file can always lose one, and a broken image is a broken
              puzzle for everybody on earth that day */}
          {!answerRow.img && <span className="faint small">（这一题没有图）</span>}
          {answerRow.img && <img
            src={`${assetBase()}${answerRow.img}`}
            alt=""
            aria-hidden
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', opacity: 0.75,
              filter: `blur(${blur + 16}px) saturate(1.2)`,
              transform: `scale(${zoom + 0.4})`,
              transition: 'filter .35s ease, transform .35s ease',
            }}
          />}
          {answerRow.img && <img
            src={`${assetBase()}${answerRow.img}`}
            alt=""
            style={{
              position: 'relative', display: 'block', margin: '0 auto',
              width: '100%', height: '100%', objectFit: 'contain',
              filter: `blur(${blur}px)`, transform: `scale(${zoom})`,
              transition: 'filter .35s ease, transform .35s ease',
            }}
          />}
          <div className="tiny" style={{
            position: 'absolute', right: 8, bottom: 8, padding: '2px 8px',
            borderRadius: 999, background: 'rgba(8,12,18,.72)', color: 'var(--muted)',
          }}>
            {state.done
              ? `${KIND_CN[kind]} · ${answerRow.name}`
              : `还剩 ${left} 次 · 每猜错一次清楚一点`}
          </div>
        </div>

        {/* The picker. A form, not a bare input with a keydown handler: this
            is how the phone keyboard's 「前往」 key submits, and three quarters
            of the people playing this are on a phone. */}
        {!state.done && (
          <form
            style={{ position: 'relative', marginBottom: 10 }}
            onSubmit={(e) => { e.preventDefault(); if (matches[0]) submit(matches[0].id) }}
          >
            <div className="row" style={{ gap: 8 }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={block ?? `输入名字开始猜（还剩 ${left} 次）`}
                disabled={!!block}
                enterKeyHint="go"
              />
              {/* a real submit button, so Enter and the phone's 「前往」 both
                  work — a form with no submit control does not reliably
                  implicit-submit, and a thumb wants something to press anyway */}
              <button className="primary" type="submit" disabled={!!block || !matches[0]}>
                猜
              </button>
            </div>
            {matches.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5,
                background: 'var(--panel)', border: '1px solid var(--line)',
                borderRadius: 3, marginTop: 3, overflow: 'hidden',
                boxShadow: '0 12px 30px rgba(0,0,0,.5)',
              }}>
                {matches.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="ghost"
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', border: 0,
                      borderRadius: 0, padding: '8px 11px',
                    }}
                    onClick={() => submit(c.id)}
                  >
                    <b>{c.name}</b>{' '}
                    <span className="tag" style={{ marginLeft: 2 }}>{KIND_CN[c.kind!]}</span>{' '}
                    <span className="tiny faint">{c.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </form>
        )}

        {block && !state.done && (
          <p className="tiny" style={{ color: 'var(--warn)', margin: '0 0 8px' }}>{block}</p>
        )}

        {/* What has been tried.
            The header comes from the WIDEST row, not the first one: a guess of
            the wrong kind returns a single 类型 cell, so a table headed off the
            opening guess put 赛区 above 分级 and everything after it one column
            to the left. Short rows are padded so each cell stays under its own
            heading. */}
        {rows.length > 0 && (() => {
          const head = rows.reduce((best, r) => (r.cells.length > best.length ? r.cells : best),
            [] as typeof rows[number]['cells'])
          return (
          <div className="table-wrap" style={{ marginTop: 4 }}>
            <table>
              {head.length > 0 && (
                <thead>
                  <tr>
                    <th>猜的</th>
                    {head.map((c) => <th key={c.label} className="center">{c.label}</th>)}
                  </tr>
                </thead>
              )}
              <tbody>
                {rows.slice().reverse().map((r, i) => (
                  <tr key={`${r.id}-${i}`}>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        {r.img && (
                          <img src={`${assetBase()}${r.img}`} alt="" style={{
                            width: 22, height: 22, borderRadius: 2, objectFit: 'cover',
                            objectPosition: 'top center', background: 'var(--panel-2)',
                          }} />
                        )}
                        <b>{r.name}</b>
                        {r.id === answer && <span className="tag t1">正解</span>}
                      </span>
                    </td>
                    {head.map((h, ci) => {
                      const c = r.cells[ci]
                      if (!c) return <td key={h.label} className="center faint">—</td>
                      const st = MARK_STYLE[c.mark]
                      return (
                        <td key={c.label} className="center">
                          <span style={{
                            display: 'inline-block', minWidth: 44, padding: '2px 7px',
                            borderRadius: 3, background: st.bg, color: st.fg,
                            fontSize: 'var(--t-tiny)', fontWeight: 700,
                          }}>
                            {c.value}{st.suffix ?? ''}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )
        })()}

        {state.done && (
          <>
            <p className="small" style={{ marginTop: 12, marginBottom: 6, color: state.solved ? 'var(--win)' : 'var(--muted)' }}>
              {state.solved
                ? `第 ${used} 次猜中，连续第 ${state.streak} 天。`
                : '今天没猜出来，连胜清零了。'}
              答案是<b style={{ color: 'var(--text)' }}>{KIND_CN[kind]}「{answerRow.name}」</b>。明天换一道。
            </p>
            {/* Everybody on earth has today's puzzle, and this is the exact
                moment somebody screenshots it. Loud enough to actually stop
                them: a boxed callout, not a grey footnote. */}
            <div style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              margin: '12px 0 0', padding: '11px 13px', borderRadius: 3,
              background: 'var(--warn-wash)',
              border: '1px solid var(--warn)', borderLeftWidth: 3,
            }}>
              <span style={{ fontSize: 19, lineHeight: 1.2 }}>🤐</span>
              <div>
                <b style={{ color: 'var(--warn)', fontSize: 'var(--t-body)' }}>
                  别把答案发出去
                </b>
                <div className="small muted" style={{ marginTop: 3, lineHeight: 1.7 }}>
                  今天<b>全世界是同一道题</b>，发出来别人就没得玩了。
                  想晒的话，晒「第几次猜中」和连胜天数就好。
                </div>
              </div>
            </div>
          </>
        )}
      </Panel>

      <Panel title="怎么算分">
        <div className="table-wrap">
          <table>
            <thead><tr><th>几次猜中</th><th>奖励</th></tr></thead>
            <tbody>
              <tr><td>第 1 次</td><td><b style={{ color: 'var(--warn)' }}>十连包</b>（商店买不到）</td></tr>
              <tr><td>2~3 次</td><td>选拔包</td></tr>
              <tr><td>4~{CHALLENGE_TRIES} 次</td><td>试训包</td></tr>
              <tr><td>没猜中</td><td className="muted">退一半入场费</td></tr>
              <tr><td>连续第 7 天</td><td><b style={{ color: 'var(--warn)' }}>额外一个十连包</b></td></tr>
            </tbody>
          </table>
        </div>
        <p className="tiny faint" style={{ marginTop: 10, marginBottom: 0 }}>
          猜中还按连胜天数加金币。题型每天轮换：猜选手、猜战队、猜地图、猜英雄——
          选手题最多，因为这游戏说到底是关于人的。
        </p>
      </Panel>
    </>
  )
}
