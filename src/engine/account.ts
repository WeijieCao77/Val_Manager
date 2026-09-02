/**
 * The card mode's account: one random string, and nothing else.
 *
 * Deliberately the weakest kind of account there is. No email, no password, no
 * recovery — you are handed an id, told to screenshot it, and that string is
 * your collection forever. Anyone who has it is you, and losing it loses the
 * account. That is stated plainly on the screen that hands it over, because a
 * player who finds out later is a player who lost something.
 *
 * What changed, and why this file is half the size it was: the collection is
 * the SERVER's now. It used to be written here — the client ran the rules,
 * mutated its copy and posted the whole thing up — which meant editing
 * localStorage was editing the account, and nothing on the server could tell.
 * Now every action worth anything (`act` below) is a request: 「开一个选拔包」
 * goes up, the pack comes back rolled, and so does the account as the server
 * now holds it. The client writes only what is worth nothing to anyone else —
 * the name, the five on the table, the presets, the friendlies — and the save
 * endpoint reads nothing else out of what it is sent. See engine/actions.ts.
 *
 * The local mirror is a display cache: what to show while the server is
 * unreachable. It no longer recovers play, because there is no play a client
 * can hold that the server has not already recorded.
 */
import type { GachaState } from './gacha'
import type { RivalSquad } from './arena'
import { CLIENT_KEYS, mergeClientFields, migrateGacha, takeServerFields } from './gacha'
import { rememberId, rememberedId } from './cardid'

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

interface Mirror {
  state: GachaState
  /** the server revision this was built on, null if never confirmed */
  rev: number | null
  /** true while it holds cosmetic changes the server has not said yes to */
  dirty: boolean
}

const readMirror = (id: string): Mirror | null => {
  try {
    const raw = localStorage.getItem(MIRROR + id)
    if (!raw) return null
    const j: unknown = JSON.parse(raw)
    if (j && typeof j === 'object' && 'state' in j) return j as Mirror
    return { state: j as GachaState, rev: null, dirty: true }
  } catch { return null }
}

const writeMirror = (state: GachaState, dirty: boolean): void => {
  try {
    const m: Mirror = { state, rev, dirty }
    localStorage.setItem(MIRROR + state.id, JSON.stringify(m))
  } catch { /* full or blocked */ }
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
 * the offset by the same amount and buys nothing. The meter itself is settled
 * on the server; this is only so the countdown on screen agrees with it.
 */
let skew = 0
const noteNow = (serverMs: unknown): void => {
  if (typeof serverMs === 'number' && Number.isFinite(serverMs)) skew = serverMs - Date.now()
}

export const serverNow = (): number => Date.now() + skew

/** The revision this session last read or wrote — sent with cosmetic saves. */
let rev: number | null = null
export const knownRev = (): number | null => rev

/**
 * This account's 对战码, straight from the server.
 *
 * Eight characters of the id's hash. Safe to post anywhere — it cannot be
 * turned back into the id, which is the whole of the login here.
 */
let code: string | null = null
export const myCode = (): string | null => code

/** Called when a foreign, newer state arrives and the local one must yield. */
type StaleHandler = (state: GachaState) => void
let onStale: StaleHandler | null = null
export const whenStale = (fn: StaleHandler | null): void => { onStale = fn }

// guarded the way dossier.ts is, so a check script can import this file
const BASE = typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : '/'
const api = (path: string) => `${BASE}api/card/${path}`.replace(/([^:])\/\//g, '$1/')

/** The part of the account this client is allowed to write. */
const clientFields = (state: GachaState): Partial<GachaState> => {
  const out: Partial<GachaState> = {}
  const src = state as unknown as Record<string, unknown>
  for (const k of CLIENT_KEYS) (out as unknown as Record<string, unknown>)[k] = src[k]
  return out
}

/** Take what the server handed back as the truth about everything it owns. */
function absorb(state: GachaState, fresh: unknown): boolean {
  if (!fresh || typeof fresh !== 'object') return false
  takeServerFields(state, migrateGacha(fresh as GachaState, state.id))
  return true
}

/**
 * The same, for a reply that did not come through `act` — the trading post
 * hands the account back after a listing or a bid, because it changed it.
 */
export function takeServer(state: GachaState, fresh: unknown, revision?: unknown): boolean {
  if (!absorb(state, fresh)) return false
  if (typeof revision === 'number') rev = revision
  writeMirror(state, false)
  return true
}

export type ActOutcome =
  | { ok: true; result?: unknown }
  | { ok: false; why: string; offline?: boolean }

/**
 * Do something that counts.
 *
 * The command goes up with the client's cosmetic fields — so a five changed
 * a second ago is the five the server plays — and the account comes back as
 * the server now holds it, which replaces everything the server owns in the
 * local copy. Whatever localStorage said a moment before is simply not what
 * is on screen any more.
 *
 * A refusal comes back with a reason written for the player, and usually the
 * account as well, so a stale screen corrects itself on the same round trip.
 */
export async function act(
  state: GachaState, action: string, args: Record<string, unknown> = {},
): Promise<ActOutcome> {
  try {
    const r = await fetch(api('act'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: state.id, action, args, client: clientFields(state) }),
    })
    const j = await r.json().catch(() => null) as {
      ok?: boolean; why?: string; rev?: number; now?: unknown; state?: unknown
      result?: unknown; code?: string; offline?: boolean
    } | null
    if (!j) return { ok: false, why: `服务器没有回应（${r.status}）` }
    noteNow(j.now)
    if (typeof j.rev === 'number') rev = j.rev
    if (typeof j.code === 'string') code = j.code
    if (j.state && absorb(state, j.state)) writeMirror(state, false)
    if (j.ok) return { ok: true, result: j.result }
    if (j.offline) return { ok: false, why: '服务器后面没有数据库，这一步做不了。', offline: true }
    return { ok: false, why: j.why ?? (r.status === 429 ? '操作太快了，等一下。' : '没成功，等会儿再试。') }
  } catch {
    return { ok: false, why: '连不上服务器——这一步需要联网。', offline: true }
  }
}

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

