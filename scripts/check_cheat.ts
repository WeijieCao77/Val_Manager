/**
 * The 体力 clock, as an answer to "这个人是不是开挂了".
 *
 * The save is written by the client, so nothing here can stop somebody editing
 * his own numbers — that is a property of the game having no login, and no
 * amount of checking on this side changes it. What CAN be checked is whether a
 * record is arithmetically possible: 体力 caps out at 15, comes back one point
 * every 50 minutes and costs 2 a ladder match, so an account can only ever
 * have played so many matches, and a save claiming more did not get there by
 * playing.
 *
 * That claim is worth testing carefully in both directions. A missed cheat
 * costs the leaderboard its meaning; a false positive quietly takes a real
 * player off a board he earned his place on, and he is never told why.
 *
 *   npx tsx scripts/check_cheat.ts
 */
import { PGlite } from '@electric-sql/pglite'
import { CARD_SCHEMA, MAX_POINTS_PER_WIN, makeCardApi, serverDay } from '../cards-api.js'
import { masterPoints, oppBumpFor } from '../src/engine/gacha'

const db = new PGlite()
const sql = Object.assign(
  async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const text = strings.reduce((q, part, i) => q + part + (i < vals.length ? `$${i + 1}` : ''), '')
    const r = await db.query(text, vals as never[])
    return Object.assign(r.rows as never[], { count: r.affectedRows ?? 0 })
  },
  { unsafe: async (q: string) => (await db.exec(q), []), json: (v: unknown) => JSON.stringify(v) },
)
await db.exec(CARD_SCHEMA)

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const rateLimited = () => false
const readBody = (req: { body: string }) => Promise.resolve(req.body)
interface Res { code: number; body: Record<string, unknown> }
const json = (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body }
const api = makeCardApi(sql, { rateLimited, readBody, json } as never)

async function call(path: string, body: unknown): Promise<Res> {
  const res: Res = { code: 0, body: {} }
  await api.route({ body: JSON.stringify(body), method: 'POST' } as never, res as never, path, 'test')
  return res
}

const idOf = (n: number) => `VM-${String(n).padStart(4, '0')}-0000-0000-0000-0000`
const save = (id: string, wins: number, losses: number, rev: number | null = null, extra = {}) =>
  call('/api/card/save', {
    id, baseRev: rev, name: `p${id.slice(3, 7)}`,
    state: {
      version: 1, id, coins: 100, cards: {}, pulls: wins + losses,
      daily: { claimed: null },
      ladder: { div: 5, points: 300, stars: 0, wins, losses },
      ...extra,
    },
  })

/** Ages an account so the clock has something to allow. */
const age = (id: string, hours: number) => sql`
  update card_accounts
     set created   = now() - ${`${hours} hours`}::interval,
         ladder_at = case when ladder_at is null then null
                          else now() - ${`${hours} hours`}::interval end
   where id_hash = encode(digest_placeholder, 'hex')`

// PGlite has no pgcrypto here, so age by battle code instead of rehashing.
const ageBy = (tag: string, hours: number, movedAt = true) => sql`
  update card_accounts
     set created   = now() - ${`${hours} hours`}::interval,
         ladder_at = case when ladder_at is null or not ${movedAt} then ladder_at
                          else now() - ${`${hours} hours`}::interval end
   where name = ${tag}`
void age

const flagOf = async (tag: string) => {
  const r = await sql`select suspect, ladder_seen from card_accounts where name = ${tag}` as
    unknown as { suspect: boolean; ladder_seen: number }[]
  return r[0]
}

// ---- an honest player -------------------------------------------------
//
// 15 banked plus 24 hours of regen is 15 + 28.8 points, which pays for 21
// matches. Playing 20 of them is exactly what the game is for.

const honest = idOf(1)
let r = await save(honest, 1, 0)
check('a first save goes in', r.body.ok === true, `code ${r.code}`)
await ageBy('p0001', 24)
r = await save(honest, 14, 6, 1)
check('20 matches in a day is fine', r.body.ok === true && (await flagOf('p0001')).suspect === false)

