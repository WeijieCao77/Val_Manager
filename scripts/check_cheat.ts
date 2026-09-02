/**
 * What is left of the 体力 flag now that a save cannot move the ladder.
 *
 *   npx tsx scripts/check_cheat.ts
 *
 * The flag was born when the client wrote its own record: the only question
 * the server could ask was arithmetic — can this many matches have been
 * played — and it caught the clumsy. The record is the server's now (see
 * engine/cardActions.ts and scripts/check_authority.ts), so a save claiming
 * 999 matches changes nothing and there is nothing to flag.
 *
 * Three things still have to hold: a save cannot write a record, a client
 * that says it played 999 is not flagged for saying so (it is simply not
 * read), and the accounts already flagged from before — the ones whose
 * records were typed in under the old rules — stay off the board until the
 * owner clears them, while a pardon survives the one-time back-fill.
 */
process.env.ENGINE_FROM_SOURCE = '1'
import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { masterPoints, oppBumpFor } from '../src/engine/gacha'
const { CARD_SCHEMA, MAX_POINTS_PER_WIN, makeCardApi, serverDay } = await import('../cards-api.js')

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
const hashOf = (id: string) => createHash('sha256').update(id).digest('hex')

const readBody = (req: { body: string }) => Promise.resolve(req.body)
interface Res { code: number; body: Record<string, unknown> }
const json = (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body }
const api = makeCardApi(sql, { rateLimited: () => false, readBody, json } as never)

async function call(path: string, body: unknown): Promise<Res> {
  const res: Res = { code: 0, body: {} }
  await api.route({ body: JSON.stringify(body), method: 'POST' } as never, res as never, path, 'test')
  return res
}
const row = async (id: string) => (await sql`
  select suspect, ladder_seen, (state->'ladder'->>'wins')::int as wins,
         (state->'ladder'->>'losses')::int as losses
  from card_accounts where id_hash = ${hashOf(id)}` as unknown as
  { suspect: boolean; ladder_seen: number; wins: number; losses: number }[])[0]

// ---- a save cannot write a record -------------------------------------
{
  const ID = 'VM-0001-0000-0000-0000-0000'
  const made = await call('/api/card/claim', { id: ID, name: 'p0001' })
  const rev = made.body.rev as number
  const r = await call('/api/card/save', {
    id: ID, baseRev: rev, name: 'p0001',
    state: { ladder: { div: 5, points: 99_999, stars: 0, wins: 999, losses: 0 }, pulls: 999 },
  })
  const after = await row(ID)
  check('a save claiming 999 matches is accepted as a save', r.body.ok === true, `code ${r.code}`)
  check('...and the record it claimed is not there', after.wins === 0 && after.losses === 0,
    `${after.wins}-${after.losses}`)
  check('...so there is nothing to flag', after.suspect === false)
  check('the ladder total the row remembers is the real one', after.ladder_seen === 0, `${after.ladder_seen}`)
}

// ---- the score, not just the matches ---------------------------------
{
  let best = 0
  for (let rating = 60; rating <= 89 + oppBumpFor(100_000); rating++) {
    for (const streak of [0, 3, 40]) best = Math.max(best, masterPoints(true, rating, streak))
  }
  check('the server knows what the best possible win pays',
    best === MAX_POINTS_PER_WIN, `engine ${best}, server ${MAX_POINTS_PER_WIN}`)
}

// ---- accounts flagged under the old rules stay off the board ----------
{
  await sql`
    insert into card_accounts (id_hash, name, state, created, rev, suspect, ladder_at)
    values ('flagged1', 'old-cheat', ${sql.json({
      version: 1, coins: 0, cards: {}, daily: { claimed: null },
      ladder: { div: 5, points: 900, wins: 300, losses: 2 },
    })}, now() - interval '15 hours', 1, true, now()),
           ('honest1', 'old-honest', ${sql.json({
      version: 1, coins: 0, cards: {}, daily: { claimed: null },
      ladder: { div: 3, points: 400, wins: 8, losses: 4 },
    })}, now() - interval '15 hours', 1, false, now())`
  const r = await call('/api/card/top', {})
  const board = (r.body.rows ?? []) as { name: string }[]
  const named = (tag: string) => board.some((x) => String(x.name ?? '').startsWith(tag))
  check('the board ranks the honest one', named('old-honest'), `${board.length} rows`)
  check('the board does not rank the flagged one', !named('old-cheat'))
}

// ---- the one-time pass over accounts that predate the check ----------
{
  await sql`
    insert into card_accounts (id_hash, name, state, created, rev)
    values ('old1', 'legacy-cheat', ${sql.json({
      version: 1, coins: 0, cards: {}, daily: { claimed: null },
      ladder: { div: 5, points: 900, wins: 300, losses: 2 },
    })}, now() - interval '15 hours', 1),
           ('old2', 'legacy-honest', ${sql.json({
      version: 1, coins: 0, cards: {}, daily: { claimed: null },
      ladder: { div: 3, points: 400, wins: 8, losses: 4 },
    })}, now() - interval '15 hours', 1)`
  await sql`
    insert into card_accounts (id_hash, name, state, created, rev, pardon_seen, pardon_at)
    values ('old3', 'legacy-pardoned', ${sql.json({
      version: 1, coins: 0, cards: {}, daily: { claimed: null },
      ladder: { div: 5, points: 300, wins: 200, losses: 2 },
    })}, now() - interval '15 hours', 1, 202, now())`
  await db.exec(CARD_SCHEMA)
  const flag = async (name: string) => (await sql`select suspect from card_accounts where name = ${name}` as unknown as { suspect: boolean }[])[0].suspect
  check('the back-fill catches an impossible record already in the table', (await flag('legacy-cheat')) === true)
  check('...and leaves an ordinary one alone', (await flag('legacy-honest')) === false)
  check('...and a pardoned one', (await flag('legacy-pardoned')) === false)
  await db.exec(CARD_SCHEMA)
  check('running it twice changes nothing', (await flag('legacy-honest')) === false && (await flag('legacy-pardoned')) === false)
}

// ---- the flag cannot be created from the client any more --------------
{
  const ID = 'VM-0002-0000-0000-0000-0000'
  await call('/api/card/claim', { id: ID, name: 'p0002' })
  await sql`update card_accounts set created = now() - interval '14 hours' where id_hash = ${hashOf(ID)}`
  for (const ladder of [
    { div: 5, points: 1, wins: '900', losses: '0' },
    { div: 5, points: 1, wins: 900, losses: -880 },
    { div: 5, points: 1, wins: 900.5, losses: 0 },
    { div: 5, points: 99_999, wins: 999, losses: 0 },
  ]) {
    const r = await call('/api/card/save', { id: ID, baseRev: 1, name: 'p0002', state: { ladder, pulls: 900 } })
    check(`junk ladder ${JSON.stringify(ladder).slice(0, 40)} does not crash the save`, r.code === 200 || r.code === 409, `code ${r.code}`)
  }
  const after = await row(ID)
  check('none of it reached the record', after.wins === 0 && after.losses === 0 && after.suspect === false)
}

check('the server day is still the server day', serverDay().length === 10)

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
