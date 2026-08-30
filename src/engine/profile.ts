/**
 * One id for the whole site.
 *
 * The card mode already had an account: twenty characters of Crockford base32,
 * no email and no password, held in localStorage and mirrored to a server row
 * keyed by its SHA-256. That id is now the site's id rather than one game's —
 * the manager's endings, achievements and lifetime numbers hang off the same
 * string, so a player who screenshots it once keeps everything.
 *
 * Deliberately kept OUT of the card mode's save. The two games are written by
 * different hands and change at different rates, and a profile that lived
 * inside `GachaState` would mean every ending written from the manager races
 * the card mode's own saves for the same row. So this is its own row, its own
 * endpoint and its own revision counter, and the only thing the two share is
 * the id itself — read from account.ts, never written by this file.
 *
 * Local first, always. The server is a copy that lets the profile follow a
 * player to another device; every read falls back to localStorage and every
 * write lands there first, so the whole thing works with no network at all.
 */
import { rememberedId } from './account'
import { earnedLifetime } from './achievements'
import { NET, netFetch } from './net'

const KEY = 'valmanager:profile:'

export interface CareerRecord {
  /** careers begun, including the one in progress */
  careers: number
  /** careers that reached the end of the ten years */
  finished: number
  /** careers ended by the board */
  sacked: number
  titles: number
  worldTitles: number
  /** best single-career trophy count */
  bestHaul: number
  /** seasons managed, added up across every career */
  seasons: number
  /** clubs managed, by id, so "三朝元老" means three different clubs */
  clubs: string[]
}

export interface Profile {
  id: string
  /** ending keys, from engine/endings.ts */
  endings: string[]
  /** achievement keys, from engine/achievements.ts */
  achievements: string[]
  record: CareerRecord
  /** ISO stamp of the last change, for the "上次游玩" line */
  at?: string
}

const emptyRecord = (): CareerRecord => ({
  careers: 0, finished: 0, sacked: 0,
  titles: 0, worldTitles: 0, bestHaul: 0, seasons: 0, clubs: [],
})

export const emptyProfile = (id: string): Profile => ({
  id, endings: [], achievements: [], record: emptyRecord(),
})

/** The id everything hangs off. Null until the player has made one. */
export const siteId = (): string | null => rememberedId()

/**
 * Has this account earned the right to start anywhere?
 *
 * Proving yourself once is enough: a three-peat of Champions in any save, a
 * career played to an ending at the ten-year mark, or reputation 90 — after
 * any of those, new careers ignore the reputation gate and the locked top
 * clubs alike. The first two ride on achievement keys precisely so that an
 * in-progress save counts the moment it qualifies, not when it ends.
 */
export const freeTeamChoice = (p: Profile): boolean =>
  p.record.finished >= 1
  || p.achievements.includes('threepeat')
  || p.achievements.includes('rep90')

// ---------------------------------------------------------------- local

/** Bring anything read off disk or the wire up to the current shape. */
function repair(raw: unknown, id: string): Profile {
  const p = (raw ?? {}) as Partial<Profile>
  const rec = { ...emptyRecord(), ...(p.record ?? {}) }
  // A number that arrives as a string or a NaN would poison every sum after
  // it, and these come off a network and out of localStorage.
  for (const k of ['careers', 'finished', 'sacked', 'titles', 'worldTitles', 'bestHaul', 'seasons'] as const) {
    rec[k] = Number.isFinite(Number(rec[k])) ? Math.max(0, Math.round(Number(rec[k]))) : 0
  }
  rec.clubs = Array.isArray(rec.clubs) ? [...new Set(rec.clubs.filter((x) => typeof x === 'string'))] : []
  return {
    id,
    endings: Array.isArray(p.endings) ? [...new Set(p.endings.filter((x) => typeof x === 'string'))] : [],
    achievements: Array.isArray(p.achievements)
      ? [...new Set(p.achievements.filter((x) => typeof x === 'string'))] : [],
    record: rec,
    at: typeof p.at === 'string' ? p.at : undefined,
  }
}

const COUNTED = 'valmanager:counted:'

/**
 * Claim a career for the lifetime totals, once and only once.
 *
 * The totals are sums — trophies, seasons, careers ended — and the screen that
 * writes them is a modal that mounts whenever the career tree renders with a
 * finished save. Leaving to the front page and coming back mounts it again,
 * and the whole career was added a second time: three visits to a single
 * eleven-season career read 「48 座冠军、33 个赛季、完成 3 次」.
 *
 * Endings and achievements never needed this — a set union is idempotent by
 * itself. Only the running totals do, so only they are gated.
 *
 * If localStorage is unavailable the answer is yes: counting a career once per
 * visit is wrong, but not counting it at all is worse, and that is the old
 * behaviour rather than a new failure.
 */
