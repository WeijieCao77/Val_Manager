import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { toPng } from 'html-to-image'
import CardFace from '../Card'
import type { Card } from '../../engine/cards'

const cache = new Map<string, string>()
/** Rasterize the game's actual CardFace, including event/legend-specific layouts. */
export async function captureCards(cards: { card: Card; level: number }[]): Promise<string[]> {
  const host = document.createElement('div')
  host.className = 'memento-card-capture'
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:240px;pointer-events:none;'
  document.body.append(host)
  const root = createRoot(host)
  try {
    const results: string[] = []
    for (const { card, level } of cards) {
      const key = `${card.id}:${level}:${document.documentElement.dataset.theme ?? ''}`
      const cached = cache.get(key)
      if (cached) { results.push(cached); continue }
      flushSync(() => root.render(<div style={{ width: 240, height: 336 }}><CardFace card={card} level={level} /></div>))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const node = host.firstElementChild as HTMLElement
      await Promise.all(Array.from(node.querySelectorAll('img')).map(async image => {
        image.loading = 'eager'
        let timeout: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([image.decode(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('卡面图片加载超时，请重试。')), 8000) })])
        } finally { clearTimeout(timeout) }
      }))
      await document.fonts.ready
      const opts = { pixelRatio: 3, width: 240, height: 336, fontEmbedCSS: '' }
      if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) await toPng(node, opts)
      const png = await toPng(node, opts)
      if (cache.size >= 30) cache.delete(cache.keys().next().value!)
      cache.set(key, png); results.push(png)
    }
    return results
  } finally { root.unmount(); host.remove() }
}
