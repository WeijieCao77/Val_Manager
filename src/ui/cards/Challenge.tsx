import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../engine/account'
import { useCards } from './ctx'
import { Panel } from '../common'
import { track } from '../../engine/telemetry'
import {
  allChoices, CHALLENGE_COST, CHALLENGE_TRIES, challengeBlock, challengeToday,
  detail, evaluate, KIND_CN, revealed, triesLeft,
} from '../../engine/challenge'
import type { ChallengeTurn, GuessRow, HintMark } from '../../engine/challenge'

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
/** Letters and digits only, so 「GENG」 and 「Gen.G」 are the same word. */
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')

/**
 * The picker's short list, best match first.
 *
 * It used to be "the first eight things containing the text", and for 「LOUD」
 * that was LOUD's five players and three more before the club itself, which
 * sits further down the list — so the club could not be guessed at all. And
 * 「GENG」 found nothing, because the club is spelled Gen.G. Now a name or tag
 * that IS the text comes first, then the ones that start with it, then the
 * ones that merely contain it, and the hint (club · region) last.
 */
function rankMatches<T extends { id: string; name: string; hint: string }>(all: T[], query: string): T[] {
  const q = fold(query)
  if (!q) return []
  const scored: [number, T][] = []
  for (const c of all) {
    const name = fold(c.name)
    // the first half of the hint is the thing's other name — a club's tag,
    // an agent's English name, a map's — except for a player, whose hint is
    // the club he plays for, and 「LOUD」 must not make all five of them
    // rank level with the club
    const alias = /^P\d+$/.test(c.id) ? '' : fold(c.hint.split('·')[0])
    let s = 0
    if (name === q || alias === q) s = 4
    else if (name.startsWith(q) || alias.startsWith(q)) s = 3
    else if (name.includes(q)) s = 2
    else if (fold(c.hint).includes(q)) s = 1
    if (s) scored.push([s, c])
  }
  return scored.sort((a, b) => b[0] - a[0]).map(([, c]) => c).slice(0, 8)
}

const blank = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const k = document.createElement('canvas')
  k.width = Math.max(1, Math.round(w))
  k.height = Math.max(1, Math.round(h))
  const ctx = k.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return [k, ctx]
}

/**
 * A picture reduced to `cells` columns of colour.
 *
 * Shrunk to that many pixels across and grown back, so what comes out is the
 * average colour of each patch and nothing finer. This replaces a canvas
 * blur, which softened edges and kept every large shape — a crest blown up
 * to twice the frame stayed readable through 22px of it, and a map's hard
 * top and bottom edges showed at any radius. It also leaned on the canvas
 * filter, which Safari before 18 does not have, and an unfiltered draw is
 * the answer in the clear.
 *
 * Both directions go a factor of two at a time: one jump down aliases and
 * keeps fine detail as speckle instead of averaging it away, and one jump up
 * from a handful of pixels draws bilinear diamonds around every cell.
 */
function coarsen(src: HTMLCanvasElement, cells: number): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  if (!Number.isFinite(cells) || cells >= w) return src
  const tw = Math.max(1, Math.round(cells))
  const th = Math.max(1, Math.round((cells * h) / w))
  let cur = src
  while (cur.width / 2 > tw) {
    const [k, ctx] = blank(Math.ceil(cur.width / 2), Math.ceil(cur.height / 2))
    ctx.drawImage(cur, 0, 0, k.width, k.height)
    cur = k
  }
  const [tiny, tctx] = blank(tw, th)
  tctx.drawImage(cur, 0, 0, tw, th)
  cur = tiny
  while (cur.width * 2 < w) {
    const [k, ctx] = blank(cur.width * 2, cur.height * 2)
    ctx.drawImage(cur, 0, 0, k.width, k.height)
    cur = k
  }
  const [out, octx] = blank(w, h)
  octx.drawImage(cur, 0, 0, w, h)
  return out
}

/**
 * The frame's shape, and how wide it may grow.
 *
 * Detail is counted in cells across the frame, so the frame has to be the
 * same shape on every screen or the same count is a different puzzle. It
 * used to be 210px tall and as wide as the card: a 9:2 strip on a desktop,
 * about 8:5 on a phone. Six cells across was one row of colour on the
 * desktop — a horizontal gradient, nothing to see — and four rows on the
 * phone, where a face already had a shape. 16:10 is what the phone was
 * getting; on a desktop the frame stops growing at 480px and sits centred.
 */
