/**
 * The card account endpoints, against a real Postgres.
 *
 * These four routes are the only place this game writes anything to a server
 * on a player's behalf, and the id they take IS the password — so the parts
 * worth getting wrong are exactly the parts worth testing: that a claim cannot
 * silently take over somebody else's collection, that the raw id never reaches
 * the table, that a mistyped id still resolves, and that a save dated in the
 * future is refused rather than freezing that account's streak.
 *
 *   npx tsx scripts/check_cards_api.ts
 */
import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  CARD_SCHEMA, battleCode, makeCardApi, normalizeId, serverDay, vetState,
} from '../cards-api.js'

const db = new PGlite()
const sql = Object.assign(
  async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const text = strings.reduce((q, part, i) => q + part + (i < vals.length ? `$${i + 1}` : ''), '')
    const r = await db.query(text, vals as never[])
    return Object.assign(r.rows as never[], { count: r.affectedRows ?? 0 })
  },
  {
    unsafe: async (q: string) => (await db.exec(q), []),
    json: (v: unknown) => JSON.stringify(v),
  },
)
await db.exec(CARD_SCHEMA)

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

// ---- the harness the routes expect ------------------------------------

const rateHits = new Map<string, number>()
const rateLimited = (key: string, max = 60) => {
  const n = (rateHits.get(key) ?? 0) + 1
  rateHits.set(key, n)
  return n > max
}
const readBody = (req: { body: string }, limit: number) =>
  new Promise<string>((resolve, reject) => {
    if (req.body.length > limit) { reject(new Error('too large')); return }
    resolve(req.body)
  })

interface Res { code: number; body: Record<string, unknown> }
const json = (res: Res, code: number, body: Record<string, unknown>) => {
  res.code = code
  res.body = body
}

const api = makeCardApi(sql, { rateLimited, readBody, json } as never)

async function call(path: string, body: unknown, bucket = 'test'): Promise<Res> {
  const res: Res = { code: 0, body: {} }
  const req = { body: JSON.stringify(body), method: 'POST' }
  await api.route(req as never, res as never, path, bucket)
  return res
}

// ---- id handling ------------------------------------------------------

const ID = 'VM-ABCD-EFGH-JKMN-PQRS-TVWX'
check('id round-trips', normalizeId(ID) === ID)
check('id accepts lowercase and spaces', normalizeId('vm abcd efgh jkmn pqrs tvwx') === ID)
check('id accepts no separators', normalizeId('VMABCDEFGHJKMNPQRSTVWX') === ID)
check('O/I/L/U read as 0/1/1/V',
  normalizeId('VM-0O0O-1I1L-UUUU-2222-3333') === 'VM-0000-1111-VVVV-2222-3333')
check('short id refused', normalizeId('VM-ABCD') === null)
check('junk refused', normalizeId('') === null)

// ---- claim / load / save ---------------------------------------------

const state = { version: 1, id: ID, coins: 3000, cards: {}, daily: { claimed: null } }

let r = await call('/api/card/claim', { id: ID, name: '点点', state })
check('claim creates the account', r.code === 200 && r.body.ok === true, `code ${r.code}`)

r = await call('/api/card/claim', { id: ID, name: 'someone else', state: { ...state, coins: 9 } })
check('a second claim on the same id is refused, not an overwrite',
  r.code === 409 && r.body.taken === true, `code ${r.code}`)

r = await call('/api/card/load', { id: ID })
check('load returns what was claimed',
  r.body.ok === true && (r.body.state as { coins: number }).coins === 3000)
check('load carries the server date', typeof r.body.today === 'string' && r.body.today === serverDay())

// baseRev travels with every save: a client that has read the row says which
// version it read. Omitting it used to mean "write anyway" — see the no-baseRev
// case further down for why that is now a refusal.
r = await call('/api/card/save', { id: ID, baseRev: 1, state: { ...state, coins: 4200 } })
check('save bumps the revision', r.body.ok === true && r.body.rev === 2, `rev ${r.body.rev}`)

r = await call('/api/card/load', { id: 'vm abcd efgh jkmn pqrs tvwx' })
check('a sloppily typed id still finds the account',
  r.body.ok === true && (r.body.state as { coins: number }).coins === 4200)

