/**
 * 全服组队杯 — storage and a clock for the rules in src/engine/teamCup.ts.
 *
 * Four cups a day (09, 13, 17, 21 Shanghai). Until one starts, anybody who may
 * enter the solo cup may sign up. At the start the server reads every
 * entrant's five in ONE statement (one snapshot, as the solo cup does), deals
 * the field into balanced fives, and draws the first round. A tie is five
 * duels — first seat against first seat, fifth against fifth, each a BO3
 * between two real fives — and the team with three or more of them goes on.
 * Every member of a placed team is mailed the same purse; every duel an
 * entrant wins pays them, whatever their team did.
 *
 * Nothing is simulated inside a transaction. A tie's duels are played on the
 * cup worker with no connection held, then written with `where winner is
 * null`: the seeds are the cup's, the round's, the slot's and the duel's, so
 * two processes that both play a tie (a deploy overlapping) write the same
 * thing and one of them writes nothing. The round barrier and the purse are
 * taken under the cup's row lock, and the purse goes through a receipts table
 * so that no retry can pay twice.
 */
import { createHash, randomBytes } from 'node:crypto'
import { isVerified } from './phone-api.js'
import { TRADE_PULLS, TRADE_DAYS } from './market-api.js'
import { createCupComputer } from './opencup-worker.js'
import { makeCupPass } from './cup-clock.js'

const hash = (id) => createHash('sha256').update(id).digest('hex')
const freshSeed = () => randomBytes(4).readUInt32LE(0)

export const TEAM_CUP_SCHEMA = `
create table if not exists team_cups (
  id        bigserial primary key,
  starts    timestamptz not null unique,
  status    text not null default 'open',
  seed      bigint not null,
  round     int not null default 0,
  rounds    int not null default 0,
  step_sec  int not null default 480,
  entrants  int not null default 0,
  teams     int not null default 0,
  champion  int,
  balance_version int,
  created   timestamptz not null default now(),
  finished  timestamptz
);
create table if not exists team_cup_entries (
  cup_id    bigint not null references team_cups(id) on delete cascade,
  id_hash   text not null,
  name      text,
  joined    timestamptz not null default now(),
  five      jsonb,
  score     int,
  team      int,
  duels     int not null default 0,
  duel_wins int not null default 0,
  place     int,
  primary key (cup_id, id_hash)
);
create index if not exists team_cup_entries_who_idx on team_cup_entries (id_hash, cup_id desc);
create index if not exists team_cup_entries_team_idx on team_cup_entries (cup_id, team);
create table if not exists team_cup_ties (
  cup_id  bigint not null references team_cups(id) on delete cascade,
  round   int not null,
  slot    int not null,
  team_a  int not null,
  team_b  int,
  wins_a  int,
  wins_b  int,
  winner  int,
  duels   jsonb,
  primary key (cup_id, round, slot)
);
create table if not exists team_cup_payouts (
  cup_id  bigint not null references team_cups(id) on delete cascade,
  id_hash text not null,
  primary key (cup_id, id_hash)
);
`

