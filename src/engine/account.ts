/**
 * The card mode's account: one random string, and nothing else.
 *
 * Deliberately the weakest kind of account there is. No email, no password, no
 * recovery — you are handed an id, told to screenshot it, and that string is
 * your collection forever. Anyone who has it is you, and losing it loses the
 * account. That is stated plainly on the screen that hands it over, because a
 * player who finds out later is a player who lost something.
 *
 * It exists for exactly one reason: the daily check-in has to run off a clock
 * the player does not control, and a server clock needs somewhere to keep the
 * streak. Everything else about the card mode would have been happy in
 * localStorage — and still falls back to it when the server is unreachable.
 */
import type { GachaState } from './gacha'
import type { RivalSquad } from './arena'
import { GACHA_VERSION, STAMINA_MAX, clampState, newGacha } from './gacha'
import { newChallenge } from './challenge'

const ID_KEY = 'valmanager:card:id'
const MIRROR = 'valmanager:card:state:'

/** Crockford base32: no I, L, O or U, so nothing can be misread off a screenshot. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 20 characters of it — 100 bits, because this string is the whole password. */
export function newId(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  const body = Array.from(bytes, (b) => ALPHABET[b % 32]).join('')
  return `VM-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}-${body.slice(16, 20)}`
}

/**
 * Read back whatever the player pasted.
 *
 * Mirrors cards-api.js exactly. The four letters the alphabet leaves out are
 * the four people mistype, so O becomes 0 and I becomes 1 rather than being
 * rejected — someone typing an id off a photograph should not be told it is
 * wrong when it is only ambiguous.
 */
export function normalizeId(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1').replace(/U/g, 'V')
  const body = s.startsWith('VM') ? s.slice(2) : s
  if (body.length !== 20) return null
  if ([...body].some((c) => !ALPHABET.includes(c))) return null
  return `VM-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}-${body.slice(16, 20)}`
}

// ---------------------------------------------------------------- local

export const rememberedId = (): string | null => {
  try { return localStorage.getItem(ID_KEY) } catch { return null }
}

export const rememberId = (id: string | null): void => {
  try {
    if (id) localStorage.setItem(ID_KEY, id)
    else localStorage.removeItem(ID_KEY)
  } catch { /* private mode; the id is still in memory for this session */ }
}

/**
 * The mirror is the journal; the server is a copy of it.
 *
 * That is the inversion this file was missing, and it cost somebody a pack. A
 * save can fail silently in more ways than it can succeed — a phone that has
 * just been put down freezes the debounce timer, kills the in-flight fetch and
 * can refuse the beacon, and none of that raises anything the old code looked
 * at. When it happens, the only copy of what the player just did is the one
 * sitting in this localStorage, and `loadAccount` used to overwrite it with
 * the server's older state on the very next visit.
 *
 * So the mirror carries two extra facts: the revision it was built on, and
 * whether it holds anything the server has not acknowledged. That is enough
 * for a load to tell "this device is behind" from "this device is ahead".
 */
interface Mirror {
  state: GachaState
  /** the server revision this was built on, null if never confirmed */
  rev: number | null
  /** true while it holds changes the server has not said yes to */
  dirty: boolean
}

const readMirror = (id: string): Mirror | null => {
  try {
    const raw = localStorage.getItem(MIRROR + id)
    if (!raw) return null
    const j: unknown = JSON.parse(raw)
    if (j && typeof j === 'object' && 'state' in j) return j as Mirror
    // Written before this shipped: a bare state, no revision. One of these is
    // holding the 试训包 that started all of this, so it is read, not dropped.
    return { state: j as GachaState, rev: null, dirty: true }
  } catch { return null }
}

const writeMirror = (state: GachaState, dirty: boolean): void => {
  try {
    const m: Mirror = { state, rev, dirty }
    localStorage.setItem(MIRROR + state.id, JSON.stringify(m))
  } catch { /* full or blocked */ }
}

/** When the newest thing in a save's log happened, or 0 if it has none. */
const newestAt = (s: GachaState | null | undefined): number => {
  const log = (s as { log?: { at?: string }[] } | null | undefined)?.log
  let max = 0
  for (const e of log ?? []) {
    const t = Date.parse(e?.at ?? '')
    if (Number.isFinite(t) && t > max) max = t
  }
  return max
}