export function claimCareer(seed: number, id: string | null = siteId()): boolean {
  try {
    const key = `${COUNTED}${id ?? 'local'}:${seed}`
    if (localStorage.getItem(key)) return false
    localStorage.setItem(key, '1')
    return true
  } catch { return true }
}

export function readProfile(id: string | null = siteId()): Profile {
  // Falls back to the same 'local' bucket `record` writes to when there is no
  // account yet. It used to return an empty profile here instead of reading
  // it, which meant everything a player earned before making an id was
  // recorded and then never shown to them: somebody finished ten years,
  // unlocked twelve endings, and the front page told them 0/22.
  const key = id ?? 'local'
  try {
    const raw = localStorage.getItem(KEY + key)
    return repair(raw ? JSON.parse(raw) : null, key)
  } catch {
    return emptyProfile(key)
  }
}

function writeLocal(p: Profile): void {
  try { localStorage.setItem(KEY + p.id, JSON.stringify(p)) } catch { /* private mode */ }
}

/**
 * Fold new facts in and keep the result.
 *
 * Always a union, never a replacement: unlocking is one-way, so a profile that
 * arrives from an older device or a stale tab can only ever add. That is what
 * makes it safe to write from two places without a merge — there is nothing to
 * resolve when the operation is a set union and a running maximum.
 */
export function mergeProfile(a: Profile, b: Partial<Profile>): Profile {
  const rec = a.record
  const other = b.record
  return {
    id: a.id,
    endings: [...new Set([...a.endings, ...(b.endings ?? [])])],
    achievements: [...new Set([...a.achievements, ...(b.achievements ?? [])])],
    record: other ? {
      careers: Math.max(rec.careers, other.careers ?? 0),
      finished: Math.max(rec.finished, other.finished ?? 0),
      sacked: Math.max(rec.sacked, other.sacked ?? 0),
      titles: Math.max(rec.titles, other.titles ?? 0),
      worldTitles: Math.max(rec.worldTitles, other.worldTitles ?? 0),
      bestHaul: Math.max(rec.bestHaul, other.bestHaul ?? 0),
      seasons: Math.max(rec.seasons, other.seasons ?? 0),
      clubs: [...new Set([...rec.clubs, ...(other.clubs ?? [])])],
    } : rec,
    at: new Date().toISOString(),
  }
}

/**
 * Record something. Returns only what was NEW, so a caller can announce it.
 *
 * The whole point of returning the difference is the toast: an achievement the
 * player already had must not pop again every time the day ticks over, and the
 * daily check runs this with the full list of everything currently true.
 */
/**
 * Who to tell when something unlocks.
 *
 * A module-level subscriber rather than a prop threaded through the tree: the
 * three places that record — the turn handler, the 成就 screen and the end of a
 * career — are in different parts of the app, and none of them should have to
 * know how the announcement is drawn.
 */
type Announcer = (fresh: { endings: string[]; achievements: string[] }) => void
let announcer: Announcer | null = null
export const whenUnlocked = (fn: Announcer | null): void => { announcer = fn }

export function record(
  patch: { endings?: string[]; achievements?: string[]; record?: Partial<CareerRecord> },
  id: string | null = siteId(),
  opts: { announce?: boolean } = {},
): { fresh: { endings: string[]; achievements: string[] }; profile: Profile } {
  const key = id ?? 'local'
  const before = readProfile(key)
  const fresh = {
    endings: (patch.endings ?? []).filter((k) => !before.endings.includes(k)),
    achievements: (patch.achievements ?? []).filter((k) => !before.achievements.includes(k)),
  }
  const merged = mergeProfile(before, {
    endings: patch.endings,
    achievements: patch.achievements,
    record: patch.record ? { ...before.record, ...patch.record } as CareerRecord : undefined,
  })

  // 生涯成就 are a function of the record, not of anything a caller passes in,
  // so they are recomputed here rather than at every call site. Doing it after
  // the merge matters: 「解锁十种结局」 has to see the ending that was just
  // added, and 「走遍四大赛区」 the club that was just recorded.
  //
  // And BEFORE the nothing-new short-circuit, which is where they used to sit.
  // A career that quietly pushes the account past fifty titles unlocks no run
  // achievement on the way — so the turn had nothing fresh, returned early,
  // and 五十冠 never fired. It would eventually appear, whenever some unrelated
  // badge happened to unlock and drag the recount along with it, which is not
  // a thing anyone could have explained.
  const life = earnedLifetime(merged.record, merged)
  const newLife = life.filter((k) => !merged.achievements.includes(k))
  fresh.achievements = [...fresh.achievements, ...newLife]

  if (!fresh.endings.length && !fresh.achievements.length && !patch.record) {
    return { fresh, profile: before }
  }

  const next = newLife.length
    ? mergeProfile(merged, { achievements: newLife })
    : merged

  writeLocal(next)
  push(next)
  // The game-over screen is itself the announcement for the endings it just
  // recorded, so it opts out rather than being told twice.
  if (opts.announce !== false && (fresh.endings.length || fresh.achievements.length)) {
    announcer?.(fresh)
  }
  return { fresh, profile: next }
}

