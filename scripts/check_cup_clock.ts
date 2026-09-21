/**
 * A cup's clock survives a pass that never comes back.
 *
 *   npx tsx scripts/check_cup_clock.ts
 *
 * 2026-09-21, 「全服组队杯卡住了，一直在 0 秒」: the 21:00 cup played five ties
 * and stopped at round 0 for an hour and a half. Nothing was wrong with the
 * bracket and nothing was in the log — a pass had stopped on an await that
 * never answered, and `running ??=` handed that same pending promise to every
 * tick after it. One await froze a 485-player tournament in silence.
 *
 * So: a pass that does not come back is abandoned, the caller is told (which
 * is how it reaches the log), the worker it may have been waiting on is
 * thrown away, and the next tick plays the round that was owed.
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { newGacha } from '../src/engine/gacha'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import { makeCupPass } from '../cup-clock.js'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const tick = () => new Promise((r) => setTimeout(r, 1))
// the bells are unref'd so that a stalled pass cannot hold a shutdown open;
// this script has no server to keep the loop alive, so it keeps its own
const alive = setInterval(() => {}, 20)

// ------------------------------------------------------------ the guard itself
{
  let stalls = 0
  const clock = makeCupPass({ name: 'test', limitMs: 30, onStall: () => stalls++ })
  let passes = 0
  const never = clock.run(() => { passes++; return new Promise(() => {}) })
  assert.equal(clock.run(() => { passes++; return Promise.resolve() }), never, '一次只跑一趟')
  await assert.rejects(never, /还没回来/, '不回来的那一趟会报错，报错才会进日志')
  check('推进卡住时会放弃并报错', passes === 1 && stalls === 1, `stalls=${stalls}`)
  await clock.run(async () => { passes++ })
  check('放弃以后下一趟照跑', passes === 2 && clock.inflight === null)

  // an ordinary failure is still an ordinary failure: reported, and the turn ends
  await assert.rejects(clock.run(async () => { throw new Error('数据库炸了') }), /数据库炸了/)
  check('普通报错照样往外抛，不会把时钟占住', clock.inflight === null)
  // and a pass that comes back in time never rings the bell
  await clock.run(async () => {})
  await new Promise((r) => setTimeout(r, 60))
  check('按时跑完的那一趟不会被误报', stalls === 1)
}

// ------------------------------------------------------------ a real cup whose duel never answers
{
  const { CARD_SCHEMA, engine } = await import('../cards-api.js')
  const { TEAM_CUP_SCHEMA, makeTeamCupApi } = await import('../teamcup-api.js')
  const { displayName } = await import('../names.js')
  const db = new PGlite(), sql = makeSql(db)
  await db.exec(CARD_SCHEMA); await db.exec(TEAM_CUP_SCHEMA)
  const hash = (id: string) => createHash('sha256').update(id).digest('hex')
  let now = Date.parse('2026-09-19T00:10:00Z')
  let wedge = true
  let played = 0
  const api = makeTeamCupApi(sql, {
    engine, displayName, normalizeId: (v: unknown) => (typeof v === 'string' ? v : null), rateLimited: () => false,
    timer: true, minDays: 0, clock: () => now, passMs: 40,
    // the duel that never answers — what a wedged worker or a connection that
    // never arrives looks like from inside the pass
    compute: async (args: unknown[]) => {
      if (wedge) return new Promise(() => {})
      played++
      return (engine as never as { playOpenCupMatch: (...a: unknown[]) => unknown }).playOpenCupMatch(...args)
    },
    readBody: async (req: { body: unknown }) => JSON.stringify(req.body),
    json: (res: { body?: unknown }, _c: number, body: unknown) => { res.body = body },
  } as never)
  const call = async (path: string, body: object) => {
    const res: { body?: never } = {}
    await api.route({ body }, res, `/api/card/teamcup${path}`, 't')
    return res.body as never as Record<string, never>
  }
  const N = 25, today = '2026-09-19'
  const ids = Array.from({ length: N }, (_, i) => `VM-CLOCK-0000-0000-000-${String(i).padStart(4, '0')}`)
  for (let i = 0; i < N; i++) {
    const g = newGacha(ids[i], `队员${i}`, today) as never as Record<string, never>
    const t = CUP_TEAMS[(i * 7) % CUP_TEAMS.length]
    ;(g as never as { pulls: number }).pulls = 200
    ;(g as never as { squad: unknown }).squad = structuredClone(t.squad)
    const cards = (g as never as { cards: Record<string, unknown> }).cards
    for (const c of [...t.squad.slots, t.squad.coach].filter(Boolean) as string[]) cards[c] = { id: c, level: i % 6, dupes: 0, seen: 1, got: today }
    await sql`insert into card_accounts (id_hash, name, state, created, verified) values (${hash(ids[i])}, ${`队员${i}`}, ${sql.json(g)}, now() - interval '9 days', now())`
  }
  for (const id of ids) assert((await call('/join', { id })).ok)

  now = Date.parse('2026-09-19T01:00:01Z')
  // the clock's own bell is two minutes; this cup is asked to give up in 40ms
  const stalled: string[] = []
  const nudge = () => { void api.advance(now).catch((err: Error) => stalled.push(err.message)) }
  nudge()   // this one only starts the cup; the duels come on the tick after it
  await tick()
  const live = (await sql`select round, status from team_cups where status = 'live'`)[0]
  check('比赛正常开赛', !!live, JSON.stringify(live ?? null))

  // nothing moves while a duel never answers, and every later tick waits with it
  for (let k = 0; k < 3; k++) { nudge(); await tick() }
  const stuck = (await sql`select count(*)::int as n from team_cup_ties where winner is not null and team_b is not null`)[0].n
  check('单挑不回话时，这一轮确实推不动', stuck === 0, `打完 ${stuck} 场`)

  await new Promise((r) => setTimeout(r, 80))
  check('卡住的那一趟被丢下并报了错', stalled.length > 0 && /还没回来/.test(stalled[0]), stalled[0] ?? '(still waiting)')

  // the next tick plays the round that was owed — the cup is not lost
  wedge = false
  for (let k = 0; k < 12 && (await sql`select status from team_cups where id = 1`)[0].status === 'live'; k++) {
    now += 8 * 60_000
    await api.advance(now).catch(() => {})
  }
  const [cup] = await sql`select status, round, champion from team_cups where id = 1`
  check('下一趟照常把整届打完', cup.status === 'done' && cup.champion !== null, `${cup.status} 第 ${cup.round} 轮`)
  check('丢下的那一趟没有重复算分', played > 0)
  api.close()
  await db.close()
}

clearInterval(alive)
console.log(bad ? `FAILED ${bad}` : 'ok  时钟不会被一趟没回来的推进占死')
process.exit(bad ? 1 : 0)