r = await call('/api/card/load', { id: 'VM-1111-1111-1111-1111-1111' })
check('an unknown id is a miss, not an error', r.code === 200 && r.body.missing === true)

r = await call('/api/card/load', { id: 'nonsense' })
check('a malformed id is rejected', r.body.bad === true)

// ---- what the table actually holds ------------------------------------

const rows = await sql`select id_hash, rev, name from card_accounts`
check('one row per account', rows.length === 1, `${rows.length} rows`)
check('the id itself is never stored, only its hash',
  (rows[0] as { id_hash: string }).id_hash === createHash('sha256').update(ID).digest('hex'))
const dump = JSON.stringify(await sql`select * from card_accounts`)
check('the raw id appears nowhere in the table', !dump.includes(ID))

// ---- the two things that would break the server ------------------------

const future = new Date()
future.setFullYear(future.getFullYear() + 1)
check('a check-in dated in the future is refused',
  vetState({ daily: { claimed: future.toISOString().slice(0, 10) } }, serverDay()) === null)
check('a past check-in is fine',
  vetState({ daily: { claimed: '2020-01-01' } }, serverDay()) !== null)
check('an oversized save is refused',
  vetState({ blob: 'x'.repeat(600 * 1024) }, serverDay()) === null)
check('a non-object save is refused', vetState([1, 2, 3], serverDay()) === null)

r = await call('/api/card/save', { id: ID, baseRev: 2, state: { daily: { claimed: '2099-01-01' } } })
check('the save route refuses it too', r.code === 400 && r.body.why === 'state')

r = await call('/api/card/load', { id: ID })
check('the refused save did not land',
  (r.body.state as { coins: number }).coins === 4200)

// ---- two devices ------------------------------------------------------
//
// The case this exists for: a tab left open on a phone holds an hour-old
// state, the browser thaws it, and its beacon posts that state over an
// evening played on the desktop. Without a version check the server took it.

const TWO = 'VM-2222-3333-4444-5555-6666'
await call('/api/card/claim', { id: TWO, name: 'two', state: { coins: 100, daily: { claimed: null } } })
let phone = await call('/api/card/load', { id: TWO })
const phoneRev = phone.body.rev as number

// the desktop loads the same state, plays, and saves twice
let desk = await call('/api/card/load', { id: TWO })
let deskRev = desk.body.rev as number
for (const coins of [500, 900]) {
  const w = await call('/api/card/save', { id: TWO, baseRev: deskRev, state: { coins, daily: { claimed: null } } })
  deskRev = w.body.rev as number
}
check('the desktop\'s saves land', deskRev === phoneRev + 2, `rev ${deskRev}`)

// now the phone wakes up and beacons what it remembers
const beacon = await call('/api/card/save', {
  id: TWO, baseRev: phoneRev, state: { coins: 100, daily: { claimed: null } },
})
check('a save built on a stale revision is refused',
  beacon.code === 409 && beacon.body.stale === true, `code ${beacon.code}`)
check('the refusal hands back the newer state',
  (beacon.body.state as { coins: number })?.coins === 900)

const after = await call('/api/card/load', { id: TWO })
check('the evening on the desktop survives',
  (after.body.state as { coins: number }).coins === 900,
  `coins ${(after.body.state as { coins: number }).coins}`)

// and a client that resyncs can then write
const resync = await call('/api/card/save', {
  id: TWO, baseRev: after.body.rev as number, state: { coins: 1000, daily: { claimed: null } },
})
check('after resyncing, the same client can save again', resync.body.ok === true)

// A save with no baseRev has, by definition, not read what it is about to
// destroy. It used to be let through so that a tab still running an older
// bundle could write across a deploy; that allowance is how an evening
// disappeared — 大师 48 分 and three friendlies wiped by a copy that had never
// seen them. Every client this game has ever shipped sends a baseRev once it
// has loaded, so the only thing refused here is a write that should be.
{
  const naked = await call('/api/card/save', {
    id: TWO, state: { coins: 1100, daily: { claimed: null } },
  })
  check('a save with no baseRev cannot overwrite an existing account',
    naked.code === 409 && naked.body.stale === true, `code ${naked.code}`)
  const still = await call('/api/card/load', { id: TWO })
  check('and the account it aimed at is untouched',
    (still.body.state as { coins: number }).coins === 1000,
    `coins ${(still.body.state as { coins: number }).coins}`)
}

