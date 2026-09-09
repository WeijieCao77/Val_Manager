/**
 * The five, as a picture worth sending to somebody.
 *
 * A screenshot of the squad screen carries the browser chrome, the nav, the
 * theme the sender happens to be using, and no way back to the game. This
 * draws the same five deliberately: one portrait card at a fixed size, in the
 * game's own colours whatever the reader's theme is, with a QR code in the
 * corner so the person it is sent to can be playing thirty seconds later.
 *
 * The geometry is a pure function (`shareLayout`) and the painting is a pass
 * over what it returns, so scripts/check_share_card.ts can check that nothing
 * lands outside the canvas or on top of anything else without a canvas to
 * draw on.
 */
import { cardById, isPlayerCard, ratingAt } from '../../engine/cards'
import type { Card, CoachCard, Rarity, Squad } from '../../engine/cards'
import { crestUrl } from '../../engine/dossier'
import { qrMatrix } from '../../engine/qr'

export const SHARE_URL = 'https://vctgames.com'
export const SHARE_W = 1080

export interface Box { x: number; y: number; w: number; h: number }

export interface ShareLayout {
  width: number
  height: number
  /** the five seats, left to right */
  seats: Box[]
  coach: Box
  stats: Box
  qr: Box
  header: Box
  footer: Box
}

/**
 * Where everything sits. One column of blocks down a portrait card: title,
 * the five across the middle, then the coach and the two numbers beside the
 * QR code.
 */
export function shareLayout(width = SHARE_W): ShareLayout {
  const pad = 56
  const inner = width - pad * 2
  // Five whole-pixel cards and four whole-pixel gaps rarely add up to the
  // width on the first try, and a row that is one pixel narrow sits one pixel
  // off centre for ever. So the gap gives way until the arithmetic is exact.
  let gap = 18
  while (gap > 6 && (inner - gap * 4) % 5 !== 0) gap--
  const seatW = (inner - gap * 4) / 5
  const seatH = Math.round(seatW * (212 / 132))
  const seatsY = 372
  const seats = Array.from({ length: 5 }, (_, i) => ({
    x: pad + i * (seatW + gap), y: seatsY, w: seatW, h: seatH,
  }))
  const lowerY = seatsY + seatH + 64
  const qrSide = 260
  // the coach plate holds a card of the same shape as the five, so it does
  // not sit there looking squashed next to them
  const coachW = 182
  const coachH = 48 + Math.round((coachW - 32) * (212 / 132)) + 16
  const rowH = Math.max(coachH, 268)
  // the QR code carries a caption and the address under it
  const qrBlock = qrSide + 80
  // The height follows the content. It was a constant, and the constant left
  // four hundred empty pixels above the footer.
  const footY = lowerY + Math.max(rowH, qrBlock) + 46
  return {
    width,
    height: footY + 76,
    seats,
    coach: { x: pad, y: lowerY, w: coachW, h: coachH },
    stats: { x: pad + coachW + 40, y: lowerY, w: inner - coachW - 40 - qrSide - 40, h: rowH },
    qr: { x: width - pad - qrSide, y: lowerY, w: qrSide, h: qrSide },
    header: { x: pad, y: 76, w: inner, h: 240 },
    footer: { x: pad, y: footY, w: inner, h: 60 },
  }
}

/** the picture's height, which follows its content */
export const SHARE_H = shareLayout().height

export interface ShareModel {
  squad: Squad
  level: (cardId: string) => number
  /** the owner's display name, and the four characters after it */
  who: { name: string; tag?: string }
  rating: number
  chem: number
  /** what to write under the QR code, and what the QR code carries */
  url?: string
}

const INK = '#f2f5f9'
const FAINT = 'rgba(242,245,249,.55)'
const PANEL = '#141a24'