const FRAME_ASPECT = [16, 10] as const
const FRAME_MAX = 480

/**
 * The colour under everything: the picture's own average.
 *
 * Faces, crests and agents are cut-outs on a transparent background — 490
 * of the 551 faces, every crest, every agent. Painted onto a transparent
 * canvas, that transparency went into the bitmap. On the page the box's
 * panel showed through it, so in the dark theme dark hair sank into a dark
 * ground; but 「复制图片」 hands over the bitmap with its alpha, and pasted
 * onto a white chat window the silhouette — hair, head, shoulders — stood
 * out crisp against white, coarsened or not. The light themes gave the same
 * outline on the page itself, which made 浅 and 米 easier than 深.
 *
 * So the frame is painted on an opaque ground first: the picture's own
 * average colour, weighted by alpha. Fixed per picture, the same on every
 * theme, and on average the one colour the subject's edge contrasts with
 * least. What is copied is now exactly what is on the page.
 */
function groundOf(pic: HTMLImageElement): string {
  const n = 16
  const [, ctx] = blank(n, n)
  ctx.drawImage(pic, 0, 0, n, n)
  const d = ctx.getImageData(0, 0, n, n).data
  let r = 0, g = 0, b = 0, a = 0
  for (let i = 0; i < d.length; i += 4) {
    const w = d[i + 3]
    r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; a += w
  }
  if (!a) return '#6b7078'
  return `rgb(${Math.round(r / a)}, ${Math.round(g / a)}, ${Math.round(b / a)})`
}

/**
 * The frame at this many cells of detail.
 *
 * Three of the four kinds are square — faces 192², agents 128², crests 256²
 * — and only a map is a 4.55:1 strip, so a frame that cropped or letterboxed
 * gave the kind away from across the room. The picture is drawn whole and
 * contained on a backdrop of itself blown up past the box and washed out,
 * and then the whole frame is coarsened together: at the opening six cells
 * the strip's edges and the backdrop are one smudge, and they separate only
 * as the misses buy detail. Everything sits on an opaque ground — see
 * groundOf — so the bitmap carries no alpha for a copy to expose.
 */
function paintPuzzle(
  ctx: CanvasRenderingContext2D, pic: HTMLImageElement,
  w: number, h: number, zoom: number, cells: number,
) {
  const [frame, f] = blank(w, h)
  f.fillStyle = groundOf(pic)
  f.fillRect(0, 0, w, h)
  // backdrop: the picture past the edges of the box, washed to eight cells
  const cover = Math.max(w / pic.width, h / pic.height) * (zoom + 0.4)
  const [back, b] = blank(w, h)
  b.drawImage(pic, (w - pic.width * cover) / 2, (h - pic.height * cover) / 2, pic.width * cover, pic.height * cover)
  f.globalAlpha = 0.75
  f.drawImage(coarsen(back, 8), 0, 0)
  f.globalAlpha = 1
  // subject: the whole picture, contained
  const fit = Math.min(w / pic.width, h / pic.height) * zoom
  f.drawImage(pic, (w - pic.width * fit) / 2, (h - pic.height * fit) / 2, pic.width * fit, pic.height * fit)
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(coarsen(frame, cells), 0, 0)
}