export function makeTeamCupApi(sql, {
  readBody, json, normalizeId, displayName, rateLimited, engine,
  clock = () => Date.now(),
  timer = true,
  minDays = TRADE_DAYS,
  /** a local server's fast clock: { everySec, stepSec } — read only beside the in-process database */
  fast = null,
  bg = sql,
  /** (args) => playOpenCupMatch result; the checks pass the engine's own, the server a worker */
  compute = null,
  /** how long one pass of the clock may take before it is abandoned (cup-clock.js) */
  passMs = 120_000,
  cardPoolVersion = 'source',
}) {
  const guard = (req, res, bucket, max) => {
    if (rateLimited(bucket, max)) { json(res, 429, { ok: false, why: 'rate' }); return true }
    return false
  }
  const tx = (fn) => (bg.begin ? bg.begin(fn) : fn(bg))
  const computer = compute ? null : createCupComputer()
  const simulate = compute ?? ((args) => computer.compute(args, null))
  const slotOf = (now) => (fast ? engine.teamCupSlotFast(now, fast.everySec * 1000) : engine.teamCupSlot(now))
  const stepOf = () => (fast ? fast.stepSec : engine.TEAM_CUP_STEP_SEC)
  const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime())
  const who = (name, h) => { const d = displayName(name, h); return { name: d.name, tag: `#${d.tag}` } }
  const cupId = (v) => (/^\d{1,18}$/.test(String(v ?? '')) ? String(v) : null)

  /** The five an account is fielding — the solo cup's reading of it, rule for rule. */
  function fiveOf(row) {
    const slots = Array.isArray(row.squad?.slots) ? row.squad.slots.slice(0, 5).map((x) => (typeof x === 'string' ? x : null)) : []
    const coach = typeof row.squad?.coach === 'string' ? row.squad.coach : null
    const held = row.levels && typeof row.levels === 'object' ? row.levels : {}
    const cards = {}
    for (const [id, lv] of Object.entries(held)) {
      if (lv === null || lv === undefined) continue
      cards[id] = { id, level: Math.max(0, Math.min(20, Math.trunc(Number(lv) || 0))), dupes: 0, seen: 1 }
    }
    let five
    try { five = engine.squadForPlay({ squad: { slots, coach }, cards }) } catch { return null }
    if (!five?.ok) return null
    const levels = {}
    for (const id of [...five.squad.slots, five.squad.coach]) if (id && cards[id]?.level) levels[id] = cards[id].level
    let score
    try { score = engine.squadRating(five.squad, (id) => levels[id] ?? 0) } catch { return null }
    if (!Number.isFinite(score)) return null
    return { five: { slots: five.squad.slots, coach: five.squad.coach, levels, cardPoolVersion, paper: engine.squadPaper?.(five.squad, (id) => levels[id] ?? 0) }, score: Math.round(score) }
  }
  const rivalOf = (e) => {
    const d = who(e.name, e.id_hash)
    return { name: d.name, tag: d.tag, slots: e.five.slots, coach: e.five.coach, levels: e.five.levels ?? {}, div: 0, points: 0 }
  }

  // ------------------------------------------------------------ the clock

  async function ensureOpen(now) {
    const slot = slotOf(now)
    if (ensureOpen.known === slot) return
    await bg`insert into team_cups (starts, seed) values (${new Date(slot)}, ${freshSeed()}) on conflict (starts) do nothing`
    ensureOpen.known = slot
  }

  /** Read the fives, deal the teams, draw round one — under the cup's row lock, the one join and leave take. */
  async function start(cup) {
    await tx(async (db) => {
      const held = await db`select status from team_cups where id = ${cup.id} for update`
      if (held[0]?.status !== 'open') return
      const rows = await db`
        select a.id_hash, a.name, a.state->'squad' as squad,
          (select jsonb_object_agg(k, a.state->'cards'->k->'level')
             from jsonb_array_elements_text(
               (case when jsonb_typeof(a.state->'squad'->'slots') = 'array' then a.state->'squad'->'slots' else '[]'::jsonb end)
               || jsonb_build_array(a.state->'squad'->'coach')) as k
            where k is not null) as levels
        from team_cup_entries e join card_accounts a on a.id_hash = e.id_hash
        where e.cup_id = ${cup.id} and not a.suspect
        order by e.joined, e.id_hash limit ${engine.TEAM_CUP_MAX}`
      const fielded = []
      for (const r of rows) {
        const f = fiveOf(r)
        if (f) fielded.push({ id_hash: r.id_hash, name: r.name ?? null, five: f.five, score: f.score })
      }
      const teams = engine.dealTeams(fielded.map((f) => ({ id: f.id_hash, score: f.score })), Number(cup.seed))
      if (teams.length < engine.TEAM_CUP_MIN_TEAMS) {
        await db`update team_cups set status = 'void', entrants = ${fielded.length}, finished = now() where id = ${cup.id} and status = 'open'`
        return
      }
      const teamOf = new Map()
      teams.forEach((members, t) => members.forEach((id) => teamOf.set(id, t)))
      const seated = fielded.filter((f) => teamOf.has(f.id_hash)).map((f) => ({ ...f, team: teamOf.get(f.id_hash) }))
      const got = await db`
        update team_cups set status = 'live', round = 0, rounds = ${engine.teamCupRounds(teams.length)}, step_sec = ${stepOf()},
               entrants = ${seated.length}, teams = ${teams.length}, balance_version = ${engine.BALANCE_VERSION ?? null}
         where id = ${cup.id} and status = 'open' returning id`
      if (!got.length) return
      await db`
        update team_cup_entries e set five = x.five, score = x.score, name = x.name, team = x.team
          from jsonb_to_recordset(${db.json(seated)}::jsonb) as x(id_hash text, name text, five jsonb, score int, team int)
         where e.cup_id = ${cup.id} and e.id_hash = x.id_hash`
      await draw(db, cup.id, Number(cup.seed), 0, teams.map((_, t) => t))
    })
    publicCache.at = 0
  }

  async function draw(db, id, seed, round, alive) {
    const { pairs, byes } = engine.pairTeamRound(alive, seed, round)
    const rows = pairs.map(([a, b], slot) => ({ slot, a, b }))
    rows.push(...byes.map((a, i) => ({ slot: pairs.length + i, a, b: null })))
    await db`
      insert into team_cup_ties (cup_id, round, slot, team_a, team_b, winner, wins_a, wins_b)
      select ${id}::bigint, ${round}::int, x.slot, x.a, x.b, case when x.b is null then x.a else null end, null, null
        from jsonb_to_recordset(${db.json(rows)}::jsonb) as x(slot int, a int, b int)
      on conflict do nothing`
  }

  /** Play what is left of the current round (no connection held while a duel runs), then step the cup on. */
  async function playRound(cup) {
    const open = await bg`select slot, team_a, team_b from team_cup_ties where cup_id = ${cup.id} and round = ${cup.round} and winner is null order by slot`
    if (open.length) {
      const entries = await bg`select id_hash, name, five, score, team from team_cup_entries where cup_id = ${cup.id} and team is not null`
      const byTeam = new Map()
      const byId = new Map()
      for (const e of entries) { byId.set(e.id_hash, e); if (!byTeam.has(e.team)) byTeam.set(e.team, []); byTeam.get(e.team).push(e.id_hash) }
      const seed = Number(cup.seed)
      const budget = Date.now() + 4000
      for (const t of open) {
        if (Date.now() > budget) return true // the rest on the next tick
        const lineup = (team) => engine.teamLineup(byTeam.get(team).slice().sort(), (id) => byId.get(id).score, seed, team, cup.round)
        const a = lineup(t.team_a), b = lineup(t.team_b)
        const duels = []
        let winsA = 0
        for (let d = 0; d < engine.TEAM_SIZE; d++) {
          const ea = byId.get(a[d]), eb = byId.get(b[d])
          const r = await simulate([rivalOf(ea), rivalOf(eb), false, engine.teamDuelSeed(seed, cup.round, t.slot, d), cup.balance_version ?? undefined,
            ea.five.paper && eb.five.paper ? [ea.five.paper.score, eb.five.paper.score] : undefined])
          if (!r || typeof r.aWon !== 'boolean') throw new Error('invalid duel result')
          if (r.aWon) winsA++
          duels.push({ a: a[d], b: b[d], aWon: r.aWon, mapsA: r.mapsA, mapsB: r.mapsB })
        }
        const winner = winsA * 2 > engine.TEAM_SIZE ? t.team_a : t.team_b
        await tx(async (db) => {
          const got = await db`
            update team_cup_ties set winner = ${winner}, wins_a = ${winsA}, wins_b = ${engine.TEAM_SIZE - winsA}, duels = ${db.json(duels)}
             where cup_id = ${cup.id} and round = ${cup.round} and slot = ${t.slot} and winner is null returning slot`
          if (!got.length) return
          const tally = duels.flatMap((x) => [{ id: x.a, won: x.aWon ? 1 : 0 }, { id: x.b, won: x.aWon ? 0 : 1 }])
          await db`
            update team_cup_entries e set duels = e.duels + 1, duel_wins = e.duel_wins + x.won
              from jsonb_to_recordset(${db.json(tally)}::jsonb) as x(id text, won int)
             where e.cup_id = ${cup.id} and e.id_hash = x.id`
        })
      }
    }
    return advanceRound(cup)
  }

  async function advanceRound(cup) {
    const moved = await tx(async (db) => {
      const held = await db`select status, round, rounds, seed::text as seed, teams from team_cups where id = ${cup.id} for update`
      const c = held[0]
      if (!c || c.status !== 'live' || c.round !== cup.round) return false
      const ties = await db`select slot, team_a, team_b, winner from team_cup_ties where cup_id = ${cup.id} and round = ${cup.round} order by slot`
      if (!ties.length || ties.some((t) => t.winner === null)) return false
      // a place is decided by the round a team goes out in: the final's loser is 2, the semi-finals' 4, the quarter-finals' 8
      const left = c.rounds - 1 - c.round
      const place = left === 0 ? 2 : left === 1 ? 4 : left === 2 ? 8 : null
      const losers = ties.filter((t) => t.team_b !== null).map((t) => (t.winner === t.team_a ? t.team_b : t.team_a))
      if (place && losers.length) {
        await db`update team_cup_entries set place = ${place} where cup_id = ${cup.id} and team in (select jsonb_array_elements_text(${db.json(losers)}::jsonb)::int)`
      }
      const winners = ties.map((t) => t.winner)
      if (winners.length === 1) {
        await db`update team_cup_entries set place = 1 where cup_id = ${cup.id} and team = ${winners[0]}`
        await db`update team_cups set status = 'done', champion = ${winners[0]}, round = ${c.round + 1}, finished = now() where id = ${cup.id}`
        await pay(db, cup.id, c.teams)
        return true
      }
      await db`update team_cups set round = ${c.round + 1} where id = ${cup.id}`
      await draw(db, cup.id, Number(c.seed), c.round + 1, winners)
      return true
    })
    if (moved) { publicCache.at = 0; mineCache.clear() }
    return moved
  }

  /** The purse: a place's prize to every member of the team, the duel coins to whoever won them. Once. */
  async function pay(db, id, teams) {
    const rows = await db`select id_hash, team, place, duel_wins, duels from team_cup_entries where cup_id = ${id} and team is not null`
    const mail = []
    for (const e of rows) {
      const prize = [1, 2, 4, 8].includes(e.place) ? engine.teamCupPrize(teams, e.place) : { coins: 0 }
      const coins = (prize.coins ?? 0) + e.duel_wins * engine.TEAM_DUEL_COINS
      if (!coins && !prize.pack) continue
      mail.push({ id_hash: e.id_hash, coins, pack: prize.pack ?? null, count: prize.count ?? 1,
        body: { cup: String(id), teams, place: e.place ?? null, duelWins: e.duel_wins, duels: e.duels } })
    }
    if (!mail.length) return
    await db`with receipts as (
      insert into team_cup_payouts (cup_id, id_hash)
      select ${id}::bigint, x.id_hash from jsonb_to_recordset(${db.json(mail)}::jsonb) as x(id_hash text)
      on conflict do nothing returning id_hash
    ) insert into card_mail (to_h, kind, coins, pack, count, body)
      select x.id_hash, 'team_cup', x.coins, x.pack, x.count, x.body
      from jsonb_to_recordset(${db.json(mail)}::jsonb) as x(id_hash text, coins int, pack text, count int, body jsonb)
      join receipts r using (id_hash)`
  }

  let prunedAt = 0
  // A pass that never answers used to own the clock for ever, in silence (cup-clock.js).
  const cupClock = makeCupPass({ name: 'teamcup', limitMs: passMs, onStall: () => computer?.reset() })
  function advance(now = clock()) {
    // Asked while a pass is under way (a page's nudge, say): the timer simply comes round again, but a caller
    // that names its own moment — the checks — gets a pass for THAT moment, after the one in flight.
    const inflight = cupClock.inflight
    if (inflight && !timer) return inflight.then(() => advance(now), () => advance(now))
    return cupClock.run(async () => {
      await ensureOpen(now)
      for (let pass = 0; pass < (timer ? 1 : 64); pass++) {
        const due = await bg`
          select id::text as id, starts, status, round, rounds, step_sec, seed::text as seed, teams, balance_version
            from team_cups where status in ('open', 'live') and starts <= ${new Date(now)} order by starts limit 4`
        let moved = false
        for (const cup of due) {
          if (cup.status === 'open') { await start(cup); moved = true; continue }
          if (engine.teamCupRoundAt(ms(cup.starts), cup.step_sec, cup.round) <= now) moved = (await playRound(cup)) || moved
        }
        if (!moved) break
      }
      if (now - prunedAt > 3600_000) {
        prunedAt = now
        // a tie's duel list is the bulk of a cup; fourteen days of them is plenty
        await bg`delete from team_cups where status in ('done', 'void') and starts < now() - interval '14 days'`
      }
    })
  }
  let interval = null
  if (timer && sql) {
    interval = setInterval(() => { advance().catch((err) => console.warn('teamcup: advance failed', err.message)) }, 3000)
    interval.unref?.()
  }

  // ------------------------------------------------------------ reads

  const cupRow = (c) => c && ({
    id: String(c.id), starts: ms(c.starts), status: c.status, round: c.round, rounds: c.rounds, stepSec: c.step_sec,
    entrants: c.entrants, teams: c.teams, champion: c.champion ?? null,
    nextAt: c.status === 'live' ? engine.teamCupRoundAt(ms(c.starts), c.step_sec, c.round) : null,
  })
  const publicCache = { at: 0, value: null }
  async function publicState(now) {
    if (publicCache.value && now - publicCache.at < 4000) return publicCache.value
    const next = (await sql`select c.*, (select count(*)::int from team_cup_entries e where e.cup_id = c.id) as signed
      from team_cups c where c.status = 'open' and c.starts > ${new Date(now)} order by c.starts limit 1`)[0] ?? null
    const live = (await sql`select * from team_cups where status = 'live' order by starts desc limit 1`)[0] ?? null
    const last = (await sql`select * from team_cups where status = 'done' order by starts desc limit 1`)[0] ?? null
    const value = {
      size: engine.TEAM_SIZE, hours: engine.TEAM_CUP_HOURS, duelCoins: engine.TEAM_DUEL_COINS,
      next: next ? { ...cupRow(next), signed: next.signed } : null,
      live: cupRow(live), last: cupRow(last),
    }
    publicCache.at = now; publicCache.value = value
    return value
  }

  /** One team as its members may be shown: names, scores, how their duels went. No hashes. */
  async function teamView(id, team, me) {
    const rows = await sql`select id_hash, name, score, duels, duel_wins from team_cup_entries where cup_id = ${id} and team = ${team} order by score desc, id_hash`
    return rows.map((r) => ({ ...who(r.name, r.id_hash), score: r.score, duels: r.duels, duelWins: r.duel_wins, me: !!me && r.id_hash === me }))
  }
  async function tieView(id, t, me) {
    const ids = [...new Set((t.duels ?? []).flatMap((d) => [d.a, d.b]))]
    const names = new Map()
    if (ids.length) for (const r of await sql`select id_hash, name, score from team_cup_entries where cup_id = ${id} and id_hash = any(${ids})`) names.set(r.id_hash, r)
    const side = (h) => { const r = names.get(h); return { ...who(r?.name, h), score: r?.score ?? null, me: !!me && h === me } }
    return {
      round: t.round, slot: t.slot, teamA: t.team_a, teamB: t.team_b, bye: t.team_b === null, played: t.winner !== null && t.team_b !== null,
      winsA: t.wins_a, winsB: t.wins_b, winner: t.winner,
      duels: (t.duels ?? []).map((d) => ({ a: side(d.a), b: side(d.b), aWon: d.aWon, mapsA: d.mapsA, mapsB: d.mapsB })),
    }
  }
  async function mineIn(c, me) {
    const mine = (await sql`select team, place, duels, duel_wins, score from team_cup_entries where cup_id = ${c.id} and id_hash = ${me}`)[0]
    if (!mine) return null
    if (mine.team === null) return { seated: false }
    const ties = await sql`select * from team_cup_ties where cup_id = ${c.id} and (team_a = ${mine.team} or team_b = ${mine.team}) order by round`
    const prize = [1, 2, 4, 8].includes(mine.place) ? engine.teamCupPrize(c.teams, mine.place) : null
    return {
      seated: true, team: mine.team, place: mine.place ?? null, duels: mine.duels, duelWins: mine.duel_wins,
      alive: c.status === 'live' && !ties.some((t) => t.winner !== null && t.winner !== mine.team),
      members: await teamView(c.id, mine.team, me),
      ties: await Promise.all(ties.map((t) => tieView(c.id, t, me))),
      prize, coins: (prize?.coins ?? 0) + mine.duel_wins * engine.TEAM_DUEL_COINS,
    }
  }
  async function finalOf(c, me) {
    if (!c || c.status !== 'done') return null
    const t = (await sql`select * from team_cup_ties where cup_id = ${c.id} and round = ${c.round - 1} order by slot limit 1`)[0]
    return t ? { tie: await tieView(c.id, t, me), champions: await teamView(c.id, c.champion, me) } : null
  }

  async function gate(me) {
    const r = await sql`
      select state->>'pulls' as pulls, suspect,
             ceil(extract(epoch from (created + make_interval(days => ${minDays}) - now())))::int as wait
        from card_accounts where id_hash = ${me}`
    if (!r.length) return { missing: true }
    const pulls = Math.max(0, Math.floor(Number(r[0].pulls ?? 0)))
    const wait = Math.max(0, Number(r[0].wait) || 0)
    if (r[0].suspect) return { why: '这个账号暂时不能报名。' }
    if (pulls < TRADE_PULLS || wait > 0) return { need: TRADE_PULLS, have: pulls, days: minDays, wait }
    return null
  }
  async function readMe(req) {
    let body
    try { body = JSON.parse(await readBody(req, 4096)) } catch { return { body: null, me: null } }
    const id = normalizeId(body?.id)
    return { body, me: id ? hash(id) : null }
  }

  const mineCache = new Map()
  let advancedAt = 0
  async function state(req, res, bucket) {
    if (guard(req, res, `tc:${bucket}`, 120)) return
    const { me } = await readMe(req)
    const now = clock()
    if (Math.abs(now - advancedAt) > 5000) {
      advancedAt = now
      void advance(now).catch((err) => console.warn('teamcup: advance failed', err.message))
    }
    const pub = await publicState(now)
    const out = { ok: true, now, ...pub }
    if (me) {
      const key = `${pub.next?.id}:${pub.live?.id}:${pub.live?.round}:${pub.last?.id}`
      let hit = mineCache.get(me)
      if (!hit || hit.key !== key || now - hit.at > 10_000) {
        hit = { key, at: now, value: {
          joined: pub.next ? (await sql`select 1 as ok from team_cup_entries where cup_id = ${pub.next.id} and id_hash = ${me}`).length > 0 : false,
          live: pub.live ? await mineIn({ ...pub.live, id: pub.live.id }, me) : null,
          last: pub.last ? await mineIn({ ...pub.last, id: pub.last.id }, me) : null,
        } }
        if (mineCache.size > 5000) mineCache.clear()
        mineCache.set(me, hit)
      }
      if (pub.next) out.next = { ...pub.next, joined: hit.value.joined }
      if (pub.live) out.live = { ...pub.live, me: hit.value.live }
      if (pub.last) out.last = { ...pub.last, me: hit.value.last }
    }
    if (pub.last) out.last = { ...(out.last ?? pub.last), final: await finalOf({ ...pub.last, round: pub.last.round }, me) }
    json(res, 200, out)
  }

  async function join(req, res, bucket) {
    if (guard(req, res, `tcj:${bucket}`, 30)) return
    const { me } = await readMe(req)
    if (!me) { json(res, 400, { ok: false, bad: true }); return }
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    const now = clock()
    await ensureOpen(now)
    const blocked = await gate(me)
    if (blocked?.missing) { json(res, 200, { ok: false, missing: true }); return }
    if (blocked?.why) { json(res, 200, { ok: false, why: blocked.why }); return }
    if (blocked) { json(res, 200, { ok: false, gate: blocked, why: `开过 ${blocked.need} 张卡、账号满 ${blocked.days} 天才能报名（现在 ${blocked.have} 张）。` }); return }
    const mine = await sql`
      select a.id_hash, a.name, a.state->'squad' as squad,
        (select jsonb_object_agg(k, a.state->'cards'->k->'level')
           from jsonb_array_elements_text(
             (case when jsonb_typeof(a.state->'squad'->'slots') = 'array' then a.state->'squad'->'slots' else '[]'::jsonb end)
             || jsonb_build_array(a.state->'squad'->'coach')) as k
          where k is not null) as levels
      from card_accounts a where a.id_hash = ${me}`
    const five = mine.length ? fiveOf(mine[0]) : null
    if (!five) { json(res, 200, { ok: false, why: '先凑齐五个人。' }); return }
    const open = await sql`select id::text as id, starts from team_cups where status = 'open' and starts > ${new Date(now)} order by starts limit 1`
    if (!open.length) { json(res, 200, { ok: false, why: '现在没有可以报名的组队杯，稍后再试。' }); return }
    const seat = await tx(async (db) => {
      const cup = await db`select status, starts from team_cups where id = ${open[0].id} for update`
      if (cup[0]?.status !== 'open' || ms(cup[0].starts) <= clock()) return { why: '这一场已经开赛了，下一场再来。' }
      const had = await db`select 1 as ok from team_cup_entries where cup_id = ${open[0].id} and id_hash = ${me}`
      if (had.length) return { ok: true, already: true }
      const full = await db`select count(*)::int as n from team_cup_entries where cup_id = ${open[0].id}`
      if ((full[0]?.n ?? 0) >= engine.TEAM_CUP_MAX) return { why: '这一场报满了，下一场再来。' }
      await db`insert into team_cup_entries (cup_id, id_hash, name) values (${open[0].id}, ${me}, ${mine[0].name ?? null})`
      return { ok: true }
    })
    if (!seat.ok) { json(res, 200, { ok: false, why: seat.why }); return }
    publicCache.at = 0; mineCache.delete(me)
    json(res, 200, { ok: true, cup: open[0].id, starts: ms(open[0].starts), score: five.score, already: seat.already === true ? true : undefined })
  }

  async function leave(req, res, bucket) {
    if (guard(req, res, `tcj:${bucket}`, 30)) return
    const { me } = await readMe(req)
    if (!me) { json(res, 400, { ok: false, bad: true }); return }
    await tx(async (db) => {
      const cups = await db`select id from team_cups where status = 'open' and starts > ${new Date(clock())} order by starts limit 1 for update`
      if (cups.length) await db`delete from team_cup_entries where cup_id = ${cups[0].id} and id_hash = ${me}`
    })
    publicCache.at = 0; mineCache.delete(me)
    json(res, 200, { ok: true })
  }

  /** One round of one cup, a page at a time — for the bracket view. */
  async function round(req, res, bucket) {
    if (guard(req, res, `tcr:${bucket}`, 60)) return
    const { body, me } = await readMe(req)
    const id = cupId(body?.cup)
    const r = Number.isInteger(body?.round) && body.round >= 0 && body.round < 64 ? body.round : null
    if (!id || r === null) { json(res, 400, { ok: false, bad: true }); return }
    const ties = await sql`select * from team_cup_ties where cup_id = ${id} and round = ${r} order by slot limit 64`
    json(res, 200, { ok: true, ties: await Promise.all(ties.map((t) => tieView(id, t, me))) })
  }

  return {
    advance,
    close() { if (interval) clearInterval(interval); computer?.close() },
    async route(req, res, path, bucket) {
      if (path === '/api/card/teamcup') { await state(req, res, bucket); return true }
      if (path === '/api/card/teamcup/join') { await join(req, res, bucket); return true }
      if (path === '/api/card/teamcup/leave') { await leave(req, res, bucket); return true }
      if (path === '/api/card/teamcup/round') { await round(req, res, bucket); return true }
      return false
    },
  }
}
