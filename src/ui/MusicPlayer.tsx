import { useCallback, useEffect, useRef, useState } from 'react'
import { TRACKS } from '../data/music'

/**
 * Background music, and a small window in the corner to run it from.
 *
 * It starts on its own where the browser allows that, and where it does not —
 * every phone, and a desktop that has never heard from this site — it waits
 * for the first tap anywhere on the page and starts then, which is the only
 * way a web page is permitted to make a sound. Until that tap the window says
 * so instead of the artist's name.
 *
 * Everything the listener chooses stays on the device: the volume, whether
 * they turned it off, the loop mode, which track, and whether the window is
 * folded to a disc. Turned off means off — the next visit does not even fetch
 * the file. Like the theme, this is about the room the screen is in, not the
 * account, so it never rides along with a save.
 *
 * The <audio> is made by hand rather than rendered, so a track change is one
 * synchronous src-and-play inside the click that asked for it. Safari only
 * trusts a play() it can trace back to a gesture, and a React re-render
 * cannot be traced back to anything.
 */
export type Loop = 'all' | 'one' | 'off'
const KEY = 'valmgr.music'

interface Prefs {
  /** 0..1 */
  vol: number
  muted: boolean
  loop: Loop
  track: number
  /** the listener pressed pause; nothing plays, nothing loads, until they press play */
  off: boolean
  /** the window is unfolded (false: just the disc) */
  open: boolean
}
const DEFAULTS: Prefs = { vol: 0.35, muted: false, loop: 'all', track: 0, off: false, open: true }

const readPrefs = (): Prefs => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw) as Partial<Prefs>
    return {
      vol: typeof p.vol === 'number' && p.vol >= 0 && p.vol <= 1 ? p.vol : DEFAULTS.vol,
      muted: p.muted === true,
      loop: p.loop === 'one' || p.loop === 'off' ? p.loop : 'all',
      track: typeof p.track === 'number' && p.track >= 0 && p.track < TRACKS.length ? Math.floor(p.track) : 0,
      off: p.off === true,
      open: p.open !== false,
    }
  } catch { return DEFAULTS }
}

const srcOf = (i: number): string =>
  `${typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : './'}${TRACKS[i].file}`

