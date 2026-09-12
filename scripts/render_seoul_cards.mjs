/** Offline preview of every 首尔 2024 card face, as the engine builds them now,
 * beside the unsettled snapshot (raw event rating, no map-count settling).
 * One self-contained file: the game's stylesheets and every face are inlined.
 *
 *   node scripts/render_seoul_cards.mjs [out=analysis/seoul_cards.html]
 */
import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const out = process.argv[2] ?? 'analysis/seoul_cards.html'
// inside the project so the bundle's bare imports (react, react-dom) resolve
mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true })
const dir = mkdtempSync(join(root, 'node_modules', '.cache', 'seoul-cards-'))
const bundle = join(dir, 'render.mjs')
await build({
  stdin: {
    resolveDir: root, loader: 'tsx', contents: `
      import { renderToStaticMarkup } from 'react-dom/server'
      import { SEOUL_CARDS } from './src/engine/cards'
      import { SEOUL_TEAMS } from './src/engine/seoul2024'
      import { PACKS } from './src/engine/gacha'
      import { SeoulCard } from './src/ui/cards/SeoulDesign'
      export const price = PACKS.seoul2024.cost
      export const teams = SEOUL_TEAMS
      export const cards = SEOUL_CARDS.map(c => ({
        ign: c.ign, team: c.clubTag, number: c.seoul.number, maps: c.seoul.maps, vlr: c.seoul.rating,
        rating: c.rating, rarity: c.rarity, igl: c.isIgl, html: renderToStaticMarkup(<SeoulCard card={c} size="lg" />),
      }))`,
  },
  bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: bundle, jsx: 'automatic',
  loader: { '.css': 'empty' }, logLevel: 'warning',
})
const { price, teams, cards } = await import(pathToFileURL(bundle).href)
rmSync(dir, { recursive: true, force: true })

const bounded = (n) => Math.max(55, Math.min(96, Math.round(n)))
const rarityOf = (r) => (r >= 84 ? 'gold' : r >= 76 ? 'silver' : 'bronze')
const CN = { gold: '金', silver: '银', bronze: '铜' }
const PLACE = { 1: '冠军', 2: '亚军', 3: '季军', 4: '第四', 5: '5–6 名', 7: '7–8 名', 9: '9–12 名', 13: '13–16 名' }
for (const c of cards) {
  c.old = bounded(70 + (c.vlr - 0.75) * 45)
  c.oldRarity = rarityOf(c.old)
}
const count = (key) => ['gold', 'silver', 'bronze'].map((r) => cards.filter((c) => c[key] === r).length).join(' / ')
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

const tile = (c) => {
  const d = c.rating - c.old
  const moved = c.rarity !== c.oldRarity
  return `<figure class="sp-card" data-moved="${moved ? 1 : 0}">${c.html}<figcaption>
    <b>${esc(c.ign)}</b> <span>${esc(c.team)} · ${c.maps} 图${c.igl ? ' · 指挥' : ''}</span><br>
    总评 ${c.old} → <b>${c.rating}</b> <i class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d}</i>
    ${moved ? `<em>${CN[c.oldRarity]} → ${CN[c.rarity]}</em>` : ''}
  </figcaption></figure>`
}
const byTeam = [...teams].sort((a, b) => a.placement - b.placement).map((t) => {
  const five = cards.filter((c) => c.team === t.tag).sort((a, b) => a.number - b.number)
  const mean = (k) => (five.reduce((s, c) => s + c[k], 0) / five.length).toFixed(1)
  return `<section class="sp-team"><h2>${esc(t.tag)} <small>${esc(t.name)} · ${PLACE[t.placement] ?? t.placement} · 均分 ${mean('old')} → ${mean('rating')}</small></h2>
    <div class="sp-grid">${five.map(tile).join('')}</div></section>`
}).join('')
const byRating = `<div class="sp-grid">${[...cards].sort((a, b) => b.rating - a.rating || b.maps - a.maps).map(tile).join('')}</div>`