/**
 * Is this device holding play the server never received?
 *
 * Two ways to know, and the second exists only for mirrors written before the
 * first one was possible:
 *
 *   - it is dirty, and built on a revision the server has not moved past. Then
 *     nobody else has written since, so these changes are simply the newest
 *     and taking them loses nothing.
 *   - it has no revision at all, and its newest logged action is later than
 *     anything the server holds. The server cannot be hiding something this
 *     mirror lacks: there is nothing after the mirror's own newest entry.
 *
 * Anything else and the server wins — in particular a dirty mirror whose base
 * revision has been passed, which means another device really did play, and
 * choosing between them needs a merge this game does not deserve.
 */
function mirrorIsAhead(m: Mirror, server: GachaState, serverRev: number | null): boolean {
  if (m.rev !== null) return m.dirty && (serverRev === null || m.rev >= serverRev)
  return newestAt(m.state) > newestAt(server)
}

// ---------------------------------------------------------------- server

export interface DayInfo {
  today: string
  /** false when there is no database behind the server, or no server at all */
  cloud: boolean
}

/**
 * How far this device's clock is from the server's, in ms.
 *
 * 体力 comes back by the hour, so it needs a moment and not just a date. The
 * offset is captured whenever the server answers, and `serverNow()` reads the
 * local clock through it — which means moving the system clock forward moves
 * the offset by the same amount and buys nothing.
 */
let skew = 0
const noteNow = (serverMs: unknown): void => {
  if (typeof serverMs === 'number' && Number.isFinite(serverMs)) skew = serverMs - Date.now()
}

export const serverNow = (): number => Date.now() + skew

/**
 * The revision this session last read or wrote.
 *
 * Sent with every save so the server can refuse one built on a state somebody
 * else has already moved past — a phone tab thawing out of the background and
 * beaconing an hour-old collection over a newer one is the case that made this
 * necessary, and there is no way to spot it without a version.
 */
let rev: number | null = null
export const knownRev = (): number | null => rev

/**
 * This account's 对战码, straight from the server.
 *
 * Eight characters of the id's hash. Safe to post anywhere — it cannot be
 * turned back into the id, which is the whole of the login here. Null until a
 * cloud load has happened, so the friend room asks people to come back online
 * rather than showing them a code that is not theirs.
 */
let code: string | null = null
export const myCode = (): string | null => code

/** Called when a foreign, newer state arrives and the local one must yield. */
type StaleHandler = (state: GachaState) => void
let onStale: StaleHandler | null = null
export const whenStale = (fn: StaleHandler | null): void => { onStale = fn }

/**
 * Date an unanchored 体力 meter from when the account was last saved.
 *
 * Only ever fills a blank; it never moves an anchor that already exists, so a
 * player cannot earn time by reloading.
 */
function anchorFrom(state: GachaState, saved: number | undefined): void {
  const d = state.daily as { staminaAt?: number }
  if (d.staminaAt) return
  d.staminaAt = saved && Number.isFinite(saved) ? saved : serverNow()
}

// guarded the way dossier.ts is, so a check script can import this file
const BASE = typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : '/'
const api = (path: string) => `${BASE}api/card/${path}`.replace(/([^:])\/\//g, '$1/')

export interface TopRow {
  rank: number
  name: string
  /** four characters off the account's id HASH, so two 「阿伟」 are telling apart */
  tag: string
  /** the name was kept off the board; its owner can rename and reappear */
  hidden: boolean
  /** 'id' = they typed their account id in the name box; 'word' = a blocked word */
  why?: 'id' | 'word'
  div: number
  points: number
  stars: number
  wins: number
  losses: number
  me: boolean
}

/**
 * The public ladder.
 *
 * The id is sent so the server can hand back the caller's own row even when it
 * is nowhere near the top — 「我在第几」 is the number worth opening a
 * leaderboard for. It is never echoed: what comes back is four characters of
 * its hash.
 */
export async function fetchTop(): Promise<TopRow[] | null> {
  try {
    const r = await fetch(api('top'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rememberedId() }),
    })
    if (!r.ok) return null
    const j = await r.json() as { ok?: boolean; rows?: TopRow[] }
    return j.ok && Array.isArray(j.rows) ? j.rows : null
  } catch {
    return null
  }
}