/** iOS owns the volume: the slider is ignored there, so it is not shown */
const IOS = typeof navigator !== 'undefined'
  && (/iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

const LOOPS: Record<Loop, { label: string; hint: string; next: Loop }> = {
  all: { label: '列表', hint: '列表循环：放完一轮从头再来', next: 'one' },
  one: { label: '单曲', hint: '单曲循环：这一首一直放', next: 'off' },
  off: { label: '顺序', hint: '顺序播放：放完一轮就停', next: 'all' },
}

export default function MusicPlayer() {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs)
  const [playing, setPlaying] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const patch = useCallback((p: Partial<Prefs>) => setPrefs((c) => ({ ...c, ...p })), [])

  const el = useCallback((): HTMLAudioElement => {
    if (!audio.current) {
      const a = new Audio()
      a.preload = 'auto'
      audio.current = a
    }
    return audio.current
  }, [])

  /** play, and remember whether the browser let us */
  const tryPlay = useCallback((a: HTMLAudioElement) => {
    a.play().then(() => setBlocked(false)).catch(() => setBlocked(true))
  }, [])

  /** point the element at a track; `go` plays it too */
  const load = useCallback((i: number, go: boolean) => {
    const a = el()
    const src = srcOf(i)
    if (!a.src.endsWith(TRACKS[i].file)) { a.src = src; a.load() }
    if (go) tryPlay(a)
  }, [el, tryPlay])

  // the element, its listeners, and the first attempt at playing
  useEffect(() => {
    const a = el()
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => {
      const p = prefsRef.current
      const n = TRACKS.length
      const next = p.track + 1
      if (next < n) { patch({ track: next }); load(next, true); return }
      if (p.loop === 'off') { patch({ off: true }); return }
      if (n === 1) { a.currentTime = 0; tryPlay(a); return }
      patch({ track: 0 }); load(0, true)
    }
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    a.addEventListener('ended', onEnded)
    const p = prefsRef.current
    a.volume = p.vol
    a.muted = p.muted
    a.loop = p.loop === 'one'
    if (!p.off) load(p.track, true)
    return () => {
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
      a.removeEventListener('ended', onEnded)
      a.pause()
    }
  }, [el, load, patch, tryPlay])

  // refused: the first gesture anywhere on the page is the one we were waiting for
  useEffect(() => {
    if (!blocked || prefs.off) return
    const a = el()
    const go = () => {
      a.play().then(() => {
        setBlocked(false)
        stop()
      }).catch(() => { /* still not allowed: keep listening */ })
    }
    const evs: (keyof WindowEventMap)[] = ['click', 'keydown', 'touchend']
    const stop = () => evs.forEach((e) => window.removeEventListener(e, go, true))
    evs.forEach((e) => window.addEventListener(e, go, true))
    return stop
  }, [blocked, prefs.off, el])

  useEffect(() => { const a = el(); a.volume = prefs.vol; a.muted = prefs.muted }, [prefs.vol, prefs.muted, el])
  useEffect(() => { el().loop = prefs.loop === 'one' }, [prefs.loop, el])
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* private mode: lasts the session */ }
  }, [prefs])

  const track = TRACKS[prefs.track]

  // what the lock screen and the keyboard's media keys see
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: '猪之家游戏' })
    } catch { /* an older browser: no lock-screen card, nothing lost */ }
  }, [track])

  const toggle = useCallback(() => {
    const a = el()
    if (a.paused) { patch({ off: false }); load(prefsRef.current.track, true) } else { patch({ off: true }); a.pause() }
  }, [el, load, patch])

  const step = useCallback((d: 1 | -1) => {
    const n = TRACKS.length
    if (n < 2) return
    const i = (prefsRef.current.track + d + n) % n
    patch({ track: i, off: false })
    load(i, true)
  }, [load, patch])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const set = (k: MediaSessionAction, f: (() => void) | null) => { try { ms.setActionHandler(k, f) } catch { /* unsupported action */ } }
    set('play', toggle)
    set('pause', toggle)
    set('previoustrack', TRACKS.length > 1 ? () => step(-1) : null)
    set('nexttrack', TRACKS.length > 1 ? () => step(1) : null)
    return () => { set('play', null); set('pause', null); set('previoustrack', null); set('nexttrack', null) }
  }, [toggle, step])

  const loop = LOOPS[prefs.loop]
  const many = TRACKS.length > 1
  const pct = Math.round(prefs.vol * 100)

  if (!prefs.open) {
    return (
      <div className="bgm shut">
        <button
          type="button"
          className="bgm-pill"
          onClick={() => patch({ open: true })}
          aria-label={`背景音乐：${track.title}${playing ? '，正在播放' : '，已暂停'}。展开`}
          title={`${track.title} · ${playing ? '播放中' : '已暂停'}`}
        >
          <i className={`bgm-vinyl${playing ? ' spin' : ''}`} aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div className="bgm open" role="region" aria-label="背景音乐">
      <div className="bgm-row top">
      <button
        type="button"
        className="bgm-disc"
        onClick={toggle}
        aria-label={playing ? '暂停' : '播放'}
        title={playing ? '暂停' : '播放'}
      >
        <i className={`bgm-vinyl${playing ? ' spin' : ''}`} aria-hidden="true" />
      </button>
      <div className="bgm-meta">
        <b className="bgm-title" title={`${track.title} — ${track.artist}`}>{track.title}</b>
        <span className="bgm-sub">
          {blocked && !prefs.off ? '点一下页面就开始播' : track.artist}
        </span>
      </div>
      <button type="button" className="bgm-ib fold" onClick={() => patch({ open: false })} aria-label="收起播放器" title="收起">
        <Svg d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z" />
      </button>
      </div>
      <div className="bgm-row bot">
      <div className="bgm-ctl" role="group" aria-label="播放控制">
        <button type="button" className="bgm-ib" onClick={() => step(-1)} disabled={!many} aria-label="上一首" title={many ? '上一首' : '只有一首歌'}>
          <Svg d="M6 5h2v14H6zM19 5v14L9 12z" />
        </button>
        <button type="button" className="bgm-ib main" onClick={toggle} aria-label={playing ? '暂停' : '播放'} title={playing ? '暂停' : '播放'}>
          {playing ? <Svg d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <Svg d="M8 5v14l11-7z" />}
        </button>
        <button type="button" className="bgm-ib" onClick={() => step(1)} disabled={!many} aria-label="下一首" title={many ? '下一首' : '只有一首歌'}>
          <Svg d="M16 5h2v14h-2zM5 5v14l10-7z" />
        </button>
        <button
          type="button"
          className={`bgm-loop${prefs.loop === 'off' ? '' : ' on'}`}
          onClick={() => patch({ loop: loop.next })}
          aria-label={`循环方式：${loop.hint}。点击换成${LOOPS[loop.next].label}`}
          title={loop.hint}
        >
          <Svg d="M17 7H7v3L3 6l4-4v3h12v6h-2zM7 17h10v-3l4 4-4 4v-3H5v-6h2z" />
          {loop.label}
        </button>
      </div>
      <div className="bgm-vol" role="group" aria-label="音量">
        <button
          type="button"
          className="bgm-ib"
          onClick={() => patch({ muted: !prefs.muted })}
          aria-label={prefs.muted ? '取消静音' : '静音'}
          title={prefs.muted ? '取消静音' : '静音'}
          aria-pressed={prefs.muted}
        >
          {prefs.muted || prefs.vol === 0
            ? <Svg d="M4 9v6h4l5 4V5L8 9zm12.5 3 2.5-2.5-1.4-1.4L15 10.6 12.4 8 11 9.4l2.6 2.6L11 14.6l1.4 1.4 2.6-2.6 2.6 2.6 1.4-1.4z" />
            : <Svg d="M4 9v6h4l5 4V5L8 9zm11.5 3A4.5 4.5 0 0 0 13 8v8a4.5 4.5 0 0 0 2.5-4zM13 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" />}
        </button>
        {!IOS && (
          <input
            type="range"
            min={0}
            max={100}
            value={prefs.muted ? 0 : pct}
            onChange={(e) => patch({ vol: Number(e.target.value) / 100, muted: false })}
            aria-label={`音量 ${pct}%`}
            title={`音量 ${pct}%`}
          />
        )}
      </div>
      </div>
    </div>
  )
}

function Svg({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={d} fill="currentColor" />
    </svg>
  )
}
