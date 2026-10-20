/**
 * 读点 — storage, matching and the clock for the rules in src/engine/swift.ts.
 *
 * A player queues with a five. Another player in the queue whose five is close
 * enough is a live match; after SWIFT_WAIT_SEC alone the queue hands over a
 * ghost instead — another player's last five, calling rounds the way that
 * player has called them (swift_players.habit) — or, when there is nobody yet,
 * a real club's five run by the AI. Ghost and AI rounds are answered the moment
 * the player calls; a live round waits for both, or for the clock.
 *
 * Every write to a match is a short transaction holding that match's row: read
 * the state, apply one call with the engine (a round is well under a
 * millisecond), write it back. A side that lets the clock run has its round
 * called by autoChoice. The clock is enforced by whoever reads the match next,
 * and by a sweep that finishes matches nobody is reading any more.
 *
 * The finish, under the same lock: a rating for each player in the match
 * (Elo, ghosts and the AI held at their own number), the player's calls folded
 * into their habit, the five kept as their ghost, and — for the first
 * SWIFT_PAID_GAMES finished matches of a Shanghai day, win or lose, on an
 * account that may trade — coins by mail. It runs once: the match row is
 * locked and moves to 'done' in the same transaction.
 */
import { createHash, randomBytes } from 'node:crypto'
import { isVerified } from './phone-api.js'
import { TRADE_PULLS, TRADE_DAYS } from './market-api.js'

const hash = (id) => createHash('sha256').update(id).digest('hex')
const freshSeed = () => randomBytes(4).readUInt32LE(0)

/** seconds alone in the queue before a ghost is dealt */
export const SWIFT_WAIT_SEC = 12
/**
 * Every finished match pays — a win more than a loss — for the first SWIFT_PAID_GAMES a Shanghai day.
 * A side that called fewer than half its rounds itself (the clock called the rest) is paid nothing,
 * and neither is the side that gave the match up; neither uses one of the day's paid games.
 */
export const SWIFT_PAID_GAMES = 5
export const SWIFT_WIN_COINS = 100
export const SWIFT_LOSS_COINS = 30
/** grace on top of a phase's clock for a slow phone */
const GRACE_MS = 2500
/** a match past its clock this long with nobody reading it is called by the sweep */
const STALE_MS = 60_000
/** clock-called rounds in a row before a side forfeits the match */
export const FORFEIT_ROUNDS = 3
const K = 24

export const SWIFT_SCHEMA = `
create table if not exists swift_matches (
  id        bigserial primary key,
  a_hash    text not null,
  b_hash    text,
  kind      text not null,
  ghost_of  text,
  -- the ghost's way of calling rounds, read when the match was dealt
  habit     jsonb,
  state     jsonb not null,
  status    text not null default 'live',
  deadline  timestamptz not null,
  ratings   jsonb,
  created   timestamptz not null default now(),
  finished  timestamptz
);
create index if not exists swift_matches_a_idx on swift_matches (a_hash, created desc);
create index if not exists swift_matches_b_idx on swift_matches (b_hash, created desc);
create index if not exists swift_matches_live_idx on swift_matches (deadline) where status = 'live';
create table if not exists swift_queue (
  id_hash  text primary key,
  name     text,
  side     jsonb not null,
  strength real not null,
  joined   timestamptz not null default now()
);
-- the last time the queued page asked: only players still on the page are paired live
alter table swift_queue add column if not exists seen timestamptz;
-- 快速 (first to 5) and 完整 (first to 13) queue apart
alter table swift_queue add column if not exists format text not null default 'quick';
create table if not exists swift_players (
  id_hash  text primary key,
  name     text,
  rating   int not null default 1000,
  played   int not null default 0,
  won      int not null default 0,
  habit    jsonb,
  side     jsonb,
  day      text,
  day_wins int not null default 0,
  updated  timestamptz not null default now()
);
create index if not exists swift_players_rating_idx on swift_players (rating desc);
-- paid games today (wins and losses), beside the day's wins
alter table swift_players add column if not exists day_games int not null default 0;
`

