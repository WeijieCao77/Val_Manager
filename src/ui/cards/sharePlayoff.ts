/**
 * 淘汰赛预测 as a picture worth sending: the whole bracket on one portrait
 * card (1080 × 1350, the 4:5 a phone feed shows uncropped), the predicted
 * champion up top with his crest, every match below with the picked winner
 * lit and the loser faded, and a QR code back to the game.
 *
 * Same split as shareCard.ts: `playoffShareLayout` is pure geometry, so
 * scripts/check_share_playoff.ts can prove nothing leaves the canvas or sits
 * on anything else; `paintPlayoffShare` draws over it. Fixed colours — the
 * card looks the same whatever theme the sender uses.
 */
import { qrMatrix } from '../../engine/qr'
import { crestUrl } from '../../engine/dossier'
import { CHAMPIONS_2026 } from '../../engine/predict'
import { P_SLOTS, playoffPlacing, playoffSides } from '../../engine/predictPlayoffs'
import type { PlayoffEvent, PPicks, PSlot } from '../../engine/predictPlayoffs'

export const PO_SHARE_W = 1080
export const PO_SHARE_H = 1350
export const PO_SHARE_URL = 'https://vctgames.com'

export interface Box { x: number; y: number; w: number; h: number }

export interface PlayoffShareLayout {
  width: number
  height: number
  header: Box
  hero: Box
  crest: Box
  /** every match, by slot */
  match: Record<PSlot, Box>
  /** the round titles, one per column per half */
  titles: { text: string; x: number; y: number; gold?: boolean }[]
  footer: Box
  qr: Box
}

const PAD = 56
const COL_W = 212
const COL_GAP = 40
const BOX_H = 84
const ROW_GAP = 12

/** Where everything sits. Four columns; the upper bracket over the lower, the grand final at the right. */
export function playoffShareLayout(): PlayoffShareLayout {
  const col = (i: number) => PAD + i * (COL_W + COL_GAP)
  const box = (c: number, y: number): Box => ({ x: col(c), y: Math.round(y), w: COL_W, h: BOX_H })
  const centre = (b: Box) => b.y + b.h / 2
  const between = (c: number, a: Box, b: Box) => box(c, (centre(a) + centre(b)) / 2 - BOX_H / 2)

  const upperY = 520
  const q = [0, 1, 2, 3].map((i) => box(0, upperY + i * (BOX_H + ROW_GAP)))
  const s1 = between(1, q[0], q[1])
  const s2 = between(1, q[2], q[3])
  const uf = between(2, s1, s2)
  const gf = box(3, uf.y)

  const lowerY = q[3].y + BOX_H + 64
  const l1a = box(0, lowerY)
  const l1b = box(0, lowerY + BOX_H + ROW_GAP)
  const l2a = box(1, l1a.y)
  const l2b = box(1, l1b.y)
  const l3 = between(2, l2a, l2b)
  const lf = box(3, l3.y)

  const footerY = l1b.y + BOX_H + 30
  const qrSide = 132
  return {
    width: PO_SHARE_W,
    height: PO_SHARE_H,
    header: { x: PAD, y: 48, w: PO_SHARE_W - PAD * 2, h: 150 },
    hero: { x: PAD, y: 216, w: PO_SHARE_W - PAD * 2, h: 250 },
    crest: { x: PAD + 36, y: 216 + 35, w: 180, h: 180 },
    match: { q1: q[0], q2: q[1], q3: q[2], q4: q[3], s1, s2, uf, gf, l1a, l1b, l2a, l2b, l3, lf },
    titles: [
      { text: '胜者组 · 八强', x: col(0), y: upperY - 16 },
      { text: '胜者组半决赛', x: col(1), y: upperY - 16 },
      { text: '胜者组决赛', x: col(2), y: upperY - 16 },
      { text: '总决赛 · BO5', x: col(3), y: upperY - 16, gold: true },
      { text: '败者组第一轮', x: col(0), y: lowerY - 16 },
      { text: '败者组第二轮', x: col(1), y: lowerY - 16 },
      { text: '败者组第三轮', x: col(2), y: lowerY - 16 },
      { text: '败者组决赛 · BO5', x: col(3), y: lowerY - 16 },
    ],
    footer: { x: PAD, y: footerY, w: PO_SHARE_W - PAD * 2 - qrSide - 24, h: qrSide },
    qr: { x: PO_SHARE_W - PAD - qrSide, y: footerY, w: qrSide, h: qrSide },
  }
}

