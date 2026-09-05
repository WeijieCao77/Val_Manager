/**
 * How the 每日挑战 picture is painted.
 *
 * Pure canvas, no React: the frame's shape, the coarsening that stands in
 * for a blur, the ground under everything, and the painter that puts them
 * together. Challenge.tsx calls paintPuzzle once per detail step.
 */

export const blank = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const k = document.createElement('canvas')
  k.width = Math.max(1, Math.round(w))
  k.height = Math.max(1, Math.round(h))
  const ctx = k.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return [k, ctx]
}

/**
 * A picture reduced to `cells` columns of colour.
 *
 * Shrunk to that many pixels across and grown back, so what comes out is the
 * average colour of each patch and nothing finer. This replaces a canvas
 * blur, which softened edges and kept every large shape — a crest blown up
 * to twice the frame stayed readable through 22px of it, and a map's hard
 * top and bottom edges showed at any radius. It also leaned on the canvas
 * filter, which Safari before 18 does not have, and an unfiltered draw is
 * the answer in the clear.
 *
 * Both directions go a factor of two at a time: one jump down aliases and
 * keeps fine detail as speckle instead of averaging it away, and one jump up
 * from a handful of pixels draws bilinear diamonds around every cell.
 */
export function coarsen(src: HTMLCanvasElement, cells: number): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  if (!Number.isFinite(cells) || cells >= w) return src
  const tw = Math.max(1, Math.round(cells))
  const th = Math.max(1, Math.round((cells * h) / w))
  let cur = src
  while (cur.width / 2 > tw) {
    const [k, ctx] = blank(Math.ceil(cur.width / 2), Math.ceil(cur.height / 2))
    ctx.drawImage(cur, 0, 0, k.width, k.height)
    cur = k
  }
  const [tiny, tctx] = blank(tw, th)
  tctx.drawImage(cur, 0, 0, tw, th)
  cur = tiny
  while (cur.width * 2 < w) {
    const [k, ctx] = blank(cur.width * 2, cur.height * 2)
    ctx.drawImage(cur, 0, 0, k.width, k.height)
    cur = k
  }
  const [out, octx] = blank(w, h)
  octx.drawImage(cur, 0, 0, w, h)
  return out
}

/**
 * The frame's shape, and how wide it may grow.
 *
 * Detail is counted in cells across the frame, so the frame has to be the
 * same shape on every screen or the same count is a different puzzle. It
 * used to be 210px tall and as wide as the card: a 9:2 strip on a desktop,
 * about 8:5 on a phone. Six cells across was one row of colour on the
 * desktop — a horizontal gradient, nothing to see — and four rows on the
 * phone, where a face already had a shape. 16:10 is what the phone was
 * getting; on a desktop the frame stops growing at 480px and sits centred.
 */
export const FRAME_ASPECT = [16, 10] as const
export const FRAME_MAX = 480

export interface Ground {
  /** the opaque colour painted under everything */
  colour: string
  /** 0 for a picture with colours of its own, 1 for one that is a single colour cut out */
  flat: number
}

/**
 * The colour under everything.
 *
 * Faces, crests and agents are cut-outs on a transparent background — 490
 * of the 551 faces, every crest, every agent. Painted onto a transparent
 * canvas, that transparency went into the bitmap. On the page the box's
 * panel showed through it, so in the dark theme dark hair sank into a dark
 * ground; but 「复制图片」 hands over the bitmap with its alpha, and pasted
 * onto a white chat window the silhouette — hair, head, shoulders — stood
 * out crisp against white, coarsened or not. The light themes gave the same
 * outline on the page itself, which made 浅 and 米 easier than 深.
 *
 * So the frame is painted on an opaque ground first, fixed per picture and
 * the same on every theme: the picture's own average colour, weighted by
 * alpha, which is on average the one colour the subject's edge contrasts
 * with least. What is copied is now exactly what is on the page.
 *
 * That was the whole rule for a day, and it broke half the crests. A face
 * or an agent has colours of its own — skin, hair, a jersey — and shows
 * against its average by them; but forty of the seventy-eight crests are
 * one flat colour cut out of nothing, and their average IS that colour.
 * JD Gaming was a red frame with a red crest on it, invisible even in the
 * clear; the black crests were a black box; the group sent five of them.
 *
 * So the ground is pushed away from the picture by as much of the picture
 * as would vanish into it. `flat` is the share of the picture (by alpha)
 * that sits within 45 of its average colour — a face is 0.1–0.4, a crest
 * with a gradient or a second colour under 0.3, a flat crest 0.94–1 — with
 * a knee from 0.5 to 0.9 so an ordinary face moves by nothing. A flat
 * picture's ground is its colour half-way to a light grey (dark pictures)
 * or a dark grey (light ones): JD Gaming's red sits on a dusty rose, a
 * black crest on a mid grey, the Loud green on a darker green. Not the RMS
 * spread of the colours, which was tried first: a small red star on a
 * navy crest gave it a spread a face would have, and the navy stayed on
 * navy.
 *
 * A picture that fills its own box — a map, one of the 61 photographed
 * faces — is exempt: there the ground's job is to hide the box's edge, and
 * only the average does that.
 */
