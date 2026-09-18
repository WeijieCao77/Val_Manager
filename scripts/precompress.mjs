/**
 * Write <file>.br and <file>.gz beside every text asset in dist/.
 *
 *   node scripts/precompress.mjs [dir=dist]
 *
 * Part of `npm run build`. The server (server.js `compressed`) reads these
 * instead of compressing on the first request for each file, which was up to
 * a third of a second of nobody being served, per file, after every deploy.
 * Brotli at 11 here — the build can afford what a request cannot.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const ROOT = process.argv[2] ?? 'dist'
const TEXTY = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.xml', '.map', '.webmanifest'])
let files = 0, raw = 0, br = 0
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name)
    const st = statSync(file)
    if (st.isDirectory()) { walk(file); continue }
    if (!TEXTY.has(extname(name)) || st.size < 1024) continue
    const body = readFileSync(file)
    const b = brotliCompressSync(body, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length },
    })
    writeFileSync(file + '.br', b)
    writeFileSync(file + '.gz', gzipSync(body, { level: 9 }))
    files++; raw += body.length; br += b.length
  }
}
const t0 = Date.now()
walk(ROOT)
console.log(`precompress: ${files} files, ${(raw / 1e6).toFixed(2)} MB -> ${(br / 1e6).toFixed(2)} MB brotli, ${((Date.now() - t0) / 1000).toFixed(1)} s`)
