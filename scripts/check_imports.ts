/**
 * The optional import rule: two players from outside the region, per club.
 *
 * Chosen at career start (or toggled in 系统), and binding on everyone — the
 * AI shops under the same rule the player does. It gates acquisitions only:
 * a squad already over the line keeps its players and simply cannot add more.
 * Origin is nationality; a player with none recorded counts as native, because
 * a rule should punish squad-building, never missing data.
 */
import { createNewGame, WORLD_TEAMS, squadOf } from '../src/engine/world'
import { advanceDay, setupSeason } from '../src/engine/season'
import { doTransfer, resolveMyOffer } from '../src/engine/transfer'
import { IMPORT_MAX, importBlock, importCount, isImport } from '../src/engine/imports'
import { Rng } from '../src/engine/rng'
import type { GameState, Player } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (tag: string, limit: boolean, seed = 20260825): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === tag)!.id, '审计', seed)
  g.importLimit = limit
  setupSeason(g)
  return g
}
const bid = (g: GameState, p: Player) => {
  g.finances.balance = 90_000_000
  const o = {
    id: `T${p.id}`, playerId: p.id, fromTeam: p.teamId, toTeam: g.myTeam,
    fee: 5_000_000, salary: p.salary, years: 2, day: g.day, respondOn: g.day,
    status: 'pending' as const,
    terms: { salary: p.salary * 4, years: 2, signingBonus: 0, bonusShare: 0,
      releaseClause: 0, promisedRole: 'star' },
  }
  g.offers.push(o as never)
  return resolveMyOffer(g, o as never, new Rng(3))
}

// ---- with the rule OFF, a fourth import signs like anyone else
{
  const g = mk('EDG', false)
  const me = g.teams[g.myTeam]
  const foreigners = Object.values(g.players)
    .filter((p) => !p.teamId && isImport(p, me)).slice(0, 3)
  check('enough foreign free agents to test with', foreigners.length === 3)
  for (const p of foreigners) {
    p.teamId = g.myTeam
    me.roster.push(p.id)
  }
  check('rule off: three imports live on one roster untouched',
    importCount(g, g.myTeam) >= 3, `${importCount(g, g.myTeam)} 名外援`)
  const fourth = Object.values(g.players).find((p) => p.teamId && p.teamId !== g.myTeam && isImport(p, me))!
  check('rule off: a fourth import is nobody\'s business',
    importBlock(g, g.myTeam, fourth) === null)
}

// ---- with the rule ON, the third import is refused by name
{
  const g = mk('EDG', true)
  const me = g.teams[g.myTeam]
  const foreigners = Object.values(g.players)
    .filter((p) => !p.teamId && isImport(p, me)).slice(0, 2)
  for (const p of foreigners) { p.teamId = g.myTeam; me.roster.push(p.id) }
  check('two imports fit', importCount(g, g.myTeam) === 2)

  const third = Object.values(g.players).find((p) => p.teamId && p.teamId !== g.myTeam && isImport(p, me))!
  const msg = bid(g, third)
  check('the third is refused, and the message says why',
    third.teamId !== g.myTeam && msg.includes('外援名额已满'), `"${msg}"`)

  const native = Object.values(g.players).find((p) =>
    p.teamId && p.teamId !== g.myTeam && !isImport(p, me) && squadOf(g, p.teamId!).length > 5)!
  check('a native signs straight past the quota', importBlock(g, g.myTeam, native) === null)

  // jakee's case: no nationality on record, but his card says 美洲 — the rule
  // must agree with the screen, so his region stands in for his origin
  const jakeeLike = Object.values(g.players)
    .find((p) => !p.nat && !p.teamId && p.region !== me.region)
  check('no nationality but a foreign region card counts as an import',
    !!jakeeLike && isImport(jakeeLike!, me), jakeeLike ? `${jakeeLike.ign}（${jakeeLike.region}）` : '样本缺失')
  const homegrown = Object.values(g.players)
    .find((p) => !p.nat && p.region === me.region)
  check('no nationality and a home region card counts as native',
    !!homegrown && !isImport(homegrown!, me))
}

// ---- grandfathering: turning the rule on never breaks an existing squad
{
  const g = mk('EDG', false)
  const me = g.teams[g.myTeam]
  const foreigners = Object.values(g.players)
    .filter((p) => !p.teamId && isImport(p, me)).slice(0, 3)
  for (const p of foreigners) { p.teamId = g.myTeam; me.roster.push(p.id) }
  g.importLimit = true
  check('three imports survive the rule turning on beneath them',
    importCount(g, g.myTeam) === 3 && me.roster.length === squadOf(g, g.myTeam).length)
  const another = Object.values(g.players).find((p) => p.teamId && p.teamId !== g.myTeam && isImport(p, me))!
  check('but a fourth cannot join', importBlock(g, g.myTeam, another) !== null)
}

// ---- the AI plays TWO seasons inside the rule, across three worlds
for (const seed of [7, 71, 717]) {
  const g = mk('TYL', true, seed)
  const before = new Map(Object.values(g.teams).map((t) => [t.id, importCount(g, t.id)]))
  const rng = new Rng(seed + 1)
  let guard = 0
  while (!g.gameOver && guard++ < 800 && g.year <= 2027) advanceDay(g, rng)
  const over = Object.values(g.teams)
    .filter((t) => importCount(g, t.id) > Math.max(IMPORT_MAX, before.get(t.id) ?? 0))
    .map((t) => `${t.tag}:${importCount(g, t.id)}(初始${before.get(t.id)})`)
  check(`seed ${seed}: two seasons, no AI club buys over the line`,
    over.length === 0, over.slice(0, 5).join(' '))
  const short = Object.values(g.teams).filter((t) => squadOf(g, t.id).length < 5)
  check(`seed ${seed}: and nobody is short of five`, short.length === 0,
    short.map((t) => t.tag).join(' '))
}

// ---- doTransfer itself is the wall, whatever path reaches it
{
  const g = mk('EDG', true)
  const me = g.teams[g.myTeam]
  const foreigners = Object.values(g.players)
    .filter((p) => !p.teamId && isImport(p, me)).slice(0, 2)
  for (const p of foreigners) { p.teamId = g.myTeam; me.roster.push(p.id) }
  const third = Object.values(g.players).find((p) => !p.teamId && isImport(p, me))!
  const moved = doTransfer(g, third, g.myTeam, 0,
    { salary: 50000, years: 1, signingBonus: 0, bonusShare: 0, releaseClause: 0, promisedRole: 'starter' } as never)
  check('doTransfer refuses the over-quota signing outright', moved === false && third.teamId === null)
}

process.exit(bad ? 1 : 0)