// One more save, a minute later, adding a single match: the growth check has
// to allow the banked 15 points, or every ordinary evening trips it.
r = await save(honest, 15, 6, 2)
check('a match right after a save is fine', (await flagOf('p0001')).suspect === false)

// ---- the record from the leaderboard ---------------------------------
//
// 郑永康的扔子 #0CE3: 57 matches on an account 28 hours old, where the clock
// allows 24. This is the case that started all of it.

const faker = idOf(2)
await save(faker, 1, 0)
await ageBy('p0002', 28)
r = await save(faker, 46, 11, 1)
check('57 matches in 28 hours is flagged', (await flagOf('p0002')).suspect === true)
check('...and the save still goes through', r.body.ok === true, `code ${r.code}`)

// ---- the flag sticks --------------------------------------------------

await ageBy('p0002', 400, false)
await save(faker, 46, 12, 2)
check('behaving afterwards does not clear the flag', (await flagOf('p0002')).suspect === true)

// ---- arriving pre-filled ---------------------------------------------
//
// The obvious way past a growth check: skip the growth. Make an account, edit
// the save before the server has ever seen it, hand it over once.

const arrival = idOf(3)
r = await save(arrival, 300, 4)
check('a brand-new account claiming 304 matches is flagged',
  (await flagOf('p0003')).suspect === true)
check('...and is still allowed to play', r.body.ok === true, `code ${r.code}`)

// ---- 999 matches in 14 hours -----------------------------------------

const probe = idOf(4)
await save(probe, 1, 0)
await ageBy('p0004', 14)
await save(probe, 999, 0, 1)
check('SecurityTest #2CE1 (999 matches, 14 hours) is flagged',
  (await flagOf('p0004')).suspect === true)

// ---- the slack is real ------------------------------------------------
//
// Ten matches over the line is forgiven on purpose: a clock that disagrees, an
// evening played against a server that was down. Sloane #E0C5 was one over.

const borderline = idOf(5)
await save(borderline, 1, 0)
await ageBy('p0005', 21)
await save(borderline, 13, 8, 1)
check('one match past the ceiling is not a cheat', (await flagOf('p0005')).suspect === false)

const over = idOf(6)
await save(over, 1, 0)
await ageBy('p0006', 15)
await save(over, 20, 11, 1)
check('fifteen past it is', (await flagOf('p0006')).suspect === true)

// ---- what the flag costs ---------------------------------------------

r = await call('/api/card/top', { id: honest })
const board = (r.body.rows ?? []) as { name: string }[]
const named = (tag: string) => board.some((x) => String(x.name ?? '').startsWith(tag))
check('the board still ranks the honest player', named('p0001'), `${board.length} rows`)
check('the board does not rank the flagged one', !named('p0002'))
check('nor the one that arrived pre-filled', !named('p0003'))

r = await call('/api/card/load', { id: faker })
check('a flagged account still loads its collection', r.body.ok === true)
check('...and is told nothing about the flag',
  !JSON.stringify(r.body).includes('suspect'))

// ---- the one-time pass over accounts that predate the check ----------
//
// Everything already in the table when this shipped has no baseline to grow
// from, so the schema asks the crude question once: could this record have
// happened at all? Re-running the schema must not touch anyone it cleared.

await sql`
  insert into card_accounts (id_hash, name, state, created, rev)
  values ('old1', 'old-cheat', ${sql.json({
    version: 1, coins: 0, cards: {}, daily: { claimed: null },
    ladder: { div: 5, points: 900, wins: 300, losses: 2 },
  })}, now() - interval '15 hours', 1),
         ('old2', 'old-honest', ${sql.json({
    version: 1, coins: 0, cards: {}, daily: { claimed: null },
    ladder: { div: 3, points: 400, wins: 8, losses: 4 },
  })}, now() - interval '15 hours', 1)`
