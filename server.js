/**
 * Static file server for the production build.
 *
 * Deliberately dependency-free: the game is a pure client-side bundle, so all
 * this needs to do is serve `dist/` and fall back to index.html. Railway (or
 * anything else) just needs `npm run build && npm start`.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist')
const PORT = Number(process.env.PORT) || 8080

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  // normalize away any ../ before touching the filesystem
  let file = join(ROOT, normalize(url).replace(/^(\.\.[/\\])+/, ''))

  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  // single-page app: unknown paths still return the shell
  if (!existsSync(file)) file = join(ROOT, 'index.html')

  const ext = extname(file)
  const hashed = /-[A-Za-z0-9_]{8,}\./.test(file)
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    // hashed asset names are safe to cache hard; the shell never is
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}).listen(PORT, () => {
  console.log(`VAL MANAGER serving ${ROOT} on :${PORT}`)
})