export function groundOf(pic: HTMLImageElement): Ground {
  const n = 16
  const [, ctx] = blank(n, n)
  ctx.drawImage(pic, 0, 0, n, n)
  const d = ctx.getImageData(0, 0, n, n).data
  let r = 0, g = 0, b = 0, a = 0
  for (let i = 0; i < d.length; i += 4) {
    const w = d[i + 3]
    r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; a += w
  }
  if (!a) return { colour: '#6b7078', flat: 0 }
  r /= a; g /= a; b /= a
  let nearA = 0
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.hypot(d[i] - r, d[i + 1] - g, d[i + 2] - b)
    if (dist < 45) nearA += d[i + 3]
  }
  const near = nearA / a
  const coverage = a / (255 * n * n)
  const opaque = Math.min(1, Math.max(0, (coverage - 0.9) / 0.08))
  const flat = Math.min(1, Math.max(0, (near - 0.5) / 0.4)) * (1 - opaque)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const toward = lum < 128 ? 235 : 25
  const k = 0.5 * flat
  const mix = (c: number) => Math.round(c + (toward - c) * k)
  return { colour: `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`, flat }
}

/**
 * The frame at this many cells of detail.
 *
 * Three of the four kinds are square — faces 192², agents 128², crests 256²
 * — and only a map is a 4.55:1 strip, so a frame that cropped or letterboxed
 * gave the kind away from across the room. The picture is drawn whole and
 * contained on a backdrop of itself blown up past the box and washed out,
 * and then the whole frame is coarsened together: at the opening six cells
 * the strip's edges and the backdrop are one smudge, and they separate only
 * as the misses buy detail. Everything sits on an opaque ground — see
 * groundOf — so the bitmap carries no alpha for a copy to expose.
 *
 * The backdrop fades with the picture's flatness. A flat crest blown up is
 * the same flat colour over most of the frame, and a crest drawn on top of
 * that was drawn on itself; the ground has been chosen to show it, so for
 * a flat picture the ground is all there is behind it.
 */
/**
 * Where the picture sits in the frame, and how much of it is off centre.
 *
 * The same answer used to give the same frame to everybody, every time: a
 * FUT crest at six cells was the same four patches of colour on every
 * account and every day it came up, and after a while the group knew the
 * patches. So the picture is nudged off centre by a per-puzzle amount —
 * the same for one account's puzzle however many times it is redrawn,
 * different across accounts and days. Only along an axis where the zoomed
 * picture overflows the box, and by at most PUZZLE_DRIFT of that overflow,
 * so the box is still covered edge to edge and the subject is still near
 * the middle: a different four patches, not a harder puzzle. As the misses
 * pull the zoom back the overflow shrinks, and in the clear there is no
 * drift at all — the answer is shown whole, as before.
 */
export const PUZZLE_DRIFT = 0.3

/**
 * A puzzle's own nudge, each axis in [-1, 1], from its seed.
 *
 * The seed is an FNV hash of the day and the account id, and FNV's last
 * character only moves the low bits by a few hundred: 2026-09-06 and
 * 2026-09-07, or two ids a character apart, came out a hundredth apart —
 * the same frame to the eye. So the seed goes through an avalanche step
 * first (murmur3's finaliser), and only then is it split into two halves.
 */
const avalanche = (x: number): number => {
  x ^= x >>> 16
  x = Math.imul(x, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return x >>> 0
}

export const puzzleShift = (seed: number): [number, number] => {
  const m = avalanche(seed)
  return [
    ((m & 0xffff) / 0xffff) * 2 - 1,
    (((m >>> 16) & 0xffff) / 0xffff) * 2 - 1,
  ]
}

/** The drawn rectangle for a picture scaled by `scale` and nudged by `shift`. */
export function puzzleLayout(
  picW: number, picH: number, w: number, h: number, scale: number,
  shift: readonly [number, number] = [0, 0],
): { x: number; y: number; dw: number; dh: number } {
  const dw = picW * scale
  const dh = picH * scale
  const slackX = Math.max(0, dw - w) / 2
  const slackY = Math.max(0, dh - h) / 2
  return {
    x: (w - dw) / 2 + slackX * PUZZLE_DRIFT * shift[0],
    y: (h - dh) / 2 + slackY * PUZZLE_DRIFT * shift[1],
    dw, dh,
  }
}

export function paintPuzzle(
  ctx: CanvasRenderingContext2D, pic: HTMLImageElement,
  w: number, h: number, zoom: number, cells: number,
  shift: readonly [number, number] = [0, 0],
) {
  const [frame, f] = blank(w, h)
  const ground = groundOf(pic)
  f.fillStyle = ground.colour
  f.fillRect(0, 0, w, h)
  // backdrop: the picture past the edges of the box, washed to eight cells
  const wash = 0.75 * (1 - ground.flat)
  if (wash > 0.01) {
    const cover = Math.max(w / pic.width, h / pic.height) * (zoom + 0.4)
    const [back, b] = blank(w, h)
    const bl = puzzleLayout(pic.width, pic.height, w, h, cover, shift)
    b.drawImage(pic, bl.x, bl.y, bl.dw, bl.dh)
    f.globalAlpha = wash
    f.drawImage(coarsen(back, 8), 0, 0)
    f.globalAlpha = 1
  }
  // subject: the whole picture, contained, nudged by the puzzle's own drift
  const fit = Math.min(w / pic.width, h / pic.height) * zoom
  const l = puzzleLayout(pic.width, pic.height, w, h, fit, shift)
  f.drawImage(pic, l.x, l.y, l.dw, l.dh)
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(coarsen(frame, cells), 0, 0)
}
