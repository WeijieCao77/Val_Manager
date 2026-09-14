import assert from 'node:assert/strict'
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { setupSeason, advanceDay } from '../src/engine/season'
import { Rng } from '../src/engine/rng'
import { exportSave, importSave, listSaves, loadGame, loadAutosave, hasAutosave, saveGame } from '../src/engine/save'

const store = new Map<string, string>()
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
const state = createNewGame(WORLD_TEAMS.find(t => t.tag === 'TYL')!.id, '存档边界', 123)
setupSeason(state)
const original = exportSave(state)
const mutations: [string, (s: any) => void][] = [
  ['missing finances', s => { delete s.finances }],
  ['nonfinite balance serialized as null', s => { s.finances.balance = Infinity }],
  ['unknown managed club', s => { s.myTeam = 'missing' }],
  ['null player', s => { s.players[Object.keys(s.players)[0]] = null }],
  ['missing player attributes', s => { delete s.players[Object.keys(s.players)[0]].attrs }],
  ['missing roster member', s => { s.teams[s.myTeam].roster.push('missing') }],
  ['malformed fixture maps', s => { s.fixtures[0].result = { maps: {} } }],
  ['malformed news', s => { s.news = {} }],
  ['malformed offers', s => { s.offers = [null] }],
  ['null news row', s => { s.news = [null] }],
  ['invalid training map', s => { s.training = 'bad' }],
  ['invalid manager skills', s => { s.manager = { skills: null } }],
  ['invalid manager life', s => { s.life = {} }],
  ['null standings row', s => { Object.values(s.comps)[0].standings.bad = null }],
  ['null scoreboard row', s => { s.fixtures[0].result = { maps: [{ lines: { bad: null } }] } }],
  ['invalid packed scoreboard', s => { s.fixtures[0].result = { maps: [{ lines: { bad: [1, null] } }] } }],
  ['malformed ledger', s => { s.finances.log = [null] }],
]
for (const [name, mutate] of mutations) {
  const envelope = JSON.parse(original)
  mutate(envelope.state)
  const broken = JSON.stringify(envelope)
  assert.throws(() => importSave(broken), /存档/, name)
  store.set('valmanager:save:broken', JSON.stringify(envelope.state))
  assert.equal(loadGame('broken'), null, name)
  assert.equal(store.get('valmanager:save:broken'), JSON.stringify(envelope.state), `${name}: never destroys stored bytes`)
}
for (const text of ['null', '[]', '{}', '{"format":"VAL_MANAGER_SAVE","state":null}']) {
  assert.throws(() => importSave(text), /存档/)
}
console.log('ok corrupt imports are refused before they can replace a playable career')
for (const index of ['{}', 'null', '[null,{},42,{"slot":"bad","savedAt":3}]']) {
  store.clear()
  saveGame('real', state)
  store.set('valmanager:index', index)
  const rows = listSaves()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].slot, 'real')
  assert.ok(loadGame('real'))
}
console.log('ok damaged indices recover real slots and ignore malformed rows')
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage denied') } })
assert.equal(loadAutosave(), null)
assert.equal(hasAutosave(), false)
assert.deepEqual(listSaves(), [])
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
console.log('ok unavailable browser storage does not crash initial save discovery')
const old = JSON.parse(original)
for (const k of ['staff', 'drill', 'enquiries', 'offers', 'honours', 'lastResults', 'training']) delete old.state[k]
const loaded = importSave(JSON.stringify(old))
for (let i = 0; i < 8; i++) advanceDay(loaded, new Rng(i + 100))
assert.equal(loaded.day, 8)
console.log('ok legacy optional fields still migrate into a playable career')
