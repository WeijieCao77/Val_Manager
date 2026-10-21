import type { MementoData } from './model'

const sans = '"PingFang SC", "Microsoft YaHei", sans-serif'
const display = '"Arial Black", "Arial", sans-serif'
type Images = Map<string, HTMLImageElement | null>
const imageCache: Images = new Map()

// Only same-origin game assets can reach the canvas. Missing/offline portraits
// become a silhouette; they never prevent saving the poster.
async function portraits(data: MementoData): Promise<Images> {
  await Promise.all(data.members.map(async member => {
    if (!member.face || imageCache.has(member.face)) return
    const src = member.face
    try {
      const url = new URL(src, location.href)
      if (url.origin !== location.origin) return
      const img = await new Promise<HTMLImageElement | null>(resolve => {
        const image = new Image()
        const timeout = window.setTimeout(() => { image.onload = null; image.onerror = null; resolve(null) }, 4000)
        image.onload = () => { clearTimeout(timeout); resolve(image) }
        image.onerror = () => { clearTimeout(timeout); resolve(null) }
        image.src = url.href
      })
      if (img) imageCache.set(src, img)
    } catch { /* use the silhouette */ }
  }))
  return imageCache
}

function studio(ctx: CanvasRenderingContext2D) {
  const rect = (x: number, y: number, w: number, h: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h) }
  const text = (s: string, x: number, y: number, size: number, color: string, width = 960, weight = 600, family = sans) => {
    ctx.fillStyle = color; ctx.font = `${weight} ${size}px ${family}`
    while (ctx.measureText(s).width > width && size > 16) { size--; ctx.font = `${weight} ${size}px ${family}` }
    if (ctx.measureText(s).width > width) {
      const chars = Array.from(s)
      while (chars.length && ctx.measureText(chars.join('') + '…').width > width) chars.pop()
      s = chars.join('') + '…'
    }
    ctx.fillText(s, x, y)
  }
  const polygon = (points: number[][], color: string) => {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fillStyle = color; ctx.fill()
  }
  const person = (src: string | null | undefined, images: Images, x: number, y: number, w: number, h: number) => {
    const img = src ? images.get(src) : null
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
    if (img) {
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight)
      const iw = img.naturalWidth * scale, ih = img.naturalHeight * scale
      ctx.drawImage(img, x + (w - iw) / 2, y, iw, ih)
    } else {
      ctx.fillStyle = '#6b768d'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * .34, w * .19, h * .16, 0, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h, w * .49, h * .46, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }
  const quote = (message: string, y: number, color: string) => {
    let line = '', row = 0
    ctx.font = `500 26px ${sans}`
    for (const ch of Array.from(message.replace(/\s+/g, ' ').trim())) {
      if (ctx.measureText(line + ch).width > 948) { text(line, 66, y + row * 38, 26, color, 948, 500); line = ''; row++ }
      if (row > 1) break
      line += ch
    }
    if (line && row < 2) text(line, 66, y + row * 38, 26, color, 948, 500)
  }
  return { rect, text, polygon, person, quote }
}

function managerPoster(ctx: CanvasRenderingContext2D, data: MementoData, name: string, message: string, date: string, images: Images) {
  const { rect, text, polygon, person, quote } = studio(ctx)
  const ink = '#101929', blue = '#1949ed'
  rect(0, 0, 1080, 1440, '#e9eef4')
  polygon([[738, 0], [1080, 0], [1080, 956], [350, 956]], blue)
  polygon([[988, 0], [1020, 0], [380, 956], [348, 956]], '#8badff')
  text('电竞经理', 64, 86, 30, ink, 400, 800)
  text('CAREER / ARCHIVE', 718, 84, 22, ink, 300, 700, display)
  rect(64, 112, 952, 2, ink)
  text('THE LAST', 56, 243, 126, ink, 950, 900, display)
  text('LINEUP.', 56, 366, 126, ink, 950, 900, display)
  text('我的战队，我的时代。', 66, 423, 30, ink, 700, 800)
  text(data.teamTag || 'MY TEAM', 64, 524, 68, ink, 590, 900, display)
  text(data.journey, 66, 564, 24, ink, 930, 500)
  // The five starters share a single team-photo strip, not collectible cards.
  for (let i = 0; i < 5; i++) {
    const x = 64 + i * 192, member = data.members[i]
    rect(x, 608, 184, 310, i % 2 ? '#bdcde1' : '#d0dae7')
    person(member?.face, images, x, 608, 184, 310)
    const fade = ctx.createLinearGradient(0, 810, 0, 918); fade.addColorStop(0, '#10192900'); fade.addColorStop(1, '#101929')
    ctx.fillStyle = fade; ctx.fillRect(x, 810, 184, 108)
    text(member?.name || '虚位以待', x + 12, 889, 25, '#fff', 160, 800)
    rect(x, 918, 184, 5, i === 2 ? '#88b4ff' : '#101929')
  }
  text(`MANAGER / ${name.trim() || data.name}`, 66, 978, 30, ink, 750, 800)
  if (data.coach) text(`教练 ${data.coach}`, 764, 977, 20, ink, 250, 500)
  data.stats.slice(0, 4).forEach((stat, i) => {
    const x = 66 + i * 240
    rect(x, 1010, 220, 2, '#aeb9ca')
    text(stat.value, x, 1087, 54, blue, 215, 800, display)
    text(stat.label, x, 1124, 21, ink, 220, 500)
  })
  text(data.memory, 66, 1193, 22, '#46546b', 948, 500)
  rect(64, 1230, 952, 2, ink)
  quote(message, 1280, ink)
  rect(0, 1360, 1080, 80, ink)
  text('GG. WELL PLAYED.', 64, 1410, 25, '#f3f6fc', 520, 800, display)
  text(`${date} / 当前存档纪念`, 698, 1408, 19, '#b4c2d6', 320, 500)
}

