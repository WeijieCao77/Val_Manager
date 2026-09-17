/**
 * 全服杯 — storage and a clock for the bracket in src/engine/openCup.ts.
 *
 * A cup starts on every even hour. Until it does, anybody who may trade may
 * sign up for it (the same fifty pulls and three days the market asks — an
 * account made tonight is no use for padding a field tonight). At the start
 * the server reads, in ONE statement, the five every entrant is fielding at
 * that moment: one statement is one snapshot, so a card cannot be in two
 * fives by being passed between accounts, and a five that is not whole is
 * left out rather than played short. After that nothing is read from an
 * account again until the purse is posted to its mail.
 *
 * Who advances it. There is no cron to fail: `advance` runs on a timer in this
 * process AND before every read, single-flight, and everything it does is
 * either idempotent or guarded by the cup's own round counter —
 * `update … where round = k` is the lock. A round is computed outside the
 * transaction (it is CPU, it needs no connection) from a seed the cup was
 * born with, so two containers overlapping across a deploy compute the same
 * round and the second one's write changes no rows. The transaction that
 * records the last round is the one that posts the purse, which is what makes
 * a prize impossible to pay twice or not at all.
 *
 * One connection at a time, never two: a transaction here never reaches for
 * the pool (see the 2026-09-05 deadlock in cards-api.js).
 */
import { createHash } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import { isVerified } from './phone-api.js'
import { TRADE_PULLS, TRADE_DAYS } from './market-api.js'

export const OPEN_CUP_SCHEMA = `
create table if not exists open_cups (
  id        bigserial primary key,
  starts    timestamptz not null unique,
  -- open: taking entries. live: being played. done: has a champion.
  -- void: too few turned up.
  status    text not null default 'open',
  -- rounds already played
  round     int not null default 0,
  rounds    int not null default 0,
  step_sec  int not null default 900,
  seed      bigint not null default 0,
  entrants  int not null default 0,
  champion  text,
  finished  timestamptz
);
create index if not exists open_cups_status_idx on open_cups (status, starts);
create index if not exists open_cups_champion_idx on open_cups (champion, finished) where champion is not null;
create table if not exists open_cup_entries (
  cup_id    bigint not null,
  id_hash   text not null,
  name      text,
  -- the five as it stood when the cup started: slots, coach, levels
  five      jsonb,
  score     int,
  alive     boolean not null default true,
  wins      int not null default 0,
  byes      int not null default 0,
  -- the round it went out in; -1 for a five that was not whole at the start
  out_round int,
  place     int,
  joined    timestamptz not null default now(),
  primary key (cup_id, id_hash)
);
create index if not exists open_cup_entries_who_idx on open_cup_entries (id_hash, cup_id);
create table if not exists open_cup_matches (
  cup_id  bigint not null,
  round   int not null,
  slot    int not null,
  a       text not null,
  -- null is a bye
  b       text,
  winner  text,
  maps_a  int,
  maps_b  int,
  detail  jsonb,
  primary key (cup_id, round, slot)
);
create index if not exists open_cup_matches_a_idx on open_cup_matches (cup_id, a);
create index if not exists open_cup_matches_b_idx on open_cup_matches (cup_id, b);
`

