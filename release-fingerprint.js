/** Fingerprint backend code as well as the separately checked engine/frontend. */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
export function releaseFingerprint(root = dirname(fileURLToPath(import.meta.url))) {
  const files = [...readdirSync(root).filter(f => f.endsWith('.js')),
    'package.json', 'package-lock.json', 'railway.json',
    'scripts/refund_stranded_offers.js', 'scripts/precompress.mjs', 'dist-server/engine.mjs'].sort()
  const hash = createHash('sha256')
  for (const file of files) {
    if (!existsSync(join(root, file))) throw new Error(`Missing release file: ${file}`)
    hash.update(file); hash.update('\0'); hash.update(readFileSync(join(root, file))); hash.update('\0')
  }
  return hash.digest('hex')
}
