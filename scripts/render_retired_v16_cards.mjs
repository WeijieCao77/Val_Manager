// Renders preview/retired-v16.html card by card into public/cards/retired/stats/cards/.
//   node scripts/render_retired_v16_cards.mjs [base url, default http://localhost:5173]
// The dev server must be running (npm run dev). PNGs are converted to webp afterwards.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/fruit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || '/Users/fruit/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell' })
const base = process.argv[2] || 'http://localhost:5173'
const out = 'output/retired_v16_cards'
mkdirSync(out, { recursive: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1.5 })
  page.on('pageerror', e => errors.push(e.message))
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`) })
  await page.goto(`${base}/preview/retired-v16.html`, { waitUntil: 'networkidle' })
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))) })
  const nodes = await page.locator('[data-export]').all()
  for (const n of nodes) {
    const name = await n.getAttribute('data-export')
    await n.screenshot({ path: `${out}/${name}.png`, omitBackground: true })
  }
  console.log(`${nodes.length} cards rendered`, errors.length ? errors : 'no errors')
} finally { await browser.close() }
