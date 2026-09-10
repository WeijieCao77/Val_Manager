import { useEffect, useMemo, useRef, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import { track } from '../../engine/telemetry'
import {
  AIM_ROUND_MS, AIM_UP_MS, MINI_CN, MINI_GAMES, MINI_ROLE, MINIGAME_DAILY, RECON_GAP_MS, RECON_MAP_CN,
  RECON_N, RECON_SHOW_MS, SCHULTE_PENALTY_MS, aimSchedule, reconPuzzle, schulteOrder,
} from '../../engine/minigame'
import type { MiniGame, Tier } from '../../engine/minigame'
import { PACKS } from '../../engine/gacha'
import type { PackKind } from '../../engine/gacha'

/**
 * 位置小游戏 (beta).
 *
 * Three games, one per position, that pay a card of that position — see
 * engine/minigame.ts for the rules and why the server judges them. This file
 * is the playing surface only: a round is opened on the server (which is
 * what spends one of the day's five plays and hands out the seed), the
 * puzzle is built here from that seed by the same functions the server
 * uses, and what the player did is sent back as a transcript. The screen
 * never decides a tier or a reward.
 */
const assetBase = (): string => (typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : './')

interface Live { game: MiniGame; seed: number; startedAt: number }
interface Finish {
  game: MiniGame; tier: Tier; score: number; summary: string; detail: Record<string, number>
  reward: { pack: PackKind | null; coins: number }; playsLeft: number
}
const ROLE_VAR: Record<MiniGame, string> = { aim: 'var(--duelist)', recon: 'var(--initiator)', schulte: 'var(--sentinel)' }
const BLURB: Record<MiniGame, string> = {
  aim: '20 秒，靶子亮起就点，只亮 0.9 秒。',
  recon: '小地图上 4 个敌人逐个亮 1 秒，消失后点出他们的位置，按误差计分。',
  schulte: '25 个乱序数字，按 1 到 25 点完，点错罚 0.5 秒。',
}
const TIER_LINE: Record<MiniGame, string> = {
  aim: '金档：命中 ≥ 75% 且平均反应 ≤ 380 ms；银档：≥ 60% 且 ≤ 480 ms。',
  recon: '金档：平均误差 ≤ 4 米；银档：≤ 8 米。',
  schulte: '金档：≤ 25 秒；银档：≤ 35 秒。',
}

export default function Minigames() {
  const { g, today, act, toast, go } = useCards()
  const [game, setGame] = useState<MiniGame>('aim')
  const [live, setLive] = useState<Live | null>(null)
  // 3 · 2 · 1 before anything moves. A round used to begin the instant the
  // button came up — the first target lights 0.8 s later, the first enemy at
  // once — so the first one was always half-missed by somebody still moving
  // their hand to the screen.
  const [armed, setArmed] = useState(false)
  const liveRef = useRef<Live | null>(null)
  const [done, setDone] = useState<Finish | null>(null)
  const [busy, setBusy] = useState(false)
  const m = g.minigame
  const playsUsed = m && m.day === today ? m.plays : 0
  const playsLeft = Math.max(0, MINIGAME_DAILY - playsUsed)
  // a round the server still holds open that this screen is not playing:
  // the page was left mid-round; that play is spent, the next start replaces it
  const stale = !live && !!m?.live

  const start = async (which: MiniGame) => {
    if (busy) return
    setBusy(true)
    const r = await act('minigame_start', { game: which })
    setBusy(false)
    if (!r.ok) { toast(r.why); return }
    const res = r.result as Live & { playsLeft: number }
    track('minigame_start', { game: which })
    const l = { game: which, seed: res.seed, startedAt: res.startedAt }
    liveRef.current = l
    setDone(null)
    setArmed(false)
    setLive(l)
  }
  const finish = async (transcript: unknown) => {
    const l = liveRef.current
    if (!l) return
    liveRef.current = null
    setBusy(true)
    const r = await act('minigame_finish', { transcript })
    setBusy(false)
    setLive(null)
    if (!r.ok) { toast(r.why); return }
    const res = r.result as Finish
    track('minigame_finish', { game: res.game, tier: res.tier, score: res.score })
    setDone(res)
  }
  const quit = () => { liveRef.current = null; setLive(null); setArmed(false); toast('这局作废了，用掉的一次不退。') }

  return (
    <>
      <Panel
        title="位置小游戏"
        actions={
          <span className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="tag warn">beta</span>
            <span className="tiny muted mono">今天还能玩 {playsLeft}/{MINIGAME_DAILY} 次</span>
          </span>
        }
      >
        <p className="tiny faint" style={{ marginTop: 0, lineHeight: 1.7 }}>
          每个位置一个小游戏。金档、银档给位置包，金档另加金币；铜档只给少量金币。
          每天共 {MINIGAME_DAILY} 次，任意分配。测试中，数值会调。
        </p>
        <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
          {MINI_GAMES.map((k) => (
            <button
              key={k}
              className={`sm${game === k ? ' primary' : ''}`}
              disabled={!!live}
              onClick={() => { setGame(k); setDone(null) }}
              style={game === k ? { background: ROLE_VAR[k], borderColor: 'transparent', color: '#0e1620' } : undefined}
            >
              {MINI_ROLE[k]} · {MINI_CN[k]}
            </button>
          ))}
          <button className="sm" disabled title="控场的小游戏还在设计">控场 · 即将推出</button>
        </div>

        {!live && (
          <>
            <p className="small muted" style={{ marginTop: 0, lineHeight: 1.75 }}>{BLURB[game]}</p>
            <p className="tiny faint" style={{ marginTop: 0 }}>{TIER_LINE[game]} 奖励：{PACKS[MINI_PACK_OF[game]].name}。</p>
            {stale && <p className="tiny" style={{ color: 'var(--warn)' }}>上一局中途离开，那一次已用掉。</p>}
            <button className="primary" disabled={busy || playsLeft <= 0} onClick={() => void start(game)}>
              {playsLeft <= 0 ? '今天的次数用完了' : `开始（用 1 次，剩 ${playsLeft}）`}
            </button>
          </>
        )}

        {live && (
          <div className="mini-stage">
            {live.game === 'schulte' && <SchulteGame key={live.seed} seed={live.seed} armed={armed} onDone={finish} onQuit={quit} />}
            {live.game === 'aim' && <AimGame key={live.seed} seed={live.seed} armed={armed} onDone={finish} onQuit={quit} />}
            {live.game === 'recon' && <ReconGame key={live.seed} seed={live.seed} armed={armed} onDone={finish} onQuit={quit} />}
            {!armed && <Countdown color={ROLE_VAR[live.game]} onGo={() => setArmed(true)} />}
          </div>
        )}

        {done && !live && (
          <div style={{ marginTop: 14, padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--panel-2)' }}>
            <div className="row" style={{ gap: 14, alignItems: 'center' }}>
              <div className="display mono" style={{ fontSize: 36, lineHeight: 1, color: done.tier === '金' ? 'var(--gold)' : done.tier === '银' ? 'var(--text)' : 'var(--muted)' }}>{done.tier}</div>
              <div>
                <div><b>{MINI_CN[done.game]}：{done.summary}</b></div>
                <div className="tiny muted">得分 {done.score}。{TIER_LINE[done.game]}</div>
              </div>
            </div>
            <div className="row wrap" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
              {done.reward.pack ? (
                <>
                  <span className="small"><b>{PACKS[done.reward.pack].name} +1</b>{done.reward.coins ? `，+${done.reward.coins} 金币` : ''}</span>
                  <button className="sm primary" onClick={() => go('packs')}>去抽卡页打开</button>
                </>
              ) : (
                <span className="small">没过线，+{done.reward.coins} 金币。</span>
              )}
              <button className="sm" disabled={playsLeft <= 0} onClick={() => void start(done.game)}>再来一局</button>
            </div>
          </div>
        )}
      </Panel>
    </>
  )
}

/** which pack each game pays — mirrored here for the copy; the engine is the authority */
const MINI_PACK_OF: Record<MiniGame, PackKind> = { aim: 'duelist', recon: 'initiator', schulte: 'sentinel' }

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** 3 · 2 · 1 · 开始, per tick */
const COUNT_MS = 800

/**
 * The three seconds before a round starts.
 *
 * Client-side only, and deliberately so: the server's clock is already running
 * — it started when it handed out the seed — and every guard it applies gets
 * MORE slack from the wait, never less. A transcript is only ever shorter than
 * the server's elapsed time, and the two games that require a minimum elapsed
 * time can only overshoot it. So a countdown cannot buy anyone anything.
 */
function Countdown({ color, onGo }: { color: string; onGo: () => void }) {
  const [n, setN] = useState(3)
  const go = useRef(onGo)
  go.current = onGo
  useEffect(() => {
    const id = window.setInterval(() => setN((x) => x - 1), COUNT_MS)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => { if (n <= 0) { const t = window.setTimeout(() => go.current(), COUNT_MS); return () => window.clearTimeout(t) } }, [n])
  return (
    <div className="mini-countdown" aria-live="assertive" aria-atomic="true">
      <span key={n} className="mini-countdown-n display mono" style={{ color: n > 0 ? color : 'var(--win)' }}>
        {n > 0 ? n : '开始'}
      </span>
      <span className="tiny faint">准备好</span>
    </div>
  )
}

function Strip({ items }: { items: [string, string | number][] }) {
  return (
    <div className="row wrap" style={{ gap: 14, margin: '10px 0 8px', alignItems: 'baseline' }}>
      {items.map(([k, v]) => (
        <span key={k}><span className="tiny faint" style={{ marginRight: 4 }}>{k}</span><b className="mono" style={{ fontSize: 17 }}>{v}</b></span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- 哨卫 · 舒尔特方格
function SchulteGame({ seed, armed, onDone, onQuit }: { seed: number; armed: boolean; onDone: (t: unknown) => void; onQuit: () => void }) {
  const order = useMemo(() => schulteOrder(seed), [seed])
  const t0 = useRef(0)
  const taps = useRef<number[]>([])
  const wrongRef = useRef(0)
  const [next, setNext] = useState(1)
  const [wrong, setWrong] = useState(0)
  const [flash, setFlash] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!armed) return
    t0.current = performance.now()
    const id = window.setInterval(() => setElapsed(performance.now() - t0.current), 100)
    return () => window.clearInterval(id)
  }, [armed])
  const tap = (n: number, i: number) => {
    if (!armed || n < next) return
    if (n === next) {
      taps.current.push(Math.round(performance.now() - t0.current))
      if (n === order.length) onDone({ taps: taps.current, wrong: wrongRef.current })
      else setNext(n + 1)
    } else {
      wrongRef.current += 1
      setWrong(wrongRef.current)
      setFlash(i)
      window.setTimeout(() => setFlash(null), 220)
    }
  }
  return (
    <div>
      <Strip items={[['下一个', next], ['用时', fmt(elapsed + wrong * SCHULTE_PENALTY_MS)], ['点错', wrong]]} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, maxWidth: 420, touchAction: 'manipulation' }}>
        {order.map((n, i) => {
          const gone = n < next
          return (
            <button
              key={i}
              onPointerDown={(e) => { e.preventDefault(); tap(n, i) }}
              style={{
                aspectRatio: '1', borderRadius: 4, border: `1px solid ${flash === i ? 'var(--accent)' : gone ? 'var(--line-soft)' : 'var(--line)'}`,
                background: gone ? 'var(--panel-2)' : 'var(--panel)', color: gone ? 'var(--faint)' : 'var(--text)',
                font: '700 clamp(18px, 5vw, 26px)/1 var(--mono)', padding: 0, cursor: gone ? 'default' : 'pointer',
              }}
            >
              {/* face-down until 开始: three seconds to scan the grid is three
                  seconds off everyone's time, and the tiers are absolute */}
              {armed ? n : ''}
            </button>
          )
        })}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="sm ghost" onClick={onQuit}>放弃这局</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 决斗者 · 首杀反应
function AimGame({ seed, armed, onDone, onQuit }: { seed: number; armed: boolean; onDone: (t: unknown) => void; onQuit: () => void }) {
  const targets = useMemo(() => aimSchedule(seed), [seed])
  const t0 = useRef(0)
  const hits = useRef<(number | null)[]>(targets.map(() => null))
  const [up, setUp] = useState<number | null>(null)
  const [n, setN] = useState({ hits: 0, shown: 0, left: AIM_ROUND_MS })
  useEffect(() => {
    if (!armed) return
    t0.current = performance.now()
    const timers: number[] = []
    targets.forEach((tg, i) => {
      timers.push(window.setTimeout(() => { setUp(i); setN((s) => ({ ...s, shown: i + 1 })) }, tg.at))
      timers.push(window.setTimeout(() => setUp((cur) => (cur === i ? null : cur)), tg.at + AIM_UP_MS))
    })
    const tick = window.setInterval(() => setN((s) => ({ ...s, left: Math.max(0, AIM_ROUND_MS - (performance.now() - t0.current)) })), 100)
    timers.push(window.setTimeout(() => onDone({ hits: hits.current }), AIM_ROUND_MS + 150))
    return () => { timers.forEach((t) => window.clearTimeout(t)); window.clearInterval(tick) }
    // the schedule is fixed by the seed; onDone is the parent's finish, stable for this round
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, armed])
  const hit = (i: number) => {
    if (!armed || hits.current[i] != null) return
    const r = performance.now() - t0.current - targets[i].at
    if (r < 0 || r > AIM_UP_MS) return
    hits.current[i] = Math.round(r)
    setUp(null)
    setN((s) => ({ ...s, hits: s.hits + 1 }))
  }
  const avg = (() => { const xs = hits.current.filter((x): x is number => x != null); return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null })()
  return (
    <div>
      <Strip items={[['首杀', n.hits], ['被首杀', Math.max(0, n.shown - n.hits - (up != null ? 1 : 0))], ['平均反应', avg == null ? '—' : `${avg} ms`], ['剩余', fmt(n.left)]]} />
      <div
        style={{
          position: 'relative', aspectRatio: '4 / 3', maxWidth: 560, borderRadius: 4, overflow: 'hidden', touchAction: 'none',
          background: 'radial-gradient(ellipse at 50% 60%, var(--panel-2), var(--bg-rail, var(--panel)) 70%)', border: '1px solid var(--line-soft)',
        }}
      >
        {up != null && (
          <button
            aria-label="靶"
            onPointerDown={(e) => { e.preventDefault(); hit(up) }}
            style={{
              position: 'absolute', left: `${targets[up].x * 100}%`, top: `${targets[up].y * 100}%`,
              width: 'clamp(40px, 13%, 56px)', aspectRatio: '1', borderRadius: '50%', padding: 0,
              border: '3px solid #0e1620', background: 'var(--duelist)', boxShadow: '0 0 0 4px rgba(255,90,99,.35)', cursor: 'crosshair',
            }}
          />
        )}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="sm ghost" onClick={onQuit}>放弃这局</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 先锋 · 侦察报点
function ReconGame({ seed, armed, onDone, onQuit }: { seed: number; armed: boolean; onDone: (t: unknown) => void; onQuit: () => void }) {
  const puzzle = useMemo(() => reconPuzzle(seed), [seed])
  const win = puzzle.window
  const W = 760
  const cv = useRef<HTMLCanvasElement>(null)
  const img = useRef<HTMLImageElement | null>(null)
  const t0 = useRef(0)
  const marks = useRef<{ x: number; y: number }[]>([])
  const drag = useRef<number | null>(null)
  const [phase, setPhase] = useState<'show' | 'pick'>('show')
  const [count, setCount] = useState(0)
  const [shown, setShown] = useState(0)
  const lede = phase === 'show' ? `${RECON_MAP_CN[win.map]} · ${win.name}。记住 4 个敌人的位置。` : '点地图标出 4 个位置，可拖动微调，标满后点「报点」。'

  useEffect(() => {
    // The map is drawn from the first frame — orienting yourself on Haven
    // before the count is over is the point of a count. Only the enemies wait,
    // which is what `armed` gates below.
    if (armed) t0.current = performance.now()
    const im = new Image()
    im.src = `${assetBase()}minimaps/${win.map}.png`
    img.current = im
    const done = armed
      ? window.setTimeout(() => setPhase('pick'), RECON_N * (RECON_SHOW_MS + RECON_GAP_MS) + 200)
      : 0
    let raf = 0
    const cssVar = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()
    const toPx = (p: { x: number; y: number }) => ({ x: (p.x - win.x) / win.s * W, y: (p.y - win.y) / win.s * W })
    const dot = (ctx: CanvasRenderingContext2D, p: { x: number; y: number }, fill: string, text: string, ring?: number) => {
      const q = toPx(p)
      if (ring != null) { ctx.strokeStyle = fill; ctx.globalAlpha = 1 - ring; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(q.x, q.y, 14 + ring * 34, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1 }
      ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(q.x, q.y, 15, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#0e1620'; ctx.lineWidth = 3; ctx.stroke()
      ctx.fillStyle = '#0e1620'; ctx.font = '800 16px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, q.x, q.y + 1); ctx.textBaseline = 'alphabetic'
    }
    const draw = () => {
      const c = cv.current
      if (!c) return
      const ctx = c.getContext('2d')!
      const tt = armed ? performance.now() - t0.current : -1
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = cssVar('--panel-2') || '#1e2b39'; ctx.fillRect(0, 0, W, W)
      if (im.complete && im.naturalWidth) {
        const nw = im.naturalWidth
        ctx.globalAlpha = .92
        ctx.drawImage(im, win.x * nw, win.y * nw, win.s * nw, win.s * nw, 0, 0, W, W)
        ctx.globalAlpha = 1
      }
      const yellow = cssVar('--initiator') || '#f6c445'
      let visible = 0
      puzzle.enemies.forEach((p, i) => {
        const on = i * (RECON_SHOW_MS + RECON_GAP_MS), off = on + RECON_SHOW_MS
        if (tt >= on) visible = i + 1
        if (tt >= on && tt < off) dot(ctx, p, yellow, String(i + 1), Math.min(1, (tt - on) / 600))
      })
      setShown((s) => (s === visible ? s : visible))
      marks.current.forEach((p, i) => dot(ctx, p, '#ffffff', String(i + 1)))
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); window.clearTimeout(done) }
  }, [puzzle, win, armed])

  const fromEvent = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect()
    return { x: win.x + (e.clientX - r.left) / r.width * win.s, y: win.y + (e.clientY - r.top) / r.height * win.s }
  }
  const down = (e: React.PointerEvent) => {
    if (!armed || phase !== 'pick') return
    e.preventDefault()
    const p = fromEvent(e)
    const r = cv.current!.getBoundingClientRect()
    const grab = 22 / r.width * win.s   // 22 CSS px, whatever the screen
    const hit = marks.current.findIndex((m) => Math.hypot(m.x - p.x, m.y - p.y) <= grab)
    if (hit >= 0) { drag.current = hit; cv.current!.setPointerCapture(e.pointerId); return }
    if (marks.current.length >= RECON_N) return
    marks.current.push(p); drag.current = marks.current.length - 1
    cv.current!.setPointerCapture(e.pointerId)
    setCount(marks.current.length)
  }
  const move = (e: React.PointerEvent) => { if (drag.current == null || phase !== 'pick') return; marks.current[drag.current] = fromEvent(e) }
  const release = () => { drag.current = null }

  return (
    <div>
      <p className="small muted" style={{ margin: '0 0 6px' }}>{lede}</p>
      <Strip items={phase === 'show' ? [['敌人', `${shown}/${RECON_N}`]] : [['已标', `${count}/${RECON_N}`]]} />
      <canvas
        ref={cv} width={W} height={W}
        style={{ display: 'block', width: '100%', maxWidth: 560, borderRadius: 4, border: '1px solid var(--line-soft)', touchAction: 'none' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={release} onPointerCancel={release}
      />
      <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
        {phase === 'pick' && (
          <>
            <button className="sm primary" disabled={count < RECON_N} onClick={() => onDone({ marks: marks.current.map((m) => [m.x, m.y]) })}>报点</button>
            <button className="sm" onClick={() => { marks.current = []; setCount(0) }}>清空标记</button>
          </>
        )}
        <button className="sm ghost" onClick={onQuit}>放弃这局</button>
      </div>
    </div>
  )
}
