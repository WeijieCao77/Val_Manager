/**
 * Accounts for the card mode — the smallest thing that can be called one.
 *
 * The rest of this game has no accounts on purpose, and that stays true for
 * the career mode. The card mode needs one thing the career mode does not: a
 * calendar the player cannot move. A daily check-in that trusts the device
 * clock is not a daily check-in, it is a button. So the server owns the date,
 * and owning the date means the collection has to live here too.
 *
 * What identity means here: the player is handed one random string and told to
 * write it down. There is no email, no password, no recovery, and nothing that
 * could identify a person. The server never stores the string itself — only
 * its SHA-256 — so the table is a pile of hashes and game saves, and a copy of
 * it does not let anyone log in as anybody.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { displayName } from './names.js'
import { progressOf } from './progress.js'

export const CARD_SCHEMA = `
create table if not exists card_accounts (
  id_hash  text primary key,
  created  timestamptz not null default now(),
  seen     timestamptz not null default now(),
  name     text,
  rev      int not null default 1,
  state    jsonb not null
);
create index if not exists card_seen_idx on card_accounts (seen desc);
-- "seen" is bumped by reads as well as writes, so it cannot date a save. The
-- stamina meter needs to know when the state itself was last WRITTEN, which is
-- a different question and needs its own column. (No backticks in here: this
-- is a template literal and one would end it.)
alter table card_accounts add column if not exists saved timestamptz;
update card_accounts set saved = seen where saved is null;
-- the 好友对战码 is the first eight characters of id_hash, and looking one up
-- is otherwise a sequential scan of every account in the table
create index if not exists card_code_idx on card_accounts (left(id_hash, 8));
`

/** Bodies are capped well under this; 512KB is the point of refusing to look. */
export const MAX_STATE = 512 * 1024

const hash = (id) => createHash('sha256').update(String(id)).digest('hex')

/**
 * How much of the hash a battle code is.
 *
 * Eight hex characters: short enough to read out loud or type off a phone,
 * long enough that four billion of them makes walking the space pointless.
 * The leaderboard's #tag is the first four of the same hash, so a code and a
 * tag agree with each other, which is what makes 「#1C14 是你吗」 work.
 */
export const CODE_LEN = 8
export const battleCode = (idHash) => String(idHash ?? '').slice(0, CODE_LEN).toUpperCase()

/**
 * The id the client is told to keep.
 *
 * Crockford base32 without I, L, O and U, so nothing in it can be misread off
 * a screenshot, which is the only way most people will ever back it up. Twenty
 * characters is 100 bits: this string is the whole of authentication, so it
 * has to be unguessable even though the endpoint answers quickly.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function normalizeId(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '')
    // the four letters the alphabet leaves out are exactly the four people
    // mistype, so read them as what they were meant to be rather than refusing
    .replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1').replace(/U/g, 'V')
  const body = s.startsWith('VM') ? s.slice(2) : s
  if (body.length !== 20) return null
  if ([...body].some((c) => !ALPHABET.includes(c))) return null
  return `VM-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}-${body.slice(16, 20)}`
}

/**
 * Today, where the players are.
 *
 * Fixed to Asia/Shanghai rather than the visitor's zone: the streak has to
 * roll over at one moment for everybody, or a browser set to UTC-11 gets a
 * second check-in every evening.
 */
const DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
})
export const serverDay = () => DAY_FMT.format(new Date())

/**
 * The server's clock, in epoch ms.
 *
 * 体力 accrues by the hour, so the client needs a moment as well as a date —
 * and for the same reason the date is ours, the moment has to be too. The
 * client keeps the offset between this and its own clock and reads through it.
 */
export const serverNow = () => Date.now()

const sameId = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * What a save is allowed to be, and what gets stripped out of it.
 *
 * Almost nothing here is a fairness check — a single-player collection is the
 * player's own business, and an anti-cheat pass on a browser game is theatre.
 * Three things do matter:
 *
 *   - the blob has to be bounded, or one request fills the disk;
 *   - a check-in dated in the future would freeze that account's streak
 *     forever once the real date caught up, so it is refused;
 *   - the account id is deleted before the state is written. The client sends
 *     its whole save, and the save carries the id — which would have put the
 *     plaintext password back in the table the hash exists to keep it out of.
 *     The client already knows which id it logged in with and writes it back
 *     on load, so nothing downstream misses it.
 */
