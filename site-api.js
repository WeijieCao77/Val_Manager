/**
 * The handful of things the owner changes without a deploy.
 *
 * Right now that is one thing: the WeChat group's QR code. WeChat's group
 * codes expire after seven days — the image itself says so — so a QR checked
 * into the repo is a QR that is wrong most of the time, and the only version
 * that works is one the owner can swap from the admin page on a Monday.
 *
 * Stored in Postgres rather than on disk because Railway's filesystem is
 * ephemeral: a file written by the running container is gone on the next
 * deploy, which is exactly when nobody would notice it had vanished.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { battleCode } from './cards-api.js'

/**
 * Every pack the game has. A grant naming anything else is refused rather than
 * written — a row holding a pack kind that does not exist would sit in
 * somebody's inbox forever, collected and then silently dropped.
 */
export const PACK_KINDS = ['scout', 'elite', 'ten', 'coach', 'cn', 'pac', 'ame', 'emea']

export const SITE_SCHEMA = `
create table if not exists site_config (
  key      text primary key,
  value    jsonb not null,
  updated  timestamptz not null default now()
);
`

/** A QR is a few tens of kilobytes; this is the point of refusing to look. */
export const MAX_IMAGE = 600 * 1024

const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/**
 * Read a data: URL into bytes, or refuse.
 *
 * The admin page sends the file the owner picked as a data URL, because this
 * server has no multipart parser and adding one for a single upload would be
 * more code than the feature. Everything about the string is checked: the
 * prefix, the declared type, the base64 alphabet, and the decoded size.
 */
export function readDataUrl(raw) {
  const s = String(raw ?? '')
  const m = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(s)
  if (!m) return null
  const ext = TYPES[m[1]]
  if (!ext) return null
  let buf
  try { buf = Buffer.from(m[2], 'base64') } catch { return null }
  if (!buf.length || buf.length > MAX_IMAGE) return null
  return { mime: m[1], ext, buf }
}

const same = (a, b) => {
  const x = Buffer.from(String(a ?? ''))
  const y = Buffer.from(String(b ?? ''))
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y)
}

const hash = (id) => createHash('sha256').update(String(id)).digest('hex')