// ---- progress never goes backwards -------------------------------------
//
// The revision check catches a client writing on top of a copy it has not
// seen. It cannot catch one writing on top of a copy it HAS seen and then
// ignored — a tab told it was stale, adopting the truth into one object and
// saving from another. Packs opened, matches played and cards owned only ever
// increase, so a save that lowers them is a stale copy whatever its revision.
{
  const P = 'VM-3333-3333-3333-3333-3333'
  await call('/api/card/claim', {
    id: P, name: '进度', state: { pulls: 10, cards: { a: 1, b: 1 }, ladder: { wins: 4, losses: 2 } },
  })
  const at = await call('/api/card/load', { id: P })
  const rev = at.body.rev as number
  const back = await call('/api/card/save', {
    id: P, baseRev: rev, state: { pulls: 3, cards: { a: 1 }, ladder: { wins: 1, losses: 0 } },
  })
  check('版本号对得上，但进度倒退的存档照样拒绝',
    back.code === 409 && back.body.stale === true, `code ${back.code}`)
  check('并且把真正的进度还回去', (back.body.state as { pulls: number })?.pulls === 10)
  const fwd = await call('/api/card/save', {
    id: P, baseRev: rev, state: { pulls: 11, cards: { a: 1, b: 1, c: 1 }, ladder: { wins: 5, losses: 2 } },
  })
  check('往前走的存档正常写入', fwd.body.ok === true, JSON.stringify(fwd.body).slice(0, 60))
  // coins are spent as well as earned, and must never read as a regression
  const spent = await call('/api/card/save', {
    id: P, baseRev: fwd.body.rev as number,
    state: { pulls: 11, coins: 0, cards: { a: 1, b: 1, c: 1 }, ladder: { wins: 5, losses: 2 } },
  })
  check('花光金币不算倒退', spent.body.ok === true, JSON.stringify(spent.body).slice(0, 60))
}

// ---- brute force ------------------------------------------------------

rateHits.clear()
let limited = 0
for (let i = 0; i < 60; i++) {
  const g = await call('/api/card/load', { id: 'VM-2222-2222-2222-2222-2222' }, 'attacker')
  if (g.code === 429) limited++
}
check('guessing gets rate limited', limited >= 15, `${limited}/60 refused`)

// ---- 排行榜 -----------------------------------------------------------
const hashOf = (id: string) => createHash('sha256').update(id).digest('hex')

