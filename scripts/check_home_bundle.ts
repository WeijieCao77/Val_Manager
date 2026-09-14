/** Verify both source imports and Rollup's actual eager chunk graph. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
const graph = await build({ entryPoints: ['src/App.tsx', 'src/ui/Home.tsx'], bundle: true,
  splitting: true, format: 'esm', platform: 'browser', outdir: '/tmp/home-dependency-audit',
  write: false, metafile: true, logLevel: 'silent' })
const seen = new Set<string>()
function visit(path: string) {
  if (seen.has(path)) return
  seen.add(path)
  for (const dep of graph.metafile!.inputs[path]?.imports ?? []) {
    if (!dep.external && dep.kind !== 'dynamic-import') visit(dep.path)
  }
}
visit('src/App.tsx'); visit('src/ui/Home.tsx')
const forbidden = [...seen].filter((p) => /src\/data\/(world|dossier|prospects)(\.|_)/.test(p)
  || /src\/engine\/(world|match|season|gacha|arena|save|teams)\.ts$/.test(p))
assert.deepEqual(forbidden, [], `home statically loads game code: ${forbidden.join(', ')}`)
console.log(`ok home source graph: ${seen.size} modules, no world/dossier datasets or match/season/save engines`)

type Chunk = { file: string; imports?: string[]; css?: string[] }
function measure(dir: string) {
  const manifest: Record<string, Chunk> = JSON.parse(readFileSync(resolve(dir, '.vite/manifest.json'), 'utf8'))
  const keys = new Set<string>(), files = new Set<string>()
  const walk = (key: string) => {
    if (keys.has(key)) return
    keys.add(key)
    const c = manifest[key]
    assert.ok(c, `missing manifest chunk ${key}`)
    files.add(c.file)
    for (const css of c.css ?? []) files.add(css)
    for (const dep of c.imports ?? []) walk(dep)
  }
  walk('index.html'); walk('src/ui/Home.tsx')
  let bytes = 0, gzip = 0
  for (const f of files) { const b = readFileSync(resolve(dir, f)); bytes += b.length; gzip += gzipSync(b).length }
  return { files: [...files].sort(), bytes, gzip }
}
const [afterDir, beforeDir] = process.argv.slice(2)
if (afterDir) {
  const after = measure(afterDir)
  assert.ok(!after.files.some((p) => /\/(world|dossier|ManagerGame|CardMode)-/.test(p)), 'built home preloads a game or dataset chunk')
  console.log(JSON.stringify({ after }, null, 2))
  if (beforeDir) {
    const before = measure(beforeDir)
    console.log(JSON.stringify({ before, savedBytes: before.bytes - after.bytes,
      savedGzipBytes: before.gzip - after.gzip,
      gzipReductionPercent: Math.round((1 - after.gzip / before.gzip) * 1000) / 10 }, null, 2))
  }
}