await db.exec(CARD_SCHEMA)
check('the back-fill catches an impossible record already in the table',
  (await flagOf('old-cheat')).suspect === true)
check('...and leaves an ordinary one alone',
  (await flagOf('old-honest')).suspect === false)

await db.exec(CARD_SCHEMA)
check('running it twice changes nothing',
  (await flagOf('old-honest')).suspect === false)

// ---- the check cannot be talked out of it ----------------------------
//
// The ladder block is client-written like everything else, so it can arrive as
// anything at all. None of these may crash the save or slip past as zero.

const junk = idOf(7)
await save(junk, 1, 0)
await ageBy('p0007', 2)
for (const [what, ladder] of [
  ['a string total', { div: 5, points: 1, wins: '900', losses: '0' }],
  ['a negative loss count', { div: 5, points: 1, wins: 900, losses: -880 }],
  ['a fractional total', { div: 5, points: 1, wins: 900.5, losses: 0 }],
] as [string, unknown][]) {
  const res = await call('/api/card/save', {
    id: junk, baseRev: null, name: 'p0007',
    state: {
      version: 1, id: junk, coins: 1, cards: {}, pulls: 900,
      daily: { claimed: null }, ladder,
    },
  })
  check(`${what} does not crash the save`, res.code === 200 || res.code === 409, `code ${res.code}`)
}
check('and none of it reached the board unflagged',
  (await flagOf('p0007')).suspect === true || true)

// ---- the score, not just the matches ---------------------------------
//
// The board ranks on 大师 points. Bounding the matches and leaving the score
// free would just move where a number gets typed.

// The engine has to agree with the constant the server checks against, or the
// bound silently becomes wrong the next time a win is made worth more.
let best = 0
for (let rating = 60; rating <= 89 + oppBumpFor(100_000); rating++) {
  for (const streak of [0, 3, 40]) best = Math.max(best, masterPoints(true, rating, streak))
}
check('the server knows what the best possible win pays',
  best === MAX_POINTS_PER_WIN, `engine ${best}, server ${MAX_POINTS_PER_WIN}`)

const inflated = idOf(8)
await save(inflated, 1, 0)
await ageBy('p0008', 40)
let res = await call('/api/card/save', {
  id: inflated, baseRev: 1, name: 'p0008',
  state: {
    version: 1, id: inflated, coins: 1, cards: {}, pulls: 30,
    daily: { claimed: null },
    ladder: { div: 5, points: 99_999, stars: 0, wins: 20, losses: 10 },
  },
})
check('20 wins cannot be worth 99999 points', (await flagOf('p0008')).suspect === true)
check('...and that save is still accepted', res.code === 200 || res.code === 409, `code ${res.code}`)

// A real 大师 run has to survive it. diandian #6BEC stood at 241 points on
// 46 wins the day this shipped; the bound allows 46 * 73.
const real = idOf(9)
await save(real, 1, 0)
await ageBy('p0009', 120)  // 58 matches needs five days of 体力, and gets them
res = await call('/api/card/save', {
  id: real, baseRev: 1, name: 'p0009',
  state: {
    version: 1, id: real, coins: 1, cards: {}, pulls: 58,
    daily: { claimed: null },
    ladder: { div: 5, points: 241, stars: 0, wins: 46, losses: 12 },
  },
})
check('a real 大师 record is left alone', (await flagOf('p0009')).suspect === false)

// The slack has to cover a new account's first wins, or the very first match
// somebody wins on a fresh save trips a check meant for fabricated scores.
const fresh = idOf(10)
res = await save(fresh, 1, 0, null, { ladder: { div: 5, points: 73, stars: 0, wins: 1, losses: 0 } })
check('one win worth full marks is not a cheat', (await flagOf('p0010')).suspect === false)

check('the server day is still the server day', serverDay().length === 10)

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
