import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
mkdirSync(join(root, 'node_modules/.cache'), { recursive: true })
const dir = mkdtempSync(join(root, 'node_modules/.cache/seoul-pack-'))
try {
  const bundle = join(dir, 'render.mjs')
  await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { renderToStaticMarkup } from 'react-dom/server'
      import { SeoulPackArtwork, SeoulCardBack } from './src/ui/cards/SeoulDesign'
      export const pack = renderToStaticMarkup(<SeoulPackArtwork />)
      export const back = renderToStaticMarkup(<SeoulCardBack />)
    ` },
    bundle: true, packages: 'external', platform: 'node', format: 'esm',
    outfile: bundle, jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'warning',
  })
  const { pack, back } = await import(pathToFileURL(bundle).href)
  const mark = `data:image/png;base64,${readFileSync('public/events/seoul-2024/champions.png').toString('base64')}`
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>首尔 2024 · 卡包与卡背</title>
    <style>${readFileSync('src/styles.css', 'utf8')}\n${readFileSync('src/ui/cards/seoul2024.css', 'utf8')}</style>
    <style>
      body{margin:0;background:#090d13;color:#eee4cf;font-family:system-ui,"PingFang SC",sans-serif}
      main{max-width:920px;margin:auto;padding:48px 28px 60px}
      header{border-bottom:1px solid #c7b47740;padding-bottom:25px}
      header small{color:#c7b477;letter-spacing:.18em;font:10px monospace}
      h1{font-size:28px;font-weight:500;margin:14px 0 8px}
      header p{font-size:13px;color:#939997;margin:0}
      .objects{display:flex;justify-content:center;align-items:flex-end;gap:100px;padding:64px 0 40px;flex-wrap:wrap}
      figure{margin:0;width:220px}
      .cardback.sc24-back{width:220px;padding:22px 18px}
      figcaption{margin-top:26px;font-size:14px;text-align:center;color:#ddd1b4}
      figcaption small{display:block;color:#89918f;font-size:11px;margin-top:8px}
      footer{border-top:1px solid #c7b47730;padding-top:20px;font-size:11px;color:#89918f;line-height:1.8}
      @media(max-width:600px){main{padding:30px 20px}.objects{gap:42px;padding-top:40px}h1{font-size:24px}}
    </style></head><body><main>
    <header><small>CHAMPIONS SEOUL / 2024 COLLECTION</small><h1>首尔 2024 · 卡包与卡背</h1><p>黑金超新星系列</p></header>
    <div class="objects"><figure>${pack}<figcaption>卡包正面<small>金属封口 · 3 张收藏卡</small></figcaption></figure>
    <figure>${back}<figcaption>收藏卡背面<small>冠军赛标志 · 环绕金线</small></figcaption></figure></div>
    <footer>当前游戏组件的静态预览。3D 撕包与翻牌动效需在开包界面查看。</footer>
    </main></body></html>`
  writeFileSync('analysis/seoul_pack.html', html.replaceAll('/events/seoul-2024/champions.png', mark))
  console.log('Wrote analysis/seoul_pack.html')
} finally { rmSync(dir, { recursive: true, force: true }) }