/** the two ends of each metal's gradient, and the ink that reads on it */
const METAL: Record<Rarity, { a: string; b: string; edge: string; ink: string }> = {
  mythic: { a: '#6d2a86', b: '#2b4fa8', edge: 'rgba(255,255,255,.7)', ink: '#f4f2ff' },
  gold: { a: '#f6d878', b: '#9d6f1c', edge: '#ffe9a3', ink: '#241a04' },
  silver: { a: '#e6ecf3', b: '#7d8b9b', edge: '#f2f6fa', ink: '#151c25' },
  bronze: { a: '#d8a274', b: '#74451f', edge: '#eec5a1', ink: '#1c1206' },
}

const round = (ctx: CanvasRenderingContext2D, b: Box, r: number) => {
  ctx.beginPath()
  ctx.moveTo(b.x + r, b.y)
  ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, r)
  ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, r)
  ctx.arcTo(b.x, b.y + b.h, b.x, b.y, r)
  ctx.arcTo(b.x, b.y, b.x + b.w, b.y, r)
  ctx.closePath()
}

const font = (weight: number, size: number) =>
  `${weight} ${size}px "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif`

/** Fit `text` into `max` pixels, shrinking a step at a time before clipping. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number, weight: number, size: number): number {
  let s = size
  while (s > 8) {
    ctx.font = font(weight, s)
    if (ctx.measureText(text).width <= max) return s
    s -= 1
  }
  return s
}

/** how wide `text` is at that weight and size, without disturbing the state */
function measure(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number): number {
  const was = ctx.font
  ctx.font = font(weight, size)
  const w = ctx.measureText(text).width
  ctx.font = was
  return w
}

/** Load an image, or null — a missing face must not stop the picture. */
const load = (src: string | null): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    if (!src) { resolve(null); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })

