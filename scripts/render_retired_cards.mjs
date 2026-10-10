// Renders every retired card as the game draws it (preview/retired-game.html) into
// public/cards/retired/stats/cards/*.webp, the images /cards/retired/stats shows.
//   node scripts/render_retired_cards.mjs [base url, default http://localhost:5173]
// Needs the vite dev server (npm run dev), Playwright, and cwebp.
import { createRequire } from 'node:module'
import { mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/fruit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || '/Users/fruit/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell' })
const base = process.argv[2] || 'http://localhost:5173'
const tmp = 'output/retired_cards'
const out = 'public/cards/retired/stats/cards'
mkdirSync(tmp, { recursive: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 0.75 })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`) })
  await page.goto(`${base}/preview/retired-game.html`, { waitUntil: 'networkidle' })
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))) })
  // the holo frame drifts: hold it still for the picture
  await page.addStyleTag({ content: '*{animation-play-state:paused!important;animation-delay:-2s!important}' })
  const nodes = await page.locator('[data-export]').all()
  for (const n of nodes) {
    const name = await n.getAttribute('data-export')
    const card = n.locator('.ag-face > article')
    const box = await card.boundingBox()
    if (!box || Math.abs(box.height / box.width - 7 / 5) > 0.004) errors.push(`${name} is ${box && (box.width + 'x' + box.height)}, not 5:7`)
    await card.screenshot({ path: `${tmp}/${name}.png`, omitBackground: true })
    execFileSync('cwebp', ['-quiet', '-q', '82', `${tmp}/${name}.png`, '-o', `${out}/${name}.webp`])
  }
  console.log(`${nodes.length} cards rendered`, errors.length ? errors : 'no errors')
} finally { await browser.close(); rmSync(tmp, { recursive: true, force: true }) }
