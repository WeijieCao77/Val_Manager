/** Trusted, self-contained engine bundles, retained for cups that started on them. */
import { createHash } from 'node:crypto'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
const zip = promisify(gzip), unzip = promisify(gunzip)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const MAX_SOURCE = 16 * 1024 * 1024

export async function verifyCupBundle(build) {
  if (!build || !/^[a-f0-9]{64}$/.test(build.hash) || typeof build.compressed !== 'string' || build.compressed.length > 8 * 1024 * 1024) throw new Error('invalid archived cup engine')
  const source = await unzip(Buffer.from(build.compressed, 'base64'), { maxOutputLength: MAX_SOURCE })
  if (digest(source) !== build.hash) throw new Error('cup engine checksum mismatch')
  return source
}

export function createCupEngineArchive(sql, { source, hash }) {
  let registered = null
  const cache = new Map()
  async function register() {
    if (!source || source.length > MAX_SOURCE || digest(source) !== hash) throw new Error('cup engine source/hash mismatch')
    registered ??= (async () => {
      const compressed = (await zip(source)).toString('base64')
      const build = { hash, compressed }
      await verifyCupBundle(build)
      await sql`insert into open_cup_engine_builds(hash, compressed) values (${hash}, ${compressed}) on conflict do nothing`
      // An existing hash row is also verified before it can become a match input.
      const rows = await sql`select hash, compressed from open_cup_engine_builds where hash = ${hash}`
      await verifyCupBundle(rows[0])
      cache.set(hash, rows[0])
      return hash
    })().catch((e) => { registered = null; throw e })
    return registered
  }
  async function load(version) {
    if (!/^[a-f0-9]{64}$/.test(version ?? '')) throw new Error('cup has no valid engine build')
    if (cache.has(version)) { const hit = cache.get(version); cache.delete(version); cache.set(version, hit); return hit }
    const rows = await sql`select hash, compressed from open_cup_engine_builds where hash = ${version}`
    if (!rows.length) throw new Error(`missing archived cup engine ${version}`)
    await verifyCupBundle(rows[0])
    cache.set(version, rows[0])
    while (cache.size > 2) cache.delete(cache.keys().next().value)
    return rows[0]
  }
  return { register, load }
}
