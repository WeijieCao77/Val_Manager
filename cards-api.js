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
`

/** Bodies are capped well under this; 512KB is the point of refusing to look. */
export const MAX_STATE = 512 * 1024

const hash = (id) => createHash('sha256').update(String(id)).digest('hex')

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
        select state, rev, name from card_accounts where id_hash = ${hash(id)}`
      if (!rows.length) { json(res, 200, { ok: false, missing: true, today }); return }
      await sql`update card_accounts set seen = now() where id_hash = ${hash(id)}`
      json(res, 200, { ok: true, today, rev: rows[0].rev, state: rows[0].state })
    } catch (err) {
      console.warn('cards: load failed', err.message)
      json(res, 500, { ok: false, today })
    }
  }

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
    try {
      const rows = await sql`
        insert into card_accounts (id_hash, name, state, rev)
        values (${hash(id)}, ${name}, ${sql.json(state)}, 1)
        on conflict (id_hash) do update
          set state = excluded.state,
              name  = coalesce(excluded.name, card_accounts.name),
              rev   = card_accounts.rev + 1,
              seen  = now()
        returning rev`
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
        insert into card_accounts (id_hash, name, state)
        values (${hash(id)}, ${name}, ${sql.json(state)})
        on conflict (id_hash) do nothing
        returning rev`
      if (!rows.length) { json(res, 409, { ok: false, taken: true, today }); return }
      json(res, 200, { ok: true, today, rev: rows[0].rev })
    } catch (err) {
      console.warn('cards: claim failed', err.message)
      json(res, 500, { ok: false, today })
    }
  }

  return {
    /** Returns true when it handled the request. */
    async route(req, res, path, bucket) {
      if (path === '/api/card/day') {
        json(res, 200, { ok: true, today: serverDay(), cloud: !!sql })
        return true
      }
      if (path === '/api/card/load') { await load(req, res, bucket); return true }
      if (path === '/api/card/save') { await save(req, res, bucket); return true }
      if (path === '/api/card/claim') { await claim(req, res, bucket); return true }
      return false
    },
  }
}
