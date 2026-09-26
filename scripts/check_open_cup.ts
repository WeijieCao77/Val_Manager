/**
 * 全服杯, end to end: the pure bracket rules, then the real server module on
 * an in-process Postgres — sign-up gates, the snapshot at the start, a round
 * every quarter of an hour, byes, two processes racing every round, a process
 * that was down for hours, the purse paid exactly once, the 冠军榜, and what
 * the API will and will not say.
 *
 *   npx tsx scripts/check_open_cup.ts
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { newGacha } from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import {
  OPEN_CUP_EVERY_MS, OPEN_CUP_MIN, OPEN_CUP_RANKED_MIN, OPEN_CUP_STEP_SEC, OPEN_CUP_WIN_COINS,
  openCupMatchSeed, openCupPlacePrize, openCupPurse, openCupRoundAt, openCupSlot, pairOpenCupRound,
  planOpenCup, playOpenCupMatch,
} from '../src/engine/openCup'
import type { RivalSquad } from '../src/engine/arena'
import { Rng } from '../src/engine/rng'

const { CARD_SCHEMA, makeCardApi, normalizeId } = await import('../cards-api.js')
const { TRADE_PULLS } = await import('../market-api.js')
const { OPEN_CUP_SCHEMA, OPEN_CUP_V2_SCHEMA, makeOpenCupApi } = await import('../opencup-api.js')
const { displayName } = await import('../names.js')
const engine = await import('../src/engine/server.ts')

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

// ------------------------------------------------------------ the rules

{
  const H = 60 * 60 * 1000
  const t = Date.parse('2026-09-17T03:20:00Z')
  check('下一场在下一个偶数整点', openCupSlot(t) === Date.parse('2026-09-17T04:00:00Z'))
  check('正好整点时，报名的是再下一场', openCupSlot(Date.parse('2026-09-17T04:00:00Z')) === Date.parse('2026-09-17T06:00:00Z'))
  check('上海时间也是偶数整点', new Date(openCupSlot(t) + 8 * H).getUTCHours() % 2 === 0)

  let planOk = true, fits = true
  for (let n = 2; n <= 4096; n++) {
    const p = planOpenCup(n)
    let left = n, rounds = 0
    while (left > 1) { left = Math.ceil(left / 2); rounds++ }
    if (rounds !== p.rounds) planOk = false
    if (p.stepSec > OPEN_CUP_STEP_SEC || p.stepSec < 300 || (p.rounds - 1) * p.stepSec > 105 * 60) fits = false
  }
  check('2～4096 人：正好 ⌈log₂n⌉ 轮决出冠军', planOk)
  check('决赛总在下一场开赛前打完，间隔 5～15 分钟', fits)
  check('100 人是 7 轮、每 15 分钟一轮', planOpenCup(100).rounds === 7 && planOpenCup(100).stepSec === 900)
  check('256 人以内都是 15 分钟一轮', planOpenCup(256).stepSec === 900 && planOpenCup(257).stepSec < 900)
  check('第 k 轮的时间', openCupRoundAt(1000, 900, 3) === 1000 + 3 * 900_000)

  // every bracket size: everybody is in exactly one tie or through on a bye, byes
  // happen in the first round only, and from the second round on the field is a power of two
  const rng = new Rng(20260917)
  let once = true, byeFirstOnly = true, orderFree = true, depth = true
  const pow2 = (n: number) => (n & (n - 1)) === 0
  for (let trial = 0; trial < 400; trial++) {
    const n = 4 + Math.floor(rng.next() * 300)
    let seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, byes: 0 }))
    const seed = Math.floor(rng.next() * 2 ** 31)
    let round = 0
    for (; seats.length > 1; round++) {
      const { pairs, byes } = pairOpenCupRound(seats, seed, round)
      const again = pairOpenCupRound(seats.slice().reverse(), seed, round)
      if (JSON.stringify(again) !== JSON.stringify({ pairs, byes })) orderFree = false
      const seen = [...pairs.flat(), ...byes]
      if (seen.length !== seats.length || new Set(seen).size !== seats.length) once = false
      if (round > 0 && (byes.length || !pow2(seats.length))) byeFirstOnly = false
      if (round === 0 && pow2(n) && byes.length) byeFirstOnly = false
      const through = new Set([...pairs.map(([a, b]) => (rng.next() < 0.5 ? a : b)), ...byes])
      seats = seats.filter((s) => through.has(s.id)).map((s) => ({ ...s, byes: s.byes + (byes.includes(s.id) ? 1 : 0) }))
    }
    if (round !== planOpenCup(n).rounds) depth = false
  }
  check('每一轮每个人恰好出现一次', once)
  check('轮空只在第一轮，第二轮起人数是 2 的整数次方（没有人轮空进决赛）', byeFirstOnly)
  check('打出来的轮数和计划的一样', depth)
  check('配对与读出的顺序无关（两个进程算出同一张表）', orderFree)
  {
    const p = pairOpenCupRound(Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, byes: 0 })), 5, 0)
    check('20 人：第一轮 4 场、12 人轮空，剩 16 人', p.pairs.length === 4 && p.byes.length === 12)
    const q = pairOpenCupRound(Array.from({ length: 100 }, (_, i) => ({ id: `q${i}`, byes: 0 })), 5, 0)
    check('100 人：第一轮 36 场、28 人轮空，剩 64 人', q.pairs.length === 36 && q.byes.length === 28)
  }

  const asRival = (i: number): RivalSquad => ({
    name: CUP_TEAMS[i].name, tag: CUP_TEAMS[i].tag, slots: CUP_TEAMS[i].squad.slots, coach: CUP_TEAMS[i].squad.coach,
    levels: {}, div: 0, points: 0,
  })
  const r1 = playOpenCupMatch(asRival(3), asRival(9), false, 4242)
  const r2 = playOpenCupMatch(asRival(3), asRival(9), false, 4242)
  check('同一个种子，同一场比赛', JSON.stringify(r1) === JSON.stringify(r2))
  check('BO3 打到两胜，决赛 BO5 打到三胜',
    Math.max(r1.mapsA, r1.mapsB) === 2 && Math.max(...(() => { const f = playOpenCupMatch(asRival(3), asRival(9), true, 7); return [f.mapsA, f.mapsB] })()) === 3)
  check('比赛详情带地图比分和双方数据', r1.detail.maps.length === r1.mapsA + r1.mapsB && r1.detail.a.lines.length === 5 && r1.detail.b.lines.length === 5)
  let aWins = 0
  const N = 300
  for (let i = 0; i < N; i++) if (playOpenCupMatch(asRival(20), asRival(20), false, openCupMatchSeed(99, 0, i)).aWon) aWins++
  check('同一套阵容坐哪边都一样（镜像 300 场 40%～60%）', aWins / N > 0.4 && aWins / N < 0.6, `${aWins}/${N}`)

  let mono = true
  for (const place of [1, 2, 4] as const) {
    let prev = -1
    for (const n of [4, 8, 16, 32, 500]) {
      const p = openCupPlacePrize(n, place)
      const worth = p.coins + ({ ten: 5000, elite: 2000, scout: 800 } as Record<string, number>)[p.pack ?? ''] || p.coins
      if (worth < prev) mono = false
      prev = worth
    }
  }
  check('人越多奖励越高，冠军 > 亚军 > 四强', mono
    && openCupPlacePrize(64, 1).coins > openCupPlacePrize(64, 2).coins && openCupPlacePrize(64, 2).coins > openCupPlacePrize(64, 4).coins)
  check('4～7 人的小场没有卡包，只有金币', !openCupPlacePrize(7, 1).pack && !openCupPlacePrize(7, 2).pack)
  check('没赢过的人什么都拿不到', openCupPurse(100, 0, null).coins === 0 && !openCupPurse(100, 0, null).pack)
  check('每赢一场的金币', openCupPurse(100, 3, null).coins === 3 * OPEN_CUP_WIN_COINS)
}

// ------------------------------------------------------------ the server

const db = new PGlite(), sql = makeSql(db)
await db.exec(CARD_SCHEMA)
await db.exec(OPEN_CUP_SCHEMA)
await db.exec(OPEN_CUP_V2_SCHEMA)
type Body = Record<string, any>
type Reply = { code: number; body: Body }
const json = (res: Reply, code: number, body: Body) => { res.code = code; res.body = body }
const readBody = async (req: { body: string }) => req.body
const cards = makeCardApi(sql, { rateLimited: () => false, readBody, json } as never)
let now = Date.parse('2026-09-17T03:20:00Z')
const mk = () => makeOpenCupApi(sql, {
  readBody, json, normalizeId, displayName, rateLimited: () => false, engine, clock: () => now, timer: false,
} as never)
// two of them on one database: the two containers of a deploy
const api = mk(), twin = mk()
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
async function call(path: string, body: unknown, via = api): Promise<Reply> {
  const out: Reply = { code: 0, body: { ok: false } }
  const handler = path.startsWith('/api/card/opencup') ? via : cards
  await handler.route({ method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) } as never, out as never, path, 'open-cup-test')
  return out
}
const today = new Date(now).toISOString().slice(0, 10)
const idOf = (i: number) => {
  const a = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const s = `${a[Math.floor(i / 32) % 32]}${a[i % 32]}`
  return `VM-CVP${s[0]}-CVP${s[1]}-CVPA-CVPA-CVPA`
}
async function account(i: number, opts: { pulls?: number; days?: number; team?: number } = {}) {
  const id = idOf(i)
  const made = await call('/api/card/claim', { id, name: `选手${i}` })
  if (!made.body.ok) throw new Error(`claim ${i}: ${JSON.stringify(made.body)}`)
  const g: GachaState = newGacha(id, `选手${i}`, today)
  const team = CUP_TEAMS[(opts.team ?? i) % CUP_TEAMS.length]
  const ids = [...team.squad.slots, team.squad.coach].filter((x): x is string => !!x)
  g.cards = Object.fromEntries(ids.map((c) => [c, { id: c, level: i % 3, dupes: 0, seen: 1, got: today }]))
  g.squad = structuredClone(team.squad)
  g.pulls = opts.pulls ?? TRADE_PULLS + 5
  await sql`update card_accounts set state = ${sql.json(g)}, created = now() - make_interval(days => ${opts.days ?? 5})
             where id_hash = ${hash(id)}`
  return id
}
const stored = async (id: string): Promise<GachaState> => (await sql`select state from card_accounts where id_hash = ${hash(id)}`)[0].state
const setState = (id: string, g: GachaState) => sql`update card_accounts set state = ${sql.json(g)} where id_hash = ${hash(id)}`
const MIN = 60_000

try {
  // ---- sign-up
  const fresh = await account(900, { days: 0 })
  const idle = await account(901, { pulls: 10 })
  const flagged = await account(902)
  await sql`update card_accounts set suspect = true where id_hash = ${hash(flagged)}`
  const short = await account(903)
  { const g = await stored(short); g.squad.slots[2] = null; await setState(short, g) }

  let r = await call('/api/card/opencup/join', { id: fresh })
  check('今天才建的号不能报名', !r.body.ok && /满 3 天/.test(r.body.why ?? ''), r.body.why)
  r = await call('/api/card/opencup/join', { id: idle })
  check('开卡不到 50 张不能报名', !r.body.ok && r.body.gate?.have === 10, r.body.why)
  r = await call('/api/card/opencup/join', { id: flagged })
  check('被标记的账号不能报名', !r.body.ok)
  r = await call('/api/card/opencup/join', { id: short })
  check('不满五人不能报名', !r.body.ok && /五个人/.test(r.body.why ?? ''), r.body.why)
  r = await call('/api/card/opencup/join', { id: 'VM-NOPE' })
  check('乱写的账号是 400', r.code === 400)
  r = await call('/api/card/opencup/join', { id: idOf(999) })
  check('不存在的账号报不了名', !r.body.ok && r.body.missing === true)
  r = await call('/api/card/opencup/join', '{not json')
  check('坏的请求体是 400，不是 500', r.code === 400)

  const FIELD = 37
  const ids: string[] = []
  for (let i = 0; i < FIELD; i++) ids.push(await account(i))
  for (const id of ids) {
    const j = await call('/api/card/opencup/join', { id })
    if (!j.body.ok) throw new Error(`join: ${JSON.stringify(j.body)}`)
  }
  await call('/api/card/opencup/join', { id: ids[0] })
  await call('/api/card/opencup/join', { id: ids[0] }, twin)
  const T = openCupSlot(now)
  let st = (await call('/api/card/opencup', { id: ids[0] })).body
  check('报两次还是一个名额', st.next?.signed === FIELD && st.next?.joined === true, `${st.next?.signed}`)
  check('报名的是下一个偶数整点那场', st.next?.starts === T)
  await call('/api/card/opencup/leave', { id: ids[36] })
  st = (await call('/api/card/opencup', { id: ids[36] })).body
  check('开赛前可以退赛', st.next?.signed === FIELD - 1 && st.next?.joined === false)
  await call('/api/card/opencup/join', { id: ids[36] })

  // between sign-up and the start: one five is broken up, one card changes hands
  { const g = await stored(ids[35]); g.squad.slots[0] = null; await setState(ids[35], g) }
  const moved = (await stored(ids[34])).squad.slots[1]!
  {
    const from = await stored(ids[34]); delete from.cards[moved]; await setState(ids[34], from)
    const to = await stored(ids[33]); to.cards[moved] = { id: moved, level: 0, dupes: 0, seen: 1, got: today } as never
    to.squad.slots[1] = moved; await setState(ids[33], to)
  }

  // ---- the start, raced by two processes
  now = T - 1000
  await Promise.all([api.advance(now), twin.advance(now)])
  check('没到点不开赛', (await sql`select status from open_cups where starts = ${new Date(T)}`)[0].status === 'open')
  now = T
  await Promise.all([api.advance(now), twin.advance(now)])
  const cupRow = async () => (await sql`select id::text as id, status, round, rounds, step_sec, entrants, champion from open_cups where starts = ${new Date(T)}`)[0]
  let cup = await cupRow()
  const FIELDED = FIELD - 2
  check('到点开赛，阵容不完整的两个号不进签表', cup.status === 'live' && cup.entrants === FIELDED, `${cup.status} ${cup.entrants}`)
  const left = await sql`select id_hash, out_round, alive, five from open_cup_entries where cup_id = ${cup.id} and out_round = -1`
  check('他们记为未参赛', left.length === 2 && left.every((e: any) => !e.alive && !e.five)
    && left.map((e: any) => e.id_hash).sort().join() === [hash(ids[35]), hash(ids[34])].sort().join())
  const fives = await sql`select id_hash, five from open_cup_entries where cup_id = ${cup.id} and five is not null`
  const holders = fives.filter((e: any) => [...e.five.slots, e.five.coach].includes(moved) && e.id_hash !== hash(ids[34]))
  check('转手的卡只在现在持有它的人的阵容里', !fives.some((e: any) => e.id_hash === hash(ids[34]))
    && holders.length === 1 && holders[0].id_hash === hash(ids[33]), `${holders.length}`)
  check('轮数和间隔按参赛人数定', cup.rounds === planOpenCup(FIELDED).rounds && cup.step_sec === planOpenCup(FIELDED).stepSec)
  check('开赛当时就打完第一轮，只打第一轮', cup.round === 1, `${cup.round}`)
  const dupMatches = await sql`select count(*)::int as n from open_cup_matches where cup_id = ${cup.id} and round = 0`
  check('两个进程同时推进，第一轮也只有一份（3 场 + 29 个轮空）', dupMatches[0].n === 32, `${dupMatches[0].n}`)

  r = await call('/api/card/opencup/join', { id: ids[2] })
  check('开赛后报名报的是下一场', r.body.ok && r.body.starts === T + OPEN_CUP_EVERY_MS, JSON.stringify(r.body))
  await call('/api/card/opencup/leave', { id: ids[0] })
  check('开赛后退不了这一场', (await sql`select 1 from open_cup_entries where cup_id = ${cup.id} and id_hash = ${hash(ids[0])}`).length === 1)

  // the five is fixed at the start: changing it now changes nothing
  const frozen = (await sql`select five from open_cup_entries where cup_id = ${cup.id} and id_hash = ${hash(ids[1])}`)[0].five
  { const g = await stored(ids[1]); g.squad.slots[0] = null; await setState(ids[1], g) }

  st = (await call('/api/card/opencup', { id: ids[0] })).body
  check('进行中：轮次、剩余人数、下一轮时间', st.live?.round === 1 && st.live?.alive === 32
    && st.live?.nextAt === T + cup.step_sec * 1000, JSON.stringify({ r: st.live?.round, a: st.live?.alive }))
  const mine = st.live?.me
  check('我的对阵：打完的一场，和下一轮的对手（如果还活着）',
    !!mine && mine.matches.length === (mine.alive ? 2 : 1) && mine.matches[0].played === true
    && (!mine.alive || mine.matches[1].played === false))

  // ---- a round every quarter of an hour, each one raced
  now = T + 14 * MIN + 59_000
  await Promise.all([api.advance(now), twin.advance(now)])
  check('差一秒不到 15 分钟，不打第二轮', (await cupRow()).round === 1)
  for (let k = 1; k < cup.rounds; k++) {
    now = T + k * cup.step_sec * 1000
    await Promise.all([api.advance(now), twin.advance(now), api.advance(now)])
    const c = await cupRow()
    if (c.round !== k + 1) { check(`第 ${k + 1} 轮按时打完`, false, `round=${c.round}`); break }
  }
  cup = await cupRow()
  check('决赛打完，产生冠军', cup.status === 'done' && !!cup.champion && cup.round === cup.rounds, JSON.stringify(cup))

  const entries = await sql`select id_hash, alive, wins, byes, out_round, place, five from open_cup_entries where cup_id = ${cup.id} and five is not null`
  const matches = await sql`select round, slot, a, b, winner, maps_a, maps_b, detail from open_cup_matches where cup_id = ${cup.id} order by round, slot`
  const real = matches.filter((m: any) => m.b)
  check('总场次 = 人数 − 1', real.length === FIELDED - 1, `${real.length}`)
  check('每场都有胜者、比分和详情', real.every((m: any) => (m.winner === m.a || m.winner === m.b) && m.detail?.maps?.length === m.maps_a + m.maps_b))
  const losses = new Map<string, number>()
  for (const m of real) { const l = m.winner === m.a ? m.b : m.a; losses.set(l, (losses.get(l) ?? 0) + 1) }
  check('每个人恰好输一次，冠军一次没输',
    entries.every((e: any) => (e.id_hash === cup.champion ? !losses.has(e.id_hash) : losses.get(e.id_hash) === 1)))
  check('只剩冠军还活着', entries.filter((e: any) => e.alive).length === 1 && entries.find((e: any) => e.alive)!.id_hash === cup.champion)
  check('胜场总数 = 总场次', entries.reduce((s: number, e: any) => s + e.wins, 0) === real.length)
  check('名次：一个冠军、一个亚军、至多两个四强',
    entries.filter((e: any) => e.place === 1).length === 1 && entries.filter((e: any) => e.place === 2).length === 1
    && entries.filter((e: any) => e.place === 4).length <= 2 && entries.filter((e: any) => e.place === 4).length >= 1)
  check('没有人轮空两次', Math.max(...entries.map((e: any) => e.byes)) <= 1 && entries.filter((e: any) => e.byes === 1).length === 29)
  const after = (await sql`select five from open_cup_entries where cup_id = ${cup.id} and id_hash = ${hash(ids[1])}`)[0].five
  check('开赛后改阵容不影响本场', JSON.stringify(after) === JSON.stringify(frozen))
  // every recorded match is the match the rules say it is — nothing was made up on the way to the table
  const byHash = new Map(entries.map((e: any) => [e.id_hash, e]))
  const seedRow = (await sql`select seed::text as seed from open_cups where id = ${cup.id}`)[0]
  let replayOk = true
  for (const m of real.slice(0, 6)) {
    const side = (h: string): RivalSquad => ({ name: 'x', tag: 'x', ...byHash.get(h)!.five, div: 0, points: 0 })
    const again = playOpenCupMatch(side(m.a), side(m.b), m.round === cup.rounds - 1, openCupMatchSeed(Number(seedRow.seed), m.round, m.slot))
    if ((again.aWon ? m.a : m.b) !== m.winner || again.mapsA !== m.maps_a) replayOk = false
  }
  check('记录的赛果能用种子原样重算出来', replayOk)

  // ---- the purse: once
  const mailRows = async () => sql`select to_h, coins, pack, body from card_mail where kind = 'open_cup'`
  let mail = await mailRows()
  const expect = new Map(entries.map((e: any) => [e.id_hash, openCupPurse(FIELDED, e.wins, e.place)]))
  check('每个赢过的人一封邮件，没赢的没有', mail.length === entries.filter((e: any) => e.wins > 0 || e.place).length
    && new Set(mail.map((m: any) => m.to_h)).size === mail.length, `${mail.length}`)
  check('金额和卡包与奖励表一致', mail.every((m: any) => expect.get(m.to_h)!.coins === m.coins && (expect.get(m.to_h)!.pack ?? null) === m.pack))
  now += 5 * MIN
  await Promise.all([api.advance(now), twin.advance(now)])
  now += 3 * 60 * MIN
  await Promise.all([api.advance(now), twin.advance(now)])
  mail = await mailRows()
  check('之后怎么推进都不会再发一次', mail.length === expect.size - [...expect.values()].filter((p) => !p.coins && !p.pack).length)
  const champId = ids.find((id) => hash(id) === cup.champion)!
  const before = await stored(champId)
  const took = await call('/api/card/act', { id: champId, action: 'mail_take', args: {}, client: {} })
  const afterMail = await stored(champId)
  const champPrize = expect.get(cup.champion)!
  check('冠军从信箱领到奖励', took.body.ok && afterMail.coins - before.coins === champPrize.coins
    && (afterMail.packs[champPrize.pack!] ?? 0) - (before.packs[champPrize.pack!] ?? 0) === 1, JSON.stringify(took.body.why ?? ''))
  check('信箱里写的是全服杯冠军', (afterMail.mail ?? []).some((m) => /全服杯冠军/.test(m.text)), (afterMail.mail ?? [])[0]?.text)
  const again = await call('/api/card/act', { id: champId, action: 'mail_take', args: {}, client: {} })
  check('领过不能再领', (await stored(champId)).coins === afterMail.coins && again.body.ok)

  // ---- too few: no cup, no purse, no title
  api.invalidate(); twin.invalidate()
  const T2 = openCupSlot(now)
  for (const id of ids.slice(0, OPEN_CUP_MIN - 1)) await call('/api/card/opencup/join', { id })
  now = T2
  await api.advance(now)
  const small = (await sql`select status, entrants, champion from open_cups where starts = ${new Date(T2)}`)[0]
  check(`不足 ${OPEN_CUP_MIN} 人的一场取消`, small.status === 'void' && !small.champion, JSON.stringify(small))
  check('取消的一场不发任何东西', (await mailRows()).length === mail.length)

  // ---- a process that was down through a whole cup catches up in one go
  api.invalidate(); twin.invalidate()
  const T3 = openCupSlot(now)
  for (const id of [...ids.slice(2, 8), ids[0]]) await call('/api/card/opencup/join', { id })
  now = T3 + 5 * 60 * MIN
  await Promise.all([api.advance(now), twin.advance(now)])
  const late = (await sql`select status, entrants, round, rounds, champion from open_cups where starts = ${new Date(T3)}`)[0]
  check('停机几个小时后，一次推进把整场补打完', late.status === 'done' && late.round === late.rounds && !!late.champion, JSON.stringify(late))

  // ---- 冠军榜
  st = (await call('/api/card/opencup', { id: champId })).body
  const row = st.boards.all.find((x: any) => x.me)
  check('37 人那场的冠军上了总榜', !!row && row.titles >= 1, JSON.stringify(st.boards.all))
  check('7 人的小场不计入冠军榜', late.entrants < OPEN_CUP_RANKED_MIN
    && st.boards.all.reduce((s: number, x: any) => s + x.titles, 0) === 1, JSON.stringify(st.boards.all))
  check('我的冠军数', st.titles?.all === 1)
  check('往届列表里有冠军名字，取消的一场标了取消',
    st.recent.some((c: any) => c.champion?.name) && st.recent.some((c: any) => c.void))
  // 往届夺冠阵容: each past champion carries the five it won with, cards and levels only
  const withFive = st.recent.filter((c: any) => c.champion?.name)
  check('往届冠军都带着夺冠阵容（五人 + 教练 + 等级）',
    withFive.length > 0 && withFive.every((c: any) => Array.isArray(c.champion.five?.slots) && c.champion.five.slots.length === 5
      && typeof c.champion.five.levels === 'object' && !('paper' in c.champion.five)), JSON.stringify(withFive[0]?.champion))

  // ---- what the API says
  const firstReal = real[0]
  r = await call('/api/card/opencup/match', { cup: cup.id, round: firstReal.round, slot: firstReal.slot })
  check('比赛详情：双方阵容、地图、数据', r.body.ok && r.body.a?.five?.slots?.length === 5 && r.body.detail?.maps?.length >= 2)
  r = await call('/api/card/opencup/cup', { cup: cup.id, id: champId })
  check('往届：后三轮对阵和我的战绩', r.body.ok && r.body.cup.top.length >= 3 && r.body.cup.me?.place === 1)
  const everything = JSON.stringify([
    st, r.body, (await call('/api/card/opencup', {})).body,
    (await call('/api/card/opencup/match', { cup: cup.id, round: 0, slot: 0 })).body,
  ])
  check('任何返回里都没有账号哈希', !/[0-9a-f]{64}/.test(everything) && !/VM-[0-9A-Z]{4}-/.test(everything))
  for (const bodyIn of [{ cup: 'abc', round: 0, slot: 0 }, { cup: cup.id, round: -1, slot: 0 }, { cup: cup.id, round: 0.5, slot: 0 },
    { cup: cup.id, round: 0, slot: 1e9 }, { cup: `${cup.id};drop table open_cups`, round: 0, slot: 0 }, { cup: cup.id }]) {
    const x = await call('/api/card/opencup/match', bodyIn)
    if (x.code !== 400) { check('坏参数一律 400', false, JSON.stringify(bodyIn)); break }
  }
  check('表还在', (await sql`select count(*)::int as n from open_cups`)[0].n >= 3)
  // ---- what is kept
  const kept = (await sql`select count(*)::int as n from open_cup_matches where cup_id = ${cup.id}`)[0].n
  api.invalidate()
  now += 4 * 86_400_000
  await api.advance(now)
  const thin = await sql`select count(*)::int as n, count(detail)::int as d from open_cup_matches where cup_id = ${cup.id}`
  check('三天后比赛详情清掉，对阵还在', thin[0].n === kept && thin[0].d === 0, JSON.stringify(thin[0]))
  r = await call('/api/card/opencup/match', { cup: cup.id, round: firstReal.round, slot: firstReal.slot })
  check('过期的详情说过期，不报错', !r.body.ok && /过期/.test(r.body.why ?? ''))
  api.invalidate()
  now += 12 * 86_400_000
  await api.advance(now)
  const gone = await sql`select (select count(*)::int from open_cup_matches where cup_id = ${cup.id}) as m, (select count(*)::int from open_cup_entries where cup_id = ${cup.id}) as e`
  check('两周后对阵和报名记录清掉', gone[0].m === 0 && gone[0].e === 0, JSON.stringify(gone[0]))
  api.invalidate()
  st = (await call('/api/card/opencup', { id: champId })).body
  check('冠军榜不受清理影响', st.boards.all.find((x: any) => x.me)?.titles === 1 && st.titles?.all === 1)
  r = await call('/api/card/opencup/cup', { cup: '999999' })
  check('不存在的一场', !r.body.ok && r.code === 200)
} catch (err) {
  console.error(err)
  bad++
}
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
