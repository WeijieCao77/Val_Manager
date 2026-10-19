/** Offline preview of the whole 洛杉矶 2023 series — pack, back and all 80 faces
 * as engine/losangeles2023.ts builds them — with how sure each photo's caption
 * match is. One self-contained file: stylesheets and images are inlined.
 * render_bangkok_cards.mjs for the third series.
 *
 *   node scripts/render_losangeles_cards.mjs [out=analysis/losangeles_cards.html]
 */
import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const out = process.argv[2] ?? 'analysis/losangeles_cards.html'
mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true })
const dir = mkdtempSync(join(root, 'node_modules', '.cache', 'losangeles-cards-'))
const bundle = join(dir, 'render.mjs')
await build({
  stdin: {
    resolveDir: root, loader: 'tsx', contents: `
      import { renderToStaticMarkup } from 'react-dom/server'
      import { BASE_PLAYER_CARDS } from './src/engine/cards'
      import { LOS_ANGELES_TEAMS, buildLosAngelesCards, losAngelesFace } from './src/engine/losangeles2023'
      import { LosAngelesCard, LosAngelesBack, LosAngelesPack } from './src/ui/cards/LosAngelesDesign'
      import { natCountry } from './src/engine/nat'
      export const teams = LOS_ANGELES_TEAMS
      export const back = renderToStaticMarkup(<LosAngelesBack />)
      export const pack = renderToStaticMarkup(<LosAngelesPack />)
      const cards = buildLosAngelesCards(BASE_PLAYER_CARDS)
      export const total = cards.length
      export const list = cards.map(c => {
        const p = c.losAngeles, f = losAngelesFace(p.vlrId)
        const player = {
          ign: c.ign, team: c.clubTag, nation: (natCountry(c.nat) ?? '').toUpperCase(), number: String(p.number).padStart(3, '0') + ' / ' + String(cards.length).padStart(3, '0'),
          photo: c.face, rating: c.rating, acs: p.acs, kd: p.kd, maps: p.maps, label: c.role.slice(0, 2), igl: c.isIgl, photoStyle: f?.style,
        }
        return {
          ign: c.ign, team: c.clubTag, number: p.number, maps: p.maps, vlr: p.rating, rating: c.rating, rarity: c.rarity, igl: c.isIgl,
          role: c.role, realName: c.realName, face: f ?? null,
          html: renderToStaticMarkup(<LosAngelesCard player={player} rarity={c.rarity} />),
        }
      })`,
  },
  bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: bundle, jsx: 'automatic',
  loader: { '.css': 'empty' }, logLevel: 'warning',
})
const { teams, back, pack, total, list: cards } = await import(pathToFileURL(bundle).href)
// the game shows the pack as a 3D foil pouch printed with losAngelesPackTexture.ts; Codex's flat artwork stands in here
const pouch = `<figure class="bp-pouch">${pack}<figcaption>卡包（平面稿；游戏里印在立体铝箔包上）</figcaption></figure>`
rmSync(dir, { recursive: true, force: true })

const CN = { gold: '金', silver: '银', bronze: '铜' }
const PLACE = { 1: '冠军', 2: '亚军', 3: '季军', 4: '第四', 5: '5–6 名', 7: '7–8 名', 9: '9–12 名', 13: '13–16 名' }
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
const count = ['gold', 'silver', 'bronze'].map((r) => cards.filter((c) => c.rarity === r).length)
const unsure = cards.filter((c) => !c.face?.sure)

const tile = (c) => {
  const f = c.face
  const photo = !f ? '<span class="warn">⚠ 没有洛杉矶照片，用的是资料库头像</span>'
    : f.confirmed ? `<span class="ok">照片：你已确认</span>`
    : f.sure ? `<span class="ok">照片：Riot 说明文字写的是他</span>${f.note ? `<br><span class="note">${esc(f.note)}</span>` : ''}`
    : `<span class="warn">⚠ 照片不确定：${esc(f.note ?? '')}</span>`
  return `<figure class="bp-card" data-unsure="${f?.sure ? 0 : 1}">${c.html}<figcaption>
    <b>${esc(c.ign)}</b> <span>${esc(c.realName ?? '')}</span><br>
    ${esc(c.team)} · ${c.maps} 图 · VLR ${c.vlr.toFixed(2)} · ${esc(c.role)}${c.igl ? ' · 指挥' : ''} · <b>${c.rating}</b> ${CN[c.rarity]}<br>
    ${photo}${f?.source ? ` · <a href="${f.source}" target="_blank" rel="noreferrer">原图</a>` : ''}
  </figcaption></figure>`
}
const byTeam = [...teams].sort((a, b) => a.placement - b.placement).map((t) => {
  const five = cards.filter((c) => c.team === t.tag).sort((a, b) => a.number - b.number)
  const mean = (five.reduce((s, c) => s + c.rating, 0) / five.length).toFixed(1)
  return `<section class="bp-team"><h2>${esc(t.tag)} <small>${esc(t.name)} · ${PLACE[t.placement] ?? t.placement} · 均分 ${mean}</small></h2>
    <div class="bp-grid">${five.map(tile).join('')}</div></section>`
}).join('')
const byRating = `<div class="bp-grid">${[...cards].sort((a, b) => b.rating - a.rating || b.maps - a.maps).map(tile).join('')}</div>`

