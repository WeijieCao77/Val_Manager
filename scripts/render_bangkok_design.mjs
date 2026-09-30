/** Export design proofs and verify the isolated preview. Run with the Vite server on :5175.
 * PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE may override the local bundled runtime.
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/fruit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const out = 'output/bangkok-2025'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || '/Users/fruit/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`) })
  const url = process.env.BANGKOK_PREVIEW_URL || 'http://127.0.0.1:5175/preview/bangkok.html'
  const ready = async () => {
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.locator('.bk25-pouch-stage.is-ready').waitFor()
    await page.waitForTimeout(900)
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))) })
  }
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  await ready()
  assert(await page.locator('.bk25-photo img').count() === 2, 'Two sample photos must load')
  assert(await page.locator('.bk25-photo img').evaluateAll(imgs => imgs.every(i => i.naturalWidth > 0)), 'Sample images failed to decode')
  await page.screenshot({ path: `${out}/collection-desktop.png`, fullPage: true })
  await page.locator('.bk-showcase').screenshot({ path: `${out}/collection.png` })
  for (const [label, name] of [['侧面','pack-side'],['背面','pack-back']]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.waitForTimeout(700)
    assert(await page.getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed') === 'true', 'Pouch angle switch failed')
    await page.locator('[data-export=pack]').screenshot({ path: `${out}/${name}.png`, omitBackground: true })
  }
  await page.getByRole('button', { name: '正面', exact: true }).click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: '银卡', exact: true }).click()
  assert(await page.locator('.bk-showcase .bk25-silver').count() === 2, 'Silver switch failed')
  await page.getByRole('button', { name: '铜卡', exact: true }).click()
  assert(await page.locator('.bk-showcase .bk25-bronze').count() === 2, 'Bronze switch failed')
  await page.getByRole('button', { name: '照片留空', exact: true }).click()
  assert(await page.locator('.bk-showcase .bk25-photo.is-empty').count() === 2, 'Photo placeholder switch failed')
  await page.getByRole('button', { name: '翻看卡背', exact: true }).click()
  assert(await page.locator('.bk-showcase .bk25-back').count() === 3, 'Card flip failed')
  await page.locator('input[type=file]').setInputFiles('public/faces/l-chichoo-bangkok-2025.webp')
  assert((await page.locator('[data-export=chichoo] img').getAttribute('src')).startsWith('blob:'), 'Local photo replacement failed')
  await page.getByRole('slider').fill('70')
  assert((await page.locator('[data-export=chichoo] img').getAttribute('style')).includes('70%'), 'Photo positioning failed')
  await page.getByRole('button', { name: '恢复样片' }).click()
  await page.getByRole('button', { name: '金卡', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile overflow')
  await page.screenshot({ path: `${out}/collection-mobile.png`, fullPage: true })
  for (const name of ['pack','chichoo','meteor','back','template-gold','template-silver','template-bronze']) {
    await page.setViewportSize({ width: 1200, height: 1700 })
    await ready()
    await page.evaluate(name => {
      const node = document.querySelector(`[data-export="${name}"]`)
      document.body.replaceChildren(node)
      document.body.style.cssText = 'margin:0;background:transparent;'
      node.style.cssText = `width:${name === 'pack' ? 900 : 756}px;margin:0;`
      if (name === 'pack') node.querySelector('canvas').style.cssText = 'inset:0;width:100%;height:100%;'
    }, name)
    await page.waitForTimeout(300)
    await page.locator(`[data-export="${name}"]`).screenshot({ path: `${out}/${name}.png`, omitBackground: true })
  }
  assert(errors.length === 0, errors.join('\n'))
  writeFileSync(`${out}/verification.json`, JSON.stringify({ passed: true, checks: ['3D pouch WebGL ready','pouch side and back controls','two photos decoded','gold/silver/bronze switch','empty photo slots','card backs','local photo replacement','crop positioning','390px no overflow','7 PNG exports','no browser or HTTP errors'], errors }, null, 2))
  console.log(`Verified preview and exported 7 assets + 3 overview images to ${out}`)
} finally { await browser.close() }
