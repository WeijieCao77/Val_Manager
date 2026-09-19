/**
 * 全服组队杯: balanced fives, five duels a tie, one purse a team, paid once.
 *
 *   npx tsx scripts/check_team_cup.ts
 */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { newGacha } from '../src/engine/gacha'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import { TEAM_CUP_HOURS, TEAM_SIZE, TEAM_DUEL_COINS, dealTeams, pairTeamRound, teamCupPrize, teamCupRounds, teamCupSlot, teamLineup } from '../src/engine/teamCup'
import { Rng } from '../src/engine/rng'

// ---------------------------------------------------------------- the rules
{
  const rng = new Rng(7)
  const field = Array.from({ length: 343 }, (_, i) => ({ id: `p${i}`, score: 60 + Math.floor(rng.next() * 47) }))
  const teams = dealTeams(field, 42)
  assert.equal(teams.length, 68)
  assert.deepEqual([...new Set(teams.map((t) => t.length))].sort(), [5, 6], '多出来的三个人各自当某队的第六人')
  assert.equal(teams.flat().length, 343); assert.equal(new Set(teams.flat()).size, 343)
  const score = new Map(field.map((e) => [e.id, e.score]))
  const avg = teams.map((t) => t.slice(0, 5).reduce((s, id) => s + score.get(id)!, 0) / 5).sort((a, b) => a - b)
  assert(avg[avg.length - 1] - avg[0] <= 3, `最强队和最弱队的均分只差 ${(avg[avg.length - 1] - avg[0]).toFixed(1)}`)
  // every team has one from each fifth of the field
  const sorted = field.map((e) => e.score).sort((a, b) => b - a)
  for (const t of teams) t.slice(0, 5).forEach((id, k) => {
    const hi = sorted[k * 68], lo = sorted[(k + 1) * 68 - 1]
    assert(score.get(id)! <= hi && score.get(id)! >= lo, `第 ${k + 1} 个座位来自第 ${k + 1} 档`)
  })
  assert.deepEqual(dealTeams(field, 42), teams, '同一颗种子，同一副牌')
  assert.deepEqual(dealTeams(field.slice().reverse(), 42), teams, '和报名先后无关')
  const six = teams.find((t) => t.length === 6)!, ti = teams.indexOf(six)
  const benched = new Set<string>()
  for (let r = 0; r < 6; r++) {
    const line = teamLineup(six, (id) => score.get(id)!, 42, ti, r)
    assert.equal(line.length, TEAM_SIZE)
    assert.deepEqual(line.map((id) => score.get(id)!), line.map((id) => score.get(id)!).slice().sort((a, b) => b - a), '强的在前')
    benched.add(six.find((id) => !line.includes(id))!)
  }
  assert.equal(benched.size, 6, '第六人轮流坐板凳')
  const first = pairTeamRound(teams.map((_, i) => i), 42, 0)
  assert.deepEqual([first.pairs.length, first.byes.length], [4, 60], '68 队：第一轮 4 场，60 队轮空，之后是 64')
  assert.equal(teamCupRounds(68), 7); assert.equal(teamCupRounds(4), 2); assert.equal(teamCupRounds(8), 3)
  assert.deepEqual(teamCupPrize(68, 1), { coins: 500, pack: 'ten', count: 1 })
  assert.deepEqual(teamCupPrize(68, 2), { coins: 0, pack: 'elite', count: 2 })
  assert.equal(teamCupPrize(6, 8).pack, undefined, '小场子不发八强奖')
  // 09, 13, 17, 21 Shanghai, nothing between 02:00 and 08:00
  const at = (iso: string) => new Date(teamCupSlot(Date.parse(iso)) + 8 * 3600_000).toISOString().slice(11, 16)
  assert.deepEqual([at('2026-09-19T00:30:00Z'), at('2026-09-19T01:00:00Z'), at('2026-09-19T13:30:00Z'), at('2026-09-19T18:00:00Z')], ['09:00', '13:00', '09:00', '09:00'])
  assert(TEAM_CUP_HOURS.every((h) => h >= 8 || h < 2))
  console.log('ok  规则：每队每档一人、强弱差 ≤3 分、第六人轮换、轮空全在第一轮、一天四场避开凌晨')
}