//
// A public read off the accounts table. Three things it must get right: the
// order, the caller's own row when they are nowhere near the top, and never
// echoing an id — the id is the password, so only four characters of its hash
// may appear.
{
  rateHits.clear()
  await db.exec('delete from card_accounts')
  const mk = async (id: string, name: string, div: number, points: number, wins: number) => {
    await sql`insert into card_accounts (id_hash, name, state)
      values (${hashOf(id)}, ${name},
        ${JSON.stringify({ ladder: { div, points, stars: 0, wins, losses: 0 } })})`
  }
  await mk('VM-1111-1111-1111-1111-1111', '阿伟', 5, 1800, 90)
  await mk('VM-2222-2222-2222-2222-2222', '傻逼', 5, 900, 40)
  await mk('VM-3333-3333-3333-3333-3333', '阿伟', 3, 0, 12)
  await mk('VM-4444-4444-4444-4444-4444', '', 0, 0, 1)

  const r = await call('/api/card/top', {}, 'board')
  const rows = r.body.rows as { rank: number; name: string; tag: string; hidden: boolean; me: boolean; points: number }[]
  check('排行榜读得出来', r.code === 200 && Array.isArray(rows), JSON.stringify(r.body).slice(0, 120))
  check('按段位和大师分排', rows[0].name === '阿伟' && rows[0].points === 1800,
    rows.map((x) => `${x.rank}.${x.name}(${x.points})`).join(' '))
  check('名字里有脏字的显示「已隐藏」，但还在榜上',
    rows[1].hidden && rows[1].name === '已隐藏', JSON.stringify(rows[1]))
  check('没起名字的有默认名', rows.some((x) => x.name === '无名经理'))
  const weis = rows.filter((x) => x.name === '阿伟')
  check('同名的两个人靠识别码分开', weis.length === 2 && weis[0].tag !== weis[1].tag,
    weis.map((x) => `#${x.tag}`).join(' '))
  const tagOf = (id: string) => hashOf(id).slice(0, 4).toUpperCase()
  check('识别码就是各自哈希的前四位，和 ID 本身无关',
    weis[0].tag === tagOf('VM-1111-1111-1111-1111-1111')
    && weis[1].tag === tagOf('VM-3333-3333-3333-3333-3333'),
    `${weis.map((x) => x.tag).join(' ')} vs ${tagOf('VM-1111-1111-1111-1111-1111')} ${tagOf('VM-3333-3333-3333-3333-3333')}`)

  const mine = await call('/api/card/top', { id: 'VM-4444-4444-4444-4444-4444' }, 'board2')
  const mineRows = mine.body.rows as { me: boolean; name: string }[]
  check('带上自己的 ID 就能看到自己那一行', mineRows.some((x) => x.me),
    mineRows.filter((x) => x.me).map((x) => x.name).join(''))
  check('不带 ID 时没有任何一行标成「我」', !rows.some((x) => x.me))
  check('返回里不含任何 ID', !JSON.stringify(r.body).includes('VM-'))

  // found live, an hour after the board went up: rank 24 had pasted their
  // account id into the name box, and the board was publishing their password
  await mk('VM-5555-5555-5555-5555-5555', 'VM-9DJ0-X6C7-8EP', 5, 1500, 50)
  const after = await call('/api/card/top', {}, 'board3')
  const rows2 = after.body.rows as { name: string; hidden: boolean; why?: string; points: number }[]
  const leaked = rows2.find((x) => x.points === 1500)!
  check('把账号 ID 当昵称的人，ID 不会被公开', leaked.hidden && leaked.name === '已隐藏',
    JSON.stringify(leaked))
  check('而且知道是哪一种隐藏，好告诉他去改', leaked.why === 'id')
  check('整个返回里还是找不到 ID 的影子', !JSON.stringify(after.body).includes('9DJ0'))
}

// ---- 真人卡组当对手 ---------------------------------------------------
//
// The 78 real clubs stop at 89, so a ladder with no ceiling runs out of
// opposition. Other people's saved fives do not — and handing one out must
// never hand out anything that identifies its owner.
{
  rateHits.clear()
  await db.exec('delete from card_accounts')
  const squadOf = (ids: string[]) => ({ slots: ids, coach: 'C-bonkar' })
  const withCards = (ids: string[]) =>
    // the same shape the game actually saves — OwnedCard, with `level`. The
    // first version of this fixture said `lv`, which is what the endpoint was
    // reading, so the test agreed with the bug instead of catching it
    Object.fromEntries(ids.map((id, i) => [id, { id, level: i, dupes: 0, seen: 1, got: '2026-09-01' }]))
  const mkRival = async (id: string, name: string, div: number, points: number, ids: string[]) => {
    await sql`insert into card_accounts (id_hash, name, state) values (
      ${hashOf(id)}, ${name},
      ${JSON.stringify({
        ladder: { div, points, stars: 0, wins: 1, losses: 0 },
        squad: squadOf(ids), cards: withCards([...ids, 'C-bonkar']),
      })})`
  }
  const five = (n: string) => [`${n}a`, `${n}b`, `${n}c`, `${n}d`, `${n}e`]
  await mkRival('VM-1111-1111-1111-1111-1111', '阿伟', 5, 1800, five('x'))
  await mkRival('VM-2222-2222-2222-2222-2222', '傻逼', 5, 400, five('y'))
  await mkRival('VM-3333-3333-3333-3333-3333', '新手', 0, 0, five('z'))
  // a five with an empty seat is not an opponent
  await sql`insert into card_accounts (id_hash, name, state) values (
    ${hashOf('VM-4444-4444-4444-4444-4444')}, '缺人',
    ${JSON.stringify({ ladder: { div: 5, points: 999 }, squad: { slots: ['a', null, 'c', 'd', 'e'], coach: null }, cards: {} })})`

  const r = await call('/api/card/rivals', { div: 5, id: 'VM-1111-1111-1111-1111-1111' }, 'riv')
  const list = r.body.rivals as { name: string; slots: string[]; levels: Record<string, number>; div: number; coach: string | null }[]
  check('对手列表读得出来', r.code === 200 && Array.isArray(list), JSON.stringify(r.body).slice(0, 120))
  check('不会把自己发给自己', !list.some((x) => x.name === '阿伟'), list.map((x) => x.name).join(' '))
  check('缺人的阵容不算对手', !list.some((x) => x.name === '缺人'))
  check('五个位置都是满的', list.every((x) => x.slots.filter(Boolean).length === 5))
  check('带着每张卡的强化等级', list.some((x) => Object.keys(x.levels).length > 0),
    JSON.stringify(list[0]?.levels))
  check('教练也一起给', list.every((x) => x.coach === 'C-bonkar'))
  check('名字同样过滤，脏字不会跑到别人屏幕上',
    !list.some((x) => x.name === '傻逼'), list.map((x) => x.name).join(' '))
  check('返回里没有任何账号信息',
    !JSON.stringify(r.body).includes('VM-') && !JSON.stringify(r.body).includes('id_hash'))
  check('优先给同段位的', list[0].div === 5, `第一个是 ${list[0].div} 段`)
}

