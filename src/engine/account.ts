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
import { GACHA_VERSION, STAMINA_MAX, clampState, newGacha } from './gacha'

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

const readMirror = (id: string): GachaState | null => {
  try {
    const raw = localStorage.getItem(MIRROR + id)
    return raw ? (JSON.parse(raw) as GachaState) : null
  } catch { return null }
}

const writeMirror = (state: GachaState): void => {
  try { localStorage.setItem(MIRROR + state.id, JSON.stringify(state)) } catch { /* full or blocked */ }
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

const api = (path: string) => `${import.meta.env.BASE_URL}api/card/${path}`.replace(/([^:])\/\//g, '$1/')

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

/**
 * The device's idea of today, in Shanghai time.
 *
 * Only used when the server cannot be reached. It is trivially spoofable by
 * changing the system date, which is precisely why the server owns the real
 * one — but refusing to run offline would be worse than a check-in somebody
 * could cheat in a single-player game.
 */
export const localToday = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())

export type LoadResult =
  | { ok: true; state: GachaState; today: string; cloud: boolean }
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
    if (j?.today) today = j.today
    if (j?.ok && j.state) {
      const state = migrate(j.state as GachaState, id)
      writeMirror(state)
      return { ok: true, state, today, cloud: true }
    }
    if (j?.missing) {
      // The server is up and has never heard of this id. A local mirror can
      // still exist — the account was made while the server was down — so it
      // is offered rather than discarded.
      const local = readMirror(id)
      if (local) return { ok: true, state: migrate(local, id), today, cloud: false }
      return { ok: false, reason: 'missing', today }
    }
  } catch { /* fall through to the mirror */ }
  const local = readMirror(id)
  if (local) return { ok: true, state: migrate(local, id), today, cloud: false }
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
      // 100 bits does not collide; the retry is here so that if it ever did,
      // the newcomer gets a fresh id instead of a stranger's collection
      if (j?.taken) continue
      rememberId(id)
      writeMirror(state)
      return { state, today: j?.today ?? today, cloud: !!j?.ok }
    } catch {
      rememberId(id)
      writeMirror(state)
      return { state, today, cloud: false }
    }
  }
  const id = newId()
  const state = newGacha(id, name.trim().slice(0, 20) || '经理', today)
  rememberId(id)
  writeMirror(state)
  return { state, today, cloud: false }
}

let pending: number | null = null
let inflight = false

/**
 * Write the collection back.
 *
 * Debounced, because every pack, match and upgrade calls it and a ten-pull is
 * eleven state changes in two seconds. The local mirror is written straight
 * away regardless — if the tab dies before the upload, nothing is lost that a
 * reload cannot recover.
 */
export function saveAccount(state: GachaState, immediate = false): void {
  writeMirror(state)
  if (pending) { clearTimeout(pending); pending = null }
  const send = async () => {
    if (inflight) { pending = window.setTimeout(send, 400); return }
    inflight = true
    try {
      await fetch(api('save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: state.id, name: state.name, state }),
      })
    } catch { /* the mirror already has it; the next save will retry */ } finally {
      inflight = false
    }
  }
  if (immediate) void send()
  else pending = window.setTimeout(send, 1200)
}

/** Push whatever is pending right now — for page-hide, where a timer will not fire. */
export function flushAccount(state: GachaState): void {
  if (pending) { clearTimeout(pending); pending = null }
  writeMirror(state)
  try {
    const body = JSON.stringify({ id: state.id, name: state.name, state })
    // sendBeacon survives the page going away; fetch does not
    if (navigator.sendBeacon) {
      navigator.sendBeacon(api('save'), new Blob([body], { type: 'application/json' }))
    }
  } catch { /* nothing more to try */ }
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
  return clampState(g)
}