/** One card in a friend's collection, as the swap screen sees it. */
export interface FriendCard { id: string; level: number; dupes: number }

/**
 * A friend's whole collection, by 对战码 — ids and levels, nothing else.
 *
 * What the swap screen points at. The same door as fetchFriend, and the same
 * reasons it fails.
 */
export async function fetchFriendCards(
  code: string,
): Promise<{ ok: true; name: string; tag: string; code: string; cards: FriendCard[] } | { ok: false; why: FriendMiss }> {
  const clean = code.trim().toLowerCase().replace(/[^0-9a-f]/g, '')
  if (clean.length !== 8) return { ok: false, why: 'bad' }
  try {
    const r = await fetch(api('friend_cards'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: clean }),
    })
    if (!r.ok) return { ok: false, why: 'offline' }
    const j = await r.json() as {
      ok?: boolean; name?: string; tag?: string; cards?: FriendCard[]
      bad?: boolean; missing?: boolean; clash?: boolean
    }
    if (j.ok && Array.isArray(j.cards)) {
      return { ok: true, name: j.name ?? '', tag: j.tag ?? '', code: clean.toUpperCase(), cards: j.cards }
    }
    return { ok: false, why: j.bad ? 'bad' : j.clash ? 'clash' : j.missing ? 'missing' : 'offline' }
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
 * hold a date string that goes stale.
 */
export const dayOf = (ms: number): string => DAY_FMT.format(new Date(ms))

/** Today, by the server's clock where we have it and the device's otherwise. */
export const localToday = (): string => dayOf(serverNow())

export type LoadResult =
  | { ok: true; state: GachaState; today: string; cloud: boolean }
  | { ok: false; reason: 'missing' | 'bad' | 'offline'; today: string }

/**
 * Open the account.
 *
 * The server's copy is the account. A dirty mirror — a name typed or a five
 * rearranged while the last save was still in flight — contributes exactly
 * those fields and nothing else, and they go straight back up.
 */
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
      const state = migrateGacha(j.state as GachaState, id)
      const m = readMirror(id)
      if (m?.dirty && m.state) {
        // cosmetic edits this device made and never got to send
        mergeClientFields(state, m.state)
        writeMirror(state, true)
        void saveAccount(state, true)
      } else {
        writeMirror(state, false)
      }
      return { ok: true, state, today, cloud: true }
    }
    if (j?.missing) return { ok: false, reason: 'missing', today }
  } catch { /* fall through to the mirror */ }
  // Unreachable: show what this device last saw. Nothing valuable can be done
  // to it until the server is back, and the screens say so.
  const local = readMirror(id)
  if (local) return { ok: true, state: migrateGacha(local.state, id), today, cloud: false }
  return { ok: false, reason: 'offline', today }
}

