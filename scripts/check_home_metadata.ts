import assert from 'node:assert/strict'
import { WORLD_TEAMS } from '../src/engine/teams'
import { crestUrl } from '../src/engine/dossier'
import { HOME_CLUBS, HOME_COUNTS, homeCrestUrl } from '../src/engine/homeClubs'
import { regionsManaged, ACHIEVEMENT_COUNT, ACHIEVEMENTS } from '../src/engine/achievements'
import { createNewGame } from '../src/engine/world'
import { exportSave, saveGame, setSaveNamespace, loadGame } from '../src/engine/save'
import { readCareerPreview } from '../src/engine/savePreview'
import { saveNamespace, savePrefix } from '../src/engine/saveKeys'

assert.equal(Object.keys(HOME_CLUBS).length, WORLD_TEAMS.length)
for (const t of WORLD_TEAMS) {
  assert.equal(HOME_CLUBS[t.id].name, t.name)
  assert.equal(HOME_CLUBS[t.id].region, t.region)
  assert.equal(homeCrestUrl(t.id), crestUrl(t.id))
  assert.deepEqual(regionsManaged([t.id]), [t.region])
}
assert.equal(ACHIEVEMENT_COUNT, ACHIEVEMENTS.length)
assert.deepEqual(regionsManaged(WORLD_TEAMS.map((t) => t.id)).sort(), [...new Set(WORLD_TEAMS.map((t) => t.region))].sort())
assert.deepEqual(regionsManaged(['missing']), [])
console.log(`ok ${WORLD_TEAMS.length} club names, regions and crest stamps exactly match canonical data`)

const storage = new Map<string, string>()
Object.assign(globalThis, { localStorage: {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k),
  key: (i: number) => [...storage.keys()][i] ?? null, get length() { return storage.size },
} })
const g = createNewGame(WORLD_TEAMS[0].id, '首页审计', 1)
assert.equal(HOME_COUNTS.teams, Object.values(g.teams).filter(t => t.tier === 1 || t.tier === 2).length)
assert.equal(HOME_COUNTS.players, Object.keys(g.players).length)
assert.equal(HOME_COUNTS.headCoaches, new Set(Object.values(g.teams).flatMap(t => t.coach ? [t.coach.name] : [])).size)
console.log(`ok home counts match the default career: ${HOME_COUNTS.teams} teams, ${HOME_COUNTS.players} players, ${HOME_COUNTS.headCoaches} named head coaches`)
for (const ns of ['', 'test']) {
  setSaveNamespace(ns)
  assert.equal(saveNamespace(), ns)
  g.year = ns ? 2030 : 2026
  saveGame('autosave', g)
  const actual = loadGame('autosave')!
  assert.deepEqual(readCareerPreview(), { club: actual.teams[actual.myTeam].name,
    clubId: actual.myTeam, year: actual.year, over: !!actual.gameOver })
}
setSaveNamespace('')
assert.equal(readCareerPreview()?.year, 2026)
setSaveNamespace('test')
assert.equal(readCareerPreview()?.year, 2030)
console.log('ok resume preview and actual loader share namespaces and labels without mixing saves')

const parked = createNewGame(WORLD_TEAMS[1].id, '恢复审计', 2)
storage.set('valmgr.tutorial.snapshot', JSON.stringify(parked))
g.tutorialDay = true
saveGame('autosave', g)
assert.equal(readCareerPreview()?.clubId, parked.myTeam)
assert.ok(storage.has('valmgr.tutorial.snapshot'))
console.log('ok preview recognises parked tutorial career without consuming its recovery snapshot')

storage.set(savePrefix() + 'autosave', '{bad')
assert.equal(readCareerPreview(), null)
const raw = JSON.parse(exportSave(g)); delete raw.state.finances
storage.set(savePrefix() + 'autosave', JSON.stringify(raw.state))
assert.equal(readCareerPreview(), null)
Object.assign(globalThis, { localStorage: { getItem: () => { throw new Error('denied') } } })
assert.equal(readCareerPreview(), null)
console.log('ok corrupt/blocked storage cannot crash the home page')
console.log('PASS home metadata and lightweight resume checks')
