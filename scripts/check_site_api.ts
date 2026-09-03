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
import { makeSql } from '../pglite-sql.js'
import { SITE_SCHEMA, makeSiteApi, readDataUrl } from '../site-api.js'
import { engine } from '../cards-api.js'
import { CARD_SCHEMA, normalizeId } from '../cards-api.js'
import { displayName } from '../names.js'
import { createHash } from 'node:crypto'

const db = new PGlite()
const sql = makeSql(db)
await db.exec(SITE_SCHEMA)
await db.exec(CARD_SCHEMA)

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

const api = makeSiteApi(sql, {
  readBody, json, token: TOKEN, normalizeId, displayName, engine,
} as never)

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

// ---- 后台按对战码看一个账号 ---------------------------------------------
{
  const r0 = await call('/api/admin/account?code=deadbeef')
  check(r0.code === 404, '不带 token 查账号是 404', `code ${r0.code}`)
  const { makeMarketApi } = await import('../market-api.js')
  const market = makeMarketApi(sql, {
    readBody: (req: { body: string }) => Promise.resolve(req.body), json: (res: { code: number; body: unknown }, code: number, body: unknown) => { res.code = code; res.body = body },
    normalizeId, displayName, rateLimited: () => false, engine,
  } as never)
  const ID = 'VM-AAAA-AAAA-AAAA-AAAA-AAAA'
  const idHash = createHash('sha256').update(ID).digest('hex')
  const goldId = engine.ALL_CARDS ? undefined : undefined
  void goldId
  const { ALL_CARDS } = await import('../src/engine/cards')
  const card = ALL_CARDS.find((c) => c.kind === 'player' && c.rarity === 'gold')!
  await sql`insert into card_accounts (id_hash, name, state) values (${idHash}, '查我',
    ${JSON.stringify({ coins: 1234, pulls: 60, cards: { [card.id]: { id: card.id, dupes: 0 } } })})`
  const lres = { code: 0, body: {} as Record<string, unknown> }
  await market.route({ body: JSON.stringify({ id: ID, cardId: card.id, ask: 3000 }), method: 'POST' } as never, lres as never, '/api/market/list', 't')
  check('（准备）挂牌成功', lres.body.ok === true, JSON.stringify(lres.body))
  const r = await call(`/api/admin/account?code=${idHash.slice(0, 8).toUpperCase()}`, { token: TOKEN })
  const b = r.body as { ok: boolean; who: string; coins: number; cards: number; listings: { card: string; status: string; ask: number }[]; untaken: number }
  check('带 token 能按对战码找到账号', r.code === 200 && b.ok === true && /查我 #/.test(b.who), JSON.stringify(r.body).slice(0, 120))
  check('看得到金币和卡数（挂出去的那张已经不在手里）', b.coins === 1234 && b.cards === 0, `${b.coins} / ${b.cards}`)
  check('看得到那张挂牌，带选手名和状态', b.listings.length === 1 && b.listings[0].status === 'open'
    && b.listings[0].ask === 3000 && b.listings[0].card === card.ign, JSON.stringify(b.listings))
  const bad = await call('/api/admin/account?code=zz', { token: TOKEN })
  check('对战码格式不对就说不对', (bad.body as { why?: string }).why === '填 8 位对战码', JSON.stringify(bad.body))
  const none = await call('/api/admin/account?code=00000000', { token: TOKEN })
  check('没有的账号就说没有', (none.body as { why?: string }).why === '找不到这个账号', JSON.stringify(none.body))
}

// ---- every admin route this module owns has to be reachable ------------
//
// /api/admin/grant shipped unreachable once: the route existed, the module
// handled it, and server.js forwarded only the ONE admin path it knew about by
// name — so it fell through to the static handler and answered 200 with
// index.html, which reads exactly like an ungated endpoint until you look at
// the body. The dispatcher forwards the whole /api/admin/ prefix now, and this
// is the assertion that says so.
{
  const { readFileSync } = await import('node:fs')
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8')
  const forwards = /path\.startsWith\('\/api\/admin\/'\)/.test(server)
  check(forwards, 'server.js 把整个 /api/admin/ 前缀转给这个模块，而不是逐个点名')

  const src = readFileSync(new URL('../site-api.js', import.meta.url), 'utf8')
  const owned = [...src.matchAll(/path === '(\/api\/admin\/[a-z]+)'/g)].map((m) => m[1])
  check(owned.length >= 2, '这个模块确实有多个 admin 路由', owned.join(' '))
  for (const p of owned) {
    const r = await call(p, { method: 'POST', body: {} })
    check(r.handled === true && r.code === 404,
      `${p} 没 token 时是 404，而且确实被这个模块接住了`, `handled=${r.handled} code=${r.code}`)
  }
}

// ---- 给玩家发东西 -------------------------------------------------------
//
// The owner needs this for the ordinary reasons — an apology after a bug, a
// giveaway — and it must write to the inbox rather than into the player's save.
// His client is the only thing allowed to edit his collection; that rule came
// out of the week somebody's evening was overwritten.
{
  const hashOf = (id: string) => createHash('sha256').update(id).digest('hex')
  const P = 'VM-KNWQ-24Y1-6AH5-WF9H-CH9X'
  await sql`insert into card_accounts (id_hash, name, state) values (${hashOf(P)}, '收礼的',
    ${JSON.stringify({ coins: 0, cards: {}, packs: {} })})`
  const code = hashOf(P).slice(0, 8)

  const admin = (body: unknown, token: string | undefined = TOKEN) =>
    call('/api/admin/grant', { method: 'POST', body, token })

  let r = await admin({ who: code, pack: 'elite' })
  check(r.body.ok === true, '带 token 能给玩家发一个选拔包', JSON.stringify(r.body))
  check(/收礼的 #/.test(String(r.body.to)), '回执写清楚发给了谁', String(r.body.to))

  const mail = await sql`select kind, pack, count, coins from card_mail where to_h = ${hashOf(P)}`
  check(mail.length === 1 && mail[0].kind === 'grant' && mail[0].pack === 'elite' && mail[0].count === 1, '信箱里躺着一个选拔包',
    JSON.stringify(mail[0]))
  const acct = await sql`select state from card_accounts where id_hash = ${hashOf(P)}`
  check(JSON.stringify(acct[0].state.packs) === '{}', '没有直接改玩家的存档——那是他客户端的事', JSON.stringify(acct[0].state))

  r = await admin({ who: P, coins: 5000, note: '补偿' })
  check(r.body.ok === true, '完整账号 ID 也认', JSON.stringify(r.body))
  // a card id that is not in the set must not reach an account: it would sit
  // there as a card nothing can draw or sell
  r = await admin({ who: code, cardId: 'p:NOPE' })
  check(r.body.ok === false && /没有这张卡/.test(String(r.body.why)), '不存在的卡 ID 发不出去', JSON.stringify(r.body))
  r = await admin({ who: code, cardId: 'p:P0' })
  check(r.body.ok === true, '真实的卡 ID 可以发', JSON.stringify(r.body))
  r = await admin({ who: code, pack: 'nope' })
  check(r.body.ok === false && /没有这种卡包/.test(String(r.body.why)), '不存在的卡包会被拒绝',
    JSON.stringify(r.body))
  r = await admin({ who: code })
  check(r.body.ok === false, '什么都不填也会被拒绝', JSON.stringify(r.body))
  r = await admin({ who: '00000000', pack: 'elite' })
  check(/找不到/.test(String(r.body.why)), '找不到的账号会说清楚', JSON.stringify(r.body))

  const noTok = await admin({ who: code, pack: 'ten' }, 'wrong')
  check(noTok.code === 404, 'token 不对时这个接口是 404', `code ${noTok.code}`)
  const n = await sql`select count(*)::int as n from card_mail where to_h = ${hashOf(P)}`
  check(n[0].n === 3, '而且没有多发出去任何东西（两个包 + 一张卡）', String(n[0].n))
}

// ---- a pardon is a baseline, not just a cleared bit ---------------------
{
  const st = { version: 1, coins: 0, cards: {}, daily: { claimed: null },
    ladder: { div: 5, points: 300, wins: 90, losses: 36 } }
  await sql`
    insert into card_accounts (id_hash, name, state, created, rev, suspect, ladder_seen, ladder_at)
    values ('80f5d677aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '牛逼王', ${sql.json(st)},
            now() - interval '30 hours', 3, true, 126, now())`
  const listed = await call('/api/admin/flag', { token: TOKEN })
  const names = ((listed.body.flagged ?? []) as { name: string; who: string }[])
  check(names.some((x) => x.who === '80F5D677'), '被标记的账号在名单里', JSON.stringify(names))

  const cleared = await call('/api/admin/flag', { method: 'POST', token: TOKEN, body: { who: '80F5D677', clear: true } })
  check(cleared.body.ok === true && cleared.body.suspect === false, '放出来了', JSON.stringify(cleared.body))
  const row = (await sql`select suspect, pardon_seen, pardon_at from card_accounts where left(id_hash, 8) = '80f5d677'`) as
    unknown as { suspect: boolean; pardon_seen: number; pardon_at: unknown }[]
  check(row[0].suspect === false && row[0].pardon_seen === 126 && !!row[0].pardon_at,
    '赦免记下了当时的场次和时间', JSON.stringify(row[0]))

  const again = await call('/api/admin/flag', { method: 'POST', token: TOKEN, body: { who: '80F5D677' } })
  const row2 = (await sql`select suspect, pardon_seen, pardon_at from card_accounts where left(id_hash, 8) = '80f5d677'`) as
    unknown as { suspect: boolean; pardon_seen: number | null; pardon_at: unknown }[]
  check(again.body.ok === true && row2[0].suspect === true && row2[0].pardon_seen === null && row2[0].pardon_at === null,
    '手动再标记会收回赦免', JSON.stringify(row2[0]))
}

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