export function vetState(state, today) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null
  const raw = JSON.stringify(state)
  if (raw.length > MAX_STATE) return null
  const claimed = state?.daily?.claimed
  if (typeof claimed === 'string' && claimed > today) return null
  const { id, ...rest } = state
  void id
  return rest
}

export function makeCardApi(sql, { rateLimited, readBody, json }) {
  const guard = (req, res, bucket, max) => {
    if (rateLimited(bucket, max)) {
      json(res, 429, { ok: false, why: 'rate' })
      return true
    }
    return false
  }

  async function load(req, res, bucket) {
    // The id is the password, so this endpoint is the one worth guessing at.
    // 100 bits makes that hopeless on arithmetic alone; the limit is here so
    // it is also hopeless on time.
    if (guard(req, res, `cl:${bucket}`, 40)) return
    const today = serverDay()
    if (!sql) { json(res, 200, { ok: false, offline: true, today }); return }
    let body
    try { body = JSON.parse(await readBody(req, 4096)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(body?.id)
    if (!id) { json(res, 200, { ok: false, bad: true, today }); return }
    try {
      const rows = await sql`
        select state, rev, name, extract(epoch from coalesce(saved, seen)) * 1000 as saved
        from card_accounts where id_hash = ${hash(id)}`
      if (!rows.length) { json(res, 200, { ok: false, missing: true, today, now: serverNow() }); return }
      await sql`update card_accounts set seen = now() where id_hash = ${hash(id)}`
      // `saved` dates the 体力 meter for a save with no anchor of its own: it
      // is the last moment the state was WRITTEN, which is the last moment the
      // meter was known to be where it claims to be. Deliberately not `seen`,
      // which this very handler bumps on the way past.
      json(res, 200, {
        ok: true, today, now: serverNow(), saved: Number(rows[0].saved) || null,
        rev: rows[0].rev, state: rows[0].state,
        // the client cannot work its own code out — it has the id, not the
        // hash, and hashing in the browser to learn something the server
        // already knows would be work for nothing
        code: battleCode(hash(id)),
      })
    } catch (err) {
      console.warn('cards: load failed', err.message)
      json(res, 500, { ok: false, today })
    }
  }

  /**
   * Write the collection back, refusing to overwrite somebody's newer play.
   *
   * There was no version check at all, and the failure it allows is not
   * theoretical: a tab left open on a phone holds an hour-old state in memory,
   * and when the browser thaws it, flushAccount's sendBeacon posts that state
   * and the server took it. An evening on the desktop disappeared.
   *
   * So a save carries the revision it was built on. If the row has moved past
   * it, the write is refused and the current state handed back — whoever has
   * the older base loses at most their last action, instead of the other
   * device losing everything. A beacon cannot read the reply, which is fine:
   * the point is that it does not land.
   *
   * A save with no baseRev is accepted. Only tabs loaded before this shipped
   * send none, and they will be gone by tomorrow; refusing them would lose
   * real progress today to protect against a rarer loss.
   */
  async function save(req, res, bucket) {
    if (guard(req, res, `cs:${bucket}`, 120)) return
    const today = serverDay()
    if (!sql) { json(res, 200, { ok: false, offline: true, today }); return }
    let body
    try {
      body = JSON.parse(await readBody(req, MAX_STATE + 4096))
    } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(body?.id)
    if (!id) { json(res, 400, { ok: false, bad: true, today }); return }
    // the client normalises before sending; a mismatch means the id was
    // rewritten in flight, which is not a request worth serving
    if (body?.id && !sameId(normalizeId(body.id), id)) { json(res, 400, { ok: false }); return }
    const state = vetState(body?.state, today)
    if (!state) { json(res, 400, { ok: false, why: 'state' }); return }
    const name = typeof body?.name === 'string' ? body.name.slice(0, 40) : null
    const baseRev = Number.isInteger(body?.baseRev) ? body.baseRev : null
    try {
      // Progress never goes backwards.
      //
      // The revision check catches a client writing on top of a copy it has
      // not seen; it cannot catch a client writing on top of a copy it HAS
      // seen and then ignored — a tab told it was stale, adopting the truth
      // into one object and then saving from another. This is the property
      // that has to hold whatever any client does: packs opened, matches
      // played and cards owned only ever increase, so a save that lowers them
      // is a stale copy by definition and is refused the same way.
      const held = await sql`select state, rev from card_accounts where id_hash = ${hash(id)}`
      if (held.length && progressOf(state) < progressOf(held[0].state)) {
        json(res, 409, {
          ok: false, stale: true, today, now: serverNow(),
          rev: held[0].rev, state: held[0].state,
        })
        return
      }
      const rows = await sql`
        insert into card_accounts (id_hash, name, state, rev, saved)
        values (${hash(id)}, ${name}, ${sql.json(state)}, 1, now())
        on conflict (id_hash) do update
          set state = excluded.state,
              name  = coalesce(excluded.name, card_accounts.name),
              rev   = card_accounts.rev + 1,
              seen  = now(),
              saved = now()
          -- One static predicate rather than a spliced fragment: a nested
          -- tagged template here is not a boolean in every driver, and the
          -- check script caught it as "Invalid input for boolean type".
          --
          -- A null baseRev used to compare the row against itself — always
          -- true — so that a client too old to send one could still write.
          -- That is a door with no lock on it, and it is how an evening
          -- disappeared: any save that had never read the row overwrote it
          -- whole. It is refused now. A client with no revision has, by
          -- definition, not seen what it is about to destroy; the insert above
          -- still covers the only case that needs no revision, which is an
          -- account being created.
          where card_accounts.rev = ${baseRev}::int
        returning rev`
      if (!rows.length) {
        // somebody else wrote since this client last read; hand back the truth
        const cur = await sql`
          select state, rev from card_accounts where id_hash = ${hash(id)}`
        json(res, 409, {
          ok: false, stale: true, today, now: serverNow(),
          rev: cur[0]?.rev ?? null, state: cur[0]?.state ?? null,
        })
        return
      }
      json(res, 200, { ok: true, today, rev: rows[0].rev })
    } catch (err) {
      console.warn('cards: save failed', err.message)
      json(res, 500, { ok: false, today })
    }
  }

  /**
   * Claim a freshly generated id.
   *
   * Separate from save so that saving can never quietly take over an id that
   * already belongs to somebody. A collision at 100 bits will not happen; the
   * branch exists so that if it ever did, the newcomer is told to try again
   * instead of writing over a stranger's collection.
   */
  async function claim(req, res, bucket) {
    if (guard(req, res, `cn:${bucket}`, 20)) return
    const today = serverDay()
    if (!sql) { json(res, 200, { ok: false, offline: true, today }); return }
    let body
    try { body = JSON.parse(await readBody(req, MAX_STATE + 4096)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(body?.id)
    const state = vetState(body?.state, today)
    if (!id || !state) { json(res, 400, { ok: false, today }); return }
    const name = typeof body?.name === 'string' ? body.name.slice(0, 40) : null
    try {
      const rows = await sql`
        insert into card_accounts (id_hash, name, state, saved)
        values (${hash(id)}, ${name}, ${sql.json(state)}, now())
        on conflict (id_hash) do nothing
        returning rev`
      if (!rows.length) { json(res, 409, { ok: false, taken: true, today }); return }
      json(res, 200, {
        ok: true, today, now: serverNow(), rev: rows[0].rev, code: battleCode(hash(id)),
      })
    } catch (err) {
      console.warn('cards: claim failed', err.message)
      json(res, 500, { ok: false, today })
    }
  }

  /**
   * The public ladder, top hundred plus whoever is asking.
   *
   * Read straight off the accounts table — the card mode is the one part of
   * this game with a real server-side save, so a leaderboard costs a query
   * rather than a new system. Ranked the way the ladder itself ranks: the
   * division first, then the 大师 score, which has no ceiling and is the whole
   * point of the thing.
   *
   * The caller's own row comes back even when it is nowhere near the top,
   * because 「你在第几」 is the number that makes a leaderboard worth opening.
   * Sending an id is optional and the id is never echoed — only the four
   * characters of its hash that tell two players of the same name apart.
   */
  async function top(req, res, bucket) {
    if (guard(req, res, `ct:${bucket}`, 30)) return
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    let mine = null
    try {
      const body = JSON.parse(await readBody(req, 4096))
      const id = normalizeId(body?.id)
      if (id) mine = hash(id)
    } catch { /* an anonymous look at the board is fine */ }
    try {
      const rows = await sql`
        with ranked as (
          select
            id_hash, name,
            case when state->'ladder'->>'div' ~ '^[0-9]{1,2}$'
                 then (state->'ladder'->>'div')::int else 0 end as div,
            case when state->'ladder'->>'points' ~ '^[0-9]{1,9}$'
                 then (state->'ladder'->>'points')::int else 0 end as points,
            case when state->'ladder'->>'stars' ~ '^[0-9]{1,3}$'
                 then (state->'ladder'->>'stars')::int else 0 end as stars,
            case when state->'ladder'->>'wins' ~ '^[0-9]{1,7}$'
                 then (state->'ladder'->>'wins')::int else 0 end as wins,
            case when state->'ladder'->>'losses' ~ '^[0-9]{1,7}$'
                 then (state->'ladder'->>'losses')::int else 0 end as losses
          from card_accounts
          where jsonb_typeof(state->'ladder') = 'object'
        ), placed as (
          select *, rank() over (
            order by div desc, points desc, stars desc, wins desc, id_hash
          )::int as rk
          from ranked
        )
        select rk, id_hash, name, div, points, stars, wins, losses
        from placed
        -- one query either way: an empty string never matches a sha256, so
        -- the caller's own row joins the top hundred without a second shape
        where rk <= 100 or id_hash = ${mine ?? ''}
        order by rk
        limit 101`
      json(res, 200, {
        ok: true,
        rows: rows.map((r) => ({
          rank: r.rk,
          ...displayName(r.name, r.id_hash),
          div: r.div, points: r.points, stars: r.stars,
          wins: r.wins, losses: r.losses,
          me: !!mine && r.id_hash === mine,
        })),
      })
    } catch (err) {
      console.warn('cards: top failed', err.message)
      json(res, 500, { ok: false })
    }
  }

  /**
   * Other people's fives, to play against.
   *
   * The world's 78 clubs stop at 89, so a ladder with no ceiling runs out of
   * opposition in about a week — and sharpening those clubs to cover for it
   * was always a stopgap. Real squads do not run out: they are already here,
   * they get better as their owners do, and beating one means something.
   *
   * Nothing live and nobody has to be online. What goes out is the five card
   * ids, the upgrade level of each, a display name and where they sit on the
   * ladder. No account id, no state, no way back to anybody's password — and
   * the name goes through the same filter the leaderboard uses, since it lands
   * on somebody else's screen either way.
   *
   * Picked from the division asked for, widening outward when that division is
   * thin, so a 大师 player is not handed a 青铜 five just because there are
   * more of them.
   */
  /**
   * One account's five, as it is allowed to appear on somebody else's screen.
   *
   * Five card ids, each one's upgrade level, a coach, a display name and a
   * ladder position. Nothing else — no account id, no state, no save. Shared
   * by the ladder's opponent pool and the friend room, because the two send
   * exactly the same thing and should never drift apart.
   */
  function squadOf(r) {
    const slots = Array.isArray(r.squad?.slots) ? r.squad.slots.slice(0, 5) : []
    // the field is `level` — see OwnedCard in engine/gacha.ts. It was `lv`
    // here for a day, and every rival five arrived un-upgraded
    const lvOf = (id) => {
      const lv = r.cards?.[id]?.level
      return typeof lv === 'number' && lv > 0 ? Math.min(20, Math.trunc(lv)) : 0
    }
    const levels = {}
    for (const id of slots) {
      const lv = lvOf(id)
      if (lv) levels[id] = lv
    }
    const coach = typeof r.squad?.coach === 'string' ? r.squad.coach : null
    if (coach && lvOf(coach)) levels[coach] = lvOf(coach)
    const shown = displayName(r.name, r.id_hash)
    return {
      name: shown.name, tag: `#${shown.tag}`,
      slots, coach, levels, div: r.div, points: r.points,
    }
  }

  async function rivals(req, res, bucket) {
    if (guard(req, res, `cr:${bucket}`, 60)) return
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    let div = 5
    let mine = ''
    try {
      const body = JSON.parse(await readBody(req, 4096))
      const n = Number(body?.div)
      if (Number.isFinite(n)) div = Math.max(0, Math.min(5, Math.trunc(n)))
      const id = normalizeId(body?.id)
      if (id) mine = hash(id)
    } catch { /* defaults are fine */ }
    try {
      const rows = await sql`
        with pool as (
          select
            id_hash, name, state->'squad' as squad, state->'cards' as cards,
            case when state->'ladder'->>'div' ~ '^[0-9]{1,2}$'
                 then (state->'ladder'->>'div')::int else 0 end as div,
            case when state->'ladder'->>'points' ~ '^[0-9]{1,9}$'
                 then (state->'ladder'->>'points')::int else 0 end as points
          from card_accounts
          where jsonb_typeof(state->'squad'->'slots') = 'array'
            and jsonb_array_length(state->'squad'->'slots') = 5
            -- a five with an empty seat is not an opponent
            and (select count(*) from jsonb_array_elements(state->'squad'->'slots') e
                 where jsonb_typeof(e) = 'string') = 5
            and id_hash <> ${mine}
        )
        select id_hash, name, squad, cards, div, points
        from pool
        order by abs(div - ${div}), random()
        limit 12`
      json(res, 200, {
        ok: true,
        rivals: rows.map(squadOf),
      })
    } catch (err) {
      console.warn('cards: rivals failed', err.message)
      json(res, 500, { ok: false })
    }
  }

  /**
   * One friend's five, by battle code.
   *
   * The battle code is the first eight characters of the account's SHA-256 —
   * the same hash the leaderboard's #tag comes from, four characters longer.
   * It is deliberately NOT the account id: the id is the whole of the login
   * here, somebody已经 pasted theirs into a public name box once, and a code
   * meant to be posted in a group chat cannot be the same string. A hash
   * cannot be turned back into an id, so posting it costs nothing.
   *
   * Eight hex characters is four billion, which is far too many to walk, and
   * finding somebody's code buys you the right to play their squad anyway —
   * which is the entire point of the feature.
   *
   * Asynchronous like the ladder: the friend does not have to be online, and
   * what comes back is the snapshot they last saved.
   */
  async function friend(req, res, bucket) {
    if (guard(req, res, `cf:${bucket}`, 60)) return
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    let code = ''
    try {
      const body = JSON.parse(await readBody(req, 4096))
      code = String(body?.code ?? '').toLowerCase().replace(/[^0-9a-f]/g, '')
    } catch { /* handled below */ }
    if (code.length !== CODE_LEN) { json(res, 200, { ok: false, bad: true }); return }
    try {
      const rows = await sql`
        select
          id_hash, name, state->'squad' as squad, state->'cards' as cards,
          case when state->'ladder'->>'div' ~ '^[0-9]{1,2}$'
               then (state->'ladder'->>'div')::int else 0 end as div,
          case when state->'ladder'->>'points' ~ '^[0-9]{1,9}$'
               then (state->'ladder'->>'points')::int else 0 end as points
        from card_accounts
        where left(id_hash, ${CODE_LEN}) = ${code}
        limit 2`
      if (!rows.length) { json(res, 200, { ok: false, missing: true }); return }
      // eight characters of a hash could in principle be shared; refusing is
      // the only honest answer, since guessing which one was meant is worse
      if (rows.length > 1) { json(res, 200, { ok: false, clash: true }); return }
      const r = rows[0]
      const slots = Array.isArray(r.squad?.slots) ? r.squad.slots : []
      if (slots.filter((x) => typeof x === 'string').length !== 5) {
        json(res, 200, { ok: false, empty: true })
        return
      }
      json(res, 200, { ok: true, friend: { ...squadOf(r), code } })
    } catch (err) {
      console.warn('cards: friend failed', err.message)
      json(res, 500, { ok: false })
    }
  }

  return {
    /** Returns true when it handled the request. */
    async route(req, res, path, bucket) {
      if (path === '/api/card/top') { await top(req, res, bucket); return true }
      if (path === '/api/card/rivals') { await rivals(req, res, bucket); return true }
      if (path === '/api/card/friend') { await friend(req, res, bucket); return true }
      if (path === '/api/card/day') {
        json(res, 200, { ok: true, today: serverDay(), now: serverNow(), cloud: !!sql })
        return true
      }
      if (path === '/api/card/load') { await load(req, res, bucket); return true }
      if (path === '/api/card/save') { await save(req, res, bucket); return true }
      if (path === '/api/card/claim') { await claim(req, res, bucket); return true }
      return false
    },
  }
}