export function makeSiteApi(sql, { readBody, json, token, normalizeId, displayName, engine, tokenFrom }) {
  /** Cached in the process: the front page asks for this on every visit. */
  let cache = null
  let cachedAt = 0
  const TTL = 30_000

  async function read() {
    if (!sql) return null
    if (cache && Date.now() - cachedAt < TTL) return cache
    const rows = await sql`select value, updated from site_config where key = 'wechat'`
    cache = rows.length
      ? { ...rows[0].value, updated: new Date(rows[0].updated).getTime() }
      : { on: false, img: null, note: null, updated: 0 }
    cachedAt = Date.now()
    return cache
  }

  /** Everything the front page needs, and not one byte of image. */
  async function status(res) {
    const c = await read()
    if (!c) { json(res, 200, { on: false }); return }
    // `v` busts the image cache when the owner swaps the code, and is the only
    // reason the front page needs to know when it was updated
    json(res, 200, { on: !!c.on && !!c.img, note: c.note || null, v: c.updated || 0 })
  }

  /**
   * The image itself, at its own URL.
   *
   * Deliberately not inlined into the status JSON: the front page asks for the
   * status on every visit and opens the panel almost never, and a hundred
   * kilobytes of base64 on every visit to a page that was just cut in half
   * would be a poor trade.
   */
  async function image(res) {
    const c = await read()
    const data = c?.img ? readDataUrl(c.img) : null
    if (!data) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return }
    res.writeHead(200, {
      'Content-Type': data.mime,
      'Content-Length': data.buf.length,
      // immutable against `?v=`, which changes whenever the owner uploads
      'Cache-Control': 'public, max-age=604800',
    })
    res.end(data.buf)
  }

  /** Read it back for the admin page, image and all. */
  async function adminRead(res) {
    const c = await read()
    json(res, 200, { ok: true, config: c ?? { on: false, img: null, note: null } })
  }

  async function write(req, res) {
    if (!sql) { json(res, 503, { ok: false, why: 'no database' }); return }
    let body
    try { body = JSON.parse(await readBody(req, MAX_IMAGE + 8192)) } catch {
      json(res, 400, { ok: false, why: '图太大或者格式不对' })
      return
    }
    const cur = (await read()) ?? {}
    const on = typeof body?.on === 'boolean' ? body.on : !!cur.on
    const note = typeof body?.note === 'string' ? body.note.slice(0, 120) : (cur.note ?? null)
    // an absent img means "leave the picture alone"; null means "remove it"
    let img = cur.img ?? null
    if (body?.img === null) img = null
    else if (typeof body?.img === 'string') {
      if (!readDataUrl(body.img)) {
        json(res, 400, { ok: false, why: '只收 PNG / JPG / WebP，且不超过 600KB' })
        return
      }
      img = body.img
    }
    const value = { on, img, note }
    await sql`
      insert into site_config (key, value, updated) values ('wechat', ${sql.json(value)}, now())
      on conflict (key) do update set value = excluded.value, updated = now()`
    cache = null
    json(res, 200, { ok: true, config: { ...value, updated: Date.now() } })
  }

  /**
   * Send a player something: a pack, some coins, or a card.
   *
   * The owner needs this for the ordinary reasons — an apology after a bug ate
   * somebody's evening, a giveaway in the group — and doing it by hand in the
   * database is both awkward and the sort of thing that goes wrong at 2am.
   *
   * It writes a row in card_mail rather than into the player's save, for the
   * same reason everything else does: his client is the only thing allowed to
   * edit his collection, and it collects the mail next time he opens the game.
   *
   * Addressed by 对战码 for preference. The full account id works too, because
   * a player asking for help will usually paste that — but the id is the whole
   * of his login, and the eight-character code is enough to find him.
   */
  async function grant(req, res) {
    if (!sql) { json(res, 503, { ok: false, why: 'no database' }); return }
    let body
    try { body = JSON.parse(await readBody(req, 8192)) } catch { json(res, 400, { ok: false }); return }

    const who = String(body?.who ?? '').trim()
    const bare = who.toUpperCase().replace(/[^0-9A-Z]/g, '')
    let target = null
    if (/^[0-9A-Fa-f]{8}$/.test(who)) {
      const r = await sql`
        select id_hash, name from card_accounts where left(id_hash, 8) = ${who.toLowerCase()} limit 2`
      if (r.length > 1) { json(res, 200, { ok: false, why: '这个对战码对上了不止一个账号' }); return }
      target = r[0] ?? null
    } else if (bare.length >= 20) {
      const id = normalizeId(who)
      if (!id) { json(res, 200, { ok: false, why: '账号 ID 格式不对' }); return }
      const r = await sql`select id_hash, name from card_accounts where id_hash = ${hash(id)}`
      target = r[0] ?? null
    } else {
      json(res, 200, { ok: false, why: '填 8 位对战码，或者完整的账号 ID' })
      return
    }
    if (!target) { json(res, 200, { ok: false, why: '找不到这个账号' }); return }

    const pack = body?.pack ? String(body.pack) : null
    const count = Math.max(1, Math.min(50, Math.round(Number(body?.count) || 1)))
    const coins = Math.max(0, Math.min(1_000_000, Math.round(Number(body?.coins) || 0)))
    const cardId = body?.cardId ? String(body.cardId).slice(0, 40) : null
    const note = typeof body?.note === 'string' ? body.note.slice(0, 80) : null
    if (pack && !PACK_KINDS.includes(pack)) {
      json(res, 200, { ok: false, why: `没有这种卡包（${PACK_KINDS.join(' / ')}）` })
      return
    }
    // a card id that is not in the set would sit in the account as a card
    // nothing can draw; refused here, and refused again when mail is applied
    if (cardId && engine && !engine.cardById(cardId)) {
      json(res, 200, { ok: false, why: `没有这张卡（${cardId}）——卡的 ID 是 p:P123 这种` })
      return
    }
    if (!pack && !coins && !cardId) { json(res, 200, { ok: false, why: '什么都没填' }); return }

    await sql`
      insert into card_mail (to_h, kind, card_id, coins, pack, count, body)
      values (${target.id_hash}, 'grant', ${cardId}, ${coins}, ${pack}, ${count},
              ${sql.json({ note })})`
    const shown = displayName(target.name, target.id_hash)
    json(res, 200, {
      ok: true,
      to: `${shown.name} #${shown.tag}`,
      sent: { pack, count: pack ? count : undefined, coins: coins || undefined, cardId },
    })
  }

  /**
   * Who the 体力 clock has caught, and second thoughts about it.
   *
   * GET lists them. POST with { who, clear: true } puts one back on the
   * leaderboard, because the check is arithmetic and arithmetic has no idea
   * whether somebody spent a weekend playing against a server that was down.
   * A flag is a claim about a record, not about a person, and the owner has to
   * be able to withdraw one — otherwise the honest answer to an appeal is
   * editing the database by hand, which is how mistakes happen.
   */
  async function flagged(req, res) {
    if (!sql) { json(res, 503, { ok: false, why: 'no database' }); return }

    if (req.method === 'GET') {
      const rows = await sql`
        select id_hash, name, created, ladder_seen,
               coalesce((state->'ladder'->>'wins')::int, 0) as wins,
               coalesce((state->'ladder'->>'losses')::int, 0) as losses,
               floor((15 + extract(epoch from (now() - created)) / 3000) / 2) as ceiling
        from card_accounts
        where suspect
          and state->'ladder'->>'wins' ~ '^[0-9]{1,7}$'
          and state->'ladder'->>'losses' ~ '^[0-9]{1,7}$'
        order by (coalesce((state->'ladder'->>'wins')::int, 0)
                + coalesce((state->'ladder'->>'losses')::int, 0))
               - floor((15 + extract(epoch from (now() - created)) / 3000) / 2) desc
        limit 100`
      json(res, 200, {
        ok: true,
        flagged: rows.map((r) => {
          const shown = displayName(r.name, r.id_hash)
          const played = r.wins + r.losses
          return {
            who: battleCode(r.id_hash),
            name: `${shown.name} #${shown.tag}`,
            played, ceiling: Number(r.ceiling), over: played - Number(r.ceiling),
            created: r.created,
          }
        }),
      })
      return
    }

    let body
    try { body = JSON.parse(await readBody(req, 4096)) } catch { json(res, 400, { ok: false }); return }
    const who = String(body?.who ?? '').trim()
    if (!/^[0-9A-Fa-f]{8}$/.test(who)) { json(res, 200, { ok: false, why: '填 8 位对战码' }); return }
    const on = body?.clear ? false : true
    // Look before writing: eight hex characters can collide, and the update
    // used to run against the prefix first and count the matches after, so
    // a collision flagged (or pardoned) two accounts and then reported an
    // error. Resolve the code to exactly one account, then write by its id.
    const hits = await sql`
      select id_hash, name from card_accounts where left(id_hash, 8) = ${who.toLowerCase()} limit 2`
    if (!hits.length) { json(res, 200, { ok: false, why: '找不到这个账号' }); return }
    if (hits.length > 1) { json(res, 200, { ok: false, why: '这个对战码对上了不止一个账号' }); return }
    const target = hits[0].id_hash
    // Clearing is a pardon, and a pardon has to move the origin the save
    // check measures from — otherwise the very next save re-derives the same
    // flag from the same record. Flagging by hand withdraws any pardon.
    const r = on
      ? await sql`
          update card_accounts set suspect = true, pardon_seen = null, pardon_at = null
          where id_hash = ${target}
          returning id_hash, name`
      : await sql`
          update card_accounts
             set suspect = false,
                 pardon_seen = case when state->'ladder'->>'wins' ~ '^[0-9]{1,7}$'
                                     and state->'ladder'->>'losses' ~ '^[0-9]{1,7}$'
                                    then (state->'ladder'->>'wins')::int + (state->'ladder'->>'losses')::int
                                    else 0 end,
                 pardon_at = now()
          where id_hash = ${target}
          returning id_hash, name`
    if (!r.length) { json(res, 200, { ok: false, why: '找不到这个账号' }); return }
    const shown = displayName(r[0].name, r[0].id_hash)
    json(res, 200, { ok: true, to: `${shown.name} #${shown.tag}`, suspect: on })
  }

  /**
   * One account, as support needs to see it: what the player holds, what
   * is on the shelf in their name, what has closed, what waits in the
   * inbox. Read-only, by 对战码, behind the token like everything else
   * here. Written for 「挂了一张金卡消失了」 — the answer was in three
   * tables and there was no way to read them but a database console.
   */
  async function account(res, url) {
    const code = String(url.searchParams.get('code') ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{8}$/.test(code)) { json(res, 200, { ok: false, why: '填 8 位对战码' }); return }
    // The ladder and the account's own log ride along: the first question
    // the owner gets asked about an account is 「段位怎么变了」, and the
    // server's copy of the ladder — with its best division and the last
    // sixty things that happened — is the only thing that can answer it.
    const acc = await sql`
      select id_hash, name, suspect, rev, created, seen, saved, ladder_seen, ladder_at,
             (state->>'coins')::int as coins, (state->>'pulls')::int as pulls,
             (select count(*)::int from jsonb_object_keys(coalesce(state->'cards', '{}'::jsonb))) as cards,
             state->'ladder' as ladder,
             state->'cards' as owned,
             case when jsonb_typeof(state->'log') = 'array' then state->'log' else null end as log
      from card_accounts where left(id_hash, 8) = ${code} limit 2`
    if (!acc.length) { json(res, 200, { ok: false, why: '找不到这个账号' }); return }
    if (acc.length > 1) { json(res, 200, { ok: false, why: '这个对战码对上了不止一个账号' }); return }
    const a = acc[0]
    const h = a.id_hash
    const ign = (cardId) => (engine?.cardById?.(cardId)?.ign ?? engine?.cardById?.(cardId)?.name ?? cardId)
    const listings = await sql`
      select l.id, l.card_id, l.level, l.ask, l.status, l.created, l.closed, l.ignored,
             (select count(*)::int from card_offers o where o.listing = l.id and o.status = 'open') as offers,
             (select count(*)::int from card_listings x where x.status = 'open' and x.created > l.created) as newer
      from card_listings l where l.seller_h = ${h}
      order by l.created desc limit 20`
    const offers = await sql`
      select o.id, o.listing, o.price, o.status, o.made, o.settled, l.card_id
      from card_offers o join card_listings l on l.id = o.listing
      where o.buyer_h = ${h} order by o.made desc limit 20`
    const mail = await sql`
      select id, kind, card_id, coins, made, taken from card_mail
      where to_h = ${h} order by made desc limit 20`
    // the two other ways a card leaves an account: handed to a friend, or
    // swapped — 「我抽到过他，现在没了」 is answered here or nowhere
    const gifts = await sql`
      select id, card_id, claimed, made, from_h = ${h} as sent
      from card_gifts where from_h = ${h} or to_h = ${h} order by made desc limit 20`
    const swaps = await sql`
      select id, give_id, give_level, want_id, status, made, settled, from_h = ${h} as mine
      from card_swaps where from_h = ${h} or to_h = ${h} order by made desc limit 20`
    const shown = displayName(a.name, h)
    json(res, 200, {
      ok: true,
      who: `${shown.name} #${shown.tag}`, code: code.toUpperCase(), suspect: !!a.suspect,
      coins: a.coins, pulls: a.pulls, cards: a.cards,
      rev: a.rev, created: a.created, seen: a.seen, saved: a.saved,
      ladderSeen: a.ladder_seen, ladderAt: a.ladder_at,
      ladder: a.ladder ?? null,
      log: Array.isArray(a.log) ? a.log : [],
      owned: Object.entries(a.owned ?? {}).map(([cardId, v]) => ({
        cardId, card: ign(cardId), level: v?.level ?? 0, dupes: v?.dupes ?? 0,
      })),
      gifts: gifts.map((g) => ({ id: String(g.id), card: ign(g.card_id), cardId: g.card_id, sent: g.sent, claimed: g.claimed, made: g.made })),
      swaps: swaps.map((w) => ({
        id: String(w.id), mine: w.mine, give: ign(w.give_id), giveLevel: w.give_level, want: ign(w.want_id),
        status: w.status, made: w.made, settled: w.settled,
      })),
      listings: listings.map((l) => ({
        id: String(l.id), card: ign(l.card_id), cardId: l.card_id, level: l.level, ask: l.ask,
        status: l.status, created: l.created, closed: l.closed, ignored: l.ignored,
        offers: l.offers, newerOpen: l.newer,
      })),
      offers: offers.map((o) => ({
        id: String(o.id), listing: String(o.listing), card: ign(o.card_id), price: o.price,
        status: o.status, made: o.made, settled: o.settled,
      })),
      mail: mail.map((m) => ({
        id: String(m.id), kind: m.kind, card: m.card_id ? ign(m.card_id) : null, coins: m.coins,
        made: m.made, taken: m.taken,
      })),
      untaken: mail.filter((m) => !m.taken).length,
    })
  }

  return {
    /** Returns true when it handled the request. */
    async route(req, res, path, url) {
      if (path === '/api/admin/account') {
        if (!same(tokenFrom ? tokenFrom(req, url) : url.searchParams.get('token'), token) || !token) {
          res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
          return true
        }
        if (req.method !== 'GET') { json(res, 405, { ok: false }); return true }
        await account(res, url)
        return true
      }
      if (path === '/api/site/wechat') { await status(res); return true }
      if (path === '/api/site/wechat.img') { await image(res); return true }
      if (path === '/api/admin/flag') {
        if (!same(tokenFrom ? tokenFrom(req, url) : url.searchParams.get('token'), token) || !token) {
          res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
          return true
        }
        if (req.method !== 'GET' && req.method !== 'POST') { json(res, 405, { ok: false }); return true }
        await flagged(req, res)
        return true
      }
      if (path === '/api/admin/grant') {
        if (!same(tokenFrom ? tokenFrom(req, url) : url.searchParams.get('token'), token) || !token) {
          res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
          return true
        }
        if (req.method !== 'POST') { json(res, 405, { ok: false }); return true }
        await grant(req, res)
        return true
      }
      if (path === '/api/admin/wechat') {
        // 404 rather than 401, like every other admin route here: an endpoint
        // that admits it exists is an endpoint somebody comes back to
        if (!same(tokenFrom ? tokenFrom(req, url) : url.searchParams.get('token'), token) || !token) {
          res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
          return true
        }
        if (req.method === 'POST') await write(req, res)
        else await adminRead(res)
        return true
      }
      return false
    },
  }
}