/**
 * A handful of other people's fives, near your own division.
 *
 * Fetched in a batch and used one at a time, so the ladder is not making a
 * request per match. Returns null when the server cannot be reached — the
 * caller falls back to the world's clubs, which is what every match was
 * before this existed.
 */
export async function fetchRivals(div: number): Promise<RivalSquad[] | null> {
  try {
    const r = await fetch(api('rivals'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rememberedId(), div }),
    })
    if (!r.ok) return null
    const j = await r.json() as { ok?: boolean; rivals?: RivalSquad[] }
    if (!j.ok || !Array.isArray(j.rivals)) return null
    // a five with a hole in it is not an opponent; the server filters for this
    // too, but a client that trusts a server it did not write is a client that
    // crashes on the day that server changes
    return j.rivals.filter((x) => Array.isArray(x.slots)
      && x.slots.filter(Boolean).length === 5)
  } catch {
    return null
  }
}

export type FriendMiss = 'bad' | 'missing' | 'empty' | 'clash' | 'offline'

/**
 * One friend's five, by 对战码.
 *
 * Same snapshot the ladder's opponents come from, asked for by name instead of
 * dealt out by division. Returns a reason rather than null when it fails, so
 * the room can say 「这个码没人用过」 instead of 「出错了」 — a code typed one
 * character wrong is the common case and deserves a sentence, not a shrug.
 */
export async function fetchFriend(
  code: string,
): Promise<{ ok: true; friend: RivalSquad & { code: string } } | { ok: false; why: FriendMiss }> {
  const clean = code.trim().toLowerCase().replace(/[^0-9a-f]/g, '')
  if (clean.length !== 8) return { ok: false, why: 'bad' }
  try {
    const r = await fetch(api('friend'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: clean }),
    })
    if (!r.ok) return { ok: false, why: 'offline' }
    const j = await r.json() as {
      ok?: boolean; friend?: RivalSquad & { code: string }
      bad?: boolean; missing?: boolean; empty?: boolean; clash?: boolean
    }
    if (j.ok && j.friend && Array.isArray(j.friend.slots)
      && j.friend.slots.filter(Boolean).length === 5) {
      return { ok: true, friend: j.friend }
    }
    return {
      ok: false,
      why: j.bad ? 'bad' : j.empty ? 'empty' : j.clash ? 'clash'
        : j.missing ? 'missing' : 'offline',
    }
  } catch {
    return { ok: false, why: 'offline' }
  }
}

/** Today, in the one timezone the streak rolls over in. Device clock is last resort. */
export async function fetchDay(): Promise<DayInfo> {
  try {
    const r = await fetch(api('day'), { cache: 'no-store' })
    const j = await r.json()
    noteNow(j?.now)
    if (j?.today) return { today: j.today, cloud: !!j.cloud }
  } catch { /* offline */ }
  return { today: localToday(), cloud: false }
}

const DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
})

/**
 * Which day a moment falls on, in the one timezone the calendar rolls over in.
 *
 * The same computation the server does, so the two always agree — which means
 * the client can work the date out from the server's CLOCK and never has to
 * hold a date string that goes stale. It used to hold one, fetched once at
 * boot: a tab left open across midnight went on believing it was yesterday,
 * so the check-in button came back for a day already claimed and the quest
 * board reset to the wrong day.
 */
export const dayOf = (ms: number): string => DAY_FMT.format(new Date(ms))

/** Today, by the server's clock where we have it and the device's otherwise. */
export const localToday = (): string => dayOf(serverNow())

export type LoadResult =
  | { ok: true; state: GachaState; today: string; cloud: boolean; recovered?: boolean }
  | { ok: false; reason: 'missing' | 'bad' | 'offline'; today: string }

