/**
 * Ten seasons, and a verdict that can actually be reached.
 *
 * Every ending is judged off the save's own record — honours and tenures —
 * never off a flag written when something happened, so an imported save gets
 * the same answer as one played straight through. These build the record and
 * check the answer.
 */
import { createNewGame, WORLD_TEAMS, squadOf } from '../src/engine/world'
import { setupSeason, advanceDay } from '../src/engine/season'
import {
  ENDINGS, ENDING_COUNT, endingOf, endingsFor, factsOf, FINAL_YEAR,
} from '../src/engine/endings'
import type { GameState } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', 20260828)
  setupSeason(g)
  g.year = FINAL_YEAR
  return g
}
const won = (g: GameState, year: number, title: string) => g.honours.push({ year, title })

// ---- every ending is reachable, and none is a duplicate
{
  const keys = ENDINGS.map((e) => e.key)
  check('no two endings share a key', new Set(keys).size === keys.length)
  check('the collection knows how many there are', ENDING_COUNT === ENDINGS.length)
  const ranks = ENDINGS.map((e) => e.rank)
  check('they are ordered', ranks.every((r, i) => i === 0 || r >= ranks[i - 1]))
}

// ---- each one, built from a record that should produce it
{
  const cases: [string, (g: GameState) => void][] = [
    ['dynasty5', (g) => { for (let y = 2032; y <= 2036; y++) won(g, y, 'Champions') }],
    ['dynasty3', (g) => { for (let y = 2034; y <= 2036; y++) won(g, y, 'Masters') }],
    ['treble', (g) => {
      for (let y = 2034; y <= 2036; y++) { won(g, y, 'Champions'); won(g, y, 'VCT China · Stage 1') }
      // three consecutive sweeps but the world streak is also 3 — treble
      // outranks dynasty3, which is the point of the ordering
    }],
    ['worldFirst', (g) => won(g, 2030, 'Masters')],
    ['promoted', (g) => won(g, 2028, '晋级 VCT China')],
    ['fallen', () => { /* nothing at all */ }],
  ]
  for (const [key, build] of cases) {
    const g = mk()
    build(g)
    const got = endingsFor(g)
    check(`「${ENDINGS.find((e) => e.key === key)!.title}」可以达成`,
      got.some((e) => e.key === key), got.map((e) => e.title).join('、') || '（无）')
  }
}

// ---- the ordering actually decides which one is shown
{
  const g = mk()
  for (let y = 2032; y <= 2036; y++) won(g, y, 'Champions')
  check('五连霸盖过单次夺冠', endingOf(g)?.key === 'dynasty5', endingOf(g)?.title)
  const g2 = mk()
  for (let y = 2034; y <= 2036; y++) { won(g2, y, 'Champions'); won(g2, y, 'VCT China · Stage 1') }
  check('全冠三连盖过三连霸', endingOf(g2)?.key === 'treble', endingOf(g2)?.title)
}

// ---- 初始队员还在队里
{
  const g = mk()
  check('开局记下了初始阵容', (g.startingSquad ?? []).length >= 5,
    `${(g.startingSquad ?? []).length} 人`)
  const f = factsOf(g)
  check('十年没动阵容时全员都在', f.originalsLeft === f.originalsAt, `${f.originalsLeft}/${f.originalsAt}`)
  check('「一起走到最后」可以达成', endingsFor(g).some((e) => e.key === 'loyalWithMe'))
  // sell everyone and it goes away
  const g2 = mk()
  g2.teams[g2.myTeam].roster = []
  check('把人全卖了就不算', !endingsFor(g2).some((e) => e.key === 'loyalWithMe'))
}

// ---- 没有外援
{
  const g = mk()
  won(g, 2033, 'Champions')
  const me = g.teams[g.myTeam]
  // isImport reads NATIONALITY first and only falls back to region, so a
  // homegrown squad has to be homegrown by passport
  for (const p of squadOf(g, g.myTeam)) { p.region = me.region; p.nat = undefined }
  check('全本土夺冠 →「本土主义」', endingsFor(g).some((e) => e.key === 'homegrown'),
    `外援 ${factsOf(g).imports} 人`)
  squadOf(g, g.myTeam)[0].nat = me.region === 'EMEA' ? 'kr' : 'fr'
  check('签一个外援就没了', !endingsFor(g).some((e) => e.key === 'homegrown'),
    `外援 ${factsOf(g).imports} 人`)
}

// ---- 连冠之后爆冷
{
  const g = mk()
  won(g, 2030, 'Champions')
  won(g, 2031, 'Champions')
  check('夺冠后再无所获 →「功亏一篑」', endingsFor(g).some((e) => e.key === 'nearly'))
  won(g, 2035, 'VCT China · Stage 2')
  check('之后又拿到东西就不算', !endingsFor(g).some((e) => e.key === 'nearly'))
}

// ---- 判定发生在休赛期之前：结算的是刚打完最后一季的那支队，不是散伙后的残部
{
  // The check used to sit at the BOTTOM of endSeason, after expiring contracts
  // had emptied the squad and ensureMinimumRosters had reshuffled the league.
  // Everyone here is on a deal that runs out at this rollover, and one of them
  // is an import — if the endings are judged after the off-season he is gone
  // and 「本土主义」 fires on the two or three men left behind.
  const g = mk()
  won(g, FINAL_YEAR, 'Champions')
  const me = g.teams[g.myTeam]!
  const squad = squadOf(g, g.myTeam)
  // A deal that ran out LAST winter: the managed club gets one year of grace,
  // so `contractYears = 1` would only put him on notice, not out the door.
  // These men leave at this rollover, which is exactly the moment the ending
  // is decided.
  for (const p of squad) {
    p.contractYears = 0
    p.expiredYear = FINAL_YEAR - 1
    p.region = me.region
    p.nat = undefined
  }
  squad[0]!.nat = me.region === 'EMEA' ? 'kr' : 'fr'
  const before = squad.length

  g.day = 0
  g.boardConfidence = 80
  let guard = 0
  while (!g.gameOver && guard++ < 500) { g.onNotice = false; advanceDay(g) }

  const after = squadOf(g, g.myTeam)
  check('结局判定时阵容还没散', after.length >= before - 1,
    `赛季末 ${before} 人，判定时 ${after.length} 人`)
  check('刚到期的外援仍然算数——「本土主义」不会白送',
    !endingsFor(g).some((e) => e.key === 'homegrown'),
    `外援 ${factsOf(g).imports} 人`)
}

// ---- 十年真的会结束，而不是无限跑下去
{
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', 20260828)
  setupSeason(g)
  let guard = 0
  while (!g.gameOver && guard++ < 4200) {
    g.boardConfidence = 80          // 不让解雇提前结束，这里测的是十年到期
    g.onNotice = false
    advanceDay(g)
  }
  check('十个赛季之后生涯自动结束', !!g.finished, `${g.year} 年：${g.gameOver ?? '仍在进行'}`)
  check('结束于最后一个赛季', g.year === FINAL_YEAR, `${g.year}`)
  check('并且给出了一个结局', !!endingOf(g), endingOf(g)?.title)
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