// ---------------------------------------------------------------- the whole cup on the real server module
const { CARD_SCHEMA, engine } = await import('../cards-api.js')
const { TEAM_CUP_SCHEMA, makeTeamCupApi } = await import('../teamcup-api.js')
const { displayName } = await import('../names.js')
const db = new PGlite(), sql = makeSql(db)
await db.exec(CARD_SCHEMA); await db.exec(TEAM_CUP_SCHEMA)
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
let now = Date.parse('2026-09-19T00:10:00Z')   // 08:10 Shanghai: the 09:00 cup is open
let played = 0
const api = makeTeamCupApi(sql, {
  engine, displayName, normalizeId: (v: unknown) => (typeof v === 'string' ? v : null), rateLimited: () => false, timer: false, minDays: 0,
  clock: () => now, compute: async (args: unknown[]) => { played++; return (engine as any).playOpenCupMatch(...args) },
  readBody: async (req: { body: unknown }) => JSON.stringify(req.body),
  json: (res: { body?: any }, _c: number, body: any) => { res.body = body },
} as never)
const call = async (path: string, body: object) => { const res: { body?: any } = {}; await api.route({ body }, res, `/api/card/teamcup${path}`, 't'); return res.body }
const N = 47
const ids = Array.from({ length: N }, (_, i) => `VM-TEAM-0000-0000-0000-${String(i).padStart(4, '0')}`)
const today = '2026-09-19'
for (let i = 0; i < N; i++) {
  const g = newGacha(ids[i], `队员${i}`, today), t = CUP_TEAMS[(i * 7) % CUP_TEAMS.length]
  g.pulls = 200; g.squad = structuredClone(t.squad)
  for (const c of [...t.squad.slots, t.squad.coach].filter(Boolean) as string[]) g.cards[c] = { id: c, level: i % 6, dupes: 0, seen: 1, got: today }
  await sql`insert into card_accounts (id_hash, name, state, created, verified) values (${hash(ids[i])}, ${`队员${i}`}, ${sql.json(g)}, now() - interval '9 days', now())`
}
const broke = 'VM-TEAM-0000-0000-0000-9999'
await sql`insert into card_accounts (id_hash, name, state, created, verified) values (${hash(broke)}, '没阵容', ${sql.json(newGacha(broke, '没阵容', today))}, now() - interval '9 days', now())`
assert.match((await call('/join', { id: broke })).why, /凑齐五个人|开过/)
for (const id of ids) assert((await call('/join', { id })).ok)
assert((await call('/join', { id: ids[0] })).already, '重复报名不占第二个位置')
assert((await call('/leave', { id: ids[46] })).ok); assert((await call('/join', { id: ids[46] })).ok)
let s = await call('', { id: ids[0] })
assert.deepEqual([s.next.signed, s.next.joined, s.size], [N, true, 5])
console.log('ok  报名、重复报名、退赛、没阵容的报不上')

now = Date.parse('2026-09-19T01:00:01Z')
await api.advance(now)
s = await call('', { id: ids[0] })
if (!s.live) console.log('no live cup:', JSON.stringify(await sql`select id, starts, status, entrants, teams from team_cups order by id`), JSON.stringify(s.next))
assert.deepEqual([s.live.teams, s.live.entrants, s.live.rounds], [9, 47, 4], '47 人 → 9 队（两队有第六人），4 轮')
assert(s.live.me.seated && s.live.me.members.length >= 5 && s.live.me.members.some((m: any) => m.me))
assert((await call('/join', { id: ids[1] })).cup !== s.live.id, '开赛以后报的是下一场')
// everything to the end; advance() is safe to call as often as anybody likes
for (let k = 0; k < 8; k++) { now += 8 * 60_000; await api.advance(now); await api.advance(now) }
s = await call('', { id: ids[0] })
assert.equal(s.last?.status, 'done'); assert.equal(s.live, null)
const ties = await sql`select round, team_a, team_b, wins_a, wins_b, winner, duels from team_cup_ties order by round, slot`
for (const t of ties.filter((x: any) => x.team_b !== null)) {
  assert.equal(t.wins_a + t.wins_b, 5); assert.equal(t.duels.length, 5)
  assert.equal(t.winner, t.wins_a >= 3 ? t.team_a : t.team_b, '五场单挑三分定胜负')
}
assert.equal(played, ties.filter((x: any) => x.team_b !== null).length * 5, '每场单挑只算一次，多调几次 advance 不重算')
const e = await sql`select id_hash, team, place, duels, duel_wins from team_cup_entries where team is not null`
const champs = e.filter((x: any) => x.place === 1)
assert(champs.length >= 5 && new Set(champs.map((x: any) => x.team)).size === 1)
assert.equal(e.filter((x: any) => x.place === 2).length >= 5, true)
const mail = await sql`select to_h, coins, pack, count, body from card_mail where kind = 'team_cup'`
assert.equal(new Set(mail.map((m: any) => m.to_h)).size, mail.length, '一人一封')
for (const c of champs) {
  const m = mail.find((x: any) => x.to_h === c.id_hash)!
  assert.deepEqual([m.pack, m.count, m.coins], ['elite', 1, 200 + c.duel_wins * TEAM_DUEL_COINS], '9 队的冠军：全队一样的包，单挑金币各算各的')
}
const loser = e.find((x: any) => !x.place && x.duel_wins > 0)
if (loser) assert.equal(mail.find((x: any) => x.to_h === loser.id_hash)?.coins, loser.duel_wins * TEAM_DUEL_COINS, '队输了，自己赢的单挑照样有金币')
const before = mail.length
await api.advance(now + 60_000)
assert.equal((await sql`select count(*)::int as n from card_mail where kind = 'team_cup'`)[0].n, before, '发奖只发一次')
assert(s.last.final?.champions?.length >= 5 && s.last.me?.ties?.length >= 1)
console.log(`ok  整届：${ties.length} 场对决、${played} 场单挑，三分定胜负，全队同奖，奖只发一次`)
api.close()
await db.close()
