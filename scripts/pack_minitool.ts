/**
 * Build the 小红书 小工具 zip, and refuse to hand one over that would be rejected.
 *
 * The container's checklist (`.claude/skills/minitool-zip-builder/references/`)
 * is a list of things that must not be in the shipped package — not in the
 * source, in the *package*. So every check here reads `dist-minitool/` and the
 * zip's own listing rather than `src/`: a banned call that a bundler was
 * supposed to drop, and did not, is exactly the failure worth catching, and
 * reading the source would not catch it.
 *
 *   npx tsx scripts/pack_minitool.ts
 *
 * Exits non-zero on any violation, so it can gate a release.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const OUT = 'dist-minitool'
const ZIP = 'val-manager-minitool.zip'

/** §2 of zip-artifact-spec.md — anything else in the zip is a rejection. */
const ALLOWED = new Set([
  '.html', '.css', '.js', '.json',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.woff', '.woff2',
])

const HARD_LIMIT = 10 * 1024 * 1024
const ADVISED = 2 * 1024 * 1024
/**
 * The container rejects a package holding more than this many entries. The
 * portraits are inlined rather than shipped as files precisely because of it —
 * see embedFaces() in vite.config.minitool.ts.
 */
const MAX_ENTRIES = 200

const problems: string[] = []
const notes: string[] = []
const fail = (m: string) => problems.push(m)

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

if (!existsSync(OUT)) {
  console.error(`no ${OUT}/ — run: npx vite build --config vite.config.minitool.ts`)
  process.exit(1)
}

const files = walk(OUT).map((p) => relative(OUT, p))
const html = readFileSync(join(OUT, 'index.html'), 'utf8')
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(OUT, f), 'utf8')).join('\n')
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(OUT, f), 'utf8')).join('\n')

// ── 包结构 ────────────────────────────────────────────────────────────────
if (!files.includes('index.html')) fail('index.html is not at the package root')

for (const f of files) {
  const ext = extname(f).toLowerCase()
  if (!ALLOWED.has(ext)) fail(`disallowed file type in package: ${f}`)
}
for (const f of files) {
  if (/(^|\/)(node_modules|\.git)(\/|$)/.test(f)) fail(`development directory in package: ${f}`)
  if (/\.map$/.test(f)) fail(`source map in package: ${f}`)
  if (/(^|\/)\.DS_Store$/.test(f)) fail(`.DS_Store in package: ${f}`)
  if (/(vite|webpack|rollup)\.config\./.test(f)) fail(`build config in package: ${f}`)
}
if (files.filter((f) => f.endsWith('.html')).length !== 1) {
  fail('more than one .html: the container loads a single index.html')
}

// ── index.html ───────────────────────────────────────────────────────────
if (!/^<!doctype html>/i.test(html.trim())) fail('index.html: missing <!DOCTYPE html>')
if (!/<html[^>]*lang="zh-CN"/.test(html)) fail('index.html: missing lang="zh-CN"')
if (!/charset="?UTF-8"?/i.test(html)) fail('index.html: missing charset=UTF-8')
for (const token of ['width=device-width', 'initial-scale=1.0', 'viewport-fit=cover']) {
  if (!new RegExp(`<meta name="viewport"[^>]*${token.replace('.', '\\.')}`).test(html)) {
    fail(`index.html: viewport is missing ${token}`)
  }
}
if (/<base\b/i.test(html)) fail('index.html: <base href> breaks paths on device')
if (/<meta[^>]+http-equiv="Content-Security-Policy"/i.test(html)) {
  fail('index.html: the container manages CSP; do not declare one')
}
if (/type="module"/.test(html)) fail('index.html: <script type="module"> is refused by the container')
if (/\bcrossorigin\b/.test(html)) fail('index.html: crossorigin has no origin to ask here')

