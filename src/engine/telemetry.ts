/**
 * What the game reports back about how it is being played.
 *
 * The owner had no idea whether anyone came back a second time. This answers
 * that, and stops there: it records what someone did with the game, never who
 * they are.
 *
 * Identity is a random id generated in the browser on first visit. The server
 * never sees or stores an IP address. Two consequences worth stating plainly:
 * clearing site data makes someone a new person, and two people sharing a
 * phone are one person. For "did anyone come back", that is far more accurate
 * than an IP — Chinese carriers put hundreds of users behind one address and
 * move a single user between several in an evening.
 *
 * Nothing here can break the game. Every entry point swallows its own errors,
 * the queue is bounded, and a server that is down or blocked simply means the
 * events are dropped.
 */

// Relative like the card api, so a copy served under a subpath (the B站 Toy
// platform, a GitHub Pages checkout) posts into its own path — where the 404
// drops the event, as designed — instead of at the host's real API root.
// Guarded because scripts/ import the engine through tsx, where there is no
// Vite env and reading it throws before any test runs.
const ENDPOINT = `${typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : './'}api/e`
const ID_KEY = 'vm:vid'
const SEQ_KEY = 'vm:vseq'

/** Longest gap that still counts as the same sitting. */
const SESSION_GAP_MS = 30 * 60 * 1000
/** How often an open tab confirms someone is still there. */
const HEARTBEAT_MS = 60 * 1000
/**
 * Playtime is the sum of confirmed minutes, not wall-clock between first and
 * last event. A tab left open overnight stops confirming — the page is hidden
 * and nothing is being clicked — so the night does not count as play.
 */
const IDLE_MS = 3 * 60 * 1000

type Props = Record<string, string | number | boolean | null | undefined>

interface Queued {
  name: string
  t: number
  /** monotonic within the session, so a re-delivered batch can be recognised */
  n: number
  props?: Props
}

let visitorId = ''
let sessionId = ''
let sessionSeq = 0
let queue: Queued[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
let lastActivity = 0
/** confirmed active milliseconds this session */
let activeMs = 0
/** every event this session gets the next number, and keeps it across retries */
let eventNo = 0
let started = false
let disabled = false

const now = () => Date.now()

function readId(): string {
  try {
    let v = localStorage.getItem(ID_KEY)
    if (!v) {
      // crypto.randomUUID is unavailable on http:// origins in some browsers
      v = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
      localStorage.setItem(ID_KEY, v)
    }
    return v
  } catch {
    // private mode with storage denied: still usable, just never recognised again
    return `eph-${Math.random().toString(36).slice(2, 12)}`
  }
}

function bumpSession(): void {
  try {
    const n = Number(localStorage.getItem(SEQ_KEY) ?? '0') + 1
    localStorage.setItem(SEQ_KEY, String(n))
    sessionSeq = n
  } catch {
    sessionSeq = 1
  }
  sessionId = `${visitorId.slice(0, 8)}-${now().toString(36)}`
}

/** Roughly what kind of screen this is, which is all the layout work needs. */
function device(): string {
  const w = window.innerWidth
  return w < 720 ? 'phone' : w < 1100 ? 'tablet' : 'desktop'
}

function send(events: Queued[], keepalive: boolean): void {
  if (!events.length) return
  const body = JSON.stringify({
    v: 1,
    vid: visitorId,
    sid: sessionId,
    seq: sessionSeq,
    dev: device(),
    tz: -new Date().getTimezoneOffset(),
    events,
  })
  try {
    // sendBeacon survives the page being closed, which is exactly when the
    // session-end event fires and is the one we least want to lose
    if (keepalive && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive,
    }).catch(() => {})
  } catch {
    /* nothing here is worth breaking a game over */
  }
}

function flush(keepalive = false): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  const batch = queue
  queue = []
  send(batch, keepalive)
}

/**
 * Record something the player did.
 *
 * Batched: a phone on a flaky connection should not make a request per click,
 * and the queue is capped so a long offline stretch cannot grow without bound.
 */
export function track(name: string, props?: Props): void {
  if (disabled || !started) return
  try {
    lastActivity = now()
    queue.push({ name, t: lastActivity, n: ++eventNo, props })
    if (queue.length >= 20) { flush(); return }
    if (!flushTimer) flushTimer = setTimeout(() => flush(), 5000)
  } catch {
    /* ignore */
  }
}

let sinceReport = 0

/**
 * One confirmed minute.
 *
 * The accumulated total is also reported every few minutes, not only at the
 * end. iOS Safari drops `pagehide` often enough that a session-end-only design
 * loses the playtime of exactly the users this game has most of — so the total
 * is sent as it grows, and the dashboard takes the largest figure it has seen
 * for a session rather than requiring a final one.
 */
function tick(): void {
  const idle = now() - lastActivity
  if (document.visibilityState !== 'visible' || idle > IDLE_MS) return
  activeMs += HEARTBEAT_MS
  sinceReport += HEARTBEAT_MS
  if (sinceReport >= 3 * HEARTBEAT_MS) {
    sinceReport = 0
    // Deliberately NOT through track(): track() stamps lastActivity, so the
    // heartbeat kept resetting the very idle timer that is supposed to stop
    // it. A tab left open and untouched reported four hours of "active" play.
    queue.push({
      name: 'session_ping',
      t: now(),
      n: ++eventNo,
      props: { active_s: Math.round(activeMs / 1000) },
    })
    flush()
  }
}

function end(reason: string): void {
  if (!started) return
  queue.push({
    name: 'session_end',
    t: now(),
    n: ++eventNo,
    props: { active_s: Math.round(activeMs / 1000), reason },
  })
  flush(true)
}

/**
 * Start reporting. Safe to call twice; does nothing when the page is served
 * from a file:// origin or a dev server, so local play is never counted.
 */
export function startTelemetry(): void {
  if (started || typeof window === 'undefined') return
  if (location.protocol === 'file:' || location.hostname === 'localhost') {
    disabled = true
    return
  }
  started = true
  visitorId = readId()
  bumpSession()
  eventNo = 0
  lastActivity = now()

  let hadSave = false
  let freshId = false
  try {
    hadSave = !!localStorage.getItem('valmgr:save')
    freshId = sessionSeq === 1
  } catch { /* storage denied */ }
  track('session_start', {
    // WeChat and Xiaohongshu webviews strip the referrer, so this is mostly
    // null for the audience that matters — kept because when it is there it
    // is the only thing that says where someone came from
    ref: document.referrer ? new URL(document.referrer).hostname : null,
    w: window.innerWidth,
    h: window.innerHeight,
    // a first-ever id sitting next to an existing save means the id churned
    new_id: freshId,
    had_save: hadSave,
  })

  heartbeat = setInterval(tick, HEARTBEAT_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // a long time away is a new sitting, not a continuation of the old one
      if (now() - lastActivity > SESSION_GAP_MS) {
        end('gap')
        activeMs = 0
        bumpSession()
        eventNo = 0
        track('session_start', { ref: null, w: window.innerWidth, h: window.innerHeight })
      }
      lastActivity = now()
    } else {
      flush(true)
    }
  })
  window.addEventListener('pagehide', () => end('pagehide'))
}

/** Only for tests. */
export function _stopTelemetry(): void {
  if (heartbeat) clearInterval(heartbeat)
  heartbeat = null
  started = false
  queue = []
}
