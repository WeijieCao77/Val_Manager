/**
 * The three ways the game used to take something and never give it back.
 *
 * A 138-agent audit found them; each is a path where the player loses a
 * player, a contract or a whole career without a message they could act on.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason } from '../src/engine/season'
import { aiTransferTick } from '../src/engine/transfer'
import { dropSponsor, pitchSponsor, signSponsor, SPONSOR_MAX } from '../src/engine/commercial'
import { saveGame, loadGame, TUTORIAL_SNAPSHOT } from '../src/engine/save'
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'

// save.ts talks to localStorage; give node one
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
const mk = (tag = 'TYL'): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === tag)!.id, '审计', 20260827)
  setupSeason(g)
  return g
}

// ---- P0: an AI club may not simply take one of ours
{
  let taken = 0
  for (let seed = 0; seed < 300; seed++) {
    const g = mk()
    g.day = 5                                       // window open
    for (const p of squadOf(g, g.myTeam)) { p.listed = true; p.morale = 20 }
    for (const t of Object.values(g.teams)) if (t.id !== g.myTeam) t.budget = 50_000_000
    const before = new Set(squadOf(g, g.myTeam).map((p) => p.id))
    aiTransferTick(g, new Rng(seed * 31 + 7))
    for (const id of before) if (!squadOf(g, g.myTeam).some((p) => p.id === id)) taken++
  }
  check('no AI club walks off with one of ours', taken === 0,
    `300 次周结算（全员挂牌、士气 20、对手满预算）带走 ${taken} 人`)
}

// ---- P0: dropping a sponsor ends the row you clicked
{
  const g = mk()
  const me = g.teams[g.myTeam]
  me.sponsors = [
    { name: '雷霆能量饮料', perSeason: 900_000, bonusPlacement: 4, bonus: 200_000 },
    { name: '雷霆能量饮料', perSeason: 120_000, bonusPlacement: 8, bonus: 20_000 },
  ]
  dropSponsor(g, 1)
  check('the row you clicked is the one that ends',
    me.sponsors.length === 1 && me.sponsors[0].perSeason === 900_000,
    `剩下 ${me.sponsors.map((s) => s.perSeason).join('、')}`)
}

// ---- and a duplicate cannot be created in the first place
{
  const g = mk()
  const me = g.teams[g.myTeam]
  me.sponsors = []
  const seen: string[] = []
  for (let i = 0; i < 40 && me.sponsors.length < SPONSOR_MAX; i++) {
    g.pitchCooldown = undefined
    g.day += 11
    pitchSponsor(g)
    for (const t of g.sponsorTalks ?? []) {
      if (t.answer) continue
      t.answer = 'offer'
      signSponsor(g, t.id)
    }
  }
  me.sponsors.forEach((s) => seen.push(s.name))
  check('the pitch never offers a brand already on the shirt',
    new Set(seen).size === seen.length, seen.join('、') || '(未签成)')
}

// ---- P0: an abandoned tutorial does not strand the career at day -1
{
  const g = mk()
  g.day = 140
  const realDay = g.day
  const realYear = g.year
  // what Tutorial does on mount
  localStorage.setItem(TUTORIAL_SNAPSHOT, JSON.stringify(g))
  g.tutorialDay = true
  g.day = -1
  for (const p of Object.values(g.players)) if (p.injuredUntil > g.day) p.injuredUntil = g.day
  saveGame('审计_引导', g)                            // the autosave the sandbox writes
  // ...and then the page disappears. Next boot:
  const back = loadGame('审计_引导')!
  check('the parked career comes back, not the sandbox',
    back.day === realDay && back.year === realYear && !back.tutorialDay,
    `day ${back.day}（原 ${realDay}）`)
  check('and the parked copy is consumed', localStorage.getItem(TUTORIAL_SNAPSHOT) === null)
}

// ---- even with no parked copy, the clock is dragged back into the calendar
{
  const g = mk()
  g.tutorialDay = true
  g.day = -1
  for (const p of Object.values(g.players)) p.injuredUntil = -1
  saveGame('审计_引导2', g)
  localStorage.removeItem(TUTORIAL_SNAPSHOT)          // pre-fix save: nothing parked
  const back = loadGame('审计_引导2')!
  check('a pre-fix stranded save is still playable',
    back.day >= 0 && !back.tutorialDay && Object.values(back.players).every((p) => p.injuredUntil >= 0),
    `day ${back.day}`)
  const rng = new Rng(5)
  for (let i = 0; i < 30; i++) advanceDay(back, rng)
  check('and advances normally afterwards', back.day > 0 && back.year >= 2026, `day ${back.day}`)
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
