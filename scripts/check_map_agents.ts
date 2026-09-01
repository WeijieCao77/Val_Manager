/**
 * A map's lineup, remembered.
 *
 *   npx tsx scripts/check_map_agents.ts
 *
 * Setting the same five agents on Breeze every single week is busywork, not a
 * decision. The first hand-made sheet for a map becomes that map's default and
 * every later match on it starts there.
 *
 * The part worth testing is what happens when the five is not the five it was
 * saved with — a signing, a sale, an injury. A remembered sheet is keyed by
 * player, so it must degrade rather than break: whoever is still here keeps his
 * agent, the rest are auto-filled, and nobody ends up without a character or
 * sharing one.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { setupSeason } from '../src/engine/season'
import { selectLineup } from '../src/engine/match'
import { autoAgents, normalizeAgents } from '../src/engine/agents'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
const g = createNewGame(me.id, '审计', 20260901)
setupSeason(g)
const MAP = 'Breeze'
const five = selectLineup(g, g.myTeam)

// the manager sets Breeze by hand once
const auto = autoAgents(g, g.myTeam, five, MAP)
const mine = { ...auto }
mine[five[0].id] = 'Viper'
mine[five[1].id] = 'Jett'
g.mapAgents = { [MAP]: mine }

const resolve = (squad = five) =>
  normalizeAgents(g, g.myTeam, squad, MAP,
    g.agentPicks?.[MAP] ?? g.mapAgents?.[MAP] ?? autoAgents(g, g.myTeam, squad, MAP))

const again = resolve()
check(again[five[0].id] === 'Viper' && again[five[1].id] === 'Jett',
  '下次打这张图，还是你定的那套', `${again[five[0].id]} / ${again[five[1].id]}`)
check(new Set(Object.values(again)).size === five.length, '五个人五个不同的英雄')

// a different map is untouched
const other = normalizeAgents(g, g.myTeam, five, 'Ascent',
  g.mapAgents?.['Ascent'] ?? autoAgents(g, g.myTeam, five, 'Ascent'))
check(JSON.stringify(other) !== JSON.stringify(again), '别的图不受影响')

// ---- the five changes ---------------------------------------------------
{
  // one man sold, one signed: the newcomer is somebody already in the world
  const spare = Object.values(g.players).find(
    (p) => p.teamId !== g.myTeam && !five.some((x) => x.id === p.id))!
  const changed = [five[0], five[1], five[2], five[3], spare]
  const out = resolve(changed)
  check(out[five[0].id] === 'Viper' && out[five[1].id] === 'Jett',
    '换了人之后，还在队里的照旧', `${out[five[0].id]} / ${out[five[1].id]}`)
  check(!!out[spare.id], '新来的也分到了英雄', out[spare.id])
  check(Object.keys(out).length === 5, '五个人都有英雄')
  check(new Set(Object.values(out)).size === 5, '没有两个人拿同一个英雄',
    JSON.stringify(Object.values(out)))
}

// ---- a sheet naming nobody who is here still produces a full five -------
{
  const junk = Object.fromEntries(five.map((p, i) => [`ghost${i}`, 'Jett']))
  g.mapAgents = { [MAP]: junk }
  const out = resolve()
  check(Object.keys(out).length === 5 && new Set(Object.values(out)).size === 5,
    '存的是一队已经不在的人，也能补出完整五人', JSON.stringify(Object.values(out)))
}

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