export type CreateResult =
  | { ok: true; state: GachaState; today: string }
  | { ok: false; why: string }

/**
 * Mint an id and claim it.
 *
 * The server builds the account — the starter coins, the starter packs, the
 * seed — because an account built here would be an account built by whoever
 * edits this code. It needs the server, and says so when it cannot reach it;
 * there are no local-only accounts any more, because nothing a local-only
 * account did could ever be trusted afterwards.
 */
export async function createAccount(name: string): Promise<CreateResult> {
  const clean = name.trim().slice(0, 20) || '经理'
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newId()
    try {
      const r = await fetch(api('claim'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: clean }),
      })
      const j = await r.json()
      noteNow(j?.now)
      // 100 bits does not collide; the retry is here so that if it ever did,
      // the newcomer gets a fresh id instead of a stranger's collection
      if (j?.taken) continue
      if (!j?.ok || !j.state) {
        return { ok: false, why: j?.offline ? '服务器后面没有数据库，现在建不了账号。' : '服务器没接受，等会儿再试。' }
      }
      if (typeof j.rev === 'number') rev = j.rev
      if (typeof j.code === 'string') code = j.code
      const state = migrateGacha(j.state as GachaState, id)
      rememberId(id)
      writeMirror(state, false)
      return { ok: true, state, today: j.today ?? localToday() }
    } catch {
      return { ok: false, why: '连不上服务器。建账号需要联网——账号是存在服务器上的。' }
    }
  }
  return { ok: false, why: '三次都撞了号，再试一次。' }
}

let pending: number | null = null
let inflight = false
let retries = 0

/**
 * Write the cosmetic fields back, and keep trying until it lands.
 *
 * Debounced, because a five rearranged card by card is five saves in two
 * seconds. Only the client's own fields travel; whatever else the local copy
 * holds is not read, and the reply carries the server's account, which is
 * taken as the truth about everything it owns.
 */
export function saveAccount(state: GachaState, immediate = false): Promise<void> {
  writeMirror(state, true)
  if (pending) { clearTimeout(pending); pending = null }
  const send = async () => {
    if (inflight) { pending = window.setTimeout(send, 400); return }
    inflight = true
    try {
      const r = await fetch(api('save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: state.id, name: state.name, client: clientFields(state), baseRev: rev }),
      })
      const j = await r.json().catch(() => null)
      if (typeof j?.rev === 'number') rev = j.rev
      if (typeof j?.code === 'string') code = j.code
      if (j?.stale && j.state) {
        // Another device wrote its own five since this one last read: theirs
        // is the newer choice, and nothing of value rides on either. Adopted
        // INTO the object this tab is holding, not beside it — a tab told it
        // was stale must not be able to save the copy it was holding a moment
        // later with the revision it was just handed.
        const fresh = migrateGacha(j.state as GachaState, state.id)
        takeServerFields(state, fresh)
        mergeClientFields(state, fresh)
        writeMirror(state, false)
        onStale?.(state)
      } else if (!r.ok) {
        throw new Error(`save ${r.status}`)
      } else {
        retries = 0
        if (j?.state) absorb(state, j.state)
        writeMirror(state, false)
      }
    } catch {
      // back off, but do not give up while the tab is alive
      const wait = Math.min(30_000, 1500 * 2 ** retries++)
      pending = window.setTimeout(send, wait)
    } finally {
      inflight = false
    }
  }
  // settles when the FIRST attempt has been made — what a caller needs in
  // order not to read the server back before its own write has had its turn
  if (immediate) return send()
  pending = window.setTimeout(send, 1200)
  return Promise.resolve()
}

/** Push whatever is pending right now — for page-hide, where a timer will not fire. */
export function flushAccount(state: GachaState): void {
  if (pending) { clearTimeout(pending); pending = null }
  writeMirror(state, true)
  try {
    const body = JSON.stringify({ id: state.id, name: state.name, client: clientFields(state), baseRev: rev })
    const blob = new Blob([body], { type: 'application/json' })
    if (navigator.sendBeacon?.(api('save'), blob)) return
    void fetch(api('save'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
    }).catch(() => { /* mirror is dirty; the next load picks it up */ })
  } catch { /* same */ }
}

/**
 * Try again, now that there is a reason to think it might work.
 *
 * Called when the tab comes back to the front and when the network returns.
 */
export function retryPending(state: GachaState): void {
  const m = readMirror(state.id)
  if (m?.dirty) { retries = 0; saveAccount(state, true) }
}