// ---- 好友对战房 -------------------------------------------------------
//
// The battle code is eight characters of the account's hash. Two things have
// to hold and neither is negotiable: the code must not be the id (the id is
// the whole login, and somebody已经 published theirs once), and looking one up
// must hand back a five and nothing else.
{
  rateHits.clear()
  await db.exec('delete from card_accounts')
  const FRIEND = 'VM-5555-5555-5555-5555-5555'
  const hisHash = hashOf(FRIEND)
  const hisCode = battleCode(hisHash)
  await sql`insert into card_accounts (id_hash, name, state) values (
    ${hisHash}, '老王',
    ${JSON.stringify({
      ladder: { div: 4, points: 0, stars: 2, wins: 9, losses: 3 },
      squad: { slots: ['fa', 'fb', 'fc', 'fd', 'fe'], coach: 'C-bonkar' },
      cards: Object.fromEntries(['fa', 'fb', 'fc', 'fd', 'fe', 'C-bonkar']
        .map((id, i) => [id, { id, level: i, dupes: 0, seen: 1, got: '2026-09-01' }])),
    })})`

  check('对战码是 8 位十六进制', /^[0-9A-F]{8}$/.test(hisCode), hisCode)
  check('对战码不是账号 ID，也推不回去',
    !hisCode.includes('5555') && !FRIEND.includes(hisCode), `${hisCode} vs ${FRIEND}`)
  check('对战码和排行榜的 #四位是同一串', hisHash.slice(0, 4).toUpperCase() === hisCode.slice(0, 4))

  let f = await call('/api/card/friend', { code: hisCode }, 'fr')
  const who = f.body.friend as {
    name: string; tag: string; slots: string[]; coach: string | null
    levels: Record<string, number>; div: number; code: string
  }
  check('按对战码找得到人', f.code === 200 && f.body.ok === true, JSON.stringify(f.body).slice(0, 120))
  check('拿到的是他存下来的五个人', who?.slots?.filter(Boolean).length === 5, JSON.stringify(who?.slots))
  check('强化等级一起给', Object.keys(who.levels).length > 0, JSON.stringify(who.levels))
  check('教练也给', who.coach === 'C-bonkar')
  check('段位也给', who.div === 4)
  check('返回里没有账号 ID，也没有存档',
    !JSON.stringify(f.body).includes('VM-') && !JSON.stringify(f.body).includes('coins')
    && !JSON.stringify(f.body).includes('id_hash'))

  check('大小写和空格都认',
    ((await call('/api/card/friend', { code: ` ${hisCode.toLowerCase()} ` }, 'fr')).body.ok) === true)
  check('码不对就说不对',
    ((await call('/api/card/friend', { code: 'ZZZZ' }, 'fr')).body.bad) === true)
  check('没人用过的码是 missing，不是报错',
    ((await call('/api/card/friend', { code: '00000000' }, 'fr')).body.missing) === true)
  check('空 body 不会炸', (await call('/api/card/friend', null, 'fr')).body.ok !== true)

  // a five with a hole in it cannot be played, and saying so beats a crash
  await sql`insert into card_accounts (id_hash, name, state) values (
    ${hashOf('VM-6666-6666-6666-6666-6666')}, '缺人',
    ${JSON.stringify({ squad: { slots: ['a', null, 'c', 'd', 'e'], coach: null }, cards: {} })})`
  f = await call('/api/card/friend', { code: battleCode(hashOf('VM-6666-6666-6666-6666-6666')) }, 'fr')
  check('对方阵容缺人时说清楚，而不是发一个打不了的队', f.body.empty === true, JSON.stringify(f.body))

  // the name goes through the same filter as everywhere else it lands on
  // somebody else's screen
  await sql`insert into card_accounts (id_hash, name, state) values (
    ${hashOf('VM-7777-7777-7777-7777-7777')}, 'VM-9DJ0-X6C7-8EP0-1234-5678',
    ${JSON.stringify({
      squad: { slots: ['a', 'b', 'c', 'd', 'e'], coach: null },
      cards: {},
    })})`
  f = await call('/api/card/friend', { code: battleCode(hashOf('VM-7777-7777-7777-7777-7777')) }, 'fr')
  check('把 ID 当昵称的人，在好友房里也是隐藏的',
    (f.body.friend as { name: string }).name === '已隐藏'
    && !JSON.stringify(f.body).includes('9DJ0'), JSON.stringify(f.body.friend))
}

