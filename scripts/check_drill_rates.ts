/**
 * The numbers printed on the training cards are the numbers the engine uses.
 *
 *   npx tsx scripts/check_drill_rates.ts
 *
 * 「IGL 指挥 +7」 was read by a player as seven points of 指挥. It is seven
 * points of experience on a hundred-point bar — about one attribute point
 * every seven weeks — and the card never said which. That was a wording bug,
 * but the reason it went unnoticed for so long is that nothing tied the card
 * to the engine at all: the panel could promise anything.
 *
 * So the panel reads its multipliers from drillRates() now, and this asserts
 * that a settled drill really does deliver base × those rates. If someone
 * retunes the drill and forgets the card, or the other way round, this fails.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason } from '../src/engine/season'
import { drillRates, reviewIglXp } from '../src/engine/training'
import type { GameState, Player } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}
;(globalThis as never as { fetch: unknown }).fetch = undefined

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

/** Experience never lost to a level-up: a full bar is worth 100. */
const banked = (p: Player, k: 'igl' | 'awareness' | 'communication' | 'teamwork') =>
  (p.attrs[k] ?? 0) * 100 + (p.xp[k] ?? 0)

/**
 * Run `cycles` settled drills and report the mean experience a player gained.
 *
 * Everyone is put on 休息 personally, so the only thing moving these bars is
 * the team drill under test.
 */
function measure(tag: string, kind: 'review' | 'map', cycles: number) {
  const me = WORLD_TEAMS.find((t) => t.tag === tag)!
  const g: GameState = createNewGame(me.id, '审计', 20260831)
  setupSeason(g)
  for (const p of squadOf(g, g.myTeam)) g.training[p.id] = 'rest'
  const igl = squadOf(g, g.myTeam).find((p) => p.isIgl)!
  const rates = drillRates(g)
  // 指挥 rides where the caller currently is, so the expectation has to be
  // sampled as it moves rather than taken once at the start
  const iglWant: number[] = []

  const before = {
    igl: banked(igl, 'igl'),
    aware: banked(igl, 'awareness'),
    comm: banked(igl, 'communication'),
    team: banked(igl, 'teamwork'),
  }
  g.drill = kind === 'review' ? { kind: 'review' } : { kind: 'map', map: 'Ascent' }
  g.drillLock = g.day + 7
  let ran = 0
  for (let d = 0; d < 7 * cycles + 14 && ran < cycles; d++) {
    if (g.drillLock === g.day + 7) iglWant.push(reviewIglXp(g, igl))
    advanceDay(g, { autoScrims: true })
    if (g.drillLock == null) {
      ran++
      g.drill = kind === 'review' ? { kind: 'review' } : { kind: 'map', map: 'Ascent' }
      g.drillLock = g.day + 7
    }
  }
  return {
    rates, ran,
    iglWant: iglWant.length ? iglWant.reduce((a, b) => a + b, 0) / iglWant.length : 0,
    igl: (banked(igl, 'igl') - before.igl) / ran,
    aware: (banked(igl, 'awareness') - before.aware) / ran,
    comm: (banked(igl, 'communication') - before.comm) / ran,
    team: (banked(igl, 'teamwork') - before.team) / ran,
  }
}

/** The drill rolls 0.8–1.2 each time, so a mean over many cycles lands close. */
const near = (got: number, want: number, slack = 0.12) =>
  Math.abs(got - want) <= Math.max(0.6, want * slack)

