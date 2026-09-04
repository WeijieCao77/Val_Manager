/**
 * How big the save gets, measured rather than hoped.
 *
 *   npx tsx scripts/check_save_size.ts [seasons]
 *
 * The save lives in localStorage, which is a hard per-origin budget — 5MB on
 * iOS Safari, counted in UTF-16, so 2.5 million characters for everything this
 * site stores: the autosave, any manual saves, the tutorial's parked copy, the
 * card mode and the profile. Three quarters of the audience is on a phone.
 *
 * When it runs out the browser refuses the write and the career stops being
 * saved, which is the worst failure this game has. It has happened twice —
 * 60,000 QuotaExceededErrors reported the first time, 134,000 the second — and
 * both times the cause was per-match paperwork nobody reads piling up through
 * a season, invisible until somebody looked at the dashboard.
 *
 * So it is a test now. A career is played out and the STORED string (packed,
 * exactly as saveGame writes it) is measured at its worst point, which is late
 * in a season with a full fixture list played. The budget below is the line
 * this must not cross; the breakdown prints either way, so a regression says
 * what grew as well as that something did.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason, SEASON_DAYS } from '../src/engine/season'
import { autosave, loadAutosave, packState, unpackState } from '../src/engine/save'
import { stripToTheBone } from '../src/engine/match'
import type { GameState } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}
;(globalThis as never as { fetch: unknown }).fetch = undefined

/**
 * The ceiling, in KB of stored characters.
 *
 * Two full copies (an autosave and one manual save) plus the card mode have to
 * fit inside 2.5M characters, so one copy gets a megabyte and there is still
 * room to spare. Raising this number is a decision about somebody's phone, not
 * a formality — measure what grew first.
 */
const BUDGET_KB = 1_500

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const kb = (s: string) => Math.round(s.length / 1024)
const partKb = (v: unknown) => Math.round(((JSON.stringify(v) ?? '').length) / 1024)

const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
const g: GameState = createNewGame(me.id, '尺寸审计', 20260831)
setupSeason(g)
console.log(`开局 ${kb(packState(g))} KB`)

const seasons = Number(process.argv[2] ?? 1)
let peak = 0
let peakDay = ''
let peakState: GameState = g
for (let s = 0; s < seasons; s++) {
  for (let d = 0; d < SEASON_DAYS; d++) {
    // the sack rules and the bank would end most careers long before the
    // fixture list is full, and this is a question about size, not results
    g.boardConfidence = 85; g.onNotice = false; g.missedStreak = 0
    if (g.finances.balance < 5_000_000) g.finances.balance = 20_000_000
    advanceDay(g, { autoScrims: true })
    if (g.midReview) { g.midReview = false; g.midReviewDone = true }
    if (g.day % 14 !== 0) continue
    const size = kb(packState(g))
    if (size > peak) { peak = size; peakDay = `${g.year} 年第 ${g.day} 天`; peakState = structuredClone(g) }
  }
}

console.log(`\n最大 ${peak} KB（${peakDay}，预算 ${BUDGET_KB} KB）`)
for (const [k, v] of Object.entries(peakState)
  .map(([k, v]) => [k, partKb(v)] as [string, number])
  .filter(([, n]) => n >= 5)
  .sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(v).padStart(5)} KB  ${k}`)
}

check(`一份存档不超过 ${BUDGET_KB} KB`, peak <= BUDGET_KB, `实测 ${peak} KB`)

// ---- the packing is a storage format, so it has to survive the round trip
{
  const before = JSON.stringify(peakState)
  const after = JSON.stringify(unpackState(packState(peakState)))
  check('打包再解包，状态一字不差', before === after,
    before === after ? '' : `${before.length} B → ${after.length} B`)

  const anyLines = peakState.fixtures.find((f) => f.result?.maps.some(
    (m) => Object.keys(m.lines).length))
  check('确实有计分板参与了这次往返', !!anyLines)

  // an export, or a save written before the packing existed, is a plain object
  const plain = JSON.stringify(peakState)
  check('没打包的老存档照样读得出来',
    JSON.stringify(unpackState(plain)) === before)
}

// ---- and what happens when the browser says no anyway
{
  // What the career comes down to once the last resort has run. The fake
  // storage below is given just enough room for that and not a byte more, so
  // the first write must fail and the second must not.
  const boned = structuredClone(peakState)
  stripToTheBone(boned)
  const room = packState(boned).length + 20 * 1024
  console.log(`\n精简到底 ${Math.round(packState(boned).length / 1024)} KB`)

  const tight = new Map<string, string>()
  const used = () => [...tight].reduce((n, [k, v]) => n + k.length + v.length, 0)
  ;(globalThis as never as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => tight.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (used() - (tight.get(k)?.length ?? 0) - (tight.has(k) ? k.length : 0) + k.length + v.length > room) {
        const err = new Error('quota') as Error & { name: string }
        err.name = 'QuotaExceededError'
        throw err
      }
      tight.set(k, v)
    },
    removeItem: (k: string) => { tight.delete(k) },
    key: () => null, clear: () => tight.clear(), get length() { return tight.size },
  }

  const doomed = structuredClone(peakState)
  const before = { year: doomed.year, day: doomed.day, honours: doomed.honours.length,
    squad: doomed.teams[doomed.myTeam].roster.length, cash: doomed.finances.balance }
  let how: string
  try { how = autosave(doomed) } catch (err) { how = `threw: ${(err as Error).name}` }
  check('存不下的时候会精简后重试，而不是放弃', how === 'shrunk', String(how))

  const back = loadAutosave()
  check('精简之后确实写进去了', !!back)
  check('生涯本身一点没少', !!back
    && back.year === before.year && back.day === before.day
    && back.honours.length === before.honours
    && back.teams[back.myTeam].roster.length === before.squad
    && back.finances.balance === before.cash,
    back ? `${back.year}年D${back.day} 冠军${back.honours.length}` : '读不回来')
  check('丢掉的只是旧比赛的记分板', !!back
    && back.fixtures.every((f) => !f.result || f.result.maps.every(
      (m) => !Object.keys(m.lines).length && !m.rounds && !m.edge)))
  // and the next save is small, so it does not have to be rescued again
  check('精简之后再存一次就正常了', autosave(doomed) === 'saved')
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
