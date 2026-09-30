/** A portable, interactive, single-file proof. No server or external assets required. */
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const result = await build({ entryPoints: ['preview/bangkok.tsx'], outfile: 'bangkok.js', bundle: true, external: ['/events/*'], write: false, minify: true, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.webp': 'dataurl' } })
const inline = text => {
  for (const path of ['/events/bangkok-2025/lotus-art.webp','/faces/l-chichoo-bangkok-2025.webp','/faces/l-meteor-bangkok-2025.webp']) {
    text = text.split(path).join(`data:image/webp;base64,${readFileSync(`public${path}`).toString('base64')}`)
  }
  return text
}
const js = inline(result.outputFiles.find(f => f.path.endsWith('.js')).text).replace(/<\/script/gi, '<\\/script')
const css = inline(result.outputFiles.find(f => f.path.endsWith('.css')).text)
mkdirSync('output/bangkok-2025', { recursive: true })
writeFileSync('output/bangkok-2025/index.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>曼谷 2025 收藏系列</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`)
console.log('Built output/bangkok-2025/index.html (portable, assets embedded)')