export async function loadAccount(rawId: string): Promise<LoadResult> {
  const id = normalizeId(rawId)
  if (!id) return { ok: false, reason: 'bad', today: localToday() }
  let today = localToday()
  try {
    const r = await fetch(api('load'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const j = await r.json()
    noteNow(j?.now)
    if (typeof j?.rev === 'number') rev = j.rev
    if (typeof j?.code === 'string') code = j.code
    if (j?.today) today = j.today
    if (j?.ok && j.state) {
      const state = migrate(j.state as GachaState, id)
      // The 体力 meter is a stopwatch, and a save with no anchor has to be
      // dated from something real: `saved`, the last moment the state was
      // written. Anchoring to "now" instead — which is what opening the page
      // used to do — silently throws away every hour the player was offline,
      // which is most of them.
      anchorFrom(state, typeof j.saved === 'number' ? j.saved : undefined)
      const m = readMirror(id)
      if (m && mirrorIsAhead(m, state, typeof j.rev === 'number' ? j.rev : null)) {
        // This device did something the server never got. Hand it back and
        // push it up, instead of writing the server's older copy over the
        // only record of it — which is what used to happen, once per visit,
        // quietly, and made a lost save permanent on the next page load.
        const local = migrate(m.state, id)
        anchorFrom(local, typeof j.saved === 'number' ? j.saved : undefined)
        writeMirror(local, true)
        saveAccount(local, true)
        return { ok: true, state: local, today, cloud: true, recovered: true }
      }
      writeMirror(state, false)
      return { ok: true, state, today, cloud: true }
    }
    if (j?.missing) {
      // The server is up and has never heard of this id. A local mirror can
      // still exist — the account was made while the server was down — so it
      // is offered rather than discarded.
      const local = readMirror(id)
      if (local) return { ok: true, state: migrate(local.state, id), today, cloud: false }
      return { ok: false, reason: 'missing', today }
    }
  } catch { /* fall through to the mirror */ }
  const local = readMirror(id)
  if (local) return { ok: true, state: migrate(local.state, id), today, cloud: false }
  return { ok: false, reason: 'offline', today }
}

export interface CreateResult {
  state: GachaState
  today: string
  cloud: boolean
}

/** Mint an id and claim it. Falls back to a local-only account when offline. */
export async function createAccount(name: string): Promise<CreateResult> {
  const { today } = await fetchDay()
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newId()
    const state = newGacha(id, name.trim().slice(0, 20) || '经理', today)
    try {
      const r = await fetch(api('claim'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: state.name, state }),
      })
      const j = await r.json()
      noteNow(j?.now)
      if (typeof j?.rev === 'number') rev = j.rev
      if (typeof j?.code === 'string') code = j.code
      // 100 bits does not collide; the retry is here so that if it ever did,
      // the newcomer gets a fresh id instead of a stranger's collection
      if (j?.taken) continue
      rememberId(id)
      writeMirror(state, false)
      return { state, today: j?.today ?? today, cloud: !!j?.ok }
    } catch {
      rememberId(id)
      writeMirror(state, true)
      return { state, today, cloud: false }
    }
  }
  const id = newId()
  const state = newGacha(id, name.trim().slice(0, 20) || '经理', today)
  rememberId(id)
  writeMirror(state, true)
  return { state, today, cloud: false }
}

let pending: number | null = null
let inflight = false
let retries = 0

/**
 * Write the collection back, and keep trying until it lands.
 *
 * Debounced, because every pack, match and upgrade calls it and a ten-pull is
 * eleven state changes in two seconds.
 *
 * The version that lost a pack swallowed every failure under "the next save
 * will retry", which is true right up until the failed save is the last thing
 * the session does — and on a phone that is the ordinary way a session ends.
 * You win the match, open the pack it paid for, put the phone down, and the
 * browser freezes the timer and drops the request. There was no next save.
 *
 * So a non-2xx counts as a failure now rather than being read for a field it
 * does not carry, a failure schedules its own retry, and the mirror stays
 * marked dirty until the server has actually said yes.
 */
