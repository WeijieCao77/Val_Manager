/**
 * A tab that is behind must not overwrite a tab that is ahead.
 *
 * localStorage belongs to the origin, not to the tab, and this game had no
 * revision handling at all — so with two tabs open on the same career the last
 * write won regardless of which had played further. A player left an old tab
 * at 2032, finished the career to 2036 in another, and the idle tab's next
 * autosave put 2032 back: four seasons and an ending gone, with nothing on
 * screen to explain it.
 *
 *     npx tsx scripts/check_autosave.ts
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { setupSeason } from '../src/engine/season'
import { autosave, claimAutosave, loadAutosave } from '../src/engine/save'
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
const mk = (year: number, day: number): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', 20260828)
  setupSeason(g)
  g.year = year
  g.day = day
  return g
}
/** What another tab would have left behind. */
const otherTabWrote = (year: number, day: number) => {
  store.set('valmanager:save:autosave:owner',
    JSON.stringify({ by: 'other-tab', year, day }))
}

// ---- the case from the report
{
  store.clear()
  const ahead = mk(2036, 300)
  autosave(ahead)                       // this tab plays to 2036
  check('自己的存档写得进去', loadAutosave()?.year === 2036, String(loadAutosave()?.year))

  otherTabWrote(2036, 300)              // ...and that write was ours, but say another tab did it
  const behind = mk(2032, 100)          // the stale tab
  check('落后的标签页会被拒绝', autosave(behind) === 'behind')
  check('存档没有被改回去', loadAutosave()?.year === 2036, String(loadAutosave()?.year))
}

// ---- but normal play must never be blocked
{
  store.clear()
  const g = mk(2030, 50)
  check('同一个标签页连续保存不受影响', autosave(g) === 'saved')
  g.day = 51
  check('推进一天照样保存', autosave(g) === 'saved')
  g.year = 2031
  check('跨年照样保存', autosave(g) === 'saved', String(loadAutosave()?.year))
}

// ---- and loading an older save on purpose takes ownership back
{
  store.clear()
  otherTabWrote(2036, 300)
  const old = mk(2029, 10)
  check('没认领之前，读旧档的标签页写不进去', autosave(old) === 'behind')
  claimAutosave(old)                    // 玩家主动读取了这个存档
  check('主动读取之后就能写了', autosave(old) === 'saved')
  check('存档确实变成了旧的那个', loadAutosave()?.year === 2029, String(loadAutosave()?.year))
}

// ---- a fresh browser with no marker at all still saves
{
  store.clear()
  check('没有任何标记时正常保存', autosave(mk(2026, 1)) === 'saved')
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
