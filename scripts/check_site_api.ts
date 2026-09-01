/**
 * The one thing the owner changes without a deploy.
 *
 *   npx tsx scripts/check_site_api.ts
 *
 * A WeChat group QR expires after seven days, so the picture on the front page
 * has to be swappable from the admin page — which means an upload endpoint on
 * a public server, and an upload endpoint is the sort of thing people find.
 * What has to hold:
 *
 *   - the admin routes are invisible without the token, and 404 rather than
 *     401, because an endpoint that admits it exists is one somebody returns to
 *   - only real images get in, and only small ones
 *   - the public status route never carries the image, and never the token
 *   - turning it off, and deleting the picture, both actually take effect
 */
import { PGlite } from '@electric-sql/pglite'
import { SITE_SCHEMA, makeSiteApi, readDataUrl } from '../site-api.js'

const db = new PGlite()
const sql = Object.assign(
  async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const text = strings.reduce((q, part, i) => q + part + (i < vals.length ? `$${i + 1}` : ''), '')
    const r = await db.query(text, vals as never[])
    return Object.assign(r.rows as never[], { count: r.affectedRows ?? 0 })
  },
  { unsafe: async (q: string) => (await db.exec(q), []), json: (v: unknown) => JSON.stringify(v) },
)
await db.exec(SITE_SCHEMA)

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const TOKEN = 's3cret-token'
const json = (res: { code: number; body: Record<string, unknown> },
  code: number, body: Record<string, unknown>) => { res.code = code; res.body = body }
const readBody = (req: { body: string }, limit: number) =>
  new Promise<string>((resolve, reject) => {
    if (req.body.length > limit) { reject(new Error('too large')); return }
    resolve(req.body)
  })

const api = makeSiteApi(sql, { readBody, json, token: TOKEN } as never)

/**
 * One object plays the response.
 *
 * It has to BE the object handed to the route, not a copy beside it: `json`
 * writes onto whatever it is given, and the first version of this harness gave
 * the route one object and read another — so every JSON assertion here failed
 * against code that was working.
 */
async function call(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const res = {
    code: 0,
    body: {} as Record<string, unknown>,
    head: {} as Record<string, string>,
    raw: null as Buffer | null,
    writeHead(code: number, head: Record<string, string>) {
      res.code = code; res.head = head || {}
      return { end: (b: Buffer | string) => { res.raw = Buffer.isBuffer(b) ? b : Buffer.from(String(b)) } }
    },
    end(b: Buffer) { res.raw = b },
  }
  const url = new URL(`http://x${path}`)
  if (opts.token !== undefined) url.searchParams.set('token', opts.token)
  const req = { method: opts.method ?? 'GET', body: JSON.stringify(opts.body ?? {}) }
  const handled = await api.route(req as never, res as never, url.pathname, url)
  return { ...res, handled }
}

// a 1×1 PNG, which is a real one
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// ---- what a data URL is allowed to be ---------------------------------
check(!!readDataUrl(PNG), 'a real PNG is accepted')
check(readDataUrl('data:text/html;base64,PHNjcmlwdD4=') === null, 'HTML is not an image')
check(readDataUrl('data:image/svg+xml;base64,PHN2Zz4=') === null,
  'SVG is refused — it is a document that can carry script, not a picture')
check(readDataUrl('https://example.com/x.png') === null, 'a plain URL is not a data URL')
check(readDataUrl(`data:image/png;base64,${'A'.repeat(900_000)}`) === null, '太大的图直接拒绝')
check(readDataUrl('data:image/png;base64,not base64!!') === null, 'junk in the payload is refused')

// ---- the admin routes do not exist without the token ------------------
{
  const r = await call('/api/admin/wechat')
  check(r.code === 404 && !r.body.ok, '不带 token 时后台接口是 404，不是 401', `code ${r.code}`)
  const w = await call('/api/admin/wechat', { method: 'POST', token: 'wrong', body: { on: true } })
  check(w.code === 404, '猜错 token 也是 404', `code ${w.code}`)
  const rows = await sql`select * from site_config`
  check(rows.length === 0, '而且什么都没写进去')
}

// ---- the front page sees nothing until there is something to see ------
{
  const r = await call('/api/site/wechat')
  check(r.body.on === false, '没设置过的时候，首页按钮不出现')
  const img = await call('/api/site/wechat.img')
  check(img.code === 404, '没有图的时候图片是 404，不是空响应')
}

// ---- upload, and it takes effect --------------------------------------
{
  const w = await call('/api/admin/wechat', {
    method: 'POST', token: TOKEN, body: { on: true, img: PNG, note: '扫码进群' },
  })
  check(w.code === 200 && w.body.ok === true, '带 token 能保存', JSON.stringify(w.body).slice(0, 80))

  const r = await call('/api/site/wechat')
  check(r.body.on === true, '保存之后首页按钮就出现了')
  check(r.body.note === '扫码进群', '底下那行小字也发给前端')
  check(!('img' in r.body), '公开接口里没有图片本身', JSON.stringify(Object.keys(r.body)))
  check(typeof r.body.v === 'number' && (r.body.v as number) > 0, '带一个版本号，好把缓存冲掉')
  check(!JSON.stringify(r.body).includes(TOKEN), '公开接口里没有 token')

  const img = await call('/api/site/wechat.img')
  check(img.code === 200 && img.head['Content-Type'] === 'image/png', '图片按原类型发出去',
    `${img.code} ${img.head['Content-Type']}`)
  check((img.raw?.length ?? 0) > 0 && img.raw!.subarray(1, 4).toString() === 'PNG',
    '发出去的确实是那张 PNG')
}

// ---- a bad upload changes nothing -------------------------------------
{
  const w = await call('/api/admin/wechat', {
    method: 'POST', token: TOKEN, body: { img: 'data:text/html;base64,PHNjcmlwdD4=' },
  })
  check(w.code === 400 && !w.body.ok, '传个 HTML 上来会被拒绝', JSON.stringify(w.body))
  const img = await call('/api/site/wechat.img')
  check(img.code === 200 && img.raw!.subarray(1, 4).toString() === 'PNG',
    '而且原来那张图还在')
}

// ---- the switch, and the delete ---------------------------------------
{
  await call('/api/admin/wechat', { method: 'POST', token: TOKEN, body: { on: false } })
  const r = await call('/api/site/wechat')
  check(r.body.on === false, '关掉之后首页按钮就没了')
  const img = await call('/api/site/wechat.img')
  check(img.code === 200, '但图片本身还留着，随时可以再打开')

  await call('/api/admin/wechat', { method: 'POST', token: TOKEN, body: { on: true } })
  check((await call('/api/site/wechat')).body.on === true, '再打开就又有了')
  // a save that does not mention the picture must not wipe it
  check((await call('/api/site/wechat.img')).code === 200, '只改开关不会顺手把图删掉')

  await call('/api/admin/wechat', { method: 'POST', token: TOKEN, body: { img: null } })
  check((await call('/api/site/wechat.img')).code === 404, '明确删图才会真的删掉')
  check((await call('/api/site/wechat')).body.on === false,
    '没有图的时候按钮也不出现，哪怕开关是开着的')
}

// ---- an unknown path under /api/site is not this module's problem -----
{
  const r = await call('/api/site/nope')
  check(r.handled === false, '不认识的路径交回给服务器，不是自己回一个 200')
}

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