/** the photo, cropped to fill its box from the top — faces sit high */
function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, b: Box): void {
  const scale = Math.max(b.w / img.width, b.h / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.drawImage(img, b.x + (b.w - w) / 2, b.y, w, h)
}

/**
 * One card, drawn the way the collection draws it.
 *
 * Everything below is the .cardface stylesheet at a scale factor: the same
 * 132-wide box, the same 21px rating in the same corner, the same 74px round
 * portrait 31px down, the same six attributes in two rows of three. A share
 * image whose cards are a different shape from the cards in the game reads as
 * a different game — 「卡片比例和页面内容和收藏里的长一样就好了」.
 */
function paintSeat(
  ctx: CanvasRenderingContext2D, b: Box, card: Card | null, role: string,
  level: number, face: HTMLImageElement | null, crest: HTMLImageElement | null,
): void {
  if (!card) {
    ctx.save()
    round(ctx, b, 10)
    ctx.fillStyle = 'rgba(255,255,255,.04)'
    ctx.fill()
    ctx.setLineDash([7, 6])
    ctx.strokeStyle = 'rgba(255,255,255,.22)'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = FAINT
    ctx.font = font(600, Math.round(b.w * 0.12))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(role, b.x + b.w / 2, b.y + b.h / 2)
    ctx.textBaseline = 'alphabetic'
    return
  }
  // the stylesheet's numbers are for a 132-wide card
  const k = b.w / 132
  const metal = METAL[card.rarity]
  const player = isPlayerCard(card) ? card : null
  const legend = !!card.legend
  // a 彩卡 IS the photograph: it fills the card and the type sits on a scrim,
  // exactly as .cardface.shot does
  const shot = card.rarity === 'mythic' && !!face
  const ink = shot ? '#f4f2ff' : metal.ink

  ctx.save()
  round(ctx, b, 7 * k)
  ctx.clip()
  const grad = ctx.createLinearGradient(b.x, b.y, b.x + b.w * 0.4, b.y + b.h)
  grad.addColorStop(0, metal.a)
  grad.addColorStop(1, metal.b)
  ctx.fillStyle = grad
  ctx.fillRect(b.x, b.y, b.w, b.h)

  if (shot && face) {
    cover(ctx, face, b)
    const scrim = ctx.createLinearGradient(0, b.y, 0, b.y + b.h)
    scrim.addColorStop(0, 'rgba(10,7,24,.45)')
    scrim.addColorStop(0.45, 'rgba(10,7,24,.18)')
    scrim.addColorStop(1, 'rgba(10,7,24,.86)')
    ctx.fillStyle = scrim
    ctx.fillRect(b.x, b.y, b.w, b.h)
  }
  // the sheen, one static diagonal band, as .cardface::before
  const sheen = ctx.createLinearGradient(b.x, b.y + b.h, b.x + b.w, b.y)
  sheen.addColorStop(0.34, 'rgba(255,255,255,0)')
  sheen.addColorStop(0.47, 'rgba(255,255,255,.18)')
  sheen.addColorStop(0.6, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(b.x, b.y, b.w, b.h)
  ctx.restore()

  ctx.textBaseline = 'top'
  // ---- the corner: rating, level, positions
  ctx.textAlign = 'left'
  ctx.fillStyle = ink
  const rateSize = 21 * k
  ctx.font = font(800, rateSize)
  const rate = String(ratingAt(card.rating, level))
  ctx.fillText(rate, b.x + 9 * k, b.y + 7 * k)
  if (level > 0) {
    ctx.fillStyle = shot ? 'rgba(255,220,220,.95)' : '#7a2018'
    ctx.font = font(800, 9.5 * k)
    ctx.fillText(`+${level}`, b.x + 9 * k + measure(ctx, rate, 800, rateSize) + 3 * k,
      b.y + 7 * k + rateSize - 10 * k)
  }
  ctx.fillStyle = ink
  ctx.globalAlpha = 0.72
  ctx.font = font(700, 9 * k)
  const kinds = player
    ? player.roles.slice(0, 2).map((r, i) => r.slice(0, 2) + (i === 1 && player.roles.length > 2 ? '+' : ''))
    : [(card as CoachCard).spec ? '分析' : '教练']
  kinds.forEach((line, i) => {
    ctx.fillText(line, b.x + 9 * k, b.y + 7 * k + rateSize + 3 * k + i * 11 * k)
  })
  ctx.globalAlpha = 1

  // ---- the other corner: the club's crest, or a legend's star
  if (legend) {
    ctx.textAlign = 'right'
    ctx.fillStyle = ink
    ctx.font = font(700, 17 * k)
    ctx.fillText('★', b.x + b.w - 8 * k, b.y + 6 * k)
  } else if (crest) {
    ctx.globalAlpha = 0.92
    ctx.drawImage(crest, b.x + b.w - 8 * k - 30 * k, b.y + 7 * k, 30 * k, 30 * k)
    ctx.globalAlpha = 1
  }

  // ---- the portrait
  const dia = 74 * k
  const cx = b.x + b.w / 2
  const photoTop = b.y + 8 * k + 31 * k
  if (!shot) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, photoTop + dia / 2, dia / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = 'rgba(255,255,255,.22)'
    ctx.fillRect(cx - dia / 2, photoTop, dia, dia)
    if (face) cover(ctx, face, { x: cx - dia / 2, y: photoTop, w: dia, h: dia })
    ctx.restore()
    ctx.beginPath()
    ctx.arc(cx, photoTop + dia / 2, dia / 2, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,.5)'
    ctx.lineWidth = Math.max(1, k)
    ctx.stroke()
  }

  // ---- name, club, attributes: the bottom block, measured up from the foot
  const rule = (y: number) => {
    ctx.fillStyle = shot ? 'rgba(255,255,255,.28)' : 'rgba(23,20,13,.28)'
    ctx.fillRect(b.x + 8 * k, y, b.w - 16 * k, Math.max(1, k * 0.8))
  }
  const attrs: [string, number][] = player
    ? ([['aim', '枪法'], ['reaction', '反应'], ['awareness', '意识'],
        ['utility', '道具'], ['clutch', '残局'], ['igl', '指挥']] as const)
      .map(([key, label]) => [label, player.attrs[key]] as [string, number])
    : [['战术', (card as CoachCard).tactics], ['培养', (card as CoachCard).development],
       ['激励', (card as CoachCard).motivation]]
  const rows = Math.ceil(attrs.length / 3)
  const attrH = rows * 12 * k + 1 * k
  const bottom = b.y + b.h - 7 * k
  const attrsTop = bottom - attrH
  rule(attrsTop - 5 * k)
  const metaTop = attrsTop - 5 * k - 6 * k - 12 * k
  const nameTop = metaTop - 1 * k - 16 * k
  rule(nameTop - 5 * k)

  ctx.textAlign = 'center'
  ctx.fillStyle = ink
  const nm = player ? player.ign : (card as CoachCard).name
  ctx.font = font(800, fit(ctx, nm, b.w - 14 * k, 800, 13 * k))
  ctx.fillText(nm, cx, nameTop)

  ctx.globalAlpha = 0.84
  ctx.font = font(700, 10 * k)
  const club = card.clubTag ?? (player ? '自由人' : '自由身')
  const iglTag = player?.isIgl ? ' IGL' : ''
  ctx.fillText(club + iglTag, cx, metaTop)
  ctx.globalAlpha = 1

  const colW = (b.w - 16 * k) / 3
  attrs.forEach(([label, value], i) => {
    const col = i % 3
    const rowY = attrsTop + Math.floor(i / 3) * 12 * k
    const x0 = b.x + 8 * k + col * colW
    ctx.textAlign = 'left'
    ctx.globalAlpha = 0.66
    ctx.font = font(500, 9.5 * k)
    ctx.fillText(label, x0, rowY)
    ctx.globalAlpha = 1
    ctx.textAlign = 'right'
    ctx.font = font(800, 9.5 * k)
    ctx.fillText(String(value), x0 + colW - 4 * k, rowY)
  })

  ctx.textBaseline = 'alphabetic'
  round(ctx, b, 7 * k)
  ctx.strokeStyle = metal.edge
  ctx.lineWidth = Math.max(1, k)
  ctx.stroke()
}

function paintQr(ctx: CanvasRenderingContext2D, b: Box, url: string): void {
  ctx.fillStyle = '#fff'
  round(ctx, b, 16)
  ctx.fill()
  // Level Q recovers a quarter of the symbol, which is what makes a code
  // printed into a picture survive a screenshot of a screenshot.
  const m = qrMatrix(url, 'Q')
  const quiet = 2
  const cell = Math.floor((b.w - 28) / (m.length + quiet * 2))
  const side = cell * (m.length + quiet * 2)
  const x0 = b.x + (b.w - side) / 2 + cell * quiet
  const y0 = b.y + (b.h - side) / 2 + cell * quiet
  ctx.fillStyle = '#0d1117'
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m.length; x++) if (m[y][x]) ctx.fillRect(x0 + x * cell, y0 + y * cell, cell, cell)
  }
}

