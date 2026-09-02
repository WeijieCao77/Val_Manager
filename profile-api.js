/**
 * The site profile: what one account has unlocked, across both games.
 *
 * The card mode's id (see cards-api.js) is the whole of identity here too, and
 * the same privacy rule applies — the server stores its SHA-256 and never the
 * string itself, so a copy of this table lets nobody log in as anybody.
 *
 * Its own table rather than a column on card_accounts, for one reason: the two
 * games write on their own schedules, and sharing a row would mean an ending
 * saved from the manager racing a pack opened in the card mode for the same
 * update. Separate rows never race.
 *
 * And unlike the card save, this needs no revision counter and no conflict
 * handling at all, because every field is either a set that only grows or a
 * number that only rises. Two devices writing at once produce the union, which
 * is the right answer whichever order they land in. A lost write costs nothing
 * the next one will not restore.
 */
import { createHash } from 'node:crypto'
import { normalizeId } from './cards-api.js'

export const PROFILE_SCHEMA = `
create table if not exists site_profiles (
  id_hash text primary key,
  created timestamptz not null default now(),
  seen    timestamptz not null default now(),
  profile jsonb not null
);
`

/** Small by construction: two key lists and a handful of counters. */
const MAX_BODY = 64 * 1024

const hash = (id) => createHash('sha256').update(String(id)).digest('hex')

/** Keys are short identifiers from the client's own tables; anything else is junk. */
const keys = (v) => {
  if (!Array.isArray(v)) return []
  const out = []
  for (const k of v) {
    if (typeof k === 'string' && k.length <= 40 && /^[A-Za-z0-9_]+$/.test(k)) out.push(k)
    if (out.length >= 200) break
  }
  return [...new Set(out)]
}

const count = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.min(1e6, Math.round(n)) : 0
}

/**
 * Take only the shape we expect.
 *
 * The body arrives from a browser and there is no authentication beyond the id
 * itself, so nothing is stored that was not asked for: unknown fields are
 * dropped rather than kept, and every number is clamped. Without this, the
 * row is an open jsonb store that anyone holding an id can fill.
 */
function vet(p) {
  const rec = p?.record ?? {}
  const clubs = Array.isArray(rec.clubs)
    ? [...new Set(rec.clubs.filter((c) => typeof c === 'string' && c.length <= 40))].slice(0, 200)
    : []
  return {
    endings: keys(p?.endings),
    achievements: keys(p?.achievements),
    record: {
      careers: count(rec.careers),
      finished: count(rec.finished),
      sacked: count(rec.sacked),
      titles: count(rec.titles),
      worldTitles: count(rec.worldTitles),
      bestHaul: count(rec.bestHaul),
      seasons: count(rec.seasons),
      clubs,
    },
    at: typeof p?.at === 'string' ? p.at.slice(0, 40) : undefined,
  }
}

/** The union of what we hold and what arrived — see the note at the top. */
function fold(old, next) {
  if (!old) return next
  const a = old.record ?? {}
  const b = next.record ?? {}
  const most = (k) => Math.max(count(a[k]), count(b[k]))
  return {
    endings: [...new Set([...(old.endings ?? []), ...next.endings])],
    achievements: [...new Set([...(old.achievements ?? []), ...next.achievements])],
    record: {
      careers: most('careers'),
      finished: most('finished'),
      sacked: most('sacked'),
      titles: most('titles'),
      worldTitles: most('worldTitles'),
      bestHaul: most('bestHaul'),
      seasons: most('seasons'),
      clubs: [...new Set([...(a.clubs ?? []), ...(b.clubs ?? [])])].slice(0, 200),
    },
    at: next.at,
  }
}

export function makeProfileApi(sql, { rateLimited, readBody, json }) {
  const guard = (res, bucket, max) => {
    if (rateLimited(bucket, max)) {
      json(res, 429, { ok: false, why: 'rate' })
      return true
    }
    return false
  }

  const idFrom = async (req, res) => {
    let body
    try {
      body = JSON.parse(await readBody(req, MAX_BODY))
    } catch {
      json(res, 400, { ok: false })
      return null
    }
    const id = normalizeId(body?.id)
    if (!id) { json(res, 200, { ok: false, bad: true }); return null }
    return { id, body }
  }

  async function load(req, res, bucket) {
    // Same reasoning as the card endpoint: the id IS the password, so the one
    // worth guessing at is the one that reads.
    if (guard(res, `pl:${bucket}`, 40)) return
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    const got = await idFrom(req, res)
    if (!got) return
    try {
      const rows = await sql`select profile from site_profiles where id_hash = ${hash(got.id)}`
      if (!rows.length) { json(res, 200, { ok: true, profile: vet(null), missing: true }); return }
      await sql`update site_profiles set seen = now() where id_hash = ${hash(got.id)}`
      json(res, 200, { ok: true, profile: rows[0].profile })
    } catch {
      json(res, 500, { ok: false })
    }
  }

  async function save(req, res, bucket) {
    if (guard(res, `ps:${bucket}`, 60)) return
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    const got = await idFrom(req, res)
    if (!got) return
    const incoming = vet(got.body?.profile)
    try {
      // Read-modify-write rather than an upsert of the incoming value: the
      // stored row may hold an ending this device has never seen, and the
      // whole contract of this table is that unlocking only ever adds.
      // In one transaction with the row locked: two devices saving at once
      // used to read the same old row and the second write dropped whatever
      // the first had just unlocked. The empty insert first means there is
      // always a row to lock, even for an account saving for the first time.
      const h = hash(got.id)
      const run = (fn) => (sql.begin ? sql.begin(fn) : fn(sql))
      const merged = await run(async (db) => {
        await db`insert into site_profiles (id_hash, profile) values (${h}, ${db.json(vet(null))})
                 on conflict (id_hash) do nothing`
        const rows = await db`select profile from site_profiles where id_hash = ${h} for update`
        const m = fold(rows[0]?.profile, incoming)
        await db`update site_profiles set profile = ${db.json(m)}, seen = now() where id_hash = ${h}`
        return m
      })
      json(res, 200, { ok: true, profile: merged })
    } catch {
      json(res, 500, { ok: false })
    }
  }

  return {
    async route(req, res, path, bucket) {
      if (path === '/api/profile/load') { await load(req, res, bucket); return true }
      if (path === '/api/profile/save') { await save(req, res, bucket); return true }
      return false
    },
  }
}