function cardsPoster(ctx: CanvasRenderingContext2D, data: MementoData, name: string, message: string, date: string, cardImages: HTMLImageElement[]) {
  const { rect, text, quote } = studio(ctx)
  rect(0, 0, 1080, 1440, '#101016')
  const glow = ctx.createRadialGradient(550, 680, 30, 550, 680, 640)
  glow.addColorStop(0, '#55428b'); glow.addColorStop(.6, '#27213c'); glow.addColorStop(1, '#101016')
  ctx.fillStyle = glow; ctx.fillRect(0, 100, 1080, 1060)
  ctx.save(); ctx.translate(540, 684); ctx.rotate(-.18)
  ctx.strokeStyle = '#6e5b9f'; ctx.lineWidth = 1
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(0, 0, 430 + i * 36, 215 + i * 32, 0, 0, Math.PI * 2); ctx.stroke() }
  ctx.restore()
  text('开瓦包', 64, 85, 32, '#f3f0ff', 400, 800)
  text('COLLECTION / SAVED', 682, 82, 22, '#b5a8cf', 340, 700, display)
  rect(64, 113, 952, 1, '#635873')
  text('KEEP THE', 62, 237, 111, '#f4efff', 960, 900, display)
  // Foil typography belongs to the collection, separate from the career mark.
  const foil = ctx.createLinearGradient(70, 0, 820, 0)
  foil.addColorStop(0, '#c3affe'); foil.addColorStop(.4, '#f4e9ff'); foil.addColorStop(.7, '#9bcdd9'); foil.addColorStop(1, '#b7a0f7')
  ctx.font = `900 137px ${display}`; ctx.fillStyle = foil; ctx.fillText('RARE.', 58, 365)
  text('这一手，永久珍藏。', 66, 421, 28, '#c5b9db', 900, 500)
  const places = [{ x: 150, y: 689, a: -.16 }, { x: 345, y: 665, a: -.08 }, { x: 540, y: 642, a: 0 }, { x: 735, y: 665, a: .08 }, { x: 930, y: 689, a: .16 }]
  // Outer cards first, centre card last: a physical hand of five cards.
  for (const i of [0, 4, 1, 3, 2]) {
    const p = places[i]
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a)
    ctx.shadowColor = '#000b'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 12
    // Same 5:7 aspect as CardFace. No redrawn frame, text, or altered crop.
    ctx.drawImage(cardImages[i], -104, -145.6, 208, 291.2)
    ctx.restore()
  }
  text(name.trim() || data.name, 66, 976, 45, '#f4efff', 948, 800)
  text(data.journey, 66, 1019, 22, '#b6a9cb', 700, 500)
  if (data.coach) text(`教练 ${data.coach}`, 760, 1019, 20, '#b6a9cb', 255, 500)
  data.stats.slice(0, 4).forEach((stat, i) => {
    const x = 66 + i * 240
    rect(x, 1062, 218, 1, '#645774')
    text(stat.value, x, 1133, 48, '#e2d4ff', 213, 800, display)
    text(stat.label, x, 1171, 20, '#b6a9cb', 218, 500)
  })
  rect(64, 1230, 952, 1, '#645774')
  quote(message, 1280, '#e8e1f4')
  text('ONCE PULLED. ALWAYS YOURS.', 64, 1407, 22, '#cab6f4', 590, 800, display)
  text(`${date} / 当前存档纪念`, 698, 1407, 19, '#a89bbd', 320, 500)
}

export async function renderMemento(data: MementoData, name: string, message: string, date: string): Promise<HTMLCanvasElement> {
  const images = data.kind === 'manager' ? await portraits(data) : new Map()
  const cards = data.kind === 'cards' ? await Promise.all((data.cardImages ?? []).map(src => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('卡面载入失败，请重试。')); img.src = src
  }))) : []
  if (data.kind === 'cards' && cards.length !== 5) throw new Error('请从收藏中选择五张卡，再生成纪念图。')
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1440
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器无法生成图片，请换一个浏览器重试。')
  if (data.kind === 'cards') cardsPoster(ctx, data, name, message, date, cards)
  else managerPoster(ctx, data, name, message, date, images)
  return canvas
}