export interface PlayoffShareModel {
  name: string
  event: PlayoffEvent
  /** the SAVED picks — the card never shows an unsaved draft */
  picks: PPicks
  /** "10/06 16:00" */
  deadline: string
  url?: string
}

const BG_TOP = '#0d1526'
const BG_BOTTOM = '#080c16'
const PANEL = '#141d2e'
const EDGE = '#26324a'
const INK = '#f3f6fb'
const FAINT = 'rgba(243,246,251,.52)'
const DIM = 'rgba(243,246,251,.30)'
const TEAL = '#4fe0bd'
const GOLD = '#e6c172'
const SANS = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system, sans-serif'
const font = (weight: number, size: number) => `${weight} ${size}px ${SANS}`

const round = (ctx: CanvasRenderingContext2D, b: Box, r: number) => {
  ctx.beginPath()
  ctx.moveTo(b.x + r, b.y)
  ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, r)
  ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, r)
  ctx.arcTo(b.x, b.y + b.h, b.x, b.y, r)
  ctx.arcTo(b.x, b.y, b.x + b.w, b.y, r)
  ctx.closePath()
}

/** Text that shrinks until it fits, never below `min`. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, weight: number, size: number, min = 14) {
  let s = size
  ctx.font = font(weight, s)
  while (s > min && ctx.measureText(text).width > max) { s -= 1; ctx.font = font(weight, s) }
  ctx.fillText(text, x, y, max)
}

const load = (src: string | null): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    if (!src) { resolve(null); return }
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })

function paintQr(ctx: CanvasRenderingContext2D, b: Box, url: string) {
  ctx.fillStyle = '#fff'
  round(ctx, b, 14)
  ctx.fill()
  const m = qrMatrix(url, 'Q')
  const cell = Math.floor((b.w - 8) / (m.length + 2))
  const side = cell * (m.length + 2)
  const x0 = b.x + (b.w - side) / 2 + cell
  const y0 = b.y + (b.h - side) / 2 + cell
  ctx.fillStyle = '#0d1117'
  for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++) if (m[y][x]) ctx.fillRect(x0 + x * cell, y0 + y * cell, cell, cell)
}

/**
 * A crest on a light disc: half the field's logos are drawn for light
 * backgrounds (PRX, G2 are black), and on the card's navy they vanished.
 */
function crestChip(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, cx: number, cy: number, r: number, ring?: string) {
  const disc = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r)
  disc.addColorStop(0, '#ffffff')
  disc.addColorStop(1, '#d9e1ec')
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = disc
  ctx.fill()
  if (ring) { ctx.lineWidth = Math.max(2, r * 0.08); ctx.strokeStyle = ring; ctx.stroke() }
  if (img) {
    const s = r * 1.32
    ctx.drawImage(img, cx - s / 2, cy - s / 2, s, s)
  }
}

const teamName = (tag: string) => CHAMPIONS_2026.teams[tag]?.name ?? tag
const clubOf = (tag: string) => CHAMPIONS_2026.teams[tag]?.clubId ?? null

