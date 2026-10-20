/**
 * 抢人大战 — rooms for the rules in src/engine/draft.ts.
 *
 * A host opens a room and shares its five-character code; up to six join. The
 * host starts it: the room deals the first lot and runs a clock of
 * DRAFT_BID_SEC a round. A round settles when every seat has bid or the clock
 * runs out (a seat that did not bid bids 0 on the first card) — whichever
 * request or sweep sees it first, under the room's row lock, so a round is
 * settled once. After the fifth, the round robin is played on a worker with no
 * connection held, and written with `where status = 'playing'` so two
 * processes that both play it write once.
 *
 * The round robin and the final are computed at once and stored, then shown
 * as a broadcast (status 'showing'): one match every DRAFT_GAME_SEC, the
 * final map by map. When the broadcast has run, the room is finished under its
 * lock — places, and coins by place by mail for a room of at least
 * DRAFT_PAID_MIN, the first DRAFT_PAID_ROOMS a Shanghai day per player, on
 * accounts that may trade. Cards drafted here never reach a collection.
 */
import { createHash, randomInt } from 'node:crypto'
import { isVerified } from './phone-api.js'
import { TRADE_PULLS, TRADE_DAYS } from './market-api.js'
import { createCupComputer } from './opencup-worker.js'

const hash = (id) => createHash('sha256').update(id).digest('hex')

export const DRAFT_SCHEMA = `
create table if not exists draft_rooms (
  code      text primary key,
  host      text not null,
  status    text not null default 'lobby',
  seed      bigint not null,
  round     int not null default 0,
  lot       jsonb,
  history   jsonb not null default '[]'::jsonb,
  games     jsonb,
  deadline  timestamptz,
  created   timestamptz not null default now(),
  finished  timestamptz
);
create table if not exists draft_members (
  code     text not null references draft_rooms(code) on delete cascade,
  id_hash  text not null,
  name     text,
  seat     int not null,
  budget   int not null,
  picks    jsonb not null default '[]'::jsonb,
  bid      jsonb,
  -- left a finished room: it no longer shows for them
  gone     boolean not null default false,
  joined   timestamptz not null default now(),
  primary key (code, id_hash)
);
create index if not exists draft_members_who_idx on draft_members (id_hash, joined desc);
-- the BO5 final, when the broadcast began, and how many times the matches failed to play
alter table draft_rooms add column if not exists final jsonb;
alter table draft_rooms add column if not exists reveal_at timestamptz;
alter table draft_rooms add column if not exists tries int not null default 0;
alter table draft_rooms add column if not exists failed boolean not null default false;
-- 3rd v 4th and 5th v 6th after the round robin, so everyone plays the same number of matches as the finalists
alter table draft_rooms add column if not exists placements jsonb;
-- the place a member finished, and the coins it paid (on which Shanghai day)
alter table draft_members add column if not exists place int;
alter table draft_members add column if not exists paid int;
alter table draft_members add column if not exists paid_day text;
alter table draft_members add column if not exists unpaid text;
`

