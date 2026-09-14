/**
 * The site has to run on Chrome that stopped updating years ago: in mainland
 * China Chrome often cannot reach its update server, so versions before 93 are
 * still in use. Vite only rewrites syntax, never missing built-ins — one
 * Object.hasOwn in the save check left 「继续上次存档」 dead and import failing
 * with "Object.hasOwn is not a function" on those browsers, while Edge was fine.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Built-ins newer than Chrome 87 / Safari 14 (Vite's default target).
const BANNED: [RegExp, string][] = [
  [/\bObject\.hasOwn\s*\(/, 'Object.hasOwn (Chrome 93)'],
  [/\.at\(\s*-?\d/, 'Array/String .at() (Chrome 92)'],
  [/\bstructuredClone\s*\(/, 'structuredClone (Chrome 98)'],
  [/\.findLast(Index)?\s*\(/, 'findLast (Chrome 97)'],
  [/\.(toSorted|toReversed|toSpliced)\s*\(/, 'change-array-by-copy (Chrome 110)'],
  [/\bObject\.groupBy\s*\(|\bMap\.groupBy\s*\(/, 'groupBy (Chrome 117)'],
  [/\bPromise\.withResolvers\s*\(/, 'Promise.withResolvers (Chrome 119)'],
]

const files: string[] = []
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.tsx?$/.test(name)) files.push(p)
  }
}
walk('src')
const hits: string[] = []
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return
    for (const [re, what] of BANNED) if (re.test(line)) hits.push(`${f}:${i + 1} ${what}`)
  })
}
assert.deepEqual(hits, [], `built-ins old Chrome lacks:\n${hits.join('\n')}`)
console.log(`ok browser apis: ${files.length} source files, none newer than Chrome 87`)

// The path that broke, run with the missing built-ins actually missing.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
} })
const { createNewGame } = await import('../src/engine/world')
const { WORLD_TEAMS } = await import('../src/engine/teams')
const { setupSeason } = await import('../src/engine/season')
const { exportSave, importSave, saveGame, loadAutosave } = await import('../src/engine/save')
const { readCareerPreview } = await import('../src/engine/savePreview')
const game = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '旧版浏览器', 7)
setupSeason(game)
const file = exportSave(game)

const hasOwn = Object.hasOwn, at = Array.prototype.at
let imported, resumed, preview, error: unknown
try {
  delete (Object as any).hasOwn
  delete (Array.prototype as any).at
  imported = importSave(file)
  saveGame('autosave', imported)
  preview = readCareerPreview()
  resumed = loadAutosave()
} catch (e) { error = e } finally {
  Object.hasOwn = hasOwn
  Array.prototype.at = at
}
assert.equal(error, undefined, `save path throws without Object.hasOwn / Array.prototype.at: ${error}`)
assert.equal(imported?.myTeam, game.myTeam, 'import works without Object.hasOwn')
assert.equal(preview?.clubId, game.myTeam, 'home resume label works without Object.hasOwn')
assert.equal(resumed?.myTeam, game.myTeam, '继续上次存档 works without Object.hasOwn')
console.log('ok save import / resume without Object.hasOwn and Array.prototype.at')
