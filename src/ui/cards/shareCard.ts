import { natCountry } from '../../engine/nat'
import { squadTeamIdentity, teamBackdrop } from '../../engine/teamIdentity'
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
import { MAX_LEVEL, RARITY_CN, cardById, isPlayerCard } from '../../engine/cards'
import type { Card, CoachCard, PlayerCard, Rarity, Squad } from '../../engine/cards'
import { crestUrl } from '../../engine/dossier'
import { qrMatrix } from '../../engine/qr'
import { ATTR_CN } from '../../engine/types'

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
  // The coach holds a card exactly the size of the five: a coach drawn at two
  // thirds of a player read as an afterthought. The QR code only has to scan:
  // eight pixels a module is what survives a 25% thumbnail, and the white
  // plate around it does the work of most of the quiet zone.
  const qrSide = 224
  const coachW = seatW + 32
  const coachH = 48 + seatH + 16
  // the QR code carries a caption and the address under it
  const qrBlock = qrSide + 80
  const rowH = Math.max(coachH, qrBlock)
  // The height follows the content. It was a constant, and the constant left
  // four hundred empty pixels above the footer.
  const footY = lowerY + rowH + 46
  return {
    width,
    height: footY + 76,
    seats,
    coach: { x: pad, y: lowerY, w: coachW, h: coachH },
    stats: { x: pad + coachW + 32, y: lowerY, w: inner - coachW - 32 - qrSide - 32, h: rowH },
    qr: { x: width - pad - qrSide, y: lowerY, w: qrSide, h: qrSide },
    header: { x: pad, y: 76, w: inner, h: 240 },
    footer: { x: pad, y: footY, w: inner, h: 60 },
  }
}

/** the QR code's inner margin and quiet zone, shared with scripts/check_share_card.ts */
export const QR_INSET = 8
export const QR_QUIET = 1

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

/**
 * The level as the faces print it: the whole level, and an arrow once 进修 has
 * taken the card past +5 (a match's level carries that as a fraction —
 * 「+5.56」 is not something a card says).
 */
