import { useMemo, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import { track } from '../../engine/telemetry'
import {
  CHALLENGE_COST, CHALLENGE_TRIES, challengeBlock, challengeToday, choicesFor,
  evaluate, guessChallenge, revealed, triesLeft,
} from '../../engine/challenge'
import type { ChallengeKind, GuessRow, HintMark } from '../../engine/challenge'

const KIND_CN: Record<ChallengeKind, { title: string; blurb: string }> = {
  player: { title: '猜选手', blurb: '今天的答案是一名 VCT 一级联赛在役选手。每猜一次，下面会告诉你猜的人和答案在哪些方面对得上。' },
  team: { title: '猜战队', blurb: '今天的答案是一支 VCT 一级联赛的俱乐部。每猜一次，下面会告诉你差在哪。' },
  map: { title: '猜地图', blurb: '只给一张糊到看不清的图，猜错一次就清楚一点。第一次就认出来的，奖励最好。' },
  agent: { title: '猜英雄', blurb: '一张糊掉的立绘，加上他的定位。猜错一次清楚一点。' },
}

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
  const choices = useMemo(() => choicesFor(kind), [kind])
  const used = state.guesses.length
  const left = triesLeft(state)
  const block = challengeBlock(g, today)
  const visual = kind === 'map' || kind === 'agent'

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
        title={`每日挑战 · ${KIND_CN[kind].title}`}
        actions={
          <span className="tiny muted">
            {state.streak > 0 && <b style={{ color: 'var(--warn)' }}>连续 {state.streak} 天 · </b>}
            累计解开 {state.total}
          </span>
        }
      >
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.7 }}>
          {KIND_CN[kind].blurb}
          <br />
          全世界今天是<b>同一道题</b>，日期以服务器为准。一天一次，
          入场 <b>{CHALLENGE_COST} 金币</b>——猜中按用了几次给卡包（<b>一次猜中给十连包</b>），
          没猜中退一半。
        </p>

        {/* the subject */}
        {visual ? (
          <div style={{
            position: 'relative', height: 190, borderRadius: 4, overflow: 'hidden',
            background: 'var(--panel-2)', marginBottom: 12,
          }}>
            <img
              src={`${assetBase()}${answerRow.img}`}
              alt=""
              style={{
                width: '100%', height: '100%', objectFit: 'cover',
                filter: `blur(${blur}px)`, transform: `scale(${zoom})`,
                transition: 'filter .35s ease, transform .35s ease',
              }}
            />
            {!state.done && (
              <div className="tiny" style={{
                position: 'absolute', right: 8, bottom: 8, padding: '2px 8px',
                borderRadius: 999, background: 'rgba(8,12,18,.72)', color: 'var(--muted)',
              }}>
                每猜错一次清楚一点
              </div>
            )}
          </div>
        ) : (
          <div className="row" style={{ gap: 12, marginBottom: 12 }}>
            <div style={{
              width: 62, height: 62, borderRadius: 4, display: 'grid', placeItems: 'center',
              background: 'var(--panel-2)', border: '1px solid var(--line)',
              fontSize: 30, fontWeight: 800, color: 'var(--faint)',
            }}>
              {state.done ? (
                <img src={`${assetBase()}${answerRow.img}`} alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
              ) : '?'}
            </div>
            <div className="small muted">
              {state.done
                ? <>答案是 <b style={{ color: 'var(--text)' }}>{answerRow.name}</b></>
                : <>还剩 <b style={{ color: 'var(--text)' }}>{left}</b> 次机会。绿色＝完全对上，黄色＝沾边，↑↓＝答案比你猜的高／低。</>}
            </div>
          </div>
        )}

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
                    <b>{c.name}</b> <span className="tiny faint">{c.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </form>
        )}

        {block && !state.done && (
          <p className="tiny" style={{ color: 'var(--warn)', margin: '0 0 8px' }}>{block}</p>
        )}

        {/* what has been tried */}
        {rows.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 4 }}>
            <table>
              {rows[0].cells.length > 0 && (
                <thead>
                  <tr>
                    <th>猜的</th>
                    {rows[0].cells.map((c) => <th key={c.label} className="center">{c.label}</th>)}
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
                    {r.cells.map((c) => {
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
        )}

        {state.done && (
          <p className="small" style={{ marginTop: 12, marginBottom: 0, color: state.solved ? 'var(--win)' : 'var(--muted)' }}>
            {state.solved
              ? `第 ${used} 次猜中，连续第 ${state.streak} 天。明天换一道，题型是轮着来的。`
              : `今天没猜出来，连胜清零了。明天再来。`}
          </p>
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
