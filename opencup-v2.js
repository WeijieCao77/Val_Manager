/** Durable Swiss/knockout state machine. Every result and its standings commit together. */
import { randomUUID } from 'node:crypto'

export function makeSwissCupRunner(sql, { engine, rivalOf, simulate }) {
  const tx = (fn) => sql.begin ? sql.begin(fn) : fn(sql)
  const entries = (db, id) => db`select * from open_cup_entries where cup_id = ${id} and five is not null order by id_hash`
  async function insertRound(db, cup, stage, stageRound, pairs, byes = []) {
    const rows = pairs.map(([a, b], slot) => ({ a, b, slot }))
    rows.push(...byes.map((a, i) => ({ a, b: null, slot: pairs.length + i })))
    if (!rows.length) throw new Error('cup round has no entrants')
    await db`insert into open_cup_matches(cup_id, round, slot, a, b, stage, stage_round, bo)
      select ${cup.id}::bigint, ${cup.round}::int, x.slot, x.a, x.b, ${stage}, ${stageRound}::int, ${stage === 'swiss' ? 3 : 5}::int
      from jsonb_to_recordset(${db.json(rows)}::jsonb) as x(a text, b text, slot int) on conflict do nothing`
  }
  async function drawSwiss(db, cup) {
    const rows = await entries(db, cup.id)
    const seats = rows.map((e) => ({ id: e.id_hash, wins: e.swiss_wins, losses: e.swiss_losses, byes: e.byes, floats: e.floats, met: e.met }))
    const plan = engine.pairSwissRound(seats, Number(cup.seed), cup.stage_round)
    await insertRound(db, cup, 'swiss', cup.stage_round, plan.pairs, plan.bye ? [plan.bye] : [])
    if (plan.floated.length) await db`update open_cup_entries set floats = floats + 1 where cup_id = ${cup.id}
      and id_hash in (select jsonb_array_elements_text(${db.json(plan.floated)}::jsonb))`
    if (plan.notes.length) console.warn('opencup pairing', cup.id, cup.round, plan.notes.join('; '))
  }
  async function payout(db, cup) {
    const rows = await entries(db, cup.id)
    const mail = []
    for (const e of rows) {
      const place = [1, 2, 4].includes(e.place) ? e.place : null
      const p = engine.openCupPurse(cup.entrants, 0, place)
      p.coins += e.swiss_real_wins * 20 + e.playoff_wins * 40
      if (p.coins || p.pack) mail.push({ id_hash: e.id_hash, coins: p.coins, pack: p.pack ?? null,
        body: { cup: String(cup.id), entrants: cup.entrants, place, wins: e.wins, swissWins: e.swiss_real_wins, playoffWins: e.playoff_wins, format: 2 } })
    }
    if (!mail.length) return
    // The stable receipt and mail insert are one statement inside the final-stage transaction.
    await db`with receipts as (
      insert into open_cup_payouts(cup_id, id_hash)
      select ${cup.id}::bigint, x.id_hash from jsonb_to_recordset(${db.json(mail)}::jsonb) as x(id_hash text)
      on conflict do nothing returning id_hash
    ) insert into card_mail(to_h, kind, coins, pack, count, body)
      select x.id_hash, 'open_cup', x.coins, x.pack, 1, x.body
      from jsonb_to_recordset(${db.json(mail)}::jsonb) as x(id_hash text, coins int, pack text, body jsonb)
      join receipts r using(id_hash)`
  }
  async function finish(db, cup, champion) {
    if (!champion) throw new Error('cup cannot finish without champion')
    await db`update open_cup_entries set place = 1 where cup_id = ${cup.id} and id_hash = ${champion}`
    await db`update open_cups set status = 'done', phase = 'done', champion = ${champion}, finished = now(), rounds = round where id = ${cup.id}`
    await payout(db, cup)
  }
  async function mainBracket(db, cup, plan) {
    if (plan.lines.some((id) => !id)) throw new Error('playoff line missing')
    if (plan.size === 1) { await finish(db, cup, plan.lines[0]); return }
    await db`update open_cups set phase = 'playoff', stage_round = 0, playoff = ${db.json(plan)}, rounds = ${cup.round + plan.rounds} where id = ${cup.id}`
    await insertRound(db, cup, 'playoff', 0, engine.firstRoundLines(plan.size).map(([a, b]) => [plan.lines[a - 1], plan.lines[b - 1]]))
  }
  async function beginPlayoff(db, cup) {
    const rows = (await entries(db, cup.id)).filter((e) => e.swiss_wins >= 2)
    if (!rows.length) throw new Error('Swiss stage has no qualifiers')
    const plan = engine.planPlayoff(rows.map((e) => ({ id: e.id_hash, swissWins: e.swiss_wins, swissLosses: e.swiss_losses,
      realWins: e.swiss_real_wins, mapDiff: e.map_diff, met: e.met })), Number(cup.seed))
    const seeds = plan.seeds.map((id, i) => ({ id, seed: i + 1 }))
    await db`update open_cup_entries e set playoff_seed = x.seed from jsonb_to_recordset(${db.json(seeds)}::jsonb) as x(id text, seed int)
      where e.cup_id = ${cup.id} and e.id_hash = x.id`
    if (plan.playIn.length) {
      await db`update open_cups set phase = 'playin', stage_round = 0, playoff = ${db.json(plan)}, rounds = ${cup.round + 1 + plan.rounds} where id = ${cup.id}`
      await insertRound(db, cup, 'playin', 0, plan.playIn.map((p) => [p.hi, p.lo]), plan.lines.filter(Boolean))
    } else await mainBracket(db, cup, plan)
  }
  async function advanceRound(cup) {
    return tx(async (db) => {
      const held = await db`select * from open_cups where id = ${cup.id} for update`
      const c = held[0]
      if (!c || c.status !== 'live' || c.round !== cup.round) return false
      const matches = await db`select * from open_cup_matches where cup_id = ${cup.id} and round = ${cup.round} order by slot`
      if (!matches.length || matches.some((m) => !m.winner)) return false
      const next = { ...c, round: c.round + 1 }
      await db`update open_cups set round = ${next.round} where id = ${cup.id}`
      if (c.phase === 'swiss') {
        const waiting = await db`select 1 from open_cup_entries where cup_id = ${cup.id} and five is not null and swiss_wins < 2 and swiss_losses < 2 limit 1`
        if (waiting.length) {
          if (c.stage_round >= 2) throw new Error('Swiss stage did not converge after three rounds')
          next.stage_round = c.stage_round + 1
          await db`update open_cups set stage_round = ${next.stage_round} where id = ${cup.id}`
          await drawSwiss(db, next)
        } else await beginPlayoff(db, next)
      } else if (c.phase === 'playin') {
        const plan = c.playoff
        for (let i = 0; i < plan.playIn.length; i++) plan.lines[plan.playIn[i].line - 1] = matches[i].winner
        await mainBracket(db, next, plan)
      } else {
        const winners = matches.map((m) => m.winner)
        if (winners.length === 1) await finish(db, next, winners[0])
        else {
          await db`update open_cups set stage_round = stage_round + 1 where id = ${cup.id}`
          const pairs = []
          for (let i = 0; i < winners.length; i += 2) pairs.push([winners[i], winners[i + 1]])
          await insertRound(db, next, 'playoff', c.stage_round + 1, pairs)
        }
      }
      return true
    })
  }
  async function claim(cup) {
    const token = randomUUID()
    const rows = await sql`with job as (
      select cup_id, round, slot from open_cup_matches
      where cup_id = ${cup.id} and round = ${cup.round} and winner is null
      and (lease_until is null or lease_until < now())
      order by slot for update skip locked limit 1
    ) update open_cup_matches m set lease_token = ${token}, lease_until = now() + interval '60 seconds', attempts = attempts + 1
      from job j where m.cup_id = j.cup_id and m.round = j.round and m.slot = j.slot returning m.*`
    return rows[0] ?? null
  }
  async function record(cup, m, result) {
    return tx(async (db) => {
      // Match row first; the round barrier only runs once ALL match transactions have committed.
      const winner = !m.b || result.aWon ? m.a : m.b
      const got = await db`update open_cup_matches set winner = ${winner}, maps_a = ${result?.mapsA ?? null}, maps_b = ${result?.mapsB ?? null},
        detail = ${result ? db.json(result.detail) : null}, lease_until = null, lease_token = null, error = null
        where cup_id = ${cup.id} and round = ${cup.round} and slot = ${m.slot} and winner is null and lease_token = ${m.lease_token}
        returning slot`
      if (!got.length) return false
      const isSwiss = m.stage === 'swiss'
      const loser = m.b ? (winner === m.a ? m.b : m.a) : null
      const diff = result ? Math.abs(result.mapsA - result.mapsB) : 0
      const updates = [{ id: winner, win: m.b ? 1 : 0, sw: isSwiss ? 1 : 0, sl: 0, bye: m.b ? 0 : 1,
        rw: isSwiss && m.b ? 1 : 0, pw: !isSwiss && m.b ? 1 : 0, diff, opponent: loser, lost: false }]
      if (loser) updates.push({ id: loser, win: 0, sw: 0, sl: isSwiss ? 1 : 0, bye: 0, rw: 0, pw: 0, diff: -diff, opponent: winner, lost: true })
      const place = m.stage === 'playoff' && cup.playoff?.rounds - m.stage_round === 1 ? 2
        : m.stage === 'playoff' && cup.playoff?.rounds - m.stage_round === 2 ? 4 : null
      await db`update open_cup_entries e set wins = e.wins + x.win, swiss_wins = e.swiss_wins + x.sw, swiss_losses = e.swiss_losses + x.sl,
        byes = e.byes + x.bye, swiss_real_wins = e.swiss_real_wins + x.rw, playoff_wins = e.playoff_wins + x.pw,
        map_diff = e.map_diff + x.diff, met = case when x.opponent is null then e.met else e.met || jsonb_build_array(x.opponent) end,
        alive = case when ${isSwiss} then e.swiss_losses + x.sl < 2 else not x.lost end,
        out_round = case when (${isSwiss} and e.swiss_losses + x.sl >= 2) or (not ${isSwiss} and x.lost) then ${cup.round} else e.out_round end,
        place = case when not ${isSwiss} and x.lost then ${place}::int else e.place end
        from jsonb_to_recordset(${db.json(updates)}::jsonb) as x(id text, win int, sw int, sl int, bye int, rw int, pw int, diff int, opponent text, lost boolean)
        where e.cup_id = ${cup.id} and e.id_hash = x.id`
      return true
    })
  }
  async function tick(cup) {
    const until = Date.now() + 1500
    let moved = false
    for (let i = 0; i < 64 && Date.now() < until; i++) {
      const m = await claim(cup)
      if (!m) break
      try {
        let result = null
        if (m.b) {
          const rows = await sql`select id_hash, name, five from open_cup_entries where cup_id = ${cup.id} and id_hash in (${m.a}, ${m.b})`
          const a = rows.find((e) => e.id_hash === m.a), b = rows.find((e) => e.id_hash === m.b)
          if (!a?.five || !b?.five) throw new Error('frozen entrant missing; refusing fabricated walkover')
          result = await simulate([rivalOf(a), rivalOf(b), m.bo === 5, engine.openCupMatchSeed(Number(cup.seed), cup.round, m.slot), cup.balance_version, [a.five.paper.score, b.five.paper.score]], cup.engine_hash)
          const target = m.bo === 5 ? 3 : 2
          if (!result || Math.max(result.mapsA, result.mapsB) !== target || Math.min(result.mapsA, result.mapsB) >= target
            || result.aWon !== (result.mapsA > result.mapsB) || result.detail?.bo !== m.bo) throw new Error('invalid simulation result')
        }
        moved = (await record(cup, m, result)) || moved
      } catch (error) {
        await sql`update open_cup_matches set error = ${String(error.message).slice(0, 500)}, lease_until = now() + interval '10 seconds'
          where cup_id = ${cup.id} and round = ${cup.round} and slot = ${m.slot} and winner is null and lease_token = ${m.lease_token}`
        console.warn('opencup job failed', cup.id, cup.round, m.slot, error.message)
      }
    }
    return (await advanceRound(cup)) || moved
  }
  return { drawSwiss, tick }
}
