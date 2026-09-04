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
  // One row per screen per session carrying a running count, and one row per
  // session carrying the turn totals. They replaced 'screen', 'turn' and
  // 'turn_done', which were three quarters of the whole table and were only
  // ever read as sums. The three old names stay accepted: rows already written
  // are still queried alongside these, and a phone running yesterday's bundle
  // should not have its session silently dropped.
  'screens',
  'turns',
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
  // How big a career actually is on disk, once per session. Two rounds of
  // QuotaExceededError were diagnosed from the sizes of saves that had already
  // failed, which is the tail rather than the distribution — this is the
  // number that says whether a fix worked.
  'save_size',
  // the card mode — a separate game with a separate save, so it gets its own
  // names rather than muddying the career funnel
  'card_start',
  'card_pull',
  'card_match',
  'card_signin',
  // 每日挑战 — the one thing in the card mode that asks the player to know
  // something, and therefore the one whose solve rate is worth watching
  'card_challenge',
  // The five-year settlement asks the one question the career is built
  // around. The modal has always reported the answer; the allowlist did not
  // have the name, so every one of those answers was dropped at the door.
  'mid_review',
  // The front page sits in front of both games now, so the first decision a
  // visitor makes is which one — and until this existed, somebody who arrived,
  // read the page and left looked identical to somebody who never arrived.
  'home_go',
  // Reaching 2036 is the thing the ten-year rewrite was for, and it was the
  // one outcome with no event at all: `sacked` fired, finishing did not.
  'game_over',
  // Which endings and achievements actually get earned. The audit proved every
  // one is reachable in principle; this is whether anyone reaches it.
  'unlock',
  // the site account, which is opt-in and therefore worth watching
  'account',
  // switching the page's ground — dark, light or cream. session_start
  // carries which one a session ran on; this is the moment of choosing.
  'theme',
  'error',
])

/**
 * Props the dashboard reads as numbers, with the largest value each can mean.
 *
 * A type check was not enough. `{"day": 1.5}` is a number, passes
 * jsonb_typeof, and then `'1.5'::bigint` throws — one anonymous request and
 * every dashboard query fails for the next 180 days. `{"active_s": 1e308}`
 * type-checks too and renders a 308-digit number in the session panel.
 *
 * So each key carries its own ceiling and everything is coerced to a
 * non-negative integer inside it. A bound per key rather than one global clamp:
 * 1e9 seconds is thirty-one years, which is not a session length, and a number
 * you would not believe is a number you should not store.
 */
const NUMERIC_MAX = {
  active_s: 86_400,   // a day; nobody plays longer in one sitting
  sim_ms: 600_000,
  day: 20_000,        // a season is 336; a very long career, a few thousand
  year: 4_000,
  seasons: 500,
  turns: 100_000,
  // how many times one screen was opened in one session
  hits: 100_000,
  fast: 100_000,
  quiet: 100_000,
  conf: 100,
  confidence: 100,
  honours: 1_000,
  place: 100,
  age: 120,
  kb: 100_000,
  w: 20_000,
  h: 20_000,
  left: 100_000,
  // the card mode. Bounded like everything else, because the panels that read
  // them cast in SQL: a pack deals at most ten cards, the ladder has six
  // divisions, and a sign-in streak is counted in days.
  gold: 50,
  dupes: 50,
  owned: 10_000,
  pulls: 1_000_000,
  streak: 3_650,
  tries: 100,
  solved: 10,
  rival: 1,
  div: 50,
  round: 50,
  rating: 10_000,
}
const NUMERIC_PROPS = new Set(Object.keys(NUMERIC_MAX))

const MAX_BODY = 32 * 1024
const MAX_EVENTS = 50
const MAX_PROPS = 12
const MAX_STR = 120
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 120

const hits = new Map()

/**
 * Bounded, self-pruning, and keyed on something we never keep.
 *
 * Called twice per request with two different keys and two different budgets:
 * a generous one for the network address, which a whole neighbourhood may
 * share behind carrier NAT, and a tight one for the anonymous visitor id,
 * which is what a single flooding client cannot vary without also giving up
 * being counted.
 */
export function rateLimited(key, max = RATE_MAX) {
  const t = Date.now()
  const rec = hits.get(key)
  if (!rec || t - rec.start > RATE_WINDOW_MS) {
    hits.set(key, { start: t, n: 1 })
    if (hits.size > 20000) {
      for (const [k, v] of hits) if (t - v.start > RATE_WINDOW_MS) hits.delete(k)
    }
    return false
  }
  rec.n += 1
  return rec.n > max
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
          // the dashboard casts these in SQL, so they arrive as whole numbers
          // inside a range that query can survive, or they do not arrive
          if (typeof v === 'number' && Number.isFinite(v)) {
            props[key] = Math.max(0, Math.min(NUMERIC_MAX[key], Math.trunc(v)))
          }
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