// ---- 送卡功能已移除，但在途的礼物还要送到 -------------------------------
//
// A free card transfer with no cost at all is an alt-account funnel, so it was
// removed. The CLAIM path stays: there may be gifts sent and not yet collected,
// and deleting the door they arrive through would quietly eat somebody's card.
{
  rateHits.clear()
  await db.exec('delete from card_accounts')
  await db.exec('delete from card_gifts')
  const A = 'VM-AAAA-AAAA-AAAA-AAAA-AAAA'
  const B = 'VM-BBBB-BBBB-BBBB-BBBB-BBBB'
  await sql`insert into card_accounts (id_hash, name, state) values (${hashOf(A)}, '送的人',
    ${JSON.stringify({ cards: { 'p:P1': { id: 'p:P1', dupes: 2 } } })})`
  await sql`insert into card_accounts (id_hash, name, state) values (${hashOf(B)}, '收的人',
    ${JSON.stringify({ cards: {} })})`

  // the route no longer exists: it is not handled at all, which the real
  // server turns into a 404 (see the `if (!handled)` in server.js)
  const gone = await call('/api/card/gift',
    { id: A, code: battleCode(hashOf(B)).toLowerCase(), cardId: 'p:P1' }, 'gf')
  check('送卡的接口已经没有了', gone.code === 0 && !gone.body.ok, `code ${gone.code}`)
  const before = await sql`select count(*)::int as n from card_gifts`
  check('而且什么礼物都没生成', before[0].n === 0, String(before[0].n))

  // one that was already in flight when the feature went away
  await sql`insert into card_gifts (from_h, to_h, card_id) values (${hashOf(A)}, ${hashOf(B)}, 'p:P1')`
  const waiting = await call('/api/card/gifts', { id: B }, 'gf')
  check('在途的礼物还看得到', waiting.body.waiting === 1, JSON.stringify(waiting.body))
  const claim = await call('/api/card/gifts', { id: B, claim: true }, 'gf')
  check('而且还领得到——功能下线不该吃掉别人的卡',
    (claim.body.gifts as { cardId: string }[])?.[0]?.cardId === 'p:P1',
    JSON.stringify(claim.body.gifts))
}

// ---- no database ------------------------------------------------------

const offlineApi = makeCardApi(null, { rateLimited, readBody, json } as never)
const res: Res = { code: 0, body: {} }
await offlineApi.route({ body: '{}', method: 'POST' } as never, res as never, '/api/card/load', 'x')
check('without a database the route says so instead of throwing',
  res.body.offline === true && typeof res.body.today === 'string')

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
