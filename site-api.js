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
import { timingSafeEqual } from 'node:crypto'

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

export function makeSiteApi(sql, { readBody, json, token }) {
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

  return {
    /** Returns true when it handled the request. */
    async route(req, res, path, url) {
      if (path === '/api/site/wechat') { await status(res); return true }
      if (path === '/api/site/wechat.img') { await image(res); return true }
      if (path === '/api/admin/wechat') {
        // 404 rather than 401, like every other admin route here: an endpoint
        // that admits it exists is an endpoint somebody comes back to
        if (!same(url.searchParams.get('token'), token) || !token) {
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
