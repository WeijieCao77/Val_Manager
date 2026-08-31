/**
 * The five-year settlement actually gets offered.
 *
 *   npx tsx scripts/check_midreview.ts
 *
 * It is one question asked once in a career, and there is no second chance to
 * ask it: if the condition misses, the player never learns anything was
 * supposed to happen. It shipped as `state.year === 2030`, which is exactly
 * right for a career started after it shipped and unreachable for one that was
 * already in 2031 — the players who had put the most hours in were the only
 * ones who could not get it. So this asserts the offer on three careers: one
 * that arrives at 2030 on schedule, one that was already past it, and one at
 * the finale, where the ten-year ending must win instead.
 *
 * The seasons are not played out day by day — the sack rules would end most
 * careers long before 2030, and this is a question about the calendar, not
 * about results. The clock is wound to the last day of a season instead and
 * advanced one turn, which is the state endSeason is entered from.
 */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { advanceDay, continuePastFive, settleAtFive, setupSeason } from '../src/engine/season'
import { FINAL_YEAR, MID_YEAR, tenureCn } from '../src/engine/endings'
import type { GameState } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }).localStorage = {
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

/** A career sitting on the last day of `year`, one advance from the off-season. */
function atSeasonEnd(year: number): GameState {
  const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
  const g = createNewGame(me.id, '审计', 20260831)
  setupSeason(g)
  g.year = year
  g.day = 335
  return g
}

// ---- the career that arrives on schedule
{
  const g = atSeasonEnd(MID_YEAR)
  const r = advanceDay(g, { autoScrims: true })
  check('2030 赛季末提出五年之约', g.midReview === true)
  check('提出时冻结在赛季末', r.seasonEnded === true && g.day === 336)
  check('digest 里说了这件事', r.notes.some((n) => n.includes('之期已到')))
  check('五年就叫五年', tenureCn(MID_YEAR) === '五')

  // the clock does not move while the question is open
  const before = g.day
  advanceDay(g, { autoScrims: true })
  check('等答复期间推不动天数', g.day === before)

  continuePastFive(g)
  check('选择继续：生涯没有结束', !g.finished && !g.gameOver && g.midReview === false)

  // and the next season end must not ask again
  advanceDay(g, { autoScrims: true })
  check('继续之后赛季正常翻篇', g.year === MID_YEAR + 1 && g.day < 336)
  const g2 = { ...g, day: 335 } as GameState
  advanceDay(g2, { autoScrims: true })
  check('只问这一次', g2.midReview !== true)
}

// ---- the save that was already past 2030 when the settlement shipped
for (const year of [MID_YEAR + 1, MID_YEAR + 3]) {
  const g = atSeasonEnd(year)
  advanceDay(g, { autoScrims: true })
  check(`${year} 的老存档也拿得到结算`, g.midReview === true)
  check(`${year} 的标题按真实年限说话`, tenureCn(year) === (year === 2031 ? '六' : '八'))
  settleAtFive(g)
  check(`${year} 收官后生涯结束`, g.finished === true && !!g.gameOver)
  check(`${year} 收官文案不写死五年`, (g.gameOver ?? '').startsWith(tenureCn(year)))
}

// ---- 2036 is the finale, and it outranks the settlement
{
  const g = atSeasonEnd(FINAL_YEAR)
  advanceDay(g, { autoScrims: true })
  check('2036 走的是十年大结局', g.midReview !== true && g.finished === true)
  check('2036 的结局文案是十年', (g.gameOver ?? '').includes('十年'))
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
