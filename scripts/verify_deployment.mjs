/** Wait for the actual build to be healthy, not merely accepted for upload. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
const origin = process.argv[2]
assert(origin, 'usage: node scripts/verify_deployment.mjs <origin>')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const engine = sha(readFileSync('dist-server/engine.mjs'))
const files = ['index.html', ...readdirSync('dist/assets').filter(x => /\.(js|css)$/.test(x)).map(x => `assets/${x}`)]
const get = async path => {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
  assert(response.ok, `${path}: HTTP ${response.status}`)
  return response
}
const deadline = Date.now() + Number(process.env.DEPLOY_WAIT_MS ?? 480_000)
for (;;) {
  try {
    const health = await get('/healthz')
    assert.equal(await health.text(), 'ok')
    assert.equal(health.headers.get('x-engine-sha256'), engine, 'running match engine differs from tested build')
    for (let i = 0; i < files.length; i += 6) {
      await Promise.all(files.slice(i, i + 6).map(async file => {
        const response = await get(file === 'index.html' ? '/' : `/${file}`)
        assert.equal(sha(Buffer.from(await response.arrayBuffer())), sha(readFileSync(`dist/${file}`)), `${file} differs from tested build`)
      }))
    }
    console.log(`Verified ${origin}: health OK, engine ${engine}, ${files.length} frontend files match tested build`)
    break
  } catch (error) {
    if (Date.now() >= deadline) throw error
    console.log(`Waiting for tested deployment: ${error.message.split('\n')[0]}`)
    await setTimeout(15_000)
  }
}
