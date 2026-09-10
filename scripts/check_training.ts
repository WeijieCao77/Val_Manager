/**
 * A confirmed drill trains for seven days, and the lock means it.
 *
 * The lock used to last one turn — a single day in season — while settlement
 * ran on the calendar week. The panel reopened every morning, six days of
 * confirmed picks were placebo, and only whatever was confirmed last before
 * the boundary counted. A player laid the whole sequence out in screenshots.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { poolFor } from '../src/engine/match'
import { saveGame, loadGame } from '../src/engine/save'

// save.ts talks to localStorage; give node one
const mem: Record<string, string> = {}
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = v },
  removeItem: (k: string) => { delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
}
import { advanceDay, finishDraw, setupSeason } from '../src/engine/season'
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', 20260826)
  setupSeason(g)
  return g
}
const teamworkSum = (g: GameState) =>
  squadOf(g, g.myTeam).reduce((s, p) => s + p.attrs.teamwork + p.attrs.awareness, 0)

// ---- the lock holds for seven days, not one
{
  const g = mk()
  const rng = new Rng(2)
  g.drill = { kind: 'map', map: 'Sunset' }
  g.drillLock = g.day + 7            // what 确定 writes
  advanceDay(g, rng)
  check('one day in, the plan is still locked',
    g.drillLock != null && g.drillLock > g.day, `锁到第 ${g.drillLock} 天，现在第 ${g.day} 天`)
  for (let i = 0; i < 4; i++) advanceDay(g, rng)
  check('five days in, still locked', g.drillLock != null && g.drillLock > g.day)
}

// ---- on day seven it settles, once, and unlocks
{
  const g = mk()
  const rng = new Rng(3)
  g.drill = { kind: 'map', map: 'Sunset' }
  g.drillLock = g.day + 7
  const map0 = g.teams[g.myTeam].mapPrefs['Sunset']
  const grew: string[] = []
  for (let i = 0; i < 8; i++) {
    const r = advanceDay(g, rng)
    grew.push(...(r?.notes ?? []).filter((n) => /跑图|训练/.test(n)))
  }
  check('the drill settles when its seven days are up',
    g.teams[g.myTeam].mapPrefs['Sunset'] > map0,
    `Sunset 熟练 ${map0} → ${g.teams[g.myTeam].mapPrefs['Sunset']}`)
  check('and the panel unlocks for the next plan', g.drillLock == null)
}

// ---- tearing it up forfeits everything
{
  const g = mk()
  const rng = new Rng(4)
  g.drill = { kind: 'map', map: 'Sunset' }
  g.drillLock = g.day + 7
  for (let i = 0; i < 3; i++) advanceDay(g, rng)
  const map0 = g.teams[g.myTeam].mapPrefs['Sunset']
  g.drillLock = undefined            // what 重选（荒废进度） does
  for (let i = 0; i < 10; i++) advanceDay(g, rng)
  check('a torn-up plan produces nothing, ever',
    g.teams[g.myTeam].mapPrefs['Sunset'] === map0,
    `熟练度保持 ${map0}`)

  // and a re-confirmed plan counts its seven from the new day
  g.drill = { kind: 'review' }
  g.drillLock = g.day + 7
  const tw0 = teamworkSum(g)
  for (let i = 0; i < 6; i++) advanceDay(g, rng)
  check('six days into the restart, still locked', g.drillLock != null && g.drillLock > g.day)
  advanceDay(g, rng)
  check('the restarted clock settles on ITS seventh day, not the calendar\'s',
    g.drillLock == null && teamworkSum(g) >= tw0)
}

// ---- an old save's serialized drillVoid must not swallow a settlement
// (nothing sets the flag any more, but saves written before the seven-day
// lock still carry drillVoid: true — the group's "跑图7天没涨熟练度")
{
  const g = mk()
  const rng = new Rng(11)
  ;(g as unknown as { drillVoid?: boolean }).drillVoid = true
  saveGame('audit_void', g)
  const loaded = loadGame('audit_void')!
  check('the ghost flag is stripped on load',
    (loaded as unknown as { drillVoid?: boolean }).drillVoid === undefined)
  loaded.drill = { kind: 'map', map: 'Sunset' }
  loaded.drillLock = loaded.day + 7
  const before = loaded.teams[loaded.myTeam].mapPrefs['Sunset']
  for (let i = 0; i < 8; i++) advanceDay(loaded, rng)
  check('and the drill pays out even if it somehow survived',
    loaded.teams[loaded.myTeam].mapPrefs['Sunset'] > before,
    `${before} → ${loaded.teams[loaded.myTeam].mapPrefs['Sunset']}`)
}

// ---- the +2/周 promise holds even for a bad coach and bad facilities
{
  let total = 0
  const runs = 24
  for (let seed = 0; seed < runs; seed++) {
    const g = mk()
    g.teams[g.myTeam].coach = null
    g.teams[g.myTeam].facilities = 40
    g.drill = { kind: 'map', map: 'Sunset' }
    g.drillLock = g.day + 7
    const before = g.teams[g.myTeam].mapPrefs['Sunset']
    const rng = new Rng(700 + seed)
    for (let i = 0; i < 8; i++) advanceDay(g, rng)
    total += g.teams[g.myTeam].mapPrefs['Sunset'] - before
  }
  const avg = total / runs
  check('the weakest setup still averages about +2 a week', avg >= 1.7,
    `均值 +${avg.toFixed(2)}/周`)
}

// ---- the 95 cap says so instead of going quiet
{
  const g = mk()
  const rng = new Rng(12)
  g.teams[g.myTeam].mapPrefs['Sunset'] = 94.9
  g.drill = { kind: 'map', map: 'Sunset' }
  g.drillLock = g.day + 7
  const notes: string[] = []
  for (let i = 0; i < 8; i++) notes.push(...(advanceDay(g, rng)?.notes ?? []))
  check('at the cap, the drill explains itself',
    notes.some((n) => n.includes('已到上限 95')), notes.filter((n) => n.includes('Sunset')).join(' | '))
}

// ---- a map that leaves the pool leaves the training plan with it
//
// 跑图 holds up to two maps, and the screen only draws a button for maps in
// the current pool — so a map rotated out mid-plan could not be clicked off
// again. It kept its slot, and the week after a rotation you could only ever
// pick one map: 「没法把被轮换的地图的选中取消」.
{
  const g = mk()
  let rotations = 0, stuck = 0, freed = 0
  for (let i = 0; i < 600; i++) {
    const before = poolFor(g)
    if (g.drill?.kind !== 'map') g.drill = { kind: 'map', map: before[0], map2: before[1] }
    const r = advanceDay(g)
    if (r?.pendingDraw) {
      const ev = g.draws!.find((d) => d.id === r.pendingDraw)
      if (ev) finishDraw(g, ev, true)
    }
    const after = poolFor(g)
    const gone = before.filter((m) => !after.includes(m))
    if (!gone.length) continue
    rotations++
    const d = g.drill
    const held = d?.kind === 'map' ? [d.map, d.map2].filter((m): m is string => !!m) : []
    if (held.some((m) => !after.includes(m))) stuck++
    if (held.length < 2) freed++
  }
  check('the season saw the pool rotate', rotations > 0, `${rotations} 次`)
  check('no plan is left holding a map that left the pool', stuck === 0, `${stuck} 次挂着轮出的图`)
  check('and dropping it frees the slot for another map', freed > 0, `${freed} 次腾出了位置`)
}

process.exit(bad ? 1 : 0)