const levelMark = (level: number): string => {
  const whole = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)))
  return whole > 0 ? `+${whole}${level > MAX_LEVEL ? '↑' : ''}` : ''
}

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
  mark: HTMLImageElement | null = null, lotus: HTMLImageElement | null = null, ember: HTMLImageElement | null = null,
): void {
  if (card && isSeoul(card)) { paintSeoulSeat(ctx, b, card, level, face, mark); return }
  if (card && isBangkok(card)) { paintBangkokSeat(ctx, b, card, level, face, lotus); return }
  if (card && isRetired(card)) { paintRetiredSeat(ctx, b, card, level, face, ember); return }
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
  const metal = isPlayerCard(card) ? METAL[card.rarity] : { ...METAL[card.rarity], a:'#233346', b:'#0d1724', ink:'#eef3f8' }
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
  const rate = String(card.rating)
  ctx.fillText(rate, b.x + 9 * k, b.y + 7 * k)
  if (level > 0) {
    ctx.fillStyle = shot ? 'rgba(255,220,220,.95)' : '#7a2018'
    ctx.font = font(800, 9.5 * k)
    ctx.fillText(levelMark(level), b.x + 9 * k + measure(ctx, rate, 800, rateSize) + 3 * k,
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

const isSeoul = (card: Card): card is PlayerCard & { seoul: NonNullable<PlayerCard['seoul']> } =>
  isPlayerCard(card) && card.event === 'seoul-2024' && !!card.seoul

/** the Champions mark the Seoul cards carry, as SeoulDesign.tsx loads it */
const SEOUL_MARK = '/events/seoul-2024/champions.png'
const SEOUL_FOIL: Record<Rarity, string> = { mythic: '#c7b477', gold: '#c7b477', silver: '#a5b7cf', bronze: '#b7977d' }
const MONO = (weight: number, size: number) => `${weight} ${size}px ui-monospace, Menlo, Consolas, monospace`
const IMPACT = (size: number) => `700 ${size}px Impact, "Arial Narrow", "Helvetica Neue", sans-serif`

/**
 * A 首尔 2024 card, drawn the way SeoulDesign.tsx draws it.
 *
 * They are event cards with their own face — black, a foil edge, the
 * Champions mark, the year's ACS, K/D and maps — and a share picture that
 * painted them as ordinary gold and silver showed a card nobody owns. The
 * positions below are the .sc24 stylesheet measured on a 132×212 card, the
 * size the squad screen shows it at.
 */
function paintSeoulSeat(
  ctx: CanvasRenderingContext2D, b: Box, card: PlayerCard & { seoul: NonNullable<PlayerCard['seoul']> },
  level: number, face: HTMLImageElement | null, mark: HTMLImageElement | null,
): void {
  const k = b.w / 132
  const X = (n: number) => b.x + n * k
  const Y = (n: number) => b.y + n * k
  const foil = SEOUL_FOIL[card.rarity]
  const entry = card.seoul

  ctx.save()
  round(ctx, b, 8 * k)
  ctx.clip()
  ctx.fillStyle = '#0c1017'
  ctx.fillRect(b.x, b.y, b.w, b.h)
  const glow = ctx.createRadialGradient(X(99), Y(32), 0, X(99), Y(32), b.w * 0.75)
  glow.addColorStop(0, 'rgba(75,84,130,.29)')
  glow.addColorStop(1, 'rgba(75,84,130,0)')
  ctx.fillStyle = glow
  ctx.fillRect(b.x, b.y, b.w, b.h)

  // the rays: thin spokes from a point above the middle, fading outwards
  const rcx = b.x + b.w / 2
  const rcy = b.y + b.h * 0.42
  const reach = b.h * 0.62
  for (let deg = 12; deg < 372; deg += 20) {
    const a0 = ((deg + 10.2 - 90) * Math.PI) / 180
    const a1 = ((deg + 10.6 - 90) * Math.PI) / 180
    const fade = ctx.createRadialGradient(rcx, rcy, 0, rcx, rcy, reach)
    fade.addColorStop(0, 'rgba(200,180,119,.17)')
    fade.addColorStop(1, 'rgba(200,180,119,0)')
    ctx.fillStyle = fade
    ctx.beginPath()
    ctx.moveTo(rcx, rcy)
    ctx.arc(rcx, rcy, reach, a0, a1)
    ctx.closePath()
    ctx.fill()
  }

  // the portrait, faded out at its sides and foot as the mask does
  const pb = { x: X(23.1), y: Y(30.4), w: 85.8 * k, h: 79.8 * k }
  if (face) {
    const off = document.createElement('canvas')
    off.width = Math.ceil(pb.w)
    off.height = Math.ceil(pb.h)
    const o = off.getContext('2d')!
    o.filter = 'saturate(.65) contrast(1.06)'
    const scale = Math.max(pb.w / face.width, pb.h / face.height)
    o.drawImage(face, (pb.w - face.width * scale) / 2, 0, face.width * scale, face.height * scale)
    o.filter = 'none'
    o.globalCompositeOperation = 'destination-in'
    const hz = o.createLinearGradient(0, 0, pb.w, 0)
    hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(0.22, '#000'); hz.addColorStop(0.78, '#000'); hz.addColorStop(1, 'rgba(0,0,0,0)')
    o.fillStyle = hz
    o.fillRect(0, 0, pb.w, pb.h)
    const vt = o.createLinearGradient(0, 0, 0, pb.h)
    vt.addColorStop(0, 'rgba(0,0,0,0)'); vt.addColorStop(0.16, '#000'); vt.addColorStop(0.74, '#000'); vt.addColorStop(1, 'rgba(0,0,0,0)')
    o.fillStyle = vt
    o.fillRect(0, 0, pb.w, pb.h)
    ctx.drawImage(off, pb.x, pb.y, pb.w, pb.h)
  } else {
    ctx.fillStyle = 'rgba(199,180,119,.33)'
    ctx.font = IMPACT(48 * k)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(card.ign.slice(0, 2), pb.x + pb.w / 2, pb.y + pb.h / 2)
  }

  // the head: CHAMPIONS / SEOUL 2024 and the mark
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = foil
  ctx.letterSpacing = `${0.72 * k}px`
  ctx.font = font(400, 6 * k)
  ctx.fillText('CHAMPIONS', X(12.7), Y(16.5))
  ctx.font = font(700, 8 * k)
  ctx.letterSpacing = `${0.96 * k}px`
  ctx.fillText('SEOUL 2024', X(12.7), Y(26))
  ctx.letterSpacing = '0px'
  if (mark) ctx.drawImage(mark, X(95.3), Y(15.7), 24 * k, 24 * k)

  // the side line, read top to bottom: the Latin turned on its side, the
  // rarity's two characters upright, as vertical-rl sets them
  const latin = `${card.clubTag ?? ''} / ${(natCountry(entry.nat) ?? '').toUpperCase()} / `
  ctx.save()
  ctx.translate(X(116), Y(59.8))
  ctx.rotate(Math.PI / 2)
  ctx.font = MONO(400, 6 * k)
  ctx.letterSpacing = `${1.2 * k}px`
  ctx.fillStyle = foil
  ctx.textBaseline = 'middle'
  ctx.fillText(latin, 0, 0)
  const run = ctx.measureText(latin).width
  ctx.restore()
  ctx.letterSpacing = '0px'
  ctx.fillStyle = foil
  ctx.font = font(400, 6 * k)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  Array.from(RARITY_CN[card.rarity]).forEach((ch, i) => {
    ctx.fillText(ch, X(116), Y(59.8) + run + i * 7.2 * k)
  })
  ctx.textAlign = 'left'

  // the rating plate, taller by the IGL tag for a caller (.sc24-igl)
  const plateH = (card.isIgl ? 52 : 41.5) * k
  ctx.fillStyle = 'rgba(11,16,22,.65)'
  ctx.fillRect(X(11.4), Y(51.4), 33.8 * k, plateH)
  ctx.fillStyle = foil
  ctx.fillRect(X(11.4), Y(51.4), Math.max(1, k), plateH)
  ctx.shadowColor = '#000'
  ctx.shadowBlur = 6 * k
  ctx.fillStyle = '#f6edda'
  ctx.font = font(700, 21 * k)
  ctx.fillText(String(card.rating), X(16.4), Y(55))
  ctx.shadowBlur = 0
  ctx.fillStyle = foil
  ctx.font = font(400, 7 * k)
  ctx.fillText(`${card.role.slice(0, 2)}${level > 0 ? ` ${levelMark(level)}` : ''}`, X(16.4), Y(80.5))
  if (card.isIgl) {
    ctx.font = font(800, 6 * k)
    const tw = ctx.measureText('IGL').width + 6 * k
    ctx.fillRect(X(16.4), Y(80.5) + 10 * k, tw, 8 * k)
    ctx.fillStyle = '#0c1017'
    ctx.fillText('IGL', X(16.4) + 3 * k, Y(80.5) + 11 * k)
    ctx.fillStyle = foil
  }

  // the info block over its own shade
  const shade = ctx.createLinearGradient(0, Y(115.1), 0, b.y + b.h)
  shade.addColorStop(0, 'rgba(10,12,19,0)')
  shade.addColorStop(0.3, 'rgba(10,12,19,.91)')
  shade.addColorStop(0.65, '#0a0c13')
  ctx.fillStyle = shade
  ctx.fillRect(b.x, Y(115.1), b.w, b.y + b.h - Y(115.1))

  ctx.fillStyle = '#fff9e9'
  // a long name shrinks rather than running into the side line
  let ignSize = 21 * k
  ctx.font = IMPACT(ignSize)
  while (ignSize > 8 && ctx.measureText(card.ign).width > 106.6 * k) { ignSize -= 0.5; ctx.font = IMPACT(ignSize) }
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(card.ign, X(12.7), Y(147))
  ctx.textBaseline = 'top'

  ctx.fillStyle = 'rgba(199,180,119,.33)'
  ctx.fillRect(X(12.7), Y(156), 106.6 * k, Math.max(1, k))
  const stats: [string, string][] = [[String(entry.acs), 'ACS'], [entry.kd.toFixed(2), 'K/D'], [String(entry.maps), 'MAPS']]
  let sx = X(12.7)
  stats.forEach(([value, label]) => {
    ctx.font = MONO(700, 10 * k)
    const vw = ctx.measureText(value).width
    ctx.fillStyle = '#e4d5ad'
    ctx.fillText(value, sx, Y(162.3))
    ctx.font = MONO(400, 5 * k)
    const lw = ctx.measureText(label).width
    ctx.fillStyle = '#a8a7a3'
    ctx.fillText(label, sx, Y(176))
    sx += Math.max(vw, lw) + 106.6 * k * 0.14
  })

  ctx.fillStyle = 'rgba(199,180,119,.19)'
  ctx.fillRect(X(12.7), Y(189.3), 106.6 * k, Math.max(1, k))
  ctx.font = MONO(400, 4.5 * k)
  ctx.fillStyle = '#a6a497'
  ctx.fillText('01—25 AUG · 2024', X(12.7), Y(195))
  ctx.textAlign = 'right'
  ctx.fillStyle = foil
  ctx.fillText(`${String(entry.number).padStart(3, '0')} / 080`, X(119.3), Y(195))
  ctx.textAlign = 'left'

  // the sheen and the inner frame, as .cardface.sc24::before
  const sheen = ctx.createLinearGradient(b.x, b.y, b.x + b.w * 0.57, b.y + b.h * 0.82)
  sheen.addColorStop(0.3, 'rgba(255,255,255,0)')
  sheen.addColorStop(0.47, 'rgba(255,255,255,.07)')
  sheen.addColorStop(0.6, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(b.x, b.y, b.w, b.h)
  ctx.restore()

  ctx.textBaseline = 'alphabetic'
  round(ctx, { x: b.x + 4 * k, y: b.y + 4 * k, w: b.w - 8 * k, h: b.h - 8 * k }, 4 * k)
  ctx.strokeStyle = 'rgba(199,180,119,.33)'
  ctx.lineWidth = Math.max(1, k)
  ctx.stroke()
  round(ctx, b, 8 * k)
  ctx.strokeStyle = foil
  ctx.lineWidth = Math.max(1, k)
  ctx.stroke()
}

const isBangkok = (card: Card): card is PlayerCard & { bangkok: NonNullable<PlayerCard['bangkok']> } =>
  isPlayerCard(card) && card.event === 'bangkok-2025' && !!card.bangkok

/** the lotus the 曼谷 cards carry in their corner, as bangkok2025.css loads it */
const BANGKOK_LOTUS = '/events/bangkok-2025/lotus-art.webp'
const BANGKOK_FOIL: Record<Rarity, string> = { mythic: '#dcc48e', gold: '#dcc48e', silver: '#c5d8eb', bronze: '#d69e81' }
const BANGKOK_TIER: Record<Rarity, string> = { mythic: '金卡', gold: '金卡', silver: '银卡', bronze: '铜卡' }

/**
 * A 曼谷 2025 card, drawn the way BangkokDesign.tsx draws it.
 *
 * Every position below is bangkok2025.css measured on the rendered face, as a
 * percentage of the card (x and sizes of its width, y of its height), so the
 * seat — 132×212, a little taller than the face's 63:88 — keeps each block
 * where the face has it and the type at the face's size.
 */
function paintBangkokSeat(
  ctx: CanvasRenderingContext2D, b: Box, card: PlayerCard & { bangkok: NonNullable<PlayerCard['bangkok']> },
  level: number, face: HTMLImageElement | null, lotus: HTMLImageElement | null,
): void {
  const X = (n: number) => b.x + (n / 100) * b.w
  const Y = (n: number) => b.y + (n / 100) * b.h
  const W = (n: number) => (n / 100) * b.w
  const H = (n: number) => (n / 100) * b.h
  const foil = BANGKOK_FOIL[card.rarity]
  const entry = card.bangkok
  const hair = Math.max(1, b.w / 480)

  ctx.save()
  round(ctx, b, W(3.2))
  ctx.clip()
  // the field: a quiet purple, lit from the upper right (.bk25-front-ground)
  const ground = ctx.createLinearGradient(b.x, b.y, b.x + b.w * 0.75, b.y + b.h)
  ground.addColorStop(0, '#20152f')
  ground.addColorStop(0.62, '#161024')
  ctx.fillStyle = ground
  ctx.fillRect(b.x, b.y, b.w, b.h)
  const lit = ctx.createRadialGradient(X(80), Y(22), 0, X(80), Y(22), b.w * 0.9)
  lit.addColorStop(0, '#38254b')
  lit.addColorStop(0.56, 'rgba(56,37,75,0)')
  ctx.fillStyle = lit
  ctx.fillRect(b.x, b.y, b.w, b.h)

  // the portrait window (.bk25-photo): cover at 50% 30%, toned, faded on every side
  const pb = { x: X(4.19), y: Y(13.11), w: W(91.62), h: H(63.81) }
  if (face) {
    const off = document.createElement('canvas')
    off.width = Math.ceil(pb.w)
    off.height = Math.ceil(pb.h)
    const o = off.getContext('2d')!
    o.filter = 'saturate(.68) contrast(1.06)'
    const scale = Math.max(pb.w / face.width, pb.h / face.height)
    const fw = face.width * scale, fh = face.height * scale
    o.drawImage(face, (pb.w - fw) / 2, (pb.h - fh) * 0.3, fw, fh)
    o.filter = 'none'
    // the lilac multiply over the photo (::before, .65)
    o.globalCompositeOperation = 'multiply'
    o.globalAlpha = 0.65
    const tint = o.createLinearGradient(0, 0, pb.w, 0)
    tint.addColorStop(0, '#715591'); tint.addColorStop(0.4, '#c1b2cf'); tint.addColorStop(0.65, '#c1b2cf'); tint.addColorStop(1, '#715591')
    o.fillStyle = tint
    o.fillRect(0, 0, pb.w, pb.h)
    o.globalAlpha = 1
    // the shade rising from the foot (::after)
    o.globalCompositeOperation = 'source-over'
    const foot = o.createLinearGradient(0, pb.h, 0, 0)
    foot.addColorStop(0, '#161024'); foot.addColorStop(0.23, 'rgba(36,20,50,.4)'); foot.addColorStop(0.53, 'rgba(36,20,50,0)')
    o.fillStyle = foot
    o.fillRect(0, 0, pb.w, pb.h)
    // the masks: top and foot, the window's sides, the photo's own sides
    o.globalCompositeOperation = 'destination-in'
    const vt = o.createLinearGradient(0, 0, 0, pb.h)
    vt.addColorStop(0, 'rgba(0,0,0,0)'); vt.addColorStop(0.13, '#000'); vt.addColorStop(0.62, '#000'); vt.addColorStop(0.97, 'rgba(0,0,0,0)')
    o.fillStyle = vt
    o.fillRect(0, 0, pb.w, pb.h)
    for (const [a, z] of [[0.2, 0.8], [0.14, 0.78]] as const) {
      const hz = o.createLinearGradient(0, 0, pb.w, 0)
      hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(a, '#000'); hz.addColorStop(z, '#000'); hz.addColorStop(1, 'rgba(0,0,0,0)')
      o.fillStyle = hz
      o.fillRect(0, 0, pb.w, pb.h)
    }
    ctx.drawImage(off, pb.x, pb.y, pb.w, pb.h)
  } else {
    ctx.fillStyle = 'rgba(205,185,245,.25)'
    ctx.font = IMPACT(W(30))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(card.ign.slice(0, 2), pb.x + pb.w / 2, pb.y + pb.h * 0.45)
  }
  // the atmosphere over the lower card (.bk25-portrait-atmosphere)
  const atm = ctx.createLinearGradient(0, b.y + b.h, 0, b.y)
  atm.addColorStop(0.09, '#161024'); atm.addColorStop(0.22, 'rgba(22,16,36,.94)'); atm.addColorStop(0.33, 'rgba(22,16,36,.5)'); atm.addColorStop(0.48, 'rgba(22,16,36,0)')
  ctx.fillStyle = atm
  ctx.fillRect(b.x, b.y, b.w, b.h)

  // the small lotus in the lower right (.bk25-corner-lotus), faded at its rim
  if (lotus) {
    const lb = { x: X(76.89), y: Y(76.98), w: W(15.93), h: H(11.41) }
    const off = document.createElement('canvas')
    off.width = Math.ceil(lb.w)
    off.height = Math.ceil(lb.h)
    const o = off.getContext('2d')!
    const lh = lb.w * (lotus.height / lotus.width)
    o.drawImage(lotus, 0, (lb.h - lh) * 0.54, lb.w, lh)
    o.globalCompositeOperation = 'destination-in'
    const rim = o.createRadialGradient(lb.w / 2, lb.h / 2, 0, lb.w / 2, lb.h / 2, Math.max(lb.w, lb.h) / 2)
    rim.addColorStop(0.4, '#000'); rim.addColorStop(0.73, 'rgba(0,0,0,0)')
    o.fillStyle = rim
    o.fillRect(0, 0, lb.w, lb.h)
    ctx.drawImage(off, lb.x, lb.y)
  }

  // the head: MASTERS / BANGKOK 25, and the tier on the right
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#f3efff'
  ctx.letterSpacing = `${W(3.78) * 0.025}px`
  ctx.font = font(700, W(3.78))
  ctx.fillText('MASTERS', X(7.18), Y(5.83) + W(0.4))
  ctx.font = font(700, W(5.18))
  ctx.fillText('BANGKOK ', X(7.18), Y(9.08))
  const bw = ctx.measureText('BANGKOK ').width
  ctx.fillStyle = foil
  ctx.fillText('25', X(7.18) + bw, Y(9.08))
  ctx.letterSpacing = '0px'
  ctx.textAlign = 'right'
  ctx.font = font(400, W(2.49))
  ctx.fillText(BANGKOK_TIER[card.rarity], X(92.83), Y(5.83) + W(0.4))
  ctx.fillText('赛事系列', X(92.83), Y(5.83) + W(0.4) + W(2.49) * 1.65)
  ctx.textAlign = 'left'

  // the side line, DAWN OF THE DUELIST, set top to bottom
  ctx.save()
  ctx.translate(X(91.68) + W(3.14) / 2, Y(23.08))
  ctx.rotate(Math.PI / 2)
  ctx.font = font(400, W(2.09))
  ctx.letterSpacing = `${W(2.09) * 0.17}px`
  ctx.fillStyle = '#c9bddc'
  ctx.textBaseline = 'middle'
  ctx.fillText('DAWN OF THE DUELIST', 0, 0)
  ctx.restore()
  ctx.letterSpacing = '0px'

  // the rating plate: the number, and the role (with the level) under it
  ctx.fillStyle = 'rgba(24,17,37,.87)'
  ctx.fillRect(X(6.18), Y(21.09), W(21.7), H(18.28))
  ctx.fillStyle = foil
  ctx.fillRect(X(6.18), Y(21.09), Math.max(1, W(0.42)), H(18.28))
  ctx.font = font(700, W(13.94))
  ctx.fillText(String(card.rating), X(9.38), Y(22.94))
  ctx.font = font(400, W(3.49))
  ctx.fillText(`${card.role.slice(0, 2)}${level > 0 ? ` ${levelMark(level)}` : ''}`, X(9.38), Y(33.78))

  // team and nation
  ctx.font = font(700, W(4.28))
  ctx.fillText(card.clubTag ?? '', X(8.17), Y(57.86))
  if (card.isIgl) {
    // the caller's IGL tag after the team, as on the face (.bk25-igl)
    const tx = X(8.17) + ctx.measureText(card.clubTag ?? '').width + W(1.4)
    ctx.font = font(800, W(3))
    const tw = ctx.measureText('IGL').width + W(2.4)
    ctx.fillStyle = foil
    ctx.fillRect(tx, Y(57.86), tw, W(4.2))
    ctx.fillStyle = '#170f24'
    ctx.fillText('IGL', tx + W(1.2), Y(57.86) + W(0.6))
    ctx.fillStyle = foil
  }
  ctx.textAlign = 'right'
  ctx.font = font(400, W(2.69))
  ctx.letterSpacing = `${W(2.69) * 0.07}px`
  ctx.fillText(`${(natCountry(card.nat) ?? '').toUpperCase()} / 2025`, X(91.82), Y(58.72))
  ctx.letterSpacing = '0px'
  ctx.textAlign = 'left'

  // the name, shrinking rather than running past the frame
  ctx.fillStyle = '#f3efff'
  let ignSize = W(14.94)
  ctx.font = IMPACT(ignSize)
  while (ignSize > 6 && ctx.measureText(card.ign).width > W(83.65)) { ignSize -= 0.5; ctx.font = IMPACT(ignSize) }
  ctx.textBaseline = 'middle'
  ctx.fillText(card.ign, X(8.17), Y(63.53) + H(11.76) / 2)
  ctx.textBaseline = 'top'

  // ACS · K/D · MAPS between two rules
  ctx.fillStyle = 'rgba(202,191,227,.24)'
  ctx.fillRect(X(8.17), Y(77.42), W(83.65), hair)
  const stats: [string, string, number][] = [[String(entry.acs), 'ACS', 8.17], [entry.kd.toFixed(2), 'K/D', 33.08], [String(entry.maps), 'MAPS', 59.65]]
  for (const [value, label, x] of stats) {
    ctx.fillStyle = '#f1e9ff'
    ctx.font = font(500, W(5.97))
    ctx.fillText(value, X(x), Y(79.71))
    ctx.fillStyle = '#bdb0d3'
    ctx.font = font(400, W(2.29))
    ctx.fillText(label, X(x), Y(79.71) + H(7.45) - W(2.29) * 1.15)
  }
  ctx.fillStyle = 'rgba(202,191,227,.13)'
  ctx.fillRect(X(8.17), Y(89.59), W(83.65), hair)
  ctx.font = font(400, W(3.19))
  ctx.fillStyle = '#d6cbe9'
  ctx.fillText('20 FEB — 02 MAR', X(8.17), Y(91.44))
  ctx.textAlign = 'right'
  ctx.font = font(400, W(2.19))
  ctx.fillStyle = foil
  ctx.fillText(`${String(entry.number).padStart(3, '0')} / 041`, X(91.82), Y(92.19))
  ctx.textAlign = 'left'

  // the faint sheen (.bk25-card::after)
  const sheen = ctx.createLinearGradient(b.x, b.y + b.h, b.x + b.w, b.y)
  sheen.addColorStop(0.24, 'rgba(199,255,248,0)')
  sheen.addColorStop(0.38, 'rgba(199,255,248,.07)')
  sheen.addColorStop(0.49, 'rgba(199,255,248,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(b.x, b.y, b.w, b.h)
  ctx.restore()

  ctx.textBaseline = 'alphabetic'
  // the inner frame and the foil edge
  round(ctx, { x: X(2.2), y: Y(2.14), w: W(95.6), h: H(95.71) }, W(2))
  ctx.strokeStyle = foil + '80'
  ctx.lineWidth = hair
  ctx.stroke()
  round(ctx, b, W(3.2))
  ctx.strokeStyle = foil
  ctx.lineWidth = hair
  ctx.stroke()
}

const isRetired = (card: Card): card is PlayerCard & { afterglow: NonNullable<PlayerCard['afterglow']> } =>
  isPlayerCard(card) && card.event === 'retired' && !!card.afterglow

/** the ember the 余晖 cards carry in their corner (RetiredDesign.tsx) */
const AFTERGLOW_EMBER = '/events/afterglow/ember-art.webp'
const AG_FINISH: Record<'gold' | 'silver' | 'bronze', { foil: string; paper: string; base: string; cn: string }> = {
  gold: { foil: '#d8b77e', paper: '#fff2da', base: '#240e19', cn: '金卡' },
  silver: { foil: '#c7d1dd', paper: '#f4f3f7', base: '#211d29', cn: '银卡' },
  bronze: { foil: '#c38d70', paper: '#f4ddd0', base: '#2c181b', cn: '铜卡' },
}
const SERIF = (weight: number, size: number) => `${weight} ${size}px Georgia, "Times New Roman", serif`

/** an image faded out toward its rim, drawn with `screen` — the ember mark */
function paintEmber(ctx: CanvasRenderingContext2D, ember: HTMLImageElement, b: Box): void {
  const off = document.createElement('canvas')
  off.width = Math.ceil(b.w); off.height = Math.ceil(b.h)
  const o = off.getContext('2d')!
  o.drawImage(ember, 0, 0, b.w, b.h)
  o.globalCompositeOperation = 'destination-in'
  const rim = o.createRadialGradient(b.w / 2, b.h / 2, 0, b.w / 2, b.h / 2, b.w / 2)
  rim.addColorStop(0.45, '#000'); rim.addColorStop(1, 'rgba(0,0,0,0)')
  o.fillStyle = rim; o.fillRect(0, 0, b.w, b.h)
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(off, b.x, b.y); ctx.restore()
}

/** the photo inside `pb`, faded out below `fadeFrom` of its height — the faces' mask-image */
function paintFaded(
  ctx: CanvasRenderingContext2D, face: HTMLImageElement, pb: Box, mode: 'contain' | 'cover', posX: number, posY: number,
  fadeFrom: number, filter: string,
): void {
  const off = document.createElement('canvas')
  off.width = Math.ceil(pb.w); off.height = Math.ceil(pb.h)
  const o = off.getContext('2d')!
  o.filter = filter
  const scale = mode === 'cover' ? Math.max(pb.w / face.width, pb.h / face.height) : Math.min(pb.w / face.width, pb.h / face.height)
  const fw = face.width * scale, fh = face.height * scale
  o.drawImage(face, (pb.w - fw) * posX, (pb.h - fh) * posY, fw, fh)
  o.filter = 'none'
  o.globalCompositeOperation = 'destination-in'
  const fade = o.createLinearGradient(0, 0, 0, pb.h)
  fade.addColorStop(fadeFrom, '#000'); fade.addColorStop(1, 'rgba(0,0,0,0)')
  o.fillStyle = fade; o.fillRect(0, 0, pb.w, pb.h)
  ctx.drawImage(off, pb.x, pb.y, pb.w, pb.h)
}

/**
 * A 余晖 (退役) card, drawn the way RetiredDesign.tsx draws it: every block at
 * afterglow.css's (or afterglowMythic.css's) place, as a percentage of the card
 * — x and type sizes of its width (the faces' cqw), y of its height.
 */
function paintRetiredSeat(
  ctx: CanvasRenderingContext2D, b: Box, card: PlayerCard & { afterglow: NonNullable<PlayerCard['afterglow']> },
  level: number, face: HTMLImageElement | null, ember: HTMLImageElement | null,
): void {
  const X = (n: number) => b.x + (n / 100) * b.w
  const Y = (n: number) => b.y + (n / 100) * b.h
  const W = (n: number) => (n / 100) * b.w
  const H = (n: number) => (n / 100) * b.h
  const hair = Math.max(1, b.w / 480)
  const g = card.afterglow
  const label = `${card.role}${card.isIgl ? ' · 指挥' : ''}${level > 0 ? ` ${levelMark(level)}` : ''}`
  ctx.save()
  round(ctx, b, W(3))
  ctx.clip()
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  if (card.rarity === 'mythic') {
    const accent = g.accent ?? '#f2b6ad'
    const tint = g.tint ?? '#501c2b'
    const bg = ctx.createRadialGradient(X(70), Y(33), 0, X(70), Y(33), b.w * 0.95)
    bg.addColorStop(0, tint); bg.addColorStop(0.73, '#210d18')
    ctx.fillStyle = bg; ctx.fillRect(b.x, b.y, b.w, b.h)
    if (face) {
      const [px, py] = (g.crop ?? '50% 50%').split(' ').map((v) => parseFloat(v) / 100)
      paintFaded(ctx, face, { x: X(3), y: Y(12), w: W(94), h: H(65) }, 'cover', px, py, 0.69, 'saturate(1.08) contrast(1.04)')
    }
    // the info block's ground (::before)
    const foot = ctx.createLinearGradient(0, Y(52), 0, b.y + b.h)
    foot.addColorStop(0, 'rgba(33,13,24,0)'); foot.addColorStop(0.23, 'rgba(33,13,24,.7)'); foot.addColorStop(0.55, '#210d18')
    ctx.fillStyle = foot; ctx.fillRect(b.x, Y(52), b.w, b.h)
    // header
    ctx.fillStyle = '#e7cfaa'
    ctx.font = font(700, W(4)); ctx.letterSpacing = `${W(4) * 0.075}px`
    ctx.fillText('AFTERGLOW', X(7), Y(4.8))
    ctx.letterSpacing = '0px'
    ctx.fillStyle = accent; ctx.font = font(400, W(2.3))
    ctx.fillText('余晖 · 退役生涯彩卡', X(7), Y(4.8) + W(4) * 1.1 + W(1.7))
    if (ember) paintEmber(ctx, ember, { x: X(81), y: Y(3.2), w: W(14), h: W(14) })
    // year
    ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = font(500, W(3))
    ctx.letterSpacing = `${W(3) * 0.15}px`
    ctx.fillText(String(card.legend?.year ?? ''), X(93), Y(13.5))
    ctx.letterSpacing = '0px'; ctx.textAlign = 'left'
    // the rating plate
    const pw = W(26), ph = W(16) * 0.95 + W(3) * 1.3 + W(2.15) * 1.3 + W(7)
    const plate = ctx.createLinearGradient(X(7), Y(17), X(7) + pw, Y(17) + ph)
    plate.addColorStop(0, 'rgba(17,19,36,.7)'); plate.addColorStop(1, 'rgba(17,19,36,.12)')
    ctx.fillStyle = plate; ctx.fillRect(X(7), Y(17), pw, ph)
    ctx.fillStyle = accent; ctx.fillRect(X(7), Y(17), Math.max(1, W(0.42)), ph)
    ctx.fillStyle = '#fff8ed'; ctx.font = IMPACT(W(16))
    ctx.fillText(String(card.rating), X(7) + W(2.5), Y(17) + W(2))
    ctx.fillStyle = accent; ctx.font = font(400, W(3))
    ctx.fillText(label, X(7) + W(2.5), Y(17) + W(2) + W(16) * 0.95 + W(2))
    ctx.fillStyle = '#e4d8ce'; ctx.font = font(400, W(2.15))
    ctx.fillText('已退役', X(7) + W(2.5), Y(17) + W(2) + W(16) * 0.95 + W(2) + W(3) * 1.3 + W(1))
    // the side tag (result / club), bottom 39% right 7%
    const tag = `${g.result ?? ''} / ${card.clubTag ?? ''}`
    ctx.font = font(400, W(2.5))
    const tw = ctx.measureText(tag).width + W(4)
    const th = W(2.5) * 1.3 + W(2.6)
    ctx.fillStyle = 'rgba(17,19,36,.67)'; ctx.fillRect(X(93) - tw, Y(61) - th, tw, th)
    ctx.fillStyle = '#fff2d8'; ctx.fillText(tag, X(93) - tw + W(2), Y(61) - th + W(1.3))
    // the info block, built up from the foot (bottom 5.3%)
    let y = Y(94.7)
    ctx.font = font(400, W(1.9)); ctx.fillStyle = '#b39b7e'
    y -= W(1.9) * 1.2
    ctx.fillText('生涯珍藏 / 彩卡', X(8), y)
    ctx.textAlign = 'right'; ctx.fillText(g.number, X(92), y); ctx.textAlign = 'left'
    y -= W(2.3)
    ctx.fillStyle = 'rgba(197,169,123,.2)'; ctx.fillRect(X(8), y, W(84), hair)
    // six attributes
    const ATTRS = (['aim', 'reaction', 'awareness', 'utility', 'clutch', 'teamwork'] as const).map((k) => [k, ATTR_CN[k]] as const)
    y -= W(2.6) + W(2) + W(1.2) + W(5.1)
    const col = W(84) / 6
    ATTRS.forEach(([k, cn], i) => {
      const cx = i === 0 ? X(8) : X(8) + col * i + col / 2
      ctx.textAlign = i === 0 ? 'left' : 'center'
      ctx.fillStyle = '#f5dfbc'; ctx.font = SERIF(400, W(5.1))
      ctx.fillText(String(card.attrs[k]), cx, y)
      ctx.fillStyle = '#b9a28e'; ctx.font = font(400, W(2))
      ctx.fillText(cn, cx, y + W(5.1) + W(1.2))
    })
    ctx.textAlign = 'left'
    y -= W(3)
    ctx.fillStyle = 'rgba(211,189,131,.33)'; ctx.fillRect(X(8), y, W(84), hair)
    // the night
    y -= W(3) + W(2.45) * 1.6
    ctx.fillStyle = '#cfbca5'; ctx.font = font(400, W(2.45))
    ctx.fillText(card.legend?.title ?? '', X(8), y)
    // the name
    let ign = W(16)
    ctx.font = IMPACT(ign)
    while (ign > 6 && ctx.measureText(card.ign).width > W(84)) { ign -= 0.5; ctx.font = IMPACT(ign) }
    y -= W(2) + ign * 1.06
    ctx.fillStyle = '#fff7e8'; ctx.fillText(card.ign, X(8), y)
    // city and club
    y -= W(1.7) + W(3.1) * 1.2
    ctx.fillStyle = accent; ctx.font = font(600, W(3.1))
    ctx.letterSpacing = `${W(3.1) * 0.1}px`
    ctx.fillText(g.city ?? '', X(8), y)
    ctx.letterSpacing = '0px'; ctx.textAlign = 'right'
    ctx.fillText(card.clubTag ?? '', X(92), y)
    ctx.textAlign = 'left'
    ctx.restore()
    ctx.textBaseline = 'alphabetic'
    // the rainbow foil edge
    round(ctx, { x: X(1.5), y: Y(1.5), w: W(97), h: H(97) }, W(2.4))
    const edge = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h)
    for (const [at, c] of [[0, '#ddc397'], [0.25, '#f3b8c0'], [0.5, '#c4bbfa'], [0.75, '#b5e6d3'], [1, '#d5ad7d']] as const) edge.addColorStop(at, c)
    ctx.strokeStyle = edge; ctx.lineWidth = Math.max(1.5, W(0.42)); ctx.stroke()
    round(ctx, b, W(3)); ctx.strokeStyle = '#d6c092'; ctx.lineWidth = hair; ctx.stroke()
    return
  }

  const fin = AG_FINISH[card.rarity === 'gold' || card.rarity === 'silver' ? card.rarity : 'bronze']
  ctx.fillStyle = fin.base; ctx.fillRect(b.x, b.y, b.w, b.h)
  // the halo behind the portrait (.ag-portrait-halo), inset 18% 10% 20%
  const halo = ctx.createRadialGradient(X(50), Y(18) + H(62) * 0.35, 0, X(50), Y(18) + H(62) * 0.35, W(48))
  halo.addColorStop(0, fin.foil + '38'); halo.addColorStop(1, fin.foil + '00')
  ctx.fillStyle = halo; ctx.fillRect(X(10), Y(18), W(80), H(62))
  ctx.beginPath()
  ctx.moveTo(X(10), Y(80)); ctx.lineTo(X(10), Y(18) + W(38))
  ctx.arcTo(X(10), Y(18), X(50), Y(18), W(38)); ctx.arcTo(X(90), Y(18), X(90), Y(18) + W(38), W(38))
  ctx.lineTo(X(90), Y(80))
  ctx.strokeStyle = fin.foil + '52'; ctx.lineWidth = hair; ctx.stroke()
  // portrait, inset 17% 5% 19%, contained and standing on its foot
  if (face) paintFaded(ctx, face, { x: X(5), y: Y(17), w: W(90), h: H(64) }, 'contain', 0.5, 1, 0.6, 'saturate(.7) contrast(1.06)')
  else {
    ctx.fillStyle = fin.foil; ctx.font = font(400, W(20)); ctx.textAlign = 'center'
    ctx.fillText('◇', X(50), Y(38)); ctx.textAlign = 'left'
  }
  // header
  ctx.fillStyle = fin.foil; ctx.font = SERIF(600, W(4.8)); ctx.letterSpacing = `${W(4.8) * 0.05}px`
  ctx.fillText('AFTERGLOW', X(7), Y(5.2))
  ctx.letterSpacing = `${W(2.7) * 0.12}px`; ctx.fillStyle = fin.paper; ctx.font = font(400, W(2.7))
  ctx.fillText('余晖 · 生涯典藏', X(7), Y(5.2) + W(4.8) * 1.2 + W(1.8))
  ctx.letterSpacing = '0px'
  if (ember) paintEmber(ctx, ember, { x: X(76), y: Y(3), w: W(18), h: W(18) })
  // rating and role, left 7.5% top 23%
  ctx.fillStyle = fin.paper; ctx.font = SERIF(400, W(17)); ctx.letterSpacing = `${-W(17) * 0.08}px`
  ctx.fillText(String(card.rating), X(7.5), Y(23))
  ctx.letterSpacing = '0px'; ctx.fillStyle = fin.foil; ctx.font = font(400, W(3))
  ctx.fillText(label, X(7.5), Y(23) + W(17) * 0.95 + W(2))
  // the side line
  ctx.save()
  ctx.translate(X(94) - W(1), Y(25)); ctx.rotate(Math.PI / 2)
  ctx.globalAlpha = 0.7; ctx.fillStyle = fin.foil; ctx.font = font(400, W(2)); ctx.letterSpacing = `${W(2) * 0.18}px`
  ctx.fillText('THE LIGHT STAYS WITH US', 0, 0)
  ctx.restore()
  // the nameplate, built up from the foot (bottom 5.8%)
  let y = Y(94.2) - W(2.7) * 1.2
  ctx.font = font(400, W(2.7)); ctx.fillStyle = fin.foil
  ctx.fillText(`生涯珍藏  ${fin.cn}`, X(8), y)
  ctx.textAlign = 'right'; ctx.font = font(400, W(2.5)); ctx.fillText(g.number, X(92), y); ctx.textAlign = 'left'
  y -= W(3)
  const rule = ctx.createLinearGradient(X(8), 0, X(92), 0)
  rule.addColorStop(0, fin.foil); rule.addColorStop(1, fin.foil + '33')
  ctx.fillStyle = rule; ctx.fillRect(X(8), y, W(84), hair)
  let name = W(17)
  ctx.font = SERIF(400, name)
  while (name > 6 && ctx.measureText(card.ign).width > W(84)) { name -= 0.5; ctx.font = SERIF(400, name) }
  y -= W(3.2) + name * 1.12
  ctx.fillStyle = fin.paper; ctx.letterSpacing = `${-name * 0.045}px`
  ctx.fillText(card.ign, X(8), y)
  ctx.letterSpacing = '0px'
  y -= W(1) + W(4) * 1.2
  ctx.fillStyle = fin.foil; ctx.font = font(600, W(4)); ctx.fillText(card.clubTag ?? '', X(8), y)
  ctx.textAlign = 'right'; ctx.font = font(400, W(3)); ctx.fillText(g.span, X(92), y + W(0.8)); ctx.textAlign = 'left'
  ctx.restore()
  ctx.textBaseline = 'alphabetic'
  // the inner frame (inset 2.2%) and the foil edge
  round(ctx, { x: X(2.2), y: Y(2.2), w: W(95.6), h: H(95.6) }, W(1.8))
  ctx.strokeStyle = fin.foil + '73'; ctx.lineWidth = hair; ctx.stroke()
  round(ctx, b, W(3)); ctx.strokeStyle = fin.foil; ctx.lineWidth = hair; ctx.stroke()
}

function paintQr(ctx: CanvasRenderingContext2D, b: Box, url: string): void {
  ctx.fillStyle = '#fff'
  round(ctx, b, 14)
  ctx.fill()
  // Level Q recovers a quarter of the symbol, which is what makes a code
  // printed into a picture survive a screenshot of a screenshot.
  const m = qrMatrix(url, 'Q')
  const quiet = QR_QUIET
  const cell = Math.floor((b.w - QR_INSET) / (m.length + quiet * 2))
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
  // a Seoul card shows the Champions mark and a 曼谷 card its lotus, not the club's crest
  const crests = await Promise.all(all.map((c) => load(c?.clubId && !isSeoul(c) && !isBangkok(c) && !isRetired(c) ? crestUrl(c.clubId) : null)))
  const mark = await load(all.some((c) => c && isSeoul(c)) ? SEOUL_MARK : null)
  const lotus = await load(all.some((c) => c && isBangkok(c)) ? BANGKOK_LOTUS : null)
  const ember = await load(all.some((c) => c && isRetired(c)) ? AFTERGLOW_EMBER : null)

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

  const team = squadTeamIdentity(model.squad)
  if (team) {
    const art = await load(teamBackdrop(team.color))
    if (art) ctx.drawImage(art, 0, 0, L.width, L.height)
    const logo = await load(team.crest)
    if (logo) {
      ctx.save(); ctx.globalAlpha = .14
      ctx.drawImage(logo, L.width * .42, 160, L.width * .6, L.width * .6)
      ctx.restore()
      ctx.drawImage(logo, L.width - 170, L.header.y + 20, 90, 90)
    }
  }

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
  ctx.fillText(team ? `${team.tag} · 完整战队阵容 6/6` : '我的首发五人', L.header.x, L.header.y + 226)

  // ---- the five
  const ROLES = ['决斗者', '先锋', '控场', '哨卫', '自由人']
  L.seats.forEach((b, i) => {
    paintSeat(ctx, b, seatCards[i], ROLES[i], seatCards[i] ? model.level(seatCards[i]!.id) : 0, faces[i], crests[i], mark, lotus, ember)
  })

  // ---- the coach
  ctx.fillStyle = 'rgba(255,255,255,.05)'
  round(ctx, L.coach, 14)
  ctx.fill()
  ctx.textAlign = 'left'
  ctx.fillStyle = FAINT
  ctx.font = font(600, 20)
  ctx.fillText('教练组', L.coach.x + 16, L.coach.y + 32)
  if (coachCard) {
    const inner = { x: L.coach.x + 16, y: L.coach.y + 48, w: L.coach.w - 32, h: L.coach.h - 64 }
    paintSeat(ctx, inner, coachCard, '教练', model.level(coachCard.id), faces[5], crests[5])
  } else {
    ctx.fillStyle = FAINT
    ctx.font = font(500, 22)
    ctx.fillText('没有教练', L.coach.x + 16, L.coach.y + 150)
  }

  // ---- the two numbers, one above the other: side by side, a five-digit
  // 战力 at 96px ran straight through 默契 (「战力数值很拥挤」)
  ctx.fillStyle = PANEL
  round(ctx, L.stats, 14)
  ctx.fill()
  const scx = L.stats.x + L.stats.w / 2
  const valueW = L.stats.w - 56
  const chemColour = model.chem >= 60 ? '#4ade80' : model.chem >= 35 ? '#fbbf24' : '#f87171'
  const power = model.rating.toLocaleString('en-US')
  ctx.textAlign = 'center'
  ctx.fillStyle = FAINT
  ctx.font = font(600, 24)
  ctx.fillText('阵容战力', scx, L.stats.y + 58)
  ctx.fillStyle = INK
  ctx.font = font(800, fit(ctx, power, valueW, 800, 84))
  ctx.fillText(power, scx, L.stats.y + 146)
  ctx.fillStyle = 'rgba(255,255,255,.08)'
  ctx.fillRect(L.stats.x + 28, L.stats.y + 180, L.stats.w - 56, 2)
  ctx.fillStyle = FAINT
  ctx.font = font(600, 24)
  ctx.fillText('默契', scx, L.stats.y + 226)
  ctx.fillStyle = chemColour
  ctx.font = font(800, 64)
  ctx.fillText(String(model.chem), scx, L.stats.y + 294)
  ctx.fillStyle = FAINT
  ctx.font = font(500, fit(ctx, '默契来自同队、同国籍、同赛区', valueW, 500, 20))
  ctx.fillText('默契来自同队、同国籍、同赛区', scx, L.stats.y + 332)

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