export function makeDraftApi(sql, {
  readBody, json, normalizeId, displayName, rateLimited, engine,
  clock = () => Date.now(),
  timer = true,
  minDays = TRADE_DAYS,
  bg = sql,
  /** (args) => playOpenCupMatch result; the checks pass the engine's own, the server a worker */
  compute = null,
}) {
  const guard = (res, bucket, max) => {
    if (rateLimited(bucket, max)) { json(res, 429, { ok: false, why: 'rate' }); return true }
    return false
  }
  const tx = (fn) => (sql.begin ? sql.begin(fn) : fn(sql))
  const who = (name, h) => { const d = displayName(name, h); return { name: d.name, tag: `#${d.tag}` } }
  const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime())
  const computer = compute ? null : createCupComputer()
  const simulate = compute ?? ((args) => computer.compute(args, null))
  const rating = (id) => engine.cardById(id)?.rating ?? 0
  const dayOf = (now) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10)

  async function readMe(req) {
    let body
    try { body = JSON.parse(await readBody(req, 4096)) } catch { return { body: null, me: null } }
    const id = normalizeId(body?.id)
    return { body, me: id ? hash(id) : null }
  }

  /** the room I am in: one still going, or the last one finished within the hour */
  async function myRoom(me) {
    const r = await sql`
      select r.code from draft_members m join draft_rooms r using (code)
       where m.id_hash = ${me} and not m.gone and (r.status <> 'done' or r.finished > now() - interval '1 hour')
       order by m.joined desc limit 1`
    return r[0]?.code ?? null
  }

  /** Settle what is due under the room's lock: a round whose bids are all in or whose clock has run. */
  async function settle(code, now = clock()) {
    return tx(async (db) => {
      const room = (await db`select * from draft_rooms where code = ${code} for update`)[0]
      if (!room || room.status !== 'bidding') return room?.status ?? null
      const members = await db`select * from draft_members where code = ${code} order by seat`
      const all = members.every((m) => m.bid)
      if (!all && ms(room.deadline) > now) return 'bidding'
      const lot = room.lot
      const bids = members.map((m) => (m.bid ? engine.cleanBid(m.bid, lot.length, m.budget) : null))
      const awards = engine.settleRound(Number(room.seed), room.round, lot, bids, rating)
      for (const a of awards) {
        const m = members[a.seat]
        await db`update draft_members set budget = budget - ${a.paid}, picks = picks || ${db.json([lot[a.card]])}::jsonb, bid = null
          where code = ${code} and id_hash = ${m.id_hash}`
      }
      const entry = { round: room.round, lot, bids: bids.map((b) => b ?? { card: 0, amount: 0, auto: true }), awards }
      const next = room.round + 1
      if (next >= engine.DRAFT_ROUNDS) {
        await db`update draft_rooms set status = 'playing', round = ${next}, lot = null, deadline = null,
          history = history || ${db.json([entry])}::jsonb where code = ${code}`
        return 'playing'
      }
      const taken = new Set()
      for (const m of members) for (const id of [...(m.picks ?? []), lot[awards.find((a) => a.seat === m.seat).card]]) {
        const c = engine.cardById(id); if (c) taken.add(engine.personOf(c))
      }
      for (const id of lot) { const c = engine.cardById(id); if (c) taken.add(engine.personOf(c)) }
      const nextLot = engine.dealLot(Number(room.seed), next, members.length + 1, taken)
      await db`update draft_rooms set round = ${next}, lot = ${db.json(nextLot)}::jsonb, deadline = ${new Date(now + engine.DRAFT_BID_SEC * 1000)},
        history = history || ${db.json([entry])}::jsonb where code = ${code}`
      return 'bidding'
    })
  }

  /** The round robin and the final, played with no connection held, written once; three failures end the room. */
  async function play(code) {
    const room = (await sql`select * from draft_rooms where code = ${code}`)[0]
    if (!room || room.status !== 'playing') return
    const members = await sql`select id_hash, name, seat, picks from draft_members where code = ${code} order by seat`
    const squad = (m) => ({ ...who(m.name, m.id_hash), slots: m.picks.slice(0, 5), coach: m.picks[5] ?? null, levels: {}, div: 0, points: 0 })
    const seed = Number(room.seed)
    try {
      const games = []
      // two players: the final is the whole tournament
      if (members.length > 2) {
        for (const [a, b] of engine.roundRobin(members.length)) {
          const r = await simulate([squad(members[a]), squad(members[b]), false, engine.draftMatchSeed(seed, a, b)])
          if (!r || typeof r.aWon !== 'boolean') throw new Error('invalid draft match')
          games.push({ a, b, aWon: r.aWon, mapsA: r.mapsA, mapsB: r.mapsB, maps: r.detail?.maps ?? [] })
        }
      }
      const table = members.length > 2 ? engine.draftTable(members.length, games, seed) : null
      const placements = []
      for (const [a, b, place] of table ? engine.placementPairs(table) : []) {
        const r = await simulate([squad(members[a]), squad(members[b]), false, engine.draftMatchSeed(seed, 200 + a, 200 + b)])
        if (!r || typeof r.aWon !== 'boolean') throw new Error('invalid draft placement')
        placements.push({ a, b, place, aWon: r.aWon, mapsA: r.mapsA, mapsB: r.mapsB, maps: r.detail?.maps ?? [] })
      }
      const [fa, fb] = table ? table.slice(0, 2).map((t) => t.seat) : [0, 1]
      const r = await simulate([squad(members[fa]), squad(members[fb]), true, engine.draftMatchSeed(seed, 100 + fa, 100 + fb)])
      if (!r || typeof r.aWon !== 'boolean') throw new Error('invalid draft final')
      const final = { a: fa, b: fb, aWon: r.aWon, mapsA: r.mapsA, mapsB: r.mapsB, maps: r.detail?.maps ?? [] }
      await sql`update draft_rooms set status = 'showing', games = ${sql.json(games)}::jsonb, final = ${sql.json(final)}::jsonb,
        placements = ${sql.json(placements)}::jsonb, reveal_at = ${new Date(clock())}
        where code = ${code} and status = 'playing'`
    } catch (err) {
      const t = await sql`update draft_rooms set tries = tries + 1 where code = ${code} and status = 'playing' returning tries`
      if ((t[0]?.tries ?? 0) >= 3) {
        await sql`update draft_rooms set status = 'done', failed = true, finished = now() where code = ${code} and status = 'playing'`
      }
      throw err
    }
  }

  /** Whether a member's account may be paid: not flagged, enough packs opened, old enough. */
  async function mayEarn(db, h) {
    const r = await db`
      select state->>'pulls' as pulls, suspect,
             ceil(extract(epoch from (created + make_interval(days => ${minDays}) - now())))::int as wait
        from card_accounts where id_hash = ${h}`
    if (!r.length || r[0].suspect) return false
    return Math.max(0, Math.floor(Number(r[0].pulls ?? 0))) >= TRADE_PULLS && Math.max(0, Number(r[0].wait) || 0) <= 0
  }

  /** The broadcast has run: places, and the purse — once, under the room's lock. */
  async function finish(code, now = clock()) {
    await tx(async (db) => {
      // one room's purse at a time, so a member finishing two rooms at once cannot pass the day's cap twice
      await db`select pg_advisory_xact_lock(7735302)`
      const room = (await db`select * from draft_rooms where code = ${code} for update`)[0]
      if (!room || room.status !== 'showing') return
      const members = await db`select id_hash, seat from draft_members where code = ${code} order by seat`
      const plan = engine.draftSchedule(room.games.length, room.final?.maps?.length ?? 0, members.length, room.placements?.length ?? 0)
      if (now - ms(room.reveal_at) < plan.end) return
      const table = engine.draftTable(members.length, room.games, Number(room.seed))
      const places = engine.draftPlaces(table, room.final, room.placements ?? [])
      const day = dayOf(now)
      for (const m of members) {
        const place = places.get(m.seat) ?? members.length
        let paid = null, unpaid = null
        // the rounds this member bid in, not left to the clock
        const own = (room.history ?? []).filter((h) => h.bids?.[m.seat] && !h.bids[m.seat].auto).length
        if (members.length < engine.DRAFT_PAID_MIN) unpaid = 'small'
        else if (own < engine.DRAFT_OWN_BIDS) unpaid = 'idle'
        else if ((await db`select count(*)::int as n from draft_members where id_hash = ${m.id_hash} and paid_day = ${day}`)[0].n >= engine.DRAFT_PAID_ROOMS) unpaid = 'cap'
        else if (!(await mayEarn(db, m.id_hash))) unpaid = 'gate'
        else {
          paid = engine.draftPrize(place)
          await db`insert into card_mail (to_h, kind, coins, body) values (${m.id_hash}, 'draft', ${paid}, ${db.json({ room: code, place, players: members.length })}::jsonb)`
        }
        await db`update draft_members set place = ${place}, paid = ${paid}, paid_day = ${paid ? day : null}, unpaid = ${unpaid}
          where code = ${code} and id_hash = ${m.id_hash}`
      }
      await db`update draft_rooms set status = 'done', finished = now() where code = ${code}`
    })
  }

  // one room's round robin at a time: the worker takes one match at a time
  const playing = new Set()
  let line = Promise.resolve()
  function playSoon(code) {
    if (playing.has(code)) return
    playing.add(code)
    line = line.then(() => play(code)).catch((err) => console.warn('draft: play failed', err.message)).finally(() => playing.delete(code))
  }

  async function view(code, me, now = clock()) {
    const status = await settle(code, now)
    if (status === 'playing') { if (compute) await play(code).catch(() => {}); else playSoon(code) }
    if (status === 'showing' || status === 'playing') await finish(code, now)
    const room = (await sql`select * from draft_rooms where code = ${code}`)[0]
    if (!room) return null
    const members = await sql`select id_hash, name, seat, budget, picks, bid is not null as bid_in, bid, place, paid, unpaid from draft_members where code = ${code} order by seat`
    const mine = members.find((m) => m.id_hash === me)
    const seats = members.map((m) => ({ seat: m.seat, ...who(m.name, m.id_hash), budget: m.budget, picks: m.picks, bidIn: m.bid_in, me: m.id_hash === me, host: m.id_hash === room.host, place: m.place ?? null }))
    // the broadcast: only what has been on screen so far
    let games = room.games, final = room.final, placements = room.placements ?? [], nextAt = null, live = null
    if (room.status === 'showing') {
      const plan = engine.draftSchedule(room.games.length, room.final?.maps?.length ?? 0, members.length, placements.length)
      const t = now - ms(room.reveal_at)
      games = room.games.filter((_, i) => plan.games[i] <= t)
      placements = placements.filter((_, i) => plan.placements[i] <= t)
      const maps = plan.final.filter((at) => at <= t).length
      final = t < plan.games.concat(plan.placements).reduce((a, b) => Math.max(a, b), plan.intro) ? null
        : { a: room.final.a, b: room.final.b, maps: room.final.maps.slice(0, maps), done: false }
      const upcoming = [plan.intro, ...plan.games, ...plan.placements, ...plan.final, plan.end].find((at) => at > t)
      nextAt = upcoming !== undefined ? ms(room.reveal_at) + upcoming : null
      // the match on air: the screen plays its maps out until it lands in the list — only this one, nothing later
      const at = ms(room.reveal_at)
      const gamesEnd = plan.games.length ? plan.games[plan.games.length - 1] : plan.intro
      const placeEnd = plan.placements.length ? plan.placements[plan.placements.length - 1] : gamesEnd
      const gi = plan.games.findIndex((x) => x > t)
      const pi = plan.placements.findIndex((x) => x > t)
      const fi = plan.final.findIndex((x) => x > t)
      const pick = (g) => ({ a: g.a, b: g.b, maps: g.maps })
      if (t >= plan.intro) {
        if (gi >= 0) live = { label: '循环赛', ...pick(room.games[gi]), mapsDone: 0, from: at + (gi ? plan.games[gi - 1] : plan.intro), to: at + plan.games[gi] }
        else if (pi >= 0) {
          const p = room.placements[pi]
          live = { label: `第 ${p.place}–${p.place + 1} 名`, ...pick(p), mapsDone: 0, from: at + (pi ? plan.placements[pi - 1] : gamesEnd), to: at + plan.placements[pi] }
        } else if (fi >= 0) {
          live = { label: '决赛', a: room.final.a, b: room.final.b, maps: room.final.maps.slice(0, fi + 1), mapsDone: fi, from: at + (fi ? plan.final[fi - 1] : placeEnd), to: at + plan.final[fi] }
        }
      }
    }
    return {
      code: room.code, status: room.status, round: room.round, rounds: engine.DRAFT_ROUNDS, position: engine.DRAFT_POSITIONS[room.round] ?? null,
      lot: room.lot, deadline: room.deadline ? ms(room.deadline) : null, host: room.host === me,
      seats, mySeat: mine?.seat ?? null, myBid: mine?.bid ?? null,
      history: room.history, games, final, placements, live, nextAt, failed: room.failed,
      // the lineups' entrance: when the broadcast began and how long each seat is on stage
      revealAt: room.reveal_at ? ms(room.reveal_at) : null, introSec: engine.DRAFT_INTRO_SEC,
      table: games && games.length ? engine.draftTable(members.length, games, Number(room.seed)) : null,
      reward: room.status === 'done' && mine ? { place: mine.place ?? null, coins: mine.paid ?? 0, unpaid: mine.unpaid ?? null } : null,
    }
  }

  async function state(req, res, bucket) {
    if (guard(res, `dr:${bucket}`, 600)) return
    const { me } = await readMe(req)
    const out = { ok: true, now: clock(), min: engine.DRAFT_MIN, max: engine.DRAFT_MAX, budget: engine.DRAFT_BUDGET, bidSec: engine.DRAFT_BID_SEC, positions: engine.DRAFT_POSITIONS,
      prizes: [engine.draftPrize(1), engine.draftPrize(2), engine.draftPrize(3)], paidMin: engine.DRAFT_PAID_MIN, paidRooms: engine.DRAFT_PAID_ROOMS }
    if (me) {
      const code = await myRoom(me)
      if (code) out.room = await view(code, me)
    }
    json(res, 200, out)
  }

  async function nameOf(me) {
    const r = await sql`select name from card_accounts where id_hash = ${me}`
    return r.length ? { name: r[0].name ?? null } : null
  }

  async function create(req, res, bucket) {
    if (guard(res, `drc:${bucket}`, 10)) return
    const { me } = await readMe(req)
    if (!me) { json(res, 400, { ok: false, bad: true }); return }
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    const acc = await nameOf(me)
    if (!acc) { json(res, 200, { ok: false, missing: true }); return }
    const cur = await myRoom(me)
    if (cur) {
      const st = (await sql`select status from draft_rooms where code = ${cur}`)[0]?.status
      if (st !== 'done') { json(res, 200, { ok: false, why: '你已经在一个房间里了。' }); return }
    }
    for (let tries = 0; tries < 5; tries++) {
      const code = engine.roomCode(() => randomInt(0, 1 << 30) / (1 << 30))
      const made = await tx(async (db) => {
        const got = await db`insert into draft_rooms (code, host, seed) values (${code}, ${me}, ${randomInt(0, 2 ** 31)}) on conflict do nothing returning code`
        if (!got.length) return null
        await db`insert into draft_members (code, id_hash, name, seat, budget) values (${code}, ${me}, ${acc.name}, 0, ${engine.DRAFT_BUDGET})`
        return code
      })
      if (made) { json(res, 200, { ok: true, code: made }); return }
    }
    json(res, 200, { ok: false, why: '没开成，再试一次。' })
  }

  async function join(req, res, bucket) {
    if (guard(res, `drc:${bucket}`, 20)) return
    const { body, me } = await readMe(req)
    const code = engine.cleanCode(body?.code)
    if (!me) { json(res, 400, { ok: false, bad: true }); return }
    if (!code) { json(res, 200, { ok: false, why: '房间码是 5 位字母和数字。' }); return }
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    const acc = await nameOf(me)
    if (!acc) { json(res, 200, { ok: false, missing: true }); return }
    const cur = await myRoom(me)
    if (cur && cur !== code) {
      const st = (await sql`select status from draft_rooms where code = ${cur}`)[0]?.status
      if (st !== 'done') { json(res, 200, { ok: false, why: '你已经在另一个房间里了，先退出。' }); return }
    }
    const out = await tx(async (db) => {
      const room = (await db`select status from draft_rooms where code = ${code} for update`)[0]
      if (!room) return { why: '没有这个房间。' }
      const had = await db`select 1 as ok from draft_members where code = ${code} and id_hash = ${me}`
      if (had.length) return { ok: true }
      if (room.status !== 'lobby') return { why: '这个房间已经开始了。' }
      const n = (await db`select count(*)::int as n from draft_members where code = ${code}`)[0].n
      if (n >= engine.DRAFT_MAX) return { why: `房间满了（最多 ${engine.DRAFT_MAX} 人）。` }
      await db`insert into draft_members (code, id_hash, name, seat, budget) values (${code}, ${me}, ${acc.name}, ${n}, ${engine.DRAFT_BUDGET})`
      return { ok: true }
    })
    json(res, 200, out.ok ? { ok: true, code } : { ok: false, why: out.why })
  }

  async function leave(req, res, bucket) {
    if (guard(res, `drc:${bucket}`, 20)) return
    const { me } = await readMe(req)
    if (!me) { json(res, 400, { ok: false, bad: true }); return }
    const code = await myRoom(me)
    if (!code) { json(res, 200, { ok: true }); return }
    const out = await tx(async (db) => {
      const room = (await db`select status, host from draft_rooms where code = ${code} for update`)[0]
      if (!room) return { ok: true }
      if (room.status === 'done') {
        // a finished room: leaving only stops showing it
        await db`update draft_members set gone = true where code = ${code} and id_hash = ${me}`
        return { ok: true, hide: true }
      }
      if (room.status !== 'lobby') return { why: '已经开始了，打完才能走。' }
      await db`delete from draft_members where code = ${code} and id_hash = ${me}`
      const left = await db`select id_hash from draft_members where code = ${code} order by seat`
      if (!left.length) { await db`delete from draft_rooms where code = ${code}`; return { ok: true } }
      // seats close up; the first left becomes the host
      for (let i = 0; i < left.length; i++) await db`update draft_members set seat = ${i} where code = ${code} and id_hash = ${left[i].id_hash}`
      if (room.host === me) await db`update draft_rooms set host = ${left[0].id_hash} where code = ${code}`
      return { ok: true }
    })
    json(res, 200, out.ok ? { ok: true } : { ok: false, why: out.why })
  }

  async function start(req, res, bucket) {
    if (guard(res, `drc:${bucket}`, 20)) return
    const { me } = await readMe(req)
    if (!me) { json(res, 400, { ok: false, bad: true }); return }
    const code = await myRoom(me)
    if (!code) { json(res, 200, { ok: false, why: '你不在房间里。' }); return }
    const now = clock()
    const out = await tx(async (db) => {
      const room = (await db`select * from draft_rooms where code = ${code} for update`)[0]
      if (!room || room.host !== me) return { why: '只有房主能开始。' }
      if (room.status !== 'lobby') return { ok: true }
      const n = (await db`select count(*)::int as n from draft_members where code = ${code}`)[0].n
      if (n < engine.DRAFT_MIN) return { why: `至少 ${engine.DRAFT_MIN} 个人才能开始。` }
      const lot = engine.dealLot(Number(room.seed), 0, n + 1, new Set())
      await db`update draft_rooms set status = 'bidding', round = 0, lot = ${db.json(lot)}::jsonb, deadline = ${new Date(now + engine.DRAFT_BID_SEC * 1000)} where code = ${code}`
      return { ok: true }
    })
    json(res, 200, out.ok ? { ok: true, room: await view(code, me) } : { ok: false, why: out.why })
  }

  async function bid(req, res, bucket) {
    if (guard(res, `drb:${bucket}`, 60)) return
    const { body, me } = await readMe(req)
    if (!me) { json(res, 400, { ok: false, bad: true }); return }
    const code = await myRoom(me)
    if (!code) { json(res, 200, { ok: false, why: '你不在房间里。' }); return }
    const out = await tx(async (db) => {
      const room = (await db`select status, round, lot, deadline from draft_rooms where code = ${code} for update`)[0]
      if (!room || room.status !== 'bidding') return { why: '现在不能出价。' }
      if (Number(body?.round) !== room.round || ms(room.deadline) + 1000 < clock()) return { why: '这一轮已经结束了。' }
      const m = (await db`select budget, bid from draft_members where code = ${code} and id_hash = ${me}`)[0]
      if (!m) return { why: '你不在房间里。' }
      if (m.bid) return { why: '这一轮已经出过价了。' }
      const b = engine.cleanBid(body?.bid, room.lot.length, m.budget)
      await db`update draft_members set bid = ${db.json(b)}::jsonb where code = ${code} and id_hash = ${me}`
      return { ok: true }
    })
    if (!out.ok) { json(res, 200, { ok: false, why: out.why }); return }
    json(res, 200, { ok: true, room: await view(code, me) })
  }

  let sweeping = false
  async function sweep(now = clock()) {
    if (sweeping) return
    sweeping = true
    try {
      const due = await bg`select code, status from draft_rooms where (status = 'bidding' and deadline < ${new Date(now)}) or status in ('playing', 'showing') limit 20`
      for (const r of due) {
        const st = r.status === 'bidding' ? await settle(r.code, now) : r.status
        if (st === 'playing') { if (compute) await play(r.code).catch(() => {}); else playSoon(r.code) }
        if (st === 'showing') await finish(r.code, now)
      }
      // a lobby nobody started, and finished rooms after a week
      await bg`delete from draft_rooms where (status = 'lobby' and created < now() - interval '3 hours') or (status = 'done' and finished < now() - interval '7 days')`
    } finally {
      sweeping = false
    }
  }
  let interval = null
  if (timer && sql) {
    interval = setInterval(() => { sweep().catch((err) => console.warn('draft: sweep failed', err.message)) }, 5000)
    interval.unref?.()
  }

  return {
    sweep,
    close() { if (interval) clearInterval(interval); computer?.close() },
    async route(req, res, path, bucket) {
      if (path === '/api/card/draft') { await state(req, res, bucket); return true }
      if (path === '/api/card/draft/create') { await create(req, res, bucket); return true }
      if (path === '/api/card/draft/join') { await join(req, res, bucket); return true }
      if (path === '/api/card/draft/leave') { await leave(req, res, bucket); return true }
      if (path === '/api/card/draft/start') { await start(req, res, bucket); return true }
      if (path === '/api/card/draft/bid') { await bid(req, res, bucket); return true }
      return false
    },
  }
}