const hash = (id) => createHash('sha256').update(String(id)).digest('hex')
const freshSeed = () => randomBytes(4).readUInt32LE(0)
const breathe = () => new Promise((r) => setImmediate(r))
const DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function makeOpenCupApi(sql, {
  readBody, json, normalizeId, displayName, rateLimited, engine,
  /** the clock, for the checks; the server's own otherwise */
  clock = () => Date.now(),
  /** false in the checks, which call advance() themselves */
  timer = true,
  /** the trading gate's days; the checks cannot backdate an account */
  minDays = TRADE_DAYS,
  /**
   * A faster clock, for a local server on the in-process database: a cup
   * every `fast.everySec`, a round every `fast.stepSec`. Never set in
   * production — server.js only reads it beside `DATABASE_URL=pglite://`.
   */
  fast = null,
}) {
  const slotOf = (now) => (fast ? engine.openCupSlot(now, fast.everySec * 1000) : engine.openCupSlot(now))
  const planOf = (n) => (fast ? engine.planOpenCupFast(n, fast.stepSec) : engine.planOpenCup(n))
  const guard = (req, res, bucket, max) => {
    if (rateLimited(bucket, max)) { json(res, 429, { ok: false, why: 'rate' }); return true }
    return false
  }
  const tx = (fn) => (sql.begin ? sql.begin(fn) : fn(sql))
  const cupId = (v) => (/^\d{1,18}$/.test(String(v ?? '')) ? String(v) : null)
  const smallInt = (v) => (Number.isInteger(v) && v >= 0 && v < 100_000 ? v : null)
  const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime())
  const who = (name, h) => { const d = displayName(name, h); return { name: d.name, tag: `#${d.tag}` } }

  // ------------------------------------------------------------ the clock

  /**
   * The five an account is fielding, from the two parts of its state that say
   * so. Validated by the same function that seats a ladder match, against a
   * collection made of exactly the cards named — a card the account does not
   * hold reads as null and is simply not in it.
   */
  function fiveOf(row) {
    const slots = Array.isArray(row.squad?.slots) ? row.squad.slots.slice(0, 5).map((x) => (typeof x === 'string' ? x : null)) : []
    const coach = typeof row.squad?.coach === 'string' ? row.squad.coach : null
    const held = row.levels && typeof row.levels === 'object' ? row.levels : {}
    const cards = {}
    for (const [id, lv] of Object.entries(held)) {
      if (lv === null || lv === undefined) continue
      const n = Math.trunc(Number(lv) || 0)
      cards[id] = { id, level: Math.max(0, Math.min(20, n)), dupes: 0, seen: 1 }
    }
    let five
    try { five = engine.squadForPlay({ squad: { slots, coach }, cards }) } catch { return null }
    if (!five?.ok) return null
    const levels = {}
    for (const id of [...five.squad.slots, five.squad.coach]) {
      if (id && cards[id]?.level) levels[id] = cards[id].level
    }
    let score
    try { score = engine.squadRating(five.squad, (id) => levels[id] ?? 0) } catch { return null }
    if (!Number.isFinite(score)) return null
    return { five: { slots: five.squad.slots, coach: five.squad.coach, levels }, score: Math.round(score) }
  }

  const rivalOf = (e) => {
    const d = who(e.name, e.id_hash)
    return { name: d.name, tag: d.tag, slots: e.five.slots, coach: e.five.coach, levels: e.five.levels ?? {}, div: 0, points: 0 }
  }

  async function ensureOpen(now) {
    const slot = slotOf(now)
    if (ensureOpen.known === slot) return
    await sql`insert into open_cups (starts, seed) values (${new Date(slot)}, ${freshSeed()}) on conflict (starts) do nothing`
    ensureOpen.known = slot
  }

  /** Take the entries, fix the fives, draw the first round. */
  async function start(cup) {
    const rows = await sql`
      select a.id_hash, a.name, a.state->'squad' as squad,
        (select jsonb_object_agg(k, a.state->'cards'->k->'level')
           from jsonb_array_elements_text(
             (case when jsonb_typeof(a.state->'squad'->'slots') = 'array'
                   then a.state->'squad'->'slots' else '[]'::jsonb end)
             || jsonb_build_array(a.state->'squad'->'coach')) as k
          where k is not null) as levels
      from open_cup_entries e join card_accounts a on a.id_hash = e.id_hash
      where e.cup_id = ${cup.id} and not a.suspect
      order by e.joined, e.id_hash
      limit ${engine.OPEN_CUP_MAX}`
    const fielded = []
    for (const r of rows) {
      const f = fiveOf(r)
      if (f) fielded.push({ id_hash: r.id_hash, name: r.name ?? null, five: f.five, score: f.score })
    }
    const n = fielded.length
    await tx(async (db) => {
      if (n < engine.OPEN_CUP_MIN) {
        await db`update open_cups set status = 'void', entrants = ${n}, finished = now()
                  where id = ${cup.id} and status = 'open'`
        return
      }
      const plan = planOf(n)
      const got = await db`
        update open_cups set status = 'live', round = 0, rounds = ${plan.rounds}, step_sec = ${plan.stepSec}, entrants = ${n}
         where id = ${cup.id} and status = 'open' returning id`
      if (!got.length) return
      await db`
        update open_cup_entries e set five = x.five, score = x.score, name = x.name
          from jsonb_to_recordset(${db.json(fielded)}::jsonb) as x(id_hash text, name text, five jsonb, score int)
         where e.cup_id = ${cup.id} and e.id_hash = x.id_hash`
      // whoever is left has no five: not whole at the start, or an account the clock caught
      await db`update open_cup_entries set alive = false, out_round = -1
                where cup_id = ${cup.id} and five is null`
      await draw(db, cup.id, Number(cup.seed), 0, fielded.map((f) => ({ id: f.id_hash, byes: 0 })))
    })
    publicCache.at = 0
  }

  /** Write round `round`'s pairings as unplayed matches; a bye is a match with nobody across it. */
  async function draw(db, id, seed, round, seats) {
    const { pairs, byes } = engine.pairOpenCupRound(seats, seed, round)
    const rows = pairs.map(([a, b], slot) => ({ slot, a, b }))
    for (const id of byes) rows.push({ slot: rows.length, a: id, b: null })
    await db`
      insert into open_cup_matches (cup_id, round, slot, a, b)
      select ${id}::bigint, ${round}::int, x.slot, x.a, x.b
        from jsonb_to_recordset(${db.json(rows)}::jsonb) as x(slot int, a text, b text)
      on conflict do nothing`
  }

  /** Play the round that is due. True when it was this call that recorded it. */
  async function playRound(cup) {
    const k = cup.round
    const last = k >= cup.rounds - 1
    const seed = Number(cup.seed)
    const pending = await sql`
      select slot, a, b from open_cup_matches where cup_id = ${cup.id} and round = ${k} order by slot`
    const alive = await sql`
      select id_hash, name, five, byes from open_cup_entries where cup_id = ${cup.id} and alive`
    const entry = new Map(alive.map((e) => [e.id_hash, e]))
    const played = []
    const winners = []
    const losers = []
    const byeOf = []
    for (const m of pending) {
      const A = entry.get(m.a)
      const B = m.b ? entry.get(m.b) : null
      if (!A && !B) continue
      if (!m.b || !A || !B) {
        // a bye — or, which cannot happen, a side that is not there
        const through = A ? m.a : m.b
        if (!m.b) byeOf.push(through)
        played.push({ slot: m.slot, winner: through, maps_a: null, maps_b: null, detail: null })
        winners.push({ id: through, won: 0 })
        continue
      }
      const res = engine.playOpenCupMatch(rivalOf(A), rivalOf(B), last, engine.openCupMatchSeed(seed, k, m.slot))
      played.push({ slot: m.slot, winner: res.aWon ? m.a : m.b, maps_a: res.mapsA, maps_b: res.mapsB, detail: res.detail })
      winners.push({ id: res.aWon ? m.a : m.b, won: 1 })
      losers.push(res.aWon ? m.b : m.a)
      // a BO3 is a few milliseconds of somebody else's request not being served
      await breathe()
    }
    let mine = false
    await tx(async (db) => {
      const got = await db`
        update open_cups set round = round + 1
         where id = ${cup.id} and status = 'live' and round = ${k} returning id`
      if (!got.length) return
      mine = true
      await db`
        update open_cup_matches m set winner = x.winner, maps_a = x.maps_a, maps_b = x.maps_b, detail = x.detail
          from jsonb_to_recordset(${db.json(played)}::jsonb) as x(slot int, winner text, maps_a int, maps_b int, detail jsonb)
         where m.cup_id = ${cup.id} and m.round = ${k} and m.slot = x.slot`
      await db`
        update open_cup_entries e set wins = e.wins + x.won
          from jsonb_to_recordset(${db.json(winners)}::jsonb) as x(id text, won int)
         where e.cup_id = ${cup.id} and e.id_hash = x.id`
      if (byeOf.length) {
        await db`update open_cup_entries set byes = byes + 1
                  where cup_id = ${cup.id} and id_hash in (select jsonb_array_elements_text(${db.json(byeOf)}::jsonb))`
      }
      // the final's loser is second; the semi-finals' losers share fourth
      const place = last ? 2 : k === cup.rounds - 2 ? 4 : null
      await db`
        update open_cup_entries set alive = false, out_round = ${k}, place = ${place}
         where cup_id = ${cup.id} and id_hash in (select jsonb_array_elements_text(${db.json(losers)}::jsonb))`
      const left = await db`
        select id_hash, byes from open_cup_entries where cup_id = ${cup.id} and alive order by id_hash`
      if (left.length > 1) {
        await draw(db, cup.id, seed, k + 1, left.map((e) => ({ id: e.id_hash, byes: e.byes })))
        return
      }
      const champion = left[0]?.id_hash ?? null
      await db`update open_cup_entries set place = 1 where cup_id = ${cup.id} and id_hash = ${champion}`
      await db`update open_cups set status = 'done', champion = ${champion}, finished = now() where id = ${cup.id}`
      await pay(db, cup)
    })
    publicCache.at = 0
    boardCache.at = 0
    return mine
  }

  /** The purse, as mail: what each entrant won, once, in the transaction that ended the cup. */
  async function pay(db, cup) {
    const rows = await db`
      select id_hash, wins, place from open_cup_entries
       where cup_id = ${cup.id} and (wins > 0 or place is not null)`
    const mail = []
    for (const r of rows) {
      const place = r.place === 1 || r.place === 2 || r.place === 4 ? r.place : null
      const prize = engine.openCupPurse(cup.entrants, r.wins, place)
      if (!prize.coins && !prize.pack) continue
      mail.push({
        to_h: r.id_hash, coins: prize.coins, pack: prize.pack ?? null,
        body: { place, wins: r.wins, entrants: cup.entrants, cup: String(cup.id) },
      })
    }
    if (!mail.length) return
    await db`
      insert into card_mail (to_h, kind, coins, pack, count, body)
      select x.to_h, 'open_cup', x.coins, x.pack, 1, x.body
        from jsonb_to_recordset(${db.json(mail)}::jsonb) as x(to_h text, coins int, pack text, body jsonb)`
  }

  /**
   * What is kept, and for how long.
   *
   * A cup's scoreboards are read for a day or two and never again, and they
   * are nearly all of what a cup weighs — a kilobyte a match, a few thousand
   * matches a day. Three days of match pages, a fortnight of brackets; the
   * cups themselves stay for good, because the 冠军榜 is counted off them.
   */
  let prunedAt = 0
  async function prune(now) {
    if (Math.abs(now - prunedAt) < 60 * 60 * 1000) return
    prunedAt = now
    await sql`
      update open_cup_matches set detail = null
       where detail is not null
         and cup_id in (select id from open_cups where starts < ${new Date(now - 3 * 86_400_000)})`
    const old = new Date(now - 14 * 86_400_000)
    await sql`delete from open_cup_matches where cup_id in (select id from open_cups where starts < ${old})`
    await sql`delete from open_cup_entries where cup_id in (select id from open_cups where starts < ${old})`
  }

  /**
   * Bring every cup up to the clock.
   *
   * Catches up as well as keeps up: a process that was down for an hour finds
   * four rounds due and plays them one after another, and the bracket comes
   * out exactly as it would have on time.
   */
  let running = null
  function advance(now = clock()) {
    running ??= (async () => {
      try {
        await ensureOpen(now)
        for (let pass = 0; pass < 64; pass++) {
          const due = await sql`
            select id::text as id, starts, status, round, rounds, step_sec, seed::text as seed, entrants
              from open_cups
             where status in ('open', 'live') and starts <= ${new Date(now)}
             order by starts limit 8`
          let moved = false
          for (const cup of due) {
            if (cup.status === 'open') { await start(cup); moved = true; continue }
            if (engine.openCupRoundAt(ms(cup.starts), cup.step_sec, cup.round) <= now) {
              await playRound(cup)
              moved = true
            }
          }
          if (!moved) break
        }
        await prune(now).catch((err) => console.warn('opencup: prune failed', err.message))
      } finally {
        running = null
      }
    })()
    return running
  }
  if (timer && sql) {
    setInterval(() => { advance().catch((err) => console.warn('opencup: advance failed', err.message)) }, fast ? 2000 : 20_000).unref?.()
  }

  // ------------------------------------------------------------ reads

  const cupRow = (c) => c && ({
    id: String(c.id), starts: ms(c.starts), status: c.status, round: c.round, rounds: c.rounds,
    stepSec: c.step_sec, entrants: c.entrants,
    nextAt: c.status === 'live' ? engine.openCupRoundAt(ms(c.starts), c.step_sec, c.round) : null,
  })

  const matchRow = (m) => ({
    round: m.round, slot: m.slot,
    a: { ...who(m.a_name, m.a), score: m.a_score },
    b: m.b ? { ...who(m.b_name, m.b), score: m.b_score } : null,
    bye: !m.b, played: !!m.winner, aWon: m.winner ? m.winner === m.a : null,
    mapsA: m.maps_a, mapsB: m.maps_b,
  })

  /** The late rounds of a cup — the quarter-finals on — which is the part with names people know. */
  async function topOf(c) {
    if (!c || !c.rounds) return []
    const from = Math.max(0, c.rounds - 3)
    const rows = await sql`
      select m.round, m.slot, m.a, m.b, m.winner, m.maps_a, m.maps_b,
             ea.name as a_name, ea.score as a_score, eb.name as b_name, eb.score as b_score
        from open_cup_matches m
        join open_cup_entries ea on ea.cup_id = m.cup_id and ea.id_hash = m.a
        left join open_cup_entries eb on eb.cup_id = m.cup_id and eb.id_hash = m.b
       where m.cup_id = ${c.id} and m.round >= ${from} order by m.round, m.slot limit 16`
    return rows.map(matchRow)
  }

  const publicCache = { at: 0, value: null, inflight: null }
  async function publicState(now) {
    if (publicCache.value && now - publicCache.at < 5000) return publicCache.value
    publicCache.inflight ??= (async () => {
      try {
        const cups = await sql`
          select id::text as id, starts, status, round, rounds, step_sec, entrants, champion, finished
            from open_cups order by starts desc limit 14`
        const next = cups.find((c) => c.status === 'open') ?? null
        const live = cups.find((c) => c.status === 'live') ?? null
        const last = cups.find((c) => c.status === 'done') ?? null
        let signed = 0
        if (next) {
          const n = await sql`select count(*)::int as n from open_cup_entries where cup_id = ${next.id}`
          signed = n[0]?.n ?? 0
        }
        let aliveN = 0
        if (live) {
          const n = await sql`select count(*)::int as n from open_cup_entries where cup_id = ${live.id} and alive`
          aliveN = n[0]?.n ?? 0
        }
        let champion = null
        if (last?.champion) {
          const c = await sql`select id_hash, name, five, score from open_cup_entries where cup_id = ${last.id} and id_hash = ${last.champion}`
          if (c.length) champion = { ...who(c[0].name, c[0].id_hash), five: c[0].five, score: c[0].score }
        }
        const done = cups.filter((c) => c.status === 'done' && c.champion)
        const champs = done.length ? await sql`
          select e.cup_id::text as cup, e.id_hash, e.name from open_cup_entries e
           where e.place = 1 and e.cup_id in (select (jsonb_array_elements_text(${sql.json(done.map((c) => c.id))}::jsonb))::bigint)` : []
        const champOf = new Map(champs.map((r) => [r.cup, who(r.name, r.id_hash)]))
        const value = {
          next: next && { ...cupRow(next), signed },
          live: live && { ...cupRow(live), alive: aliveN, top: await topOf(live) },
          last: last && { ...cupRow(last), champion, top: await topOf(last) },
          // a slot nobody signed up for is not news
          recent: cups.filter((c) => c.status === 'done' || (c.status === 'void' && c.entrants > 0)).slice(0, 8).map((c) => ({
            id: c.id, starts: ms(c.starts), entrants: c.entrants, void: c.status === 'void',
            champion: champOf.get(c.id) ?? null,
          })),
        }
        publicCache.value = value
        publicCache.at = clock()
        return value
      } finally {
        publicCache.inflight = null
      }
    })()
    return publicCache.inflight
  }

  /**
   * 冠军榜: titles, today and ever.
   *
   * A title counts when the field it was won in had OPEN_CUP_RANKED_MIN or
   * more in it. 「今天」 is the Shanghai day the cup finished on.
   */
  const boardCache = { at: 0, value: null, inflight: null }
  async function boards(now) {
    if (boardCache.value && now - boardCache.at < 60_000) return boardCache.value
    boardCache.inflight ??= (async () => {
      try {
        const day = DAY_FMT.format(new Date(now))
        const since = new Date(`${day}T00:00:00+08:00`)
        const q = (from) => sql`
          select c.champion as id_hash, count(*)::int as titles, max(c.finished) as latest,
                 (select a.name from card_accounts a where a.id_hash = c.champion) as name
            from open_cups c
           where c.status = 'done' and c.champion is not null
             and c.entrants >= ${engine.OPEN_CUP_RANKED_MIN} and c.finished >= ${from}
           group by c.champion
           order by titles desc, latest asc
           limit 50`
        const [today, all] = [await q(since), await q(new Date(0))]
        const shape = (rows) => rows.map((r, i) => ({ rank: i + 1, ...who(r.name, r.id_hash), titles: r.titles, h: r.id_hash }))
        boardCache.value = { day, today: shape(today), all: shape(all) }
        boardCache.at = clock()
        return boardCache.value
      } finally {
        boardCache.inflight = null
      }
    })()
    return boardCache.inflight
  }

  async function myTitles(me, now) {
    const day = DAY_FMT.format(new Date(now))
    const r = await sql`
      select count(*)::int as all_n,
             count(*) filter (where finished >= ${new Date(`${day}T00:00:00+08:00`)})::int as today_n
        from open_cups
       where status = 'done' and champion = ${me} and entrants >= ${engine.OPEN_CUP_RANKED_MIN}`
    return { today: r[0]?.today_n ?? 0, all: r[0]?.all_n ?? 0 }
  }

  /** One account's view of one cup: where it stands and the ties it played. */
  async function mineIn(c, me) {
    if (!c || !me) return null
    const e = await sql`
      select alive, wins, byes, out_round, place, score from open_cup_entries
       where cup_id = ${c.id} and id_hash = ${me}`
    if (!e.length) return null
    const rows = await sql`
      select m.round, m.slot, m.a, m.b, m.winner, m.maps_a, m.maps_b,
             ea.name as a_name, ea.score as a_score, eb.name as b_name, eb.score as b_score
        from open_cup_matches m
        join open_cup_entries ea on ea.cup_id = m.cup_id and ea.id_hash = m.a
        left join open_cup_entries eb on eb.cup_id = m.cup_id and eb.id_hash = m.b
       where m.cup_id = ${c.id} and (m.a = ${me} or m.b = ${me}) order by m.round`
    return {
      alive: e[0].alive, wins: e[0].wins, outRound: e[0].out_round, place: e[0].place, score: e[0].score,
      matches: rows.map((m) => ({ ...matchRow(m), mine: m.a === me ? 'a' : 'b' })),
    }
  }

  /** May this account sign up? The market's gate, for the market's reason. */
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

  async function readMe(req, max = 4096) {
    let body
    try { body = JSON.parse(await readBody(req, max)) } catch { return { body: null, me: null } }
    const id = normalizeId(body?.id)
    return { body, me: id ? hash(id) : null }
  }

  /**
   * What one account adds to the public picture, kept for a few seconds: the
   * page polls, and a poll is five small reads that change once a quarter of
   * an hour. Dropped whenever a round is recorded or the account signs up.
   */
  const mineCache = new Map()
  async function mineState(me, pub, now) {
    const key = `${me}:${pub.next?.id ?? ''}:${pub.live?.id ?? ''}:${pub.live?.round ?? ''}:${pub.last?.id ?? ''}`
    const hit = mineCache.get(me)
    if (hit && hit.key === key && now - hit.at < 10_000) return hit.value
    const joined = pub.next
      ? (await sql`select 1 as ok from open_cup_entries where cup_id = ${pub.next.id} and id_hash = ${me}`).length > 0
      : false
    const value = {
      joined,
      live: pub.live ? await mineIn(pub.live, me) : null,
      last: pub.last ? await mineIn(pub.last, me) : null,
      titles: await myTitles(me, now),
    }
    if (mineCache.size > 5000) mineCache.clear()
    mineCache.set(me, { key, at: now, value })
    return value
  }

  let advancedAt = 0
  async function state(req, res, bucket) {
    if (guard(req, res, `oc:${bucket}`, 120)) return
    const { me } = await readMe(req)
    const now = clock()
    // the timer keeps the cups moving; a read only nudges it, and not more than once every few seconds
    if (Math.abs(now - advancedAt) > 5000) {
      advancedAt = now
      await advance(now).catch((err) => console.warn('opencup: advance failed', err.message))
    }
    const pub = await publicState(now)
    const board = await boards(now)
    const strip = (rows) => rows.map(({ h, ...r }) => ({ ...r, me: !!me && h === me }))
    const out = { ok: true, now, ...pub, boards: { day: board.day, today: strip(board.today), all: strip(board.all) } }
    if (me) {
      const mine = await mineState(me, pub, now)
      if (pub.next) out.next = { ...pub.next, joined: mine.joined }
      if (pub.live) out.live = { ...pub.live, me: mine.live }
      if (pub.last) out.last = { ...pub.last, me: mine.last }
      out.titles = mine.titles
    }
    json(res, 200, out)
  }

  async function join(req, res, bucket) {
    if (guard(req, res, `ocj:${bucket}`, 30)) return
    const { me } = await readMe(req)
    if (!me) { json(res, 400, { ok: false, bad: true }); return }
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    const now = clock()
    await advance(now).catch(() => {})
    const blocked = await gate(me)
    if (blocked?.missing) { json(res, 200, { ok: false, missing: true }); return }
    if (blocked?.why) { json(res, 200, { ok: false, why: blocked.why }); return }
    if (blocked) {
      json(res, 200, {
        ok: false, gate: blocked,
        why: `开过 ${blocked.need} 张卡、账号满 ${blocked.days} 天才能报名（现在 ${blocked.have} 张）。`,
      })
      return
    }
    const mine = await sql`
      select a.id_hash, a.name, a.state->'squad' as squad,
        (select jsonb_object_agg(k, a.state->'cards'->k->'level')
           from jsonb_array_elements_text(
             (case when jsonb_typeof(a.state->'squad'->'slots') = 'array'
                   then a.state->'squad'->'slots' else '[]'::jsonb end)
             || jsonb_build_array(a.state->'squad'->'coach')) as k
          where k is not null) as levels
      from card_accounts a where a.id_hash = ${me}`
    const five = mine.length ? fiveOf(mine[0]) : null
    if (!five) { json(res, 200, { ok: false, why: '先凑齐五个人。' }); return }
    const open = await sql`
      select id::text as id, starts from open_cups
       where status = 'open' and starts > ${new Date(now)} order by starts limit 1`
    if (!open.length) { json(res, 200, { ok: false, why: '现在没有可以报名的比赛，稍后再试。' }); return }
    const full = await sql`select count(*)::int as n from open_cup_entries where cup_id = ${open[0].id}`
    if ((full[0]?.n ?? 0) >= engine.OPEN_CUP_MAX) { json(res, 200, { ok: false, why: '这一场报满了，下一场再来。' }); return }
    await sql`
      insert into open_cup_entries (cup_id, id_hash, name) values (${open[0].id}, ${me}, ${mine[0].name ?? null})
      on conflict (cup_id, id_hash) do nothing`
    publicCache.at = 0
    mineCache.delete(me)
    json(res, 200, { ok: true, cup: open[0].id, starts: ms(open[0].starts), score: five.score })
  }

  async function leave(req, res, bucket) {
    if (guard(req, res, `ocj:${bucket}`, 30)) return
    const { me } = await readMe(req)
    if (!me) { json(res, 400, { ok: false, bad: true }); return }
    // only out of a cup that has not started: once the fives are read, the bracket is the bracket
    await sql`
      delete from open_cup_entries e using open_cups c
       where c.id = e.cup_id and c.status = 'open' and c.starts > ${new Date(clock())} and e.id_hash = ${me}`
    publicCache.at = 0
    mineCache.delete(me)
    json(res, 200, { ok: true })
  }

  /** One tie: the maps, both scoreboards, both fives. */
  async function match(req, res, bucket) {
    if (guard(req, res, `ocm:${bucket}`, 60)) return
    const { body } = await readMe(req)
    const id = cupId(body?.cup)
    const round = smallInt(body?.round)
    const slot = smallInt(body?.slot)
    if (!id || round === null || slot === null) { json(res, 400, { ok: false, bad: true }); return }
    const rows = await sql`
      select m.a, m.b, m.winner, m.maps_a, m.maps_b, m.detail, c.rounds
        from open_cup_matches m join open_cups c on c.id = m.cup_id
       where m.cup_id = ${id} and m.round = ${round} and m.slot = ${slot}`
    const m = rows[0]
    if (!m || !m.winner || !m.b) { json(res, 200, { ok: false, why: '这场还没打。' }); return }
    if (!m.detail) { json(res, 200, { ok: false, why: '这场比赛的详情已经过期。' }); return }
    const sides = await sql`
      select id_hash, name, five, score from open_cup_entries
       where cup_id = ${id} and id_hash in (${m.a}, ${m.b})`
    const side = (h) => {
      const e = sides.find((x) => x.id_hash === h)
      return e ? { ...who(e.name, e.id_hash), five: e.five, score: e.score } : null
    }
    json(res, 200, {
      ok: true, round, rounds: m.rounds, aWon: m.winner === m.a, mapsA: m.maps_a, mapsB: m.maps_b,
      a: side(m.a), b: side(m.b), detail: m.detail,
    })
  }

  /** A finished cup by id, for the 「往届」 list: its late rounds and the asker's own run. */
  async function cup(req, res, bucket) {
    if (guard(req, res, `ocm:${bucket}`, 60)) return
    const { body, me } = await readMe(req)
    const id = cupId(body?.cup)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const rows = await sql`
      select id::text as id, starts, status, round, rounds, step_sec, entrants, champion
        from open_cups where id = ${id}`
    const c = rows[0]
    if (!c) { json(res, 200, { ok: false, why: '没有这一场。' }); return }
    json(res, 200, { ok: true, cup: { ...cupRow(c), top: await topOf(c), me: await mineIn(c, me) } })
  }

  return {
    advance,
    /** forget what was cached — for checks that move the clock */
    invalidate() { publicCache.at = 0; boardCache.at = 0; ensureOpen.known = undefined; mineCache.clear(); advancedAt = 0; prunedAt = 0 },
    async route(req, res, path, bucket) {
      if (!sql) { json(res, 200, { ok: false, offline: true }); return true }
      if (path === '/api/card/opencup') { await state(req, res, bucket); return true }
      if (path === '/api/card/opencup/join') { await join(req, res, bucket); return true }
      if (path === '/api/card/opencup/leave') { await leave(req, res, bucket); return true }
      if (path === '/api/card/opencup/match') { await match(req, res, bucket); return true }
      if (path === '/api/card/opencup/cup') { await cup(req, res, bucket); return true }
      return false
    },
  }
}