export function saveAccount(state: GachaState, immediate = false): void {
  writeMirror(state, true)
  if (pending) { clearTimeout(pending); pending = null }
  const send = async () => {
    if (inflight) { pending = window.setTimeout(send, 400); return }
    inflight = true
    try {
      const r = await fetch(api('save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: state.id, name: state.name, state, baseRev: rev }),
      })
      const j = await r.json().catch(() => null)
      if (typeof j?.rev === 'number') rev = j.rev
      if (typeof j?.code === 'string') code = j.code
      if (j?.stale && j.state) {
        // Another device wrote while this one was holding an older copy. It
        // does not get to win: take the server's state and let the screens
        // redraw from it, rather than overwriting an evening of somebody's
        // play with whatever this tab happened to remember.
        const fresh = migrate(j.state as GachaState, state.id)
        writeMirror(fresh, false)
        onStale?.(fresh)
      } else if (!r.ok) {
        // 429, 400, a proxy's 502 — all of them used to land here looking for
        // `rev`, not find it, and return as though the save had worked
        throw new Error(`save ${r.status}`)
      } else {
        retries = 0
        writeMirror(state, false)
      }
    } catch {
      // Back off, but do not give up while the tab is alive. The mirror is the
      // only copy of whatever this was, and it stays dirty until it lands, so
      // even a tab that dies here is recoverable on the next load.
      const wait = Math.min(30_000, 1500 * 2 ** retries++)
      pending = window.setTimeout(send, wait)
    } finally {
      inflight = false
    }
  }
  if (immediate) void send()
  else pending = window.setTimeout(send, 1200)
}

/** Push whatever is pending right now — for page-hide, where a timer will not fire. */
export function flushAccount(state: GachaState): void {
  if (pending) { clearTimeout(pending); pending = null }
  writeMirror(state, true)
  try {
    const body = JSON.stringify({ id: state.id, name: state.name, state, baseRev: rev })
    const blob = new Blob([body], { type: 'application/json' })
    // sendBeacon survives the page going away; fetch does not. It also returns
    // false when it will not queue — over quota, or a page already too far
    // gone — and ignoring that meant sending nothing and believing otherwise.
    if (navigator.sendBeacon?.(api('save'), blob)) return
    void fetch(api('save'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
    }).catch(() => { /* mirror is dirty; the next load picks it up */ })
  } catch { /* same */ }
  // Nothing here can learn whether the write was accepted — a beacon has no
  // reply to read. It does not need to: the mirror is left dirty, and if the
  // save did land the server's revision moves past it and the next load
  // prefers the server anyway. Both endings are correct without an answer.
}

/**
 * Try again, now that there is a reason to think it might work.
 *
 * Called when the tab comes back to the front and when the network returns —
 * the two moments when a save that died in the background can finally land.
 */
export function retryPending(state: GachaState): void {
  const m = readMirror(state.id)
  if (m?.dirty) { retries = 0; saveAccount(state, true) }
}

/** Bring an older save up to the current shape. */
function migrate(state: GachaState, id: string): GachaState {
  const g = state as GachaState & { version?: number }
  g.version = GACHA_VERSION
  g.id = id
  g.cards ??= {}
  g.packs ??= {}
  g.mythicDry ??= 0
  g.log ??= []
  g.squad ??= { slots: [null, null, null, null, null], coach: null }
  g.squad.slots ??= [null, null, null, null, null]
  g.ladder ??= { div: 0, stars: 0, best: 0, wins: 0, losses: 0, streak: 0 }
  // 大师 changed from a shelf into a score; accounts that were already there
  // start the new ladder at zero, which is the only fair place to start it
  g.ladder.points ??= 0
  g.ladder.bestPoints ??= g.ladder.points
  g.daily ??= {
    claimed: null, streak: 0, questDay: null, picked: [], progress: {}, taken: [],
    stamina: STAMINA_MAX, staminaAt: 0,
  }
  g.daily.picked ??= []
  g.daily.progress ??= {}
  g.daily.taken ??= []
  // accounts made before the daily budget existed start today with a full one
  g.daily.stamina ??= STAMINA_MAX
  g.daily.staminaAt ??= 0
  // accounts made before the daily challenge existed have never played one
  g.challenge ??= newChallenge()
  // an existing collection already sits somewhere on the series ladder; nothing
  // is marked claimed, so whatever it has already earned is waiting on the shelf
  g.series ??= {}
  g.friends ??= []
  return clampState(g)
}