const page = `
  body { background: #0b0d12; }
  .sp { max-width: 1320px; margin: 0 auto; padding: 28px 20px 60px; color: #e9e6df; font-family: -apple-system, "PingFang SC", "Noto Sans SC", sans-serif; }
  .sp header h1 { font-size: 24px; margin: 0 0 8px; }
  .sp header p { margin: 4px 0; color: #b8b3a8; line-height: 1.7; }
  .sp-tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 16px 0 8px; }
  .sp-tools button { background: #1b1f28; color: #e9e6df; border: 1px solid #353b48; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
  .sp-tools button[aria-pressed="true"] { background: #c9a45c; color: #111; border-color: #c9a45c; }
  .sp-team h2 { font-size: 18px; margin: 34px 0 12px; border-bottom: 1px solid #2a2f3a; padding-bottom: 8px; }
  .sp-team h2 small { font-size: 13px; font-weight: 400; color: #9d988d; margin-left: 8px; }
  .sp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 22px 18px; }
  .sp-card { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .sp-card figcaption { font-size: 13px; line-height: 1.6; text-align: center; color: #b8b3a8; }
  .sp-card figcaption b { color: #f3efe6; }
  .sp-card i { font-style: normal; color: #8b8680; }
  .sp-card i.up { color: #7fd18b; } .sp-card i.down { color: #e38a7a; }
  .sp-card em { font-style: normal; margin-left: 6px; padding: 0 6px; border-radius: 4px; background: #3a2f18; color: #e8c77e; }
  .sp.only-moved .sp-card[data-moved="0"] { display: none; }
  [hidden] { display: none !important; }
`
let html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>首尔 2024 卡面预览</title>
<style>${readFileSync('src/styles.css', 'utf8')}</style>
<style>${readFileSync('src/ui/cards/seoul2024.css', 'utf8')}</style>
<style>${page}</style></head><body><main class="sp">
<header>
  <h1>首尔 2024 · 全部 80 张卡面</h1>
  <p>本地预览，未上线。卡面数值为当前工作区引擎生成：总评和能力按出场地图数向本届平均收缩（6 图）；卡面上的 ACS、K/D、地图数是当届原始记录。</p>
  <p>每张下方：未收缩的原快照总评 → 现在总评。稀有度 金 / 银 / 铜：原 ${count('oldRarity')} → 现 ${count('rarity')}（金 ≥84，银 ≥76）。首尔包 ${price} 金币。</p>
  <div class="sp-tools">
    <button data-view="team" aria-pressed="true">按战队（名次）</button>
    <button data-view="rating" aria-pressed="false">按总评</button>
    <button data-moved aria-pressed="false">只看稀有度变化</button>
  </div>
</header>
<div id="view-team">${byTeam}</div>
<div id="view-rating" hidden>${byRating}</div>
</main>
<script>
  const sp = document.querySelector('.sp')
  for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => {
    for (const x of document.querySelectorAll('[data-view]')) x.setAttribute('aria-pressed', String(x === b))
    document.getElementById('view-team').hidden = b.dataset.view !== 'team'
    document.getElementById('view-rating').hidden = b.dataset.view !== 'rating'
  }
  const m = document.querySelector('[data-moved]')
  m.onclick = () => { const on = !sp.classList.contains('only-moved'); sp.classList.toggle('only-moved', on); m.setAttribute('aria-pressed', String(on)) }
</script></body></html>`

// every face and the Champions mark come out of public/ as data URIs
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }
const cache = new Map()
html = html.replace(/src="(\/[^"?]+)(\?[^"]*)?"/g, (all, path) => {
  if (!MIME[extname(path)]) return all
  if (!cache.has(path)) cache.set(path, `data:${MIME[extname(path)]};base64,${readFileSync(join('public', path)).toString('base64')}`)
  return `src="${cache.get(path)}"`
})
writeFileSync(out, html)
console.log(`Wrote ${out}: ${cards.length} cards, ${cache.size} images, ${(html.length / 1024 / 1024).toFixed(1)} MB; rarity ${count('oldRarity')} → ${count('rarity')}; pack ${price}`)
