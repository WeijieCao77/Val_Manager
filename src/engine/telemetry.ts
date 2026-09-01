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

const ENDPOINT = '/api/e'
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

/**
 * The two counters that used to be one row each.
 *
 * Measured on a week of real traffic: 341 rows per visitor, of which `screen`
 * was 52% and `turn` 23% — three quarters of the table spent on two events
 * that nothing ever reads individually. The dashboard asks 「哪个页面被打开了
 * 多少次」 and 「最深推到第几天、人均多少回合」, both of which are aggregates,
 * and an aggregate does not need one row per click.
 *
 * So they are counted here and reported as running totals, the way the
 * playtime ping already works: cumulative, sent when the tab goes away and
 * occasionally during a long sitting, and read back as a max per session. That
 * shape is what makes a re-delivered beacon harmless — a repeat of a total is
 * the same total.
 *
 * Only what CHANGED since the last report goes out, which is what stops a long
 * session from turning the saving back into a cost.
 */
const screenHits: Record<string, number> = {}
const screenSent: Record<string, number> = {}
let turnCount = 0
let fastCount = 0
let quietCount = 0
let deepDay = 0
let deepYear = 0
let simMax = 0
let turnsSent = -1

/** How often a long sitting reports its totals anyway, in heartbeats. */
const ROLLUP_EVERY = 15

/** One screen opened. Counted, not sent. */
export function countScreen(to: string): void {
  if (disabled || !started || !to) return
  lastActivity = now()
  screenHits[to] = (screenHits[to] ?? 0) + 1
}

/** One turn taken, with how far into the career it was. */
export function countTurn(day: number, year: number, fast: boolean): void {
  if (disabled || !started) return
  lastActivity = now()
  turnCount++
  if (fast) fastCount++
  if (Number.isFinite(day) && day > deepDay) deepDay = day
  if (Number.isFinite(year) && year > deepYear) deepYear = year
}

/**
 * That turn finished, and how long the league took to simulate it.
 *
 * The worst one is the number that matters — a turn that takes three seconds
 * is a frozen phone, and an average hides it behind a hundred fast ones. This
 * used to be a row per turn carrying a figure nothing ever read.
 */
export function countTurnDone(simMs: number, quiet: boolean): void {
  if (disabled || !started) return
  if (quiet) quietCount++
  if (Number.isFinite(simMs) && simMs > simMax) simMax = Math.round(simMs)
}

/**
 * Queue whatever moved since last time.
 *
 * Deliberately NOT through track(): track() stamps lastActivity, and a report
 * is not the player doing something — the same trap the playtime ping fell
 * into once already.
 */
function queueRollups(): void {
  for (const [to, hits] of Object.entries(screenHits)) {
    if (screenSent[to] === hits) continue
    screenSent[to] = hits
    queue.push({ name: 'screens', t: now(), n: ++eventNo, props: { to, hits } })
  }
  if (turnCount && turnsSent !== turnCount) {
    turnsSent = turnCount
    queue.push({
      name: 'turns',
      t: now(),
      n: ++eventNo,
      props: {
        turns: turnCount, fast: fastCount, quiet: quietCount,
        day: deepDay, year: deepYear, sim_ms: simMax,
      },
    })
  }
}

let sinceReport = 0
let sinceRollup = 0

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
  sinceRollup += 1
  // a sitting long enough to be worth insuring against a lost pagehide
  if (sinceRollup >= ROLLUP_EVERY) { sinceRollup = 0; queueRollups() }
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
  queueRollups()
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
    // Which door they came in by. The game answers on more than one domain and
    // they all reach the same server and the same table, so without this the
    // owner cannot tell whether a domain is carrying any traffic at all — a
    // referrer only ever names somewhere else.
    host: location.hostname,
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
        // the totals are per session and are read back as a max per session,
        // so a new session has to start them over or the first report of the
        // new one would carry the old one's numbers
        for (const k of Object.keys(screenHits)) { delete screenHits[k]; delete screenSent[k] }
        turnCount = 0; fastCount = 0; quietCount = 0
        deepDay = 0; deepYear = 0; simMax = 0; turnsSent = -1
        track('session_start', {
          ref: null, host: location.hostname, w: window.innerWidth, h: window.innerHeight,
        })
      }
      lastActivity = now()
    } else {
      // going away is the reliable moment on a phone — iOS drops pagehide
      // often enough that a rollup which only left at session end would be
      // lost for exactly the audience this game has most of
      queueRollups()
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

/** Only for tests: what the rollups are holding right now. */
export function _rollupState() {
  return { screenHits: { ...screenHits }, turnCount, fastCount, quietCount, deepDay, deepYear, simMax }
}