// ---- 教练复盘 · 卡片写的是 意识 +6、沟通 +3、指挥 +7
{
  const m = measure('EDG', 'review', 40)
  const wantIgl = m.iglWant
  const wantAware = 6 * m.rates.dev * m.rates.review
  const wantComm = 3 * m.rates.dev
  console.log(`\n复盘 40 轮 · dev ×${m.rates.dev.toFixed(2)} review ×${m.rates.review.toFixed(2)}`)
  check('指挥到账的就是 reviewIglXp 给面板的那个数',
    near(m.igl, wantIgl), `实测 ${m.igl.toFixed(1)}，应约 ${wantIgl.toFixed(1)}`)
  check('意识 +6 同理', near(m.aware, wantAware),
    `实测 ${m.aware.toFixed(1)}，应约 ${wantAware.toFixed(1)}`)
  check('沟通 +3 不吃战术加成', near(m.comm, wantComm),
    `实测 ${m.comm.toFixed(1)}，应约 ${wantComm.toFixed(1)}`)
  // the whole point of the report: this is a slow burn, not seven points a week
  check('一轮换不到 1 点属性', m.igl < 100, `${m.igl.toFixed(1)}/100`)
  // NOT asserted as an average over the run: the caller climbs while it runs
  // and the curve decays as he does, which is the whole design. The claim
  // 「指挥给得比意识多」 belongs at a fixed 指挥, and is made below.
  check('40 轮之后指挥确实涨了不少', m.igl * m.ran > 400,
    `累计 ${(m.igl * m.ran).toFixed(0)} 经验`)
}

// ---- 跑图 · 卡片写的是 协同 +9、意识 +5
{
  const m = measure('EDG', 'map', 40)
  console.log(`\n跑图 40 轮 · dev ×${m.rates.dev.toFixed(2)}`)
  check('协同 +9 按加成到账', near(m.team, 9 * m.rates.dev),
    `实测 ${m.team.toFixed(1)}，应约 ${(9 * m.rates.dev).toFixed(1)}`)
  check('意识 +5 按加成到账', near(m.aware, 5 * m.rates.dev),
    `实测 ${m.aware.toFixed(1)}，应约 ${(5 * m.rates.dev).toFixed(1)}`)
  check('跑图不给指挥经验', m.igl === 0, `${m.igl.toFixed(1)}`)
}

// ---- 越弱的指挥学得越快，顶尖的学得慢——不然一个赛季能把谁都练到 99
{
  const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
  const g = createNewGame(me.id, '审计', 20260831)
  setupSeason(g)
  const igl = squadOf(g, g.myTeam).find((p) => p.isIgl)!
  const at = (v: number) => { igl.attrs.igl = v; return reviewIglXp(g, igl) }
  const raw = at(55), mid = at(74), elite = at(88)
  console.log(`\n学习曲线 · 指挥 55 → ${raw.toFixed(0)}/轮，74 → ${mid.toFixed(0)}，88 → ${elite.toFixed(0)}`)
  check('指挥越低学得越快', raw > mid && mid > elite,
    `${raw.toFixed(0)} > ${mid.toFixed(0)} > ${elite.toFixed(0)}`)
  check('生手两轮涨一点', Math.ceil(100 / raw) <= 2, `${Math.ceil(100 / raw)} 轮`)
  check('顶尖指挥练不动', Math.ceil(100 / elite) >= 5, `${Math.ceil(100 / elite)} 轮`)
  const r = drillRates(g)
  check('还没练到顶的指挥，比全队的意识给得多得多',
    mid > 6 * r.dev * r.review * 2,
    `指挥 ${mid.toFixed(0)} vs 意识 ${(6 * r.dev * r.review).toFixed(0)}`)
}

// ---- a club with no coach and poor facilities still gets a truthful figure,
// because the panel prints whatever this returns and a negative one would
// promise experience that never arrives
{
  const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
  const good = createNewGame(me.id, '审计', 20260831)
  setupSeason(good)
  const rich = drillRates(good)

  const g = createNewGame(me.id, '审计', 20260831)
  setupSeason(g)
  g.teams[g.myTeam].coach = null
  g.teams[g.myTeam].facilities = 40
  g.staff = []
  const poor = drillRates(g)
  check('没有教练也不会变成负增长', poor.dev > 0 && poor.review > 0,
    `dev ×${poor.dev.toFixed(2)} review ×${poor.review.toFixed(2)}`)
  check('没有教练、设施差就是更慢', poor.dev < rich.dev && poor.review < rich.review,
    `dev ×${poor.dev.toFixed(2)} vs ×${rich.dev.toFixed(2)}，` +
    `review ×${poor.review.toFixed(2)} vs ×${rich.review.toFixed(2)}`)
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