const css = `
  body { background: #120e16; margin: 0; }
  .bp { max-width: 1320px; margin: 0 auto; padding: 28px 20px 60px; color: #ece8f4; font-family: -apple-system, "PingFang SC", "Noto Sans SC", sans-serif; }
  .bp header h1 { font-size: 24px; margin: 0 0 8px; }
  .bp header p { margin: 4px 0; color: #b9b0c9; line-height: 1.7; font-size: 14px; }
  .bp-hero { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 280px)); gap: 24px; margin: 22px 0 8px; align-items: end; }
  .bp-hero figure { margin: 0; } .bp-pouch img { width: 100%; display: block; } .bp-hero figcaption { text-align: center; font-size: 13px; color: #b9b0c9; margin-top: 8px; }
  .bp-tools { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0 6px; }
  .bp-tools button { background: #1c1629; color: #ece8f4; border: 1px solid #3b3150; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 14px; }
  .bp-tools button[aria-pressed="true"] { background: #f4ce95; color: #211922; border-color: #f4ce95; }
  .bp-team > h2 { font-size: 18px; margin: 34px 0 12px; border-bottom: 1px solid #2d2540; padding-bottom: 8px; }
  .bp-team > h2 small { font-size: 13px; font-weight: 400; color: #a197b3; margin-left: 8px; }
  .bp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 24px 18px; }
  .bp-card { margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .bp-card figcaption { font-size: 12.5px; line-height: 1.65; color: #b9b0c9; }
  .bp-card figcaption b { color: #f6f2ff; }
  .bp-card a { color: #b9a6e6; }
  .ok { color: #9fd49a; } .note { color: #948aa6; } .warn { color: #f1b36b; font-weight: 600; }
  .bp.only-unsure .bp-card[data-unsure="0"] { display: none; }
  [hidden] { display: none !important; }
  @media (max-width: 520px) { .bp-grid { grid-template-columns: repeat(2, 1fr); gap: 16px 10px; } .bp-card figcaption { font-size: 11.5px; } }
`
let html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>洛杉矶 2023 卡面预览</title>
<style>${readFileSync('src/ui/cards/losAngeles2023.css', 'utf8')}</style>
<style>${css}</style></head><body><main class="bp">
<header>
  <h1>洛杉矶 2023 · 全部 ${total} 张卡面</h1>
  <p>本地预览。卡面、卡背、卡包是工作区里 Codex 做的「逐日 / ONE MORE」设计，卡面填入真实数据。</p>
  <p>数值和首尔 2024、曼谷 2025 同一套公式：本届 VLR 数据按出场地图数向全场平均收缩（6 图），后面的轮次权重更高（小组赛 1、胜者组四分之一决赛和败者组前两轮 1.5、胜者组半决赛到败者组决赛 2、总决赛 3），指挥按名次加分（用的是 2023 年当时的指挥：TL 是 Redgar、DRX 是 stax、EDG 是 Haodong），先锋按 KAST 和助攻加分，赛事 MVP Demon1 加 5。本届没有替补上场。金 ≥84、银 ≥76：金 ${count[0]} / 银 ${count[1]} / 铜 ${count[2]}。卡面上的 ACS、K/D、地图数是当届原始记录。</p>
  <p>照片是 Riot 在洛杉矶冠军赛 Features Day（2023-08-02 至 08-04）拍的照片，按官方说明文字对应选手；T1 没参加 Features Day，用的是 8 月 5 日小组赛场馆的照片。说明文字不等于核实过本人（首尔那套出过一次说明写错人）。${unsure.length ? `<b class="warn">橙色标注 ${unsure.length} 张</b>是程序拿不准的（双人照、拍摄时间挨着别人），请重点看；其余也请过目。` : '按拍摄时间查过，没有拿不准的，请过目。'}</p>
  <div class="bp-hero">
    ${pouch}
    <figure>${back}<figcaption>统一卡背</figcaption></figure>
  </div>
  <div class="bp-tools">
    <button data-view="team" aria-pressed="true">按战队（名次）</button>
    <button data-view="rating" aria-pressed="false">按总评</button>
    <button data-unsure aria-pressed="false">只看不确定的照片（${unsure.length}）</button>
  </div>
</header>
<div id="view-team">${byTeam}</div>
<div id="view-rating" hidden>${byRating}</div>
</main>
<script>
  const bp = document.querySelector('.bp')
  for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => {
    for (const x of document.querySelectorAll('[data-view]')) x.setAttribute('aria-pressed', String(x === b))
    document.getElementById('view-team').hidden = b.dataset.view !== 'team'
    document.getElementById('view-rating').hidden = b.dataset.view !== 'rating'
  }
  const u = document.querySelector('[data-unsure]')
  u.onclick = () => { const on = !bp.classList.contains('only-unsure'); bp.classList.toggle('only-unsure', on); u.setAttribute('aria-pressed', String(on)) }
</script></body></html>`

// React's server render adds a preload hint per image; the images are inlined, so the hints only 404
html = html.replace(/<link rel="preload" as="image" href="[^"]*"\/>/g, '')
// every image out of public/ as a data URI, in src="" and in css url()
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' }
const cache = new Map()
const inline = (path) => {
  if (!MIME[extname(path)]) return null
  if (!cache.has(path)) {
    try { cache.set(path, `data:${MIME[extname(path)]};base64,${readFileSync(join('public', path)).toString('base64')}`) } catch { cache.set(path, null) }
  }
  return cache.get(path)
}
html = html.replace(/src="(\/[^"?]+)(\?[^"]*)?"/g, (all, path) => { const d = inline(path); return d ? `src="${d}"` : all })
html = html.replace(/url\((['"]?)(\/[^'")?]+)\1\)/g, (all, q, path) => { const d = inline(path); return d ? `url("${d}")` : all })
writeFileSync(out, html)
console.log(`${out}: ${cards.length} cards, ${unsure.length} unsure photos, ${(html.length / 1e6).toFixed(1)} MB`)