/** Draw the card onto `canvas`. Async only because the crests load first; a crest that fails leaves its seat plain. */
export async function paintPlayoffShare(canvas: HTMLCanvasElement, model: PlayoffShareModel): Promise<void> {
  const L = playoffShareLayout()
  canvas.width = L.width
  canvas.height = L.height
  const ctx = canvas.getContext('2d')!
  const ev = model.event
  const picks = model.picks
  const sides = playoffSides(ev, picks)
  const place = playoffPlacing(ev, picks)
  const tags = [...new Set((ev.quarters ?? []).flat())]
  const crestImg: Record<string, HTMLImageElement | null> = {}
  await Promise.all(tags.map(async (t) => { crestImg[t] = await load(crestUrl(clubOf(t))) }))

  // ---- ground: night over the river, a warm glow behind the champion
  const bg = ctx.createLinearGradient(0, 0, 0, L.height)
  bg.addColorStop(0, BG_TOP)
  bg.addColorStop(1, BG_BOTTOM)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, L.width, L.height)
  const glow = ctx.createRadialGradient(L.crest.x + L.crest.w / 2, L.crest.y + L.crest.h / 2, 10, L.crest.x + L.crest.w / 2, L.crest.y + L.crest.h / 2, 420)
  glow.addColorStop(0, 'rgba(230,193,114,.22)')
  glow.addColorStop(1, 'rgba(230,193,114,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, L.width, 640)
  // a fine diagonal grain, the way the event's own art is hatched
  ctx.save()
  ctx.globalAlpha = 0.05
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1
  for (let x = -L.height; x < L.width; x += 22) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + L.height, L.height); ctx.stroke() }
  ctx.restore()

  // ---- header
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = TEAL
  ctx.font = font(700, 22)
  ctx.fillText('VALORANT CHAMPIONS 2026 · SHANGHAI', L.header.x, L.header.y + 32)
  ctx.textAlign = 'right'
  ctx.fillStyle = INK
  ctx.font = font(800, 26)
  ctx.fillText('开瓦包', L.header.x + L.header.w, L.header.y + 32)
  ctx.fillStyle = FAINT
  ctx.font = font(500, 18)
  ctx.fillText('赛事预测', L.header.x + L.header.w, L.header.y + 58)
  ctx.textAlign = 'left'
  ctx.fillStyle = INK
  fitText(ctx, '上海冠军赛 · 我的淘汰赛预测', L.header.x, L.header.y + 94, L.header.w, 800, 52, 36)
  ctx.fillStyle = FAINT
  fitText(ctx, `${model.name} 的预测`, L.header.x, L.header.y + 138, L.header.w, 500, 26, 18)

  // ---- hero: the champion
  const H = L.hero
  const heroBg = ctx.createLinearGradient(H.x, H.y, H.x + H.w, H.y)
  heroBg.addColorStop(0, 'rgba(230,193,114,.16)')
  heroBg.addColorStop(1, 'rgba(20,29,46,.92)')
  ctx.fillStyle = heroBg
  round(ctx, H, 26)
  ctx.fill()
  ctx.strokeStyle = 'rgba(230,193,114,.55)'
  ctx.lineWidth = 2
  round(ctx, H, 26)
  ctx.stroke()
  const C = L.crest
  const champ = place.champion
  if (champ) {
    // a gold halo, then the crest on its disc
    ctx.beginPath()
    ctx.arc(C.x + C.w / 2, C.y + C.h / 2, C.w / 2 + 8, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(230,193,114,.25)'
    ctx.fill()
    crestChip(ctx, crestImg[champ] ?? null, C.x + C.w / 2, C.y + C.h / 2, C.w / 2, GOLD)
  } else {
    ctx.beginPath()
    ctx.arc(C.x + C.w / 2, C.y + C.h / 2, C.w / 2, 0, Math.PI * 2)
    ctx.fillStyle = '#0b111d'
    ctx.fill()
    ctx.lineWidth = 5
    ctx.strokeStyle = EDGE
    ctx.stroke()
    ctx.fillStyle = DIM
    ctx.font = font(800, 72)
    ctx.textAlign = 'center'
    ctx.fillText('?', C.x + C.w / 2, C.y + C.h / 2 + 26)
    ctx.textAlign = 'left'
  }
  const tx = C.x + C.w + 44
  const tw = H.x + H.w - 36 - tx
  ctx.fillStyle = GOLD
  ctx.font = font(800, 26)
  ctx.fillText('🏆 我的冠军', tx, H.y + 64)
  ctx.fillStyle = INK
  fitText(ctx, champ ?? '还没选', tx, H.y + 140, tw, 900, 84, 40)
  ctx.fillStyle = FAINT
  fitText(ctx, champ ? teamName(champ) : '在预测页把 14 场选完', tx, H.y + 180, tw, 500, 28, 18)
  const rest = [['亚军', place.runnerUp], ['季军', place.third], ['殿军', place.fourth]] as const
  rest.forEach(([label, tag], i) => {
    const x = tx + i * Math.floor(tw / 3)
    ctx.fillStyle = DIM
    ctx.font = font(600, 20)
    ctx.fillText(label, x, H.y + 222)
    ctx.fillStyle = tag ? INK : DIM
    fitText(ctx, tag ?? '—', x + 52, H.y + 223, Math.floor(tw / 3) - 60, 800, 26, 16)
  })

  // ---- connectors first, so the boxes sit on top of them
  const M = L.match
  const right = (b: Box) => ({ x: b.x + b.w, y: b.y + b.h / 2 })
  const left = (b: Box) => ({ x: b.x, y: b.y + b.h / 2 })
  const link = (from: Box, to: Box, lit: boolean) => {
    const a = right(from), b = left(to)
    const mid = (a.x + b.x) / 2
    ctx.strokeStyle = lit ? 'rgba(79,224,189,.75)' : 'rgba(243,246,251,.14)'
    ctx.lineWidth = lit ? 3 : 2
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(mid, a.y)
    ctx.lineTo(mid, b.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  const won = (slot: PSlot) => !!picks[slot]
  link(M.q1, M.s1, won('q1')); link(M.q2, M.s1, won('q2'))
  link(M.q3, M.s2, won('q3')); link(M.q4, M.s2, won('q4'))
  link(M.s1, M.uf, won('s1')); link(M.s2, M.uf, won('s2'))
  link(M.uf, M.gf, won('uf'))
  link(M.l1a, M.l2a, won('l1a')); link(M.l1b, M.l2b, won('l1b'))
  link(M.l2a, M.l3, won('l2a')); link(M.l2b, M.l3, won('l2b'))
  link(M.l3, M.lf, won('l3'))
  // the lower final's winner climbs to the grand final
  ctx.save()
  ctx.setLineDash([8, 8])
  ctx.strokeStyle = won('lf') ? 'rgba(230,193,114,.8)' : 'rgba(243,246,251,.16)'
  ctx.lineWidth = 3
  // down the column's right edge, clear of the 「败者组决赛 · BO5」 title
  ctx.beginPath()
  ctx.moveTo(M.lf.x + M.lf.w - 24, M.lf.y)
  ctx.lineTo(M.gf.x + M.gf.w - 24, M.gf.y + M.gf.h)
  ctx.stroke()
  ctx.restore()

  // ---- round titles
  for (const t of L.titles) {
    ctx.fillStyle = t.gold ? GOLD : FAINT
    ctx.font = font(700, 19)
    ctx.fillText(t.text, t.x, t.y)
  }

  // ---- the matches
  for (const slot of P_SLOTS) {
    const b = M[slot]
    const gfBox = slot === 'gf'
    ctx.fillStyle = gfBox ? 'rgba(230,193,114,.12)' : PANEL
    round(ctx, b, 14)
    ctx.fill()
    ctx.strokeStyle = gfBox ? 'rgba(230,193,114,.7)' : EDGE
    ctx.lineWidth = gfBox ? 2.5 : 1.5
    round(ctx, b, 14)
    ctx.stroke()
    const [a, c] = sides[slot]
    ;[a, c].forEach((tag, i) => {
      const rowY = b.y + i * (b.h / 2)
      const mid = rowY + b.h / 4
      if (i === 1) {
        ctx.strokeStyle = 'rgba(243,246,251,.08)'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(b.x + 10, rowY); ctx.lineTo(b.x + b.w - 10, rowY); ctx.stroke()
      }
      const pick = picks[slot]
      const isWin = !!tag && pick === tag
      const isLose = !!tag && !!pick && pick !== tag
      if (isWin) {
        ctx.fillStyle = gfBox ? GOLD : TEAL
        ctx.fillRect(b.x + 2, rowY + 7, 4, b.h / 2 - 14)
      }
      ctx.globalAlpha = isLose ? 0.32 : 1
      if (tag) crestChip(ctx, crestImg[tag] ?? null, b.x + 31, mid, 16)
      ctx.fillStyle = tag ? INK : DIM
      ctx.textBaseline = 'middle'
      fitText(ctx, tag ?? '待定', b.x + 54, mid + 1, b.w - 96, isWin ? 800 : 600, 25, 15)
      if (isWin) {
        ctx.fillStyle = gfBox ? GOLD : TEAL
        ctx.font = font(800, 20)
        ctx.textAlign = 'right'
        ctx.fillText('胜', b.x + b.w - 14, mid + 1)
        ctx.textAlign = 'left'
      }
      ctx.textBaseline = 'alphabetic'
      ctx.globalAlpha = 1
    })
  }

  // ---- footer and the way back to the game
  const F = L.footer
  const count = Object.keys(picks).length
  ctx.fillStyle = INK
  ctx.font = font(700, 26)
  ctx.fillText(`已保存 ${count} / 14 场`, F.x, F.y + 34)
  ctx.fillStyle = FAINT
  fitText(ctx, `北京时间 ${model.deadline} 截止 · 只展示已保存的预测`, F.x, F.y + 74, F.w, 500, 22, 16)
  ctx.fillStyle = TEAL
  fitText(ctx, '扫码来 vctgames.com · 开瓦包「预测」一起猜', F.x, F.y + 116, F.w, 700, 24, 16)
  paintQr(ctx, L.qr, model.url ?? PO_SHARE_URL)
}