// ---------------------------------------------------------------- server

// guarded the way account.ts is, so a check script can import this file
const BASE = typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : '/'
const api = (path: string) => `${BASE}api/profile/${path}`.replace(/([^:])\/\//g, '$1/')

let pending: number | null = null
let inflight = false
let retries = 0

/**
 * Send it up, and keep trying while the tab is alive.
 *
 * Failure is cheap here in a way it is not for the card mode: the server does
 * a union of what it holds and what arrives, so a lost write costs nothing
 * that the next one will not restore, and there is no revision to conflict.
 * It still retries, because the alternative is a player who unlocks the last
 * ending on a phone and finds it missing on a laptop.
 */
function push(p: Profile): void {
  if (!NET || p.id === 'local') return
  if (pending) { clearTimeout(pending); pending = null }
  const send = async () => {
    if (inflight) { pending = setTimeout(send, 400) as unknown as number; return }
    inflight = true
    try {
      const r = await netFetch(api('save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, profile: p }),
      })
      if (!r.ok) throw new Error(`profile ${r.status}`)
      retries = 0
    } catch {
      const wait = Math.min(30_000, 1500 * 2 ** retries++)
      pending = setTimeout(send, wait) as unknown as number
    } finally {
      inflight = false
    }
  }
  pending = setTimeout(send, 900) as unknown as number
}

/**
 * Pull the account's profile down and union it into this device's copy.
 *
 * Called when the site loads with an id, and after signing in with one. Never
 * overwrites: what is here and what is there are both true, and unlocking only
 * ever adds — so the merge cannot lose an ending either side has seen.
 */
export async function syncProfile(id: string | null = siteId()): Promise<Profile> {
  const local = claimLocal(id)
  if (!id || !NET) return local
  try {
    const r = await netFetch(api('load'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const j = await r.json()
    if (!j?.ok || !j.profile) return local
    const merged = mergeProfile(local, repair(j.profile, id))
    writeLocal(merged)
    // if this device knew something the server did not, hand it back
    const grew = merged.endings.length !== (j.profile.endings?.length ?? 0)
      || merged.achievements.length !== (j.profile.achievements?.length ?? 0)
    if (grew) push(merged)
    return merged
  } catch {
    return local
  }
}

/**
 * Fold the id-less profile into a real id, once there is one.
 *
 * Somebody can play the manager before they have ever opened 开瓦包, and until
 * they do there is no account to hang anything on — so those unlocks go under
 * `local`. The moment an id exists, they belong to it, or a player who earns
 * six achievements and then makes an account has just lost them.
 *
 * Runs on every sync and is idempotent: after the first fold there is no
 * `local` row left to find.
 */
export function claimLocal(id: string | null): Profile {
  if (!id || id === 'local') return readProfile(id)
  const mine = readProfile(id)
  const orphan = readProfile('local')
  const hasAny = orphan.endings.length || orphan.achievements.length || orphan.record.careers
  if (!hasAny) return mine
  const merged = mergeProfile(mine, orphan)
  writeLocal(merged)
  try { localStorage.removeItem(KEY + 'local') } catch { /* nothing to clean up */ }
  push(merged)
  return merged
}

/** Move a profile onto a different id — used when the player pastes one in. */
export function adoptId(id: string): Profile {
  const from = readProfile()
  const to = readProfile(id)
  const merged = mergeProfile(to, from)
  writeLocal(merged)
  push(merged)
  return merged
}