// An inline <script> is banned; an inline <style> is not. Match only script
// elements that carry a body.
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (m[2].trim()) fail('index.html: inline <script> is blocked by the container CSP')
  if (!/\bsrc=/.test(m[1])) fail('index.html: <script> without src')
}
if (/\son[a-z]+\s*=\s*["']/i.test(html)) fail('index.html: inline event handler (onclick=…) is blocked')
if (/javascript:/i.test(html)) fail('index.html: javascript: URI is blocked')
if (/<(iframe|object)\b/i.test(html)) fail('index.html: iframe/object are blocked')

// The script must come after #root, because a classic script is not deferred.
const rootAt = html.indexOf('id="root"')
const scriptAt = html.search(/<script src=/)
if (rootAt < 0) fail('index.html: no #root to mount into')
else if (scriptAt >= 0 && scriptAt < rootAt) {
  fail('index.html: the entry script runs before #root exists (move it to the end of <body>)')
}

// ── 外部资源 ─────────────────────────────────────────────────────────────
// Nothing loads over the network, so any absolute URL left in the package is
// either a dead reference or a banned one. Comments are already stripped from
// the built files, so a hit here is real.
const EXT_URL = /https?:\/\/[^\s"'`)<>]+/g
for (const [label, text] of [['index.html', html], ['css', css]] as const) {
  for (const u of text.match(EXT_URL) ?? []) {
    if (u.startsWith('http://www.w3.org/')) continue   // SVG/XML namespaces are not fetched
    fail(`${label}: external URL ${u}`)
  }
}
// The bundle keeps attribution strings that are shown as text rather than
// loaded, so JS is checked for the ways a URL actually gets *used*.
for (const m of js.matchAll(/(src|href)\s*[=:]\s*["'`]https?:\/\/[^"'`]+/g)) {
  fail(`app.js: external resource reference ${m[0].slice(0, 80)}`)
}
for (const m of css.matchAll(/url\(\s*["']?(?!data:)([^)"']+)/g)) {
  const ref = m[1].trim()
  if (/^https?:/.test(ref)) fail(`css: external url(${ref})`)
}

// ── 端能力扫描（device-capabilities.md §7）────────────────────────────────
const BANNED: [RegExp, string][] = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bnew\s+WebSocket\s*\(/, 'WebSocket'],
  [/\bnew\s+EventSource\s*\(/, 'EventSource'],
  [/\bnew\s+RTCPeerConnection\s*\(/, 'RTCPeerConnection'],
  [/\bsendBeacon\b/, 'navigator.sendBeacon'],
  [/navigator\s*\.\s*geolocation/, 'geolocation'],
  [/navigator\s*\.\s*clipboard/, 'clipboard API'],
  [/execCommand\s*\(/, 'document.execCommand'],
  [/navigator\s*\.\s*(bluetooth|usb|hid|serial)\b/, 'hardware connection API'],
  [/navigator\s*\.\s*(getBattery|connection|credentials|locks)\b/, 'device/credential API'],
  [/(enumerateDevices|getDisplayMedia)\s*\(/, 'device enumeration / screen share'],
  [/navigator\s*\.\s*serviceWorker/, 'service worker'],
  [/storage\s*\.\s*persist\s*\(/, 'navigator.storage.persist'],
  [/\bnew\s+(Shared)?Worker\s*\(/, 'Worker'],
  [/\bnew\s+(Accelerometer|Gyroscope|Magnetometer)\s*\(/, 'sensor'],
  [/\bDevice(Motion|Orientation)Event\b/, 'motion/orientation event'],
  [/(webkitR|\.r)equestFullscreen\s*\(/, 'requestFullscreen'],
  [/\bWebAssembly\s*\./, 'WebAssembly'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/[^.\w]eval\s*\(/, 'eval()'],
  [/window\s*\.\s*open\s*\(/, 'window.open'],
  [/window\s*\.\s*prompt\s*\(/, 'window.prompt'],
  [/_blank/, 'target="_blank"'],
  // 不可用行为：文件下载。a[download] and blob downloads are both refused, and
  // there is no other way to hand a file out of the container.
  [/\.download\s*=/, 'a[download] file download'],
  [/revokeObjectURL/, 'blob download plumbing'],
  // <input type="file"> is allowed, but the picker only ever offers images and
  // videos — an accept= asking for anything else is a control that cannot work.
  [/accept\s*[=:]\s*["'][^"']*\.(json|txt|csv|zip|pdf)/i, 'file input for a type the picker cannot offer'],
]
/**
 * Matches that are allowed to survive, each with the reason it is inert.
 *
 * Only ever feature detection inside a dependency that already handles the
 * property being missing — which is precisely what this container is. The
 * exemption is matched against the code *around* the hit, so it cannot quietly
 * widen to cover a real call somewhere else in the bundle, and every use of it
 * is printed in the summary rather than swallowed.
 */
const ACKNOWLEDGED: { name: string; near: RegExp; why: string }[] = [
  {
    name: 'device/credential API',
    near: /navigator\.connection&&\(?[^;]{0,40}navigator\.connection\.downlink/,
    why: 'react-dom 内部的带宽估算：读不到 navigator.connection 时回落到默认值，非能力依赖',
  },
]

for (const [re, name] of BANNED) {
  const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  for (const [label, text] of [['app.js', js], ['index.html', html]] as const) {
    for (const m of text.matchAll(all)) {
      const around = text.slice(Math.max(0, m.index - 140), m.index + 140)
      const ack = ACKNOWLEDGED.find((a) => a.name === name && a.near.test(around))
      if (ack) { if (!notes.includes(`豁免 ${name}：${ack.why}`)) notes.push(`豁免 ${name}：${ack.why}`) }
      else fail(`${label}: banned capability present — ${name} (…${m[0]}…)`)
    }
  }
}
// Classic script: a surviving bare import/export means the bundle would not run.
if (/^\s*(import|export)\s/m.test(js)) fail('app.js: ESM import/export in a classic script')
if (/\bimport\s*\(/.test(js)) fail('app.js: dynamic import() — the container has no module resolver')

// ── 静态引用都在包里 ──────────────────────────────────────────────────────
for (const m of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) {
  if (!files.includes(m[1])) fail(`index.html references ./${m[1]}, which is not in the package`)
}
// There is no server to interpret a query string, and nothing promises the
// container will strip one before looking the path up inside the zip.
for (const m of js.matchAll(/["'`]([A-Za-z0-9_./-]+\.(?:webp|png|jpg|jpeg|svg|gif|css|js|json))\?[^"'`]*/g)) {
  fail(`app.js: local asset referenced with a query string — ${m[0].slice(0, 60)}`)
}
// The picture directories are built by path at runtime, so check they arrived
// whole rather than trying to resolve every template literal. faces/ is not
// among them: it ships inlined, and is verified below by count instead.
{
  const faces = readFileSync(join(OUT, 'assets/faces.js'), 'utf8')
  const inlined = (faces.match(/"data:image\/webp;base64,/g) ?? []).length
  const onDisk = readdirSync(join('public', 'faces')).filter((f) => f.endsWith('.webp')).length
  if (inlined !== onDisk) fail(`faces: ${inlined} inlined, ${onDisk} in public/faces`)
  else notes.push(`faces 内嵌 ${inlined} 张（不占文件数）`)
  // faceUrl falls back to ./faces/<file> when the table misses, and that
  // directory is not in the package — so prove the miss cannot happen rather
  // than shipping a path that would always break.
  const dossier = JSON.parse(readFileSync(join('src', 'data', 'dossier.json'), 'utf8'))
  const named = new Set<string>()
  for (const group of ['players', 'coaches', 'legends'] as const) {
    for (const e of Object.values(dossier[group] ?? {}) as { img?: string }[]) {
      if (e?.img) named.add(e.img)
    }
  }
  const missing = [...named].filter((f) => !faces.includes(`"${f}":"data:image/webp;base64,`))
  if (missing.length) {
    fail(`faces: the dossier names ${missing.length} not in the table (${missing.slice(0, 3).join(', ')})`)
  } else notes.push(`dossier 引用的 ${named.size} 张头像全部在表内`)
  if (files.some((f) => f.startsWith('faces/'))) fail('faces/ was shipped as files as well as inlined')
}
for (const dir of ['logos', 'agents', 'maps', 'leagues']) {
  const inPkg = files.filter((f) => f.startsWith(`${dir}/`)).length
  const inSrc = existsSync(join('public', dir))
    ? readdirSync(join('public', dir)).filter((f) => !f.startsWith('.')).length
    : 0
  if (inPkg !== inSrc) fail(`${dir}/: ${inPkg} files in the package, ${inSrc} in public/`)
  else notes.push(`${dir}/ ${inPkg} 个文件`)
}

// ── 打包 ─────────────────────────────────────────────────────────────────
if (problems.length === 0) {
  rmSync(ZIP, { force: true })
  // the zip holds the *contents* of dist-minitool, not the folder: index.html
  // has to be at the root or the container will not find an entry
  // -D drops directory entries, so what the container counts is exactly the
  // files and there is no arguing about whether a folder is one
  execFileSync('zip', ['-r', '-q', '-X', '-D', join('..', ZIP), '.',
    '-x', '*.DS_Store', '__MACOSX/*'], { cwd: OUT })

  const listing = execFileSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean)
  if (!listing.includes('index.html')) fail('zip: index.html is not at the root of the archive')
  for (const entry of listing) {
    if (/(^|\/)\.DS_Store$/.test(entry)) fail(`zip: .DS_Store survived — ${entry}`)
    if (entry.startsWith('__MACOSX/')) fail(`zip: __MACOSX survived — ${entry}`)
  }
  if (listing.length > MAX_ENTRIES) {
    fail(`zip: ${listing.length} entries exceeds the ${MAX_ENTRIES}-file limit`)
  } else {
    notes.push(`条目 ${listing.length}/${MAX_ENTRIES}`)
  }
  const size = statSync(ZIP).size
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`
  if (size > HARD_LIMIT) fail(`zip: ${mb(size)} exceeds the 10 MB limit`)
  else if (size > ADVISED) notes.push(`体积 ${mb(size)}：在 10MB 上限内，超出 2MB 的建议值`)
  else notes.push(`体积 ${mb(size)}`)

}

// ── 报告 ─────────────────────────────────────────────────────────────────
for (const n of notes) console.log(`  · ${n}`)
if (problems.length) {
  console.error(`\n✗ ${problems.length} 项不合规：`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`\n✓ 全部检查通过 → ${ZIP}`)
