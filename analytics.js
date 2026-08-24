/**
 * Where the play data goes, and what it is allowed to be.
 *
 * The ingest endpoint is necessarily public — the game has no accounts and
 * nothing to authenticate with — so it is written as if the internet will find
 * it, because the internet will. Everything is bounded: the body, the batch,
 * the number of properties, the length of every string, the rate per address,
 * and the set of event names that exist at all. An unknown name is dropped
 * rather than stored, so nobody can fill the table with their own vocabulary.
 *
 * The client's IP is used to rate-limit and is then discarded. It is never
 * written to the database, never logged, and never leaves the process. What is
 * stored is the anonymous id the browser made up for itself.
 */
import { timingSafeEqual } from 'node:crypto'

/** Every event the game is allowed to report. Anything else is dropped. */
export const EVENTS = new Set([
  'session_start',
  'session_end',
  'session_ping',
  'screen',
  'career_start',
  'career_resume',
  'turn',
  'turn_done',
  'action_spend',
  'match_watched',
  'match_skipped',
  'transfer_bid',
  'transfer_enquiry',
  'training_set',
  'tactics_set',
  'commercial',
  'stage_done',
  'season_done',
  'sacked',
  'game_over',
  'save_export',
  'save_import',
  'error',
])

/** Props the dashboard reads as numbers. Anything else under these keys is dropped. */
const NUMERIC_PROPS = new Set([
  'active_s', 'day', 'year', 'seasons', 'turns', 'sim_ms', 'conf',
  'confidence', 'honours', 'place', 'age', 'w', 'h', 'left',
])

const MAX_BODY = 32 * 1024
const MAX_EVENTS = 50
const MAX_PROPS = 12
const MAX_STR = 120
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 120

const hits = new Map()

/** Bounded, self-pruning, and keyed on something we never keep. */
export function rateLimited(key) {
  const t = Date.now()
  const rec = hits.get(key)
  if (!rec || t - rec.start > RATE_WINDOW_MS) {
    hits.set(key, { start: t, n: 1 })
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (t - v.start > RATE_WINDOW_MS) hits.delete(k)
    }
    return false
  }
  rec.n += 1
  return rec.n > RATE_MAX
}

const str = (v, max = MAX_STR) =>
  typeof v === 'string' && v.length ? v.slice(0, max) : null

/** Trim a payload down to exactly what the schema accepts, or return null. */
export function sanitize(body) {
  if (!body || typeof body !== 'object') return null
  const vid = str(body.vid, 64)
  const sid = str(body.sid, 64)
  if (!vid || !sid) return null
  const dev = ['phone', 'tablet', 'desktop'].includes(body.dev) ? body.dev : null
  const seq = Number.isFinite(body.seq) ? Math.max(0, Math.min(100000, body.seq | 0)) : null
  const tz = Number.isFinite(body.tz) ? Math.max(-900, Math.min(900, body.tz | 0)) : null

  const list = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : []
  const out = []
  for (const e of list) {
    if (!e || typeof e !== 'object') continue
    const name = str(e.name, 40)
    if (!name || !EVENTS.has(name)) continue
    // Trust the server's clock for ordering, but keep the client's offset so a
    // batch that sat in a queue on a train still lands in the right order.
    // finite is not the same as storable: 1e30 passes Number.isFinite and then
    // overflows the bigint column, failing the insert for every event batched
    // alongside it
    const t = Number.isFinite(e.t) && Math.abs(e.t) < 9e15 ? Math.trunc(e.t) : null
    // sendBeacon has no acknowledgement, so a phone on a bad connection will
    // re-deliver a batch it already sent. Without a per-session sequence there
    // is nothing to recognise the repeat by, and every count inflates quietly
    // and permanently. Playtime survives because it is a max, but turns and
    // the funnel would not.
    const n = Number.isFinite(e.n) ? Math.max(0, Math.min(1e9, e.n | 0)) : null
    const props = {}
    if (e.props && typeof e.props === 'object') {
      let n = 0
      for (const [k, v] of Object.entries(e.props)) {
        if (n >= MAX_PROPS) break
        const key = str(k, 32)
        if (!key) continue
        if (NUMERIC_PROPS.has(key)) {
          // the dashboard casts these to numeric in SQL; a string here would
          // make that query fail permanently for everyone
          if (typeof v === 'number' && Number.isFinite(v)) props[key] = v
          n += 1
          continue
        }
        if (typeof v === 'number' && Number.isFinite(v)) props[key] = v
        else if (typeof v === 'boolean') props[key] = v
        else if (typeof v === 'string') props[key] = v.slice(0, MAX_STR)
        else continue
        n += 1
      }
    }
    out.push({ name, t, n, props })
  }
  if (!out.length) return null
  return { vid, sid, seq, dev, tz, events: out }
}

export { MAX_BODY }

/** Constant-time token check, so the dashboard cannot be guessed a byte at a time. */
export function tokenOk(given, expected) {
  if (!expected) return false
  const a = Buffer.from(String(given ?? ''))
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const SCHEMA = `
create table if not exists events (
  id          bigserial primary key,
  ts          timestamptz not null default now(),
  client_t    bigint,
  visitor_id  text not null,
  session_id  text not null,
  seq         int,
  device      text,
  tz          int,
  name        text not null,
  props       jsonb
);
-- the same batch arriving twice must be a no-op, not a doubled count
alter table events add column if not exists n int;
create unique index if not exists events_dedupe_idx on events (session_id, n) where n is not null;
create index if not exists events_ts_idx      on events (ts desc);
create index if not exists events_visitor_idx on events (visitor_id, ts);
create index if not exists events_name_idx    on events (name, ts desc);
`