export function makeSwiftApi(sql, {
  readBody, json, normalizeId, displayName, rateLimited, engine,
  clock = () => Date.now(),
  timer = true,
  minDays = TRADE_DAYS,
  bg = sql,
}) {
  const guard = (res, bucket, max) => {
    if (rateLimited(bucket, max)) { json(res, 429, { ok: false, why: 'rate' }); return true }
    return false
  }
  const tx = (fn) => (sql.begin ? sql.begin(fn) : fn(sql))
  const who = (name, h) => { const d = displayName(name, h); return { name: d.name, tag: `#${d.tag}` } }
  const matchId = (v) => (/^\d{1,18}$/.test(String(v ?? '')) ? String(v) : null)
  const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime())
  const dayOf = (now) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10)

  async function readMe(req) {
    let body
    try { body = JSON.parse(await readBody(req, 4096)) } catch { return { body: null, me: null } }
    const id = normalizeId(body?.id)
    return { body, me: id ? hash(id) : null }
  }

  /** The five a player asks to field, at the levels they hold, as the engine's side. */
  async function sideOf(me, pick) {
    const rows = await sql`select name, state->'squad' as squad, state->'cards' as cards, suspect from card_accounts where id_hash = ${me}`
    if (!rows.length) return { missing: true }
    if (rows[0].suspect) return { why: '这个账号暂时不能对战。' }
    const id = (x) => (typeof x === 'string' && x.length > 0 && x.length <= 40 ? x : null)
    const raw = pick && Array.isArray(pick.slots) ? pick : rows[0].squad
    const slots = Array.isArray(raw?.slots) ? raw.slots.slice(0, 5).map(id) : []
    const coach = id(raw?.coach)
    const cards = rows[0].cards && typeof rows[0].cards === 'object' ? rows[0].cards : {}
    if (slots.length < 5 || slots.some((s) => !s)) return { why: '先凑齐五个人。' }
    if (slots.some((s) => !cards[s]) || (coach && !cards[coach])) return { why: '阵容里有卡不在收藏里了，刷新后再试。' }
    const cap = engine.retiredLimit(slots)
    if (!cap.ok) return { why: cap.why }
    const people = new Set()
    for (const s of slots) {
      const c = engine.cardById(s)
      if (!engine.isPlayerCard(c)) return { why: '五个位置都要放选手卡。' }
      if (people.has(c.playerId)) return { why: '同一个人不能上两次。' }
      people.add(c.playerId)
    }
    const d = who(rows[0].name, me)
    const side = engine.swiftSide(d.name, d.tag, slots, coach, (cid) => engine.playLevel(cid, cards[cid]))
    if (!side) return { why: '先凑齐五个人。' }
    return { side, name: rows[0].name ?? null }
  }

  /** whether a win today pays: a phone-bound account that has opened enough packs and is old enough to trade */
  async function mayEarn(db, me) {
    const r = await db`
      select state->>'pulls' as pulls, suspect,
             ceil(extract(epoch from (created + make_interval(days => ${minDays}) - now())))::int as wait
        from card_accounts where id_hash = ${me}`
    if (!r.length || r[0].suspect) return false
    return Math.max(0, Math.floor(Number(r[0].pulls ?? 0))) >= TRADE_PULLS && Math.max(0, Number(r[0].wait) || 0) <= 0
  }

  // a round just played gets its replay on screen before the next call's clock starts
  const deadlineOf = (state, now) => new Date(now + (state.phase === 'recon' ? engine.SWIFT_RECON_SEC
    : engine.SWIFT_CHOOSE_SEC + (state.log?.length ? engine.SWIFT_REPLAY_SEC : 0)) * 1000 + GRACE_MS)

  // ------------------------------------------------------------ the robot side of a ghost or AI match

  /** Answer for side 1 when it is not a person: call the round, and take its second look after a 侦察. */
  function robot(state, row) {
    const habit = row.kind === 'ghost' ? engine.habitFrom(row.habit ?? null) : undefined
    let m = state
    for (let guard = 0; guard < 4 && m.phase !== 'done'; guard++) {
      if (m.phase === 'choose' && m.pending[0] && !m.pending[1]) {
        const rng = new engine.Rng((engine.hashStr(`swift:bot:${m.seed}:${m.round}`) >>> 0))
        // a ghost calls as its player did and does not adapt; the AI reads the half so far
        m = engine.submitChoice(m, 1, row.kind === 'ghost' ? engine.aiChoice(m, 1, rng, habit, 0) : engine.aiChoice(m, 1, rng))
        continue
      }
      if (m.phase === 'recon' && m.recon[1]) { m = engine.submitRecon(m, 1, engine.aiRecon(m, 1)); continue }
      break
    }
    return m
  }

  /** The clock: a phase past its deadline is called for whoever has not. */
  function overdue(state, row, now) {
    let m = state
    for (let guard = 0; guard < 3 && m.phase !== 'done' && ms(row.deadline) <= now; guard++) {
      if (m.phase === 'choose') {
        for (const t of [0, 1]) {
          // a ghost or the AI is side 1 and answers for itself (robot, below); it never runs the clock down
          if (m.pending[t] || (row.kind !== 'live' && t === 1)) continue
          // the clock calls it; the round stays out of this player's habit, and three in a row is a forfeit
          const autos = [(m.autos?.[0] ?? []).slice(), (m.autos?.[1] ?? []).slice()]
          autos[t].push(m.round)
          const idle = (m.idle ?? [0, 0]).slice()
          idle[t]++
          m = { ...engine.submitChoice(m, t, engine.autoChoice(m, t)), autos, idle }
        }
        if (row.kind !== 'live') m = robot(m, row)
        const gone = [0, 1].filter((t) => (m.idle?.[t] ?? 0) >= FORFEIT_ROUNDS)
        if (gone.length && m.phase !== 'done') {
          // both gone: the one behind is the one who left
          const t = gone.length === 2 ? (m.score[0] <= m.score[1] ? 0 : 1) : gone[0]
          m = { ...m, phase: 'done', winner: 1 - t, pending: [null, null], recon: [false, false], resigned: t, forfeit: true }
        }
      } else if (m.phase === 'recon') {
        for (const t of [0, 1]) if (m.recon[t]) m = engine.submitRecon(m, t, m.pending[t].plan)
      }
      row = { ...row, deadline: deadlineOf(m, now) }
      if (row.kind !== 'live') m = robot(m, row)
    }
    return m
  }

  // ------------------------------------------------------------ the finish

  const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400))

  async function finish(db, row, state, now) {
    const humans = [row.a_hash, row.kind === 'live' ? row.b_hash : null]
    const players = await db`select id_hash, rating, habit from swift_players where id_hash = any(${humans.filter(Boolean)})`
    const byId = new Map(players.map((p) => [p.id_hash, p]))
    const ghostRating = row.kind === 'ghost' && row.ghost_of
      ? (await db`select rating from swift_players where id_hash = ${row.ghost_of}`)[0]?.rating ?? 1000 : 1000
    const rating = [byId.get(row.a_hash)?.rating ?? 1000, humans[1] ? byId.get(humans[1])?.rating ?? 1000 : ghostRating]
    // a match given up (or walked away from) before the target score's worth of rounds counts for nothing:
    // no rating either way and no coins — otherwise two accounts trade instant resignations for wins
    const short = state.log.length < engine.formatOf(state).win
    const delta = [0, 1].map((t) => (short ? 0 : Math.round(K * ((state.winner === t ? 1 : 0) - expected(rating[t], rating[1 - t])))))
    const day = dayOf(now)
    const ratings = {}
    for (const t of [0, 1]) {
      const h = humans[t]
      if (!h) continue
      const won = state.winner === t ? 1 : 0
      const habit = engine.addHabit(byId.get(h)?.habit ?? null, state, t)
      const side = { ...state.sides[t], strength: engine.sideStrength(state.sides[t]) }
      const name = t === 0 ? row.a_name : row.b_name
      // paid: a full match, called at least half its rounds itself, not given up, and a paid game left today.
      // Giving a match up still uses one of the day's paid games, so a bad start is not re-rolled for free.
      const calls = state.calls?.[t] ?? 0
      const gaveUp = state.resigned === t
      const earns = !short && calls * 2 >= state.log.length && !gaveUp
      const slot = earns || gaveUp
      const got = await db`
        insert into swift_players (id_hash, name, rating, played, won, habit, side, day, day_wins, day_games, updated)
        values (${h}, ${name ?? null}, ${1000 + delta[t]}, 1, ${won}, ${db.json(habit)}::jsonb, ${db.json(side)}::jsonb, ${day}, ${won}, ${slot ? 1 : 0}, now())
        on conflict (id_hash) do update set
          name = coalesce(excluded.name, swift_players.name), rating = swift_players.rating + ${delta[t]},
          played = swift_players.played + 1, won = swift_players.won + ${won}, habit = excluded.habit, side = excluded.side,
          day_wins = case when swift_players.day = ${day} then swift_players.day_wins + ${won} else ${won} end,
          day_games = case when swift_players.day = ${day} then swift_players.day_games + ${slot ? 1 : 0} else ${slot ? 1 : 0} end,
          day = ${day}, updated = now()
        returning rating, day_wins, day_games`
      ratings[t] = { before: rating[t], after: got[0].rating, delta: delta[t] }
      if (!earns) ratings[t].unpaid = gaveUp ? (state.forfeit ? 'forfeit' : 'resigned') : short ? 'short' : 'idle'
      else if (got[0].day_games > SWIFT_PAID_GAMES) ratings[t].unpaid = 'cap'
      else if (!(await mayEarn(db, h))) ratings[t].unpaid = 'gate'
      else {
        const coins = won ? SWIFT_WIN_COINS : SWIFT_LOSS_COINS
        await db`insert into card_mail (to_h, kind, coins, body)
          values (${h}, 'swift', ${coins}, ${db.json({ match: String(row.id), won: !!won, game: got[0].day_games })}::jsonb)`
        ratings[t].coins = coins
      }
    }
    await db`update swift_matches set status = 'done', finished = now(), ratings = ${db.json(ratings)}::jsonb where id = ${row.id}`
    return ratings
  }

  /** Load a match under its lock, run the clock on it, apply `fn`, save. */
  async function withMatch(id, fn, now = clock()) {
    return tx(async (db) => {
      const rows = await db`
        select m.*, (select name from card_accounts where id_hash = m.a_hash) as a_name,
               (select name from card_accounts where id_hash = m.b_hash) as b_name
          from swift_matches m where id = ${id} for update`
      const row = rows[0]
      if (!row) return null
      let state = row.state
      const before = JSON.stringify(state)
      if (row.status === 'live') state = overdue(state, row, now)
      const out = fn ? fn(state, row) : null
      if (out?.state) state = out.state
      if (row.status === 'live' && row.kind !== 'live') state = robot(state, row)
      let ratings = row.ratings
      let deadline = row.deadline
      if (JSON.stringify(state) !== before) {
        // the clock restarts only when the round or the phase moves on — not on one side's call or a pause
        if (state.round !== row.state.round || state.phase !== row.state.phase) deadline = deadlineOf(state, now)
        await db`update swift_matches set state = ${db.json(state)}::jsonb, deadline = ${deadline} where id = ${row.id}`
        if (state.phase === 'done' && row.status === 'live') ratings = await finish(db, row, state, now)
      }
      return { row: { ...row, state, ratings, deadline, status: state.phase === 'done' ? 'done' : row.status }, out }
    })
  }

  // ------------------------------------------------------------ matching

  async function liveFor(me) {
    const r = await sql`select id::text as id from swift_matches where status = 'live' and (a_hash = ${me} or b_hash = ${me}) order by created desc limit 1`
    return r[0]?.id ?? null
  }

  /** Pair me with a queued player, or deal a ghost once I have waited long enough. Serialised by an advisory lock. */
  async function match(me, now) {
    return tx(async (db) => {
      await db`select pg_advisory_xact_lock(7735301)`
      const mine = (await db`select * from swift_queue where id_hash = ${me}`)[0]
      if (!mine) return null
      const waited = (now - ms(mine.joined)) / 1000
      const band = 3 + Math.max(0, waited) * 0.6
      await db`update swift_queue set seen = ${new Date(now)} where id_hash = ${me}`
      const other = (await db`
        select * from swift_queue where id_hash <> ${me} and abs(strength - ${mine.strength}) <= ${band}
           and seen > ${new Date(now - 6000)} and format = ${mine.format}
         order by joined limit 1`)[0]
      const seed = freshSeed()
      let row
      if (other) {
        // the earlier in the queue is side 0
        const [a, b] = ms(other.joined) <= ms(mine.joined) ? [other, mine] : [mine, other]
        const state = engine.newSwiftMatch(seed, a.side, b.side, mine.format)
        row = (await db`insert into swift_matches (a_hash, b_hash, kind, state, deadline)
          values (${a.id_hash}, ${b.id_hash}, 'live', ${db.json(state)}::jsonb, ${deadlineOf(state, now)}) returning id::text as id`)[0]
        await db`delete from swift_queue where id_hash in (${a.id_hash}, ${b.id_hash})`
        return row.id
      }
      if (waited < SWIFT_WAIT_SEC) return null
      // a ghost: someone else's last five and their way of calling rounds, near my strength
      const ghosts = await db`
        select id_hash, side, habit from swift_players
         where id_hash <> ${me} and side is not null and played >= 1
         order by abs(coalesce((side->>'strength')::real, 0) - ${mine.strength}), updated desc limit 12`
      const near = ghosts.filter((g) => g.side && Math.abs(engine.sideStrength(g.side) - mine.strength) <= 4)
      let state, kind = 'ai', ghostOf = null, habit = null
      if (near.length) {
        const g = near[seed % near.length]
        state = engine.newSwiftMatch(seed, mine.side, g.side, mine.format)
        kind = 'ghost'; ghostOf = g.id_hash; habit = g.habit ?? null
      } else {
        state = engine.newSwiftMatch(seed, mine.side, engine.aiSide(seed, mine.strength), mine.format)
      }
      row = (await db`insert into swift_matches (a_hash, b_hash, kind, ghost_of, habit, state, deadline)
        values (${me}, null, ${kind}, ${ghostOf}, ${habit ? db.json(habit) : null}::jsonb, ${db.json(state)}::jsonb, ${deadlineOf(state, now)}) returning id::text as id`)[0]
      await db`delete from swift_queue where id_hash = ${me}`
      return row.id
    })
  }

  // ------------------------------------------------------------ reads

  const board = { at: 0, value: [] }
  async function top(now) {
    if (now - board.at < 15_000) return board.value
    const rows = await sql`select id_hash, name, rating, played, won from swift_players where played >= 3 order by rating desc, won desc limit 20`
    board.value = rows.map((r, i) => ({ rank: i + 1, ...who(r.name, r.id_hash), rating: r.rating, played: r.played, won: r.won, h: r.id_hash.slice(0, 8) }))
    board.at = now
    return board.value
  }

  function matchView(row, me) {
    const side = row.a_hash === me ? 0 : 1
    const other = side === 0 ? (row.kind === 'live' ? { hash: row.b_hash, name: row.b_name } : null) : { hash: row.a_hash, name: row.a_name }
    const opp = row.state.sides[1 - side]
    return {
      id: String(row.id), kind: row.kind, status: row.status,
      deadline: row.status === 'live' ? ms(row.deadline) - GRACE_MS : null,
      opponent: other ? who(other.name, other.hash) : { name: opp.name, tag: row.kind === 'ghost' ? `${opp.tag}` : '' },
      view: engine.swiftView(row.state, side),
      ratings: row.ratings?.[side] ?? null,
    }
  }

  async function state(req, res, bucket) {
    if (guard(res, `sw:${bucket}`, 600)) return
    const { body, me } = await readMe(req)
    const now = clock()
    const out = { ok: true, now, waitSec: SWIFT_WAIT_SEC, paidGames: SWIFT_PAID_GAMES, winCoins: SWIFT_WIN_COINS, lossCoins: SWIFT_LOSS_COINS, board: await top(now) }
    if (me) {
      let id = matchId(body?.match) ?? await liveFor(me)
      if (!id) {
        const q = (await sql`select joined, format from swift_queue where id_hash = ${me}`)[0]
        if (q) {
          id = await match(me, now)
          if (!id) out.queue = { since: ms(q.joined), format: q.format }
        }
      }
      if (id) {
        const got = await withMatch(id, null, now)
        if (got && (got.row.a_hash === me || got.row.b_hash === me)) out.match = matchView(got.row, me)
      }
      // a match that ended while the page was away (the sweep, a reload): its result, for fifteen minutes
      if (!out.match) {
        const last = (await sql`select id::text as id from swift_matches where status = 'done' and (a_hash = ${me} or b_hash = ${me})
          and finished > now() - interval '15 minutes' order by finished desc limit 1`)[0]
        if (last) {
          const row = (await sql`select m.*, (select name from card_accounts where id_hash = m.a_hash) as a_name,
            (select name from card_accounts where id_hash = m.b_hash) as b_name from swift_matches m where id = ${last.id}`)[0]
          if (row) out.recent = matchView(row, me)
        }
      }
      // read after the match: a finish just written shows in the totals
      const p = (await sql`select rating, played, won, day, day_wins, day_games from swift_players where id_hash = ${me}`)[0]
      const today = p && p.day === dayOf(now)
      out.me = { rating: p?.rating ?? 1000, played: p?.played ?? 0, won: p?.won ?? 0, dayWins: today ? p.day_wins : 0, dayGames: today ? p.day_games : 0, h: me.slice(0, 8) }
    }
    json(res, 200, out)
  }

  async function queue(req, res, bucket) {
    if (guard(res, `swq:${bucket}`, 30)) return
    const { body, me } = await readMe(req)
    if (!me) { json(res, 400, { ok: false, bad: true }); return }
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    if (await liveFor(me)) { json(res, 200, { ok: true, already: true }); return }
    const got = await sideOf(me, body?.squad)
    if (got.missing) { json(res, 200, { ok: false, missing: true }); return }
    if (got.why) { json(res, 200, { ok: false, why: got.why }); return }
    const strength = engine.sideStrength(got.side)
    const side = { ...got.side, strength }
    const format = engine.isFormat(body?.format) ? body.format : 'quick'
    // under the lock matching takes, so a pairing in flight and this re-queue cannot both make a match
    const queued = await tx(async (db) => {
      await db`select pg_advisory_xact_lock(7735301)`
      const live = await db`select 1 as ok from swift_matches where status = 'live' and (a_hash = ${me} or b_hash = ${me}) limit 1`
      if (live.length) return false
      await db`insert into swift_queue (id_hash, name, side, strength, joined, seen, format) values (${me}, ${got.name}, ${db.json(side)}::jsonb, ${strength}, ${new Date(clock())}, ${new Date(clock())}, ${format})
        on conflict (id_hash) do update set side = excluded.side, strength = excluded.strength, name = excluded.name, seen = excluded.seen,
          format = excluded.format, joined = case when swift_queue.format = excluded.format then swift_queue.joined else excluded.joined end`
      return true
    })
    if (!queued) { json(res, 200, { ok: true, already: true }); return }
    const id = await match(me, clock())
    json(res, 200, { ok: true, match: id ?? undefined })
  }

  async function leave(req, res, bucket) {
    if (guard(res, `swq:${bucket}`, 30)) return
    const { body, me } = await readMe(req)
    if (!me) { json(res, 400, { ok: false, bad: true }); return }
    await sql`delete from swift_queue where id_hash = ${me}`
    // giving a match up: the other side takes it
    const id = matchId(body?.match)
    if (id && body?.resign) {
      await withMatch(id, (state, row) => {
        // the clock may have ended it inside this same lock: a finished match is not given up afterwards
        if (row.status !== 'live' || state.phase === 'done' || (row.a_hash !== me && row.b_hash !== me)) return null
        const t = row.a_hash === me ? 0 : 1
        // the score stays as played; the result says who gave it up
        return { state: { ...state, phase: 'done', winner: 1 - t, pending: [null, null], resigned: t } }
      })
    }
    json(res, 200, { ok: true })
  }

  /** A call: the round, the second look after a 侦察, or a pause. */
  async function call(req, res, bucket, what) {
    if (guard(res, `swc:${bucket}`, 120)) return
    const { body, me } = await readMe(req)
    const id = matchId(body?.match)
    if (!me || !id) { json(res, 400, { ok: false, bad: true }); return }
    let why = null
    const got = await withMatch(id, (state, row) => {
      if (row.a_hash !== me && row.b_hash !== me) { why = '这不是你的比赛。'; return null }
      if (row.status !== 'live' || state.phase === 'done') { why = '比赛已经结束了。'; return null }
      const t = row.a_hash === me ? 0 : 1
      if (what === 'call') {
        if (state.phase !== 'choose' || state.pending[t]) { why = '这一回合已经定了。'; return null }
        if (Number(body?.round) !== state.round) { why = '回合已经过了，刷新一下。'; return null }
        const next = engine.submitChoice(state, t, body?.choice)
        const calls = (state.calls ?? [0, 0]).slice()
        calls[t]++
        const idle = (state.idle ?? [0, 0]).slice()
        idle[t] = 0
        return { state: { ...next, calls, idle } }
      }
      if (what === 'recon') {
        if (state.phase !== 'recon' || !state.recon[t]) { why = '现在不能改打法。'; return null }
        return { state: engine.submitRecon(state, t, body?.plan) }
      }
      const p = engine.takePause(state, t)
      if (!p) { why = '现在不能暂停。'; return null }
      return { state: p }
    })
    if (!got) { json(res, 200, { ok: false, why: '找不到这场比赛。' }); return }
    const mine = got.row.a_hash === me || got.row.b_hash === me
    if (why) { json(res, 200, { ok: false, why, ...(mine ? { match: matchView(got.row, me) } : {}) }); return }
    json(res, 200, { ok: true, match: matchView(got.row, me) })
  }

  // ------------------------------------------------------------ the sweep

  let sweeping = false
  async function sweep(now = clock()) {
    if (sweeping) return
    sweeping = true
    try {
      // matches nobody has read for a while: the clock calls one phase a tick, at the real time, so a phone
      // that locked for half a minute comes back to its match, and an abandoned one still ends
      const stale = await bg`select id::text as id from swift_matches where status = 'live' and deadline < ${new Date(now - STALE_MS)} order by deadline limit 40`
      for (const r of stale) await withMatch(r.id, null, now)
      // a queue entry whose page has gone quiet
      await bg`delete from swift_queue where joined < ${new Date(now - 10 * 60_000)}`
      await bg`delete from swift_matches where status = 'done' and finished < now() - interval '14 days'`
    } finally {
      sweeping = false
    }
  }
  let interval = null
  if (timer && sql) {
    interval = setInterval(() => { sweep().catch((err) => console.warn('swift: sweep failed', err.message)) }, 15_000)
    interval.unref?.()
  }

  return {
    sweep,
    close() { if (interval) clearInterval(interval) },
    async route(req, res, path, bucket) {
      if (path === '/api/card/swift') { await state(req, res, bucket); return true }
      if (path === '/api/card/swift/queue') { await queue(req, res, bucket); return true }
      if (path === '/api/card/swift/leave') { await leave(req, res, bucket); return true }
      if (path === '/api/card/swift/call') { await call(req, res, bucket, 'call'); return true }
      if (path === '/api/card/swift/recon') { await call(req, res, bucket, 'recon'); return true }
      if (path === '/api/card/swift/pause') { await call(req, res, bucket, 'pause'); return true }
      return false
    },
  }
}