/**
 * Draw the whole thing onto `canvas`, at SHARE_W × SHARE_H.
 *
 * Async only because the photographs have to arrive first; a face that fails
 * to load leaves its plate empty rather than failing the picture.
 */
export async function paintShare(canvas: HTMLCanvasElement, model: ShareModel): Promise<void> {
  const L = shareLayout()
  canvas.width = L.width
  canvas.height = L.height
  const ctx = canvas.getContext('2d')!
  const url = model.url ?? SHARE_URL

  const seatCards = model.squad.slots.map((id) => (id ? cardOf(id) : null))
  const coachCard = model.squad.coach ? cardOf(model.squad.coach) : null
  const all = [...seatCards, coachCard]
  const faces = await Promise.all(all.map((c) => load(c?.face ?? null)))
  const crests = await Promise.all(all.map((c) => load(c?.clubId ? crestUrl(c.clubId) : null)))

  // ---- the plate
  const bg = ctx.createLinearGradient(0, 0, L.width, L.height)
  bg.addColorStop(0, '#0b1017')
  bg.addColorStop(0.55, '#101826')
  bg.addColorStop(1, '#0a0e15')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, L.width, L.height)
  const glow = ctx.createRadialGradient(L.width / 2, 300, 40, L.width / 2, 300, 900)
  glow.addColorStop(0, 'rgba(255,70,85,.20)')
  glow.addColorStop(1, 'rgba(255,70,85,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, L.width, 900)

  // ---- who this is
  ctx.textAlign = 'left'
  ctx.fillStyle = '#ff4655'
  ctx.font = font(800, 40)
  ctx.fillText('开瓦包', L.header.x, L.header.y + 40)
  ctx.fillStyle = FAINT
  ctx.font = font(600, 20)
  ctx.letterSpacing = '6px'
  ctx.fillText('VAL CARDS', L.header.x, L.header.y + 74)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = INK
  const nameSize = fit(ctx, model.who.name, L.header.w - 260, 800, 76)
  ctx.font = font(800, nameSize)
  ctx.fillText(model.who.name, L.header.x, L.header.y + 176)
  if (model.who.tag) {
    ctx.fillStyle = FAINT
    ctx.font = font(600, 30)
    ctx.fillText(`#${model.who.tag}`, L.header.x + measure(ctx, model.who.name, 800, nameSize) + 14, L.header.y + 176)
  }
  ctx.fillStyle = FAINT
  ctx.font = font(500, 26)
  ctx.fillText('我的首发五人', L.header.x, L.header.y + 226)

  // ---- the five
  const ROLES = ['决斗者', '先锋', '控场', '哨卫', '自由人']
  L.seats.forEach((b, i) => {
    paintSeat(ctx, b, seatCards[i], ROLES[i], seatCards[i] ? model.level(seatCards[i]!.id) : 0, faces[i], crests[i])
  })

  // ---- the coach
  ctx.fillStyle = 'rgba(255,255,255,.05)'
  round(ctx, L.coach, 14)
  ctx.fill()
  ctx.textAlign = 'left'
  ctx.fillStyle = FAINT
  ctx.font = font(600, 20)
  ctx.fillText('教练', L.coach.x + 16, L.coach.y + 32)
  if (coachCard) {
    const inner = { x: L.coach.x + 16, y: L.coach.y + 48, w: L.coach.w - 32, h: L.coach.h - 64 }
    paintSeat(ctx, inner, coachCard, '教练', model.level(coachCard.id), faces[5], crests[5])
  } else {
    ctx.fillStyle = FAINT
    ctx.font = font(500, 22)
    ctx.fillText('没有教练', L.coach.x + 16, L.coach.y + 150)
  }

  // ---- the two numbers
  ctx.fillStyle = PANEL
  round(ctx, L.stats, 14)
  ctx.fill()
  const half = L.stats.w / 2
  const pair: [string, number, string][] = [
    ['阵容分', model.rating, INK],
    ['默契', model.chem, model.chem >= 60 ? '#4ade80' : model.chem >= 35 ? '#fbbf24' : '#f87171'],
  ]
  pair.forEach(([label, value, colour], i) => {
    const cx = L.stats.x + half * i + half / 2
    ctx.textAlign = 'center'
    ctx.fillStyle = FAINT
    ctx.font = font(600, 24)
    ctx.fillText(label, cx, L.stats.y + 66)
    ctx.fillStyle = colour
    ctx.font = font(800, 96)
    ctx.fillText(String(value), cx, L.stats.y + 172)
  })
  ctx.fillStyle = FAINT
  ctx.font = font(500, 21)
  ctx.textAlign = 'center'
  ctx.fillText('默契来自同队、同国籍、同赛区', L.stats.x + L.stats.w / 2, L.stats.y + 228)

  // ---- the way back
  paintQr(ctx, L.qr, url)
  ctx.textAlign = 'center'
  ctx.fillStyle = INK
  ctx.font = font(700, 24)
  ctx.fillText('扫码开一局', L.qr.x + L.qr.w / 2, L.qr.y + L.qr.h + 38)
  ctx.fillStyle = FAINT
  ctx.font = font(500, 21)
  ctx.fillText(url.replace(/^https?:\/\//, ''), L.qr.x + L.qr.w / 2, L.qr.y + L.qr.h + 68)

  ctx.textAlign = 'left'
  ctx.fillStyle = FAINT
  ctx.font = font(500, 22)
  ctx.fillText('猪之家出品 · VCT电竞经理 · 开瓦包', L.footer.x, L.footer.y + 30)
}

const cardOf = (id: string): Card | null => cardById(id) ?? null
