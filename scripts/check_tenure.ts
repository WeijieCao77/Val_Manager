/**
 * The board's verdict, on every path it can take.
 *
 *   npx tsx scripts/check_tenure.ts
 *
 * Getting sacked is the only way a career can end badly, so the rules around
 * it have to be ones a player can actually read off the screen and act on. Two
 * of them were not:
 *
 *   The warning was withdrawn only on a top-four finish, while the brief a
 *   mid-table club is given is top eight. Do exactly what the board asked,
 *   four stages running, and the warning stayed — through 88% confidence —
 *   costing 45 points of odds on every contract talk and job offer for the
 *   rest of the career. That is what got reported.
 *
 *   And the confidence floor could sack a manager on a stage he had just been
 *   congratulated for, with a message telling him he had failed it.
 *
 * Both are the same mistake: judging the board's patience against something
 * other than the board's own brief. These drive judgeTenure directly rather
 * than playing seasons out, because reaching a 6% confidence floor with a met
 * objective by simulation takes a rigged league to arrange and says nothing
 * clearer when it gets there.
 */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { judgeTenure, moveToClub, setupSeason } from '../src/engine/season'
import type { GameState } from '../src/engine/types'

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

/** A career at a given standing with the board, nothing else going on. */
function board(conf: number, opts: { notice?: boolean; missed?: number } = {}): GameState {
  const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
  const g = createNewGame(me.id, '审计', 20260831)
  setupSeason(g)
  g.boardConfidence = conf
  g.onNotice = opts.notice ?? false
  g.missedStreak = opts.missed ?? 0
  return g
}

/** One settled stage: `met` is the brief, `place` is where we actually came. */
const stage = (g: GameState, met: boolean, place: number): string[] => {
  g.missedStreak = met ? 0 : (g.missedStreak ?? 0) + 1
  const notes: string[] = []
  judgeTenure(g, place, met, notes)
  return notes
}

// ---- the warning goes up, and says how to get out of it
{
  const g = board(40)
  const notes = stage(g, false, 9)
  check('第一次没达标不警告', g.onNotice !== true)
  stage(g, false, 9)
  check('连续两个赛段没达标就警告', g.onNotice === true)
  check('信任度太低也会警告', board(18).onNotice === false
    && (() => { const h = board(18); stage(h, false, 9); return h.onNotice === true })())
  void notes
}

// ---- and it comes off by doing what was asked, not by finishing top four
{
  const g = board(40, { notice: true, missed: 2 })
  g.boardConfidence = 52          // what a met brief pays on the way in
  const notes = stage(g, true, 6) // 第 6 名，要求前 8 —— 达成
  check('达成目标就撤回警告，不要求前四', g.onNotice === false, `第 6 名，信任度 52`)
  check('撤回时说了原因', notes.some((n) => n.includes('撤回')), notes.join(' / '))
}
{
  // the report that started this: four met briefs, confidence to 88, and the
  // warning was still there because none of them was a top-four finish
  const g = board(40, { notice: true, missed: 2 })
  for (let i = 0; i < 4; i++) {
    g.boardConfidence = Math.min(100, g.boardConfidence + 12)
    stage(g, true, 6)
  }
  check('反复达标之后不会还挂着警告', g.onNotice === false,
    `信任度 ${Math.round(g.boardConfidence)}%`)
}
{
  const g = board(24, { notice: true })
  stage(g, true, 6)
  check('达标但信任度还没回来，警告先留着', g.onNotice === true,
    `信任度 ${Math.round(g.boardConfidence)}%`)
}
{
  const g = board(60, { notice: true })
  stage(g, false, 9)
  check('没达标不会撤回警告', g.onNotice === true)
}

// ---- the sack, and what may not cause it
{
  const g = board(30, { notice: true, missed: 1 })
  stage(g, false, 9)
  check('警告之后再连丢两个赛段就下课', !!g.gameOver, g.gameOver ?? '')
  check('下课理由说的是连续没达标', (g.gameOver ?? '').includes('连续'))
}
{
  const g = board(15, { notice: true })
  stage(g, false, 9)
  check('警告之后信任度见底也会下课', !!g.gameOver, g.gameOver ?? '')
}
{
  // the one that used to fire on a stage that passed
  const g = board(4, { notice: true })
  const notes = stage(g, true, 1)
  check('达成了目标就不会在这个赛段下课', !g.gameOver, g.gameOver ?? '')
  check('哪怕信任度只剩个位数也一样', g.boardConfidence <= 10,
    `信任度 ${Math.round(g.boardConfidence)}%`)
  void notes
}
{
  const g = board(3)
  stage(g, false, 12)
  check('没被警告过就不会直接下课', !g.gameOver, g.gameOver ?? '')
  check('而是先给警告', g.onNotice === true)
}

// ---- a new club is a clean slate
{
  const g = board(20, { notice: true, missed: 2 })
  const other = Object.values(g.teams).find((t) => t.id !== g.myTeam && t.tier === 1)!
  moveToClub(g, other.id)
  check('换了俱乐部，警告不跟着走', g.onNotice === false && (g.missedStreak ?? 0) === 0)
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