export default function Challenge() {
  const { g, today, act, toast } = useCards()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const { kind, answer, state, rows } = challengeToday(g, today)
  // One list, all four kinds. The screen deliberately does not say which sort
  // of thing today is — working that out is the first half of the puzzle.
  const choices = useMemo(() => allChoices(), [])
  const used = state.guesses.length
  const left = triesLeft(state)
  const block = challengeBlock(g, today)

  const guessed = new Set(state.guesses)
  const matches = query.trim() ? rankMatches(choices.filter((c) => !guessed.has(c.id)), query) : []

  // the guess is judged and paid on the server; the row it hands back is the
  // same row the table draws from the account afterwards
  const submit = async (id: string) => {
    const why = challengeBlock(g, today)
    if (why) { toast(why); return }
    if (busy) return
    setBusy(true)
    const r = await act('challenge', { guessId: id })
    setBusy(false)
    if (!r.ok) { toast(r.why); return }
    const turn = (r.result as { turn: ChallengeTurn }).turn
    setQuery('')
    if (turn.finished) {
      const after = g.challenge
      const tries = after?.guesses.length ?? 0
      track('card_challenge', {
        kind, solved: turn.solved ? 1 : 0, tries, streak: after?.streak ?? 0,
      })
      if (turn.solved) {
        const rw = turn.reward
        toast(`猜中了！第 ${tries} 次 · +${rw?.coins ?? 0} 金币`
          + (rw?.pack ? ` + ${rw.pack === 'ten' ? '十连包' : rw.pack === 'elite' ? '选拔包' : '试训包'}` : '')
          + (rw?.streakPack ? ' + 连签七天的十连包' : ''))
      } else {
        toast(`没猜中，答案是 ${answerRow.name}。退回 ${turn.reward?.coins ?? 0} 金币，明天再来。`)
      }
    }
  }

  // the answer's own row, used for the reveal — built here rather than stored
  const answerRow: GuessRow = evaluate(kind, answer, answer)

  // how much of the picture is showing: nothing at the start, all of it at the end
  const show = state.done ? 1 : revealed(used)
  const zoom = 1 + (1 - show) * 1.6
  const cells = state.done ? Infinity : detail(used)

  // The picture comes from a route that names nothing — POST, no id in the
  // address, a generic file name — and is painted onto a canvas at the
  // current detail. It used to be an <img> of faces/P267.webp: drag it to the
  // desktop and the file name was the answer, at full clarity.
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [pic, setPic] = useState<HTMLImageElement | null>(null)
  const [picMissing, setPicMissing] = useState(false)
  useEffect(() => {
    let alive = true
    let url = ''
    setPic(null); setPicMissing(false)
    fetch(api('puzzle'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: g.id }),
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => new Promise<HTMLImageElement>((resolve, reject) => {
        url = URL.createObjectURL(blob)
        const im = new Image()
        im.onload = () => resolve(im)
        im.onerror = () => reject(new Error('decode'))
        im.src = url
      }))
      .then((im) => { if (alive) setPic(im) })
      .catch(() => { if (alive) setPicMissing(true) })
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [g.id, today, answer])
  useEffect(() => {
    const c = canvas.current
    if (!c || !pic) return
    // device pixels, or the answer is soft even once it is in the clear — and
    // a whole number of 16-pixel columns, so the frame is exactly 16:10 and a
    // given detail makes the same grid of cells on every screen
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const [aw, ah] = FRAME_ASPECT
    const w = Math.max(aw, Math.round(((c.clientWidth || FRAME_MAX) * dpr) / aw) * aw)
    c.width = w
    c.height = (w / aw) * ah
    const ctx = c.getContext('2d')
    if (!ctx) return
    paintPuzzle(ctx, pic, c.width, c.height, zoom, cells)
  }, [pic, zoom, cells])

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
          <b>每个账号的题目都不一样</b>，日期以服务器为准。一天一次，
          入场 <b>{CHALLENGE_COST} 金币</b>——猜中按用了几次给卡包（<b>一次猜中给十连包</b>），
          没猜中退一半。
        </p>

        {/* The subject — see paintPuzzle for why it is drawn the way it is,
            and FRAME_ASPECT for why the box is this shape everywhere. */}
        <div style={{
          position: 'relative', width: `min(100%, ${FRAME_MAX}px)`,
          aspectRatio: `${FRAME_ASPECT[0]} / ${FRAME_ASPECT[1]}`,
          borderRadius: 4, overflow: 'hidden',
          background: 'var(--panel-2)', margin: '0 auto 12px',
          display: answerRow.img ? undefined : 'grid', placeItems: 'center',
        }}>
          {/* the answer always has a picture — answerPool sees to that — but a
              data file can always lose one, and a broken image is a broken
              puzzle for everybody on earth that day */}
          {(!answerRow.img || picMissing) && (
            <span className="faint small">{picMissing ? '（图片没加载出来，刷新试试）' : '（这一题没有图）'}</span>
          )}
          {answerRow.img && !picMissing && (
            <canvas
              ref={canvas}
              aria-hidden
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: pic ? 'block' : 'none' }}
            />
          )}
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
            onSubmit={(e) => { e.preventDefault(); if (matches[0]) void submit(matches[0].id) }}
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
              <button className="primary" type="submit" disabled={!!block || !matches[0] || busy}>
                猜
              </button>
            </div>
            {matches.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5,
                background: 'var(--panel)', border: '1px solid var(--line)',
                borderRadius: 3, marginTop: 3, overflow: 'hidden',
                boxShadow: 'var(--shadow-card)',
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
                    onClick={() => void submit(c.id)}
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
                  <b>别人的题目和你的不一样</b>，发出去也帮不上他，只会剧透你自己这一局。
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
