/**
 * New blood, and the two rules that keep it honest.
 *
 * The world only ages: players retire, nobody arrives, and by the sixth season
 * the market is empty and every youth mechanic is developing nobody. Real
 * players from below the simulated leagues fill that gap — real, because
 * inventing people is the one thing this project will not do.
 */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { setupSeason, advanceDay } from '../src/engine/season'
import {
  admitProspects, ageIn, INTAKE_FROM, INTAKE_MAX, INTAKE_MIN, makeProspect, PROSPECTS,
} from '../src/engine/prospects'
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', 20260828)
  setupSeason(g)
  return g
}

// ---- everyone in the pool is a real person with a real date
{
  check('the pool is not empty', PROSPECTS.length > 0, `${PROSPECTS.length} 人`)
  const undated = PROSPECTS.filter((r) => !r.born)
  check('nobody is in it without a recorded birthdate', undated.length === 0,
    undated.slice(0, 3).map((r) => r.ign).join('、'))
  const nameless = PROSPECTS.filter((r) => !r.ign?.trim())
  check('and everybody has a handle', nameless.length === 0)
  const ids = new Set(PROSPECTS.map((r) => r.id))
  check('no duplicates', ids.size === PROSPECTS.length)
}

// ---- nobody already in the world arrives a second time
{
  const g = mk()
  const worldNames = new Set(Object.values(g.players).map((p) => p.ign.toLowerCase()))
  const clash = PROSPECTS.filter((r) => worldNames.has(r.ign.toLowerCase()))
  check('the pool does not re-import players the world already has',
    clash.length === 0, clash.slice(0, 3).map((r) => r.ign).join('、'))
}

// ---- age comes from the birthdate, never from convenience
{
  const row = PROSPECTS[0]
  if (row?.born) {
    const born = Number(row.born.slice(0, 4))
    check('age is the calendar answer, not a chosen one',
      ageIn(row, 2030) === 2030 - born && ageIn(row, 2035) === 2035 - born,
      `${row.ign} 生于 ${born}：2030 年 ${ageIn(row, 2030)} 岁`)
    const p = makeProspect(row, 2030)
    check('and the player built from him carries it', p.age === ageIn(row, 2030))
    check('he is unproven, not a ready-made star', p.overall < 75, `能力 ${p.overall}`)
    check('but his ceiling is worth scouting', p.potential > p.overall, `潜力 ${p.potential}`)
    check('he arrives without a club', p.teamId === null)
    check('and is the same man in every career',
      makeProspect(row, 2030).overall === p.overall
      && makeProspect(row, 2030).potential === p.potential)
  }
}

// ---- nothing arrives before the intake year, and then it does
{
  const g = mk()
  g.year = INTAKE_FROM - 1
  check('no intake before the first season', admitProspects(g, new Rng(1)).length === 0)
  g.year = INTAKE_FROM
  const before = Object.keys(g.players).length
  const notes = admitProspects(g, new Rng(1))
  const arrived = Object.keys(g.players).length - before
  check('the first intake arrives', notes.length === 1 && arrived > 0, `${arrived} 人`)
  check('and it is the promised size',
    arrived >= INTAKE_MIN && arrived <= INTAKE_MAX, `${arrived} 人`)
  const fresh = Object.values(g.players).filter((p) => p.id.startsWith('Y'))
  check('all of them are free agents', fresh.every((p) => p.teamId === null))

  // the youngest go first: the pool is finite
  const takenAges = fresh.map((p) => p.age)
  const leftAges = PROSPECTS
    .filter((r) => !g.prospectsTaken?.includes(r.id))
    .map((r) => ageIn(r, g.year))
  if (leftAges.length) {
    check('the youngest are taken first',
      Math.max(...takenAges) <= Math.min(...leftAges) + 1,
      `进来的最大 ${Math.max(...takenAges)} 岁，剩下的最小 ${Math.min(...leftAges)} 岁`)
  }

  // and nobody arrives twice
  const again = admitProspects(g, new Rng(2))
  void again
  const ids = Object.values(g.players).filter((p) => p.id.startsWith('Y')).map((p) => p.id)
  check('nobody arrives twice', new Set(ids).size === ids.length)
}

// ---- a long career actually gets them, through the normal season loop
{
  const g = mk()
  const rng = new Rng(5)
  let guard = 0
  while (g.year < INTAKE_FROM + 1 && guard++ < 3000) advanceDay(g, rng as never)
  const fresh = Object.values(g.players).filter((p) => p.id.startsWith('Y'))
  check('playing to the intake season brings new blood into the world',
    fresh.length > 0, `${g.year} 年，${fresh.length} 名新人`)
  check('and they are signable', fresh.some((p) => p.teamId === null))
}

// ---- the ceiling closes with age, because the pool ages in real time
{
  // Everyone in the pool was born by 2009, so a career that runs to 2036 is
  // scouting men in their mid-to-late twenties by the end. If they arrived with
  // a teenager's headroom, late scouting would beat early scouting.
  const row = PROSPECTS[0]!
  const young = makeProspect(row, 2027)
  const old = makeProspect(row, 2036)
  const headOf = (p: { potential: number; overall: number }) => p.potential - p.overall
  check('the same man scouted nine years later has less room to grow',
    headOf(old) < headOf(young),
    `${young.age} 岁 +${headOf(young)}，${old.age} 岁 +${headOf(old)}`)

  // and it is a taper, not a cliff: an 18-year-old still has a real ceiling
  const teens = PROSPECTS
    .filter((r) => ageIn(r, 2027) <= 20)
    .map((r) => makeProspect(r, 2027))
  check('a genuine teenager still has a wide ceiling',
    teens.length > 0 && teens.some((p) => p.potential - p.overall >= 10),
    `${teens.length} 人，最高 +${Math.max(0, ...teens.map((p) => p.potential - p.overall))}`)

  const late = PROSPECTS
    .filter((r) => ageIn(r, 2036) >= 28)
    .map((r) => makeProspect(r, 2036))
  check('and a 28-year-old "prospect" has almost none',
    late.length === 0 || late.every((p) => p.potential - p.overall <= 8),
    `${late.length} 人，最高 +${Math.max(0, ...late.map((p) => p.potential - p.overall))}`)
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
