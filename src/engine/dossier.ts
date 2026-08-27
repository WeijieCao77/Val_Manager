/**
 * Everything about a real player that is not a number the match engine reads:
 * the photograph, the flag, the clubs they have been on, and what they have
 * won.
 *
 * Kept apart from world.json on purpose. That file is the simulation's input
 * and every byte of it is loaded into every save; this is reference material
 * the dossier screen and the card faces read, and nothing in the season loop
 * touches it.
 *
 * Split in two for the same reason. Every card drawn needs a face, a flag and
 * a name, so those 45KB ride along with the bundle. The club histories and the
 * 1,673 tournaments behind them are 850KB that only the dossier screen ever
 * opens — paying for that on first visit would have roughly doubled the
 * download for everybody, so `records.json` is fetched on demand.
 *
 * Built by scripts/build_dossier.py from vlr.gg player pages (photo, flag,
 * placements, winnings) and Liquipedia's team history.
 */
import RAW from '../data/dossier.json'

export interface DossierEntry {
  img?: string
  nat?: string
  real?: string
  /** career prize money in USD, as vlr.gg totals it */
  win?: number
  /** vlr.gg player id, for the "看 vlr 主页" link */
  vlr?: string
  /** number of outright wins — kept here so the list can sort by it cheaply */
  t?: number
}

interface DossierFile {
  meta: { sources: Record<string, string>; players: number; photos: number; events: number }
  players: Record<string, DossierEntry>
}

export const DOSSIER = RAW as unknown as DossierFile

export const dossierOf = (playerId: string): DossierEntry | undefined =>
  DOSSIER.players[playerId]

export const titleCount = (playerId: string): number => dossierOf(playerId)?.t ?? 0

/**
 * `public/faces` is copied verbatim into the build; base may be a subpath.
 *
 * Guarded because the check scripts under scripts/ import this module through
 * tsx, where there is no Vite env and reading it throws before any test runs.
 */
export const faceUrl = (file: string): string => {
  const base = typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : './'
  return `${base}faces/${file}`
}

// ---------------------------------------------------------------- records

/** [name, year] — deduplicated, because 518 players share ~1,700 tournaments. */
type EventRow = [string, number | null]
/** [eventId, placement, club, stage] */
type PlacementRow = [string, string | null, string | null, string | null]
/** [from, to, club] — `to` is null while they are still there */
type TenureRow = [string | null, string | null, string]

export interface Records {
  events: Record<string, EventRow>
  players: Record<string, { ev?: PlacementRow[]; th?: TenureRow[] }>
}

let cached: Records | null = null
let inflight: Promise<Records> | null = null

/** Fetch the heavy half, once per session. */
export function loadRecords(): Promise<Records> {
  if (cached) return Promise.resolve(cached)
  inflight ??= import('../data/records.json').then((m) => {
    cached = (m.default ?? m) as unknown as Records
    return cached
  })
  return inflight
}

/** Non-null once loadRecords() has resolved; for render paths that already waited. */
export const recordsNow = (): Records | null => cached

// ---------------------------------------------------------------- placements

export interface Placement {
  eventId: string
  event: string
  year: number | null
  place: string | null
  club: string | null
  stage: string | null
  /** first place outright — the only kind that belongs in a trophy cabinet */
  won: boolean
  /** a top-three finish */
  podium: boolean
  /** Champions, Masters, an international or a league playoff */
  major: boolean
}

const ordinal = (place: string | null): number | null => {
  if (!place) return null
  const m = /^(\d+)/.exec(place.trim())
  return m ? Number(m[1]) : null
}

/**
 * Which events actually count as silverware.
 *
 * vlr lists a Korean stage-1 open qualifier next to Champions. Weighting them
 * the same turns every journeyman into a decorated veteran, so the trophy
 * shelf only marks the tournaments the sport treats as majors.
 */
const MAJOR = /champions|masters|esports world cup|game changers|vct \d{4}|champions tour/i

export function placementsOf(r: Records, playerId: string): Placement[] {
  const rows = r.players[playerId]?.ev ?? []
  return rows.map(([eid, place, club, stage]) => {
    const [event, year] = r.events[eid] ?? [eid, null]
    const n = ordinal(place)
    return {
      eventId: eid, event, year, place, club, stage,
      won: place === '1st',
      podium: n != null && n <= 3,
      major: MAJOR.test(event),
    }
  })
}

/** The trophy shelf: outright wins, majors first, newest first. */
export const honoursOf = (r: Records, playerId: string): Placement[] =>
  placementsOf(r, playerId)
    .filter((p) => p.won)
    .sort((a, b) => Number(b.major) - Number(a.major) || (b.year ?? 0) - (a.year ?? 0))

export interface Tenure {
  from: string | null
  to: string | null
  club: string
  /** whether this is where they are now */
  current: boolean
  /** months, where both ends are known */
  months: number | null
}

const monthsBetween = (a: string | null, b: string | null): number | null => {
  if (!a) return null
  const start = new Date(a)
  const end = b ? new Date(b) : new Date()
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / (30.44 * 864e5)))
}

/**
 * Club history, newest first, with the repeated rows folded together.
 *
 * Liquipedia splits a tenure whenever the club renames or the roster page is
 * re-signed — DRX appears twice back to back, then "GEN" right after "Gen.G
 * Esports". Left alone the CV reads like six moves in a year that never
 * happened.
 */
export function tenuresOf(r: Records, playerId: string): Tenure[] {
  const rows = r.players[playerId]?.th ?? []
  const out: Tenure[] = []
  for (const [from, to, club] of rows) {
    const prev = out[out.length - 1]
    // rows arrive newest first, so the previous entry is the LATER spell
    if (prev && sameClub(prev.club, club)) {
      prev.from = from
      prev.months = monthsBetween(from, prev.to)
      continue
    }
    out.push({ from, to, club, current: to == null, months: monthsBetween(from, to) })
  }
  return out
}

const strip = (s: string) =>
  s.toLowerCase().replace(/\b(esports|esport|gaming|team|club|e-?sports)\b/g, '').replace(/[^a-z0-9]/g, '')

function sameClub(a: string, b: string): boolean {
  if (a === b) return true
  const x = strip(a)
  const y = strip(b)
  if (!x || !y) return false
  return x === y || x.startsWith(y) || y.startsWith(x)
}
