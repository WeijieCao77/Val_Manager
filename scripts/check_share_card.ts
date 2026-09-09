/**
 * 分享阵容: the picture holds together, and the code on it works. (2026-09-09)
 *
 *   npx tsx scripts/check_share_card.ts
 *
 * The image is drawn on a canvas, which Node does not have, so this checks the
 * two halves that do not need one:
 *
 *   - the geometry. shareLayout is pure, so every block can be asked whether
 *     it is inside the picture and clear of its neighbours. A share image that
 *     draws the QR code half off the edge is still a valid PNG, and nobody
 *     would notice until somebody tried to scan it.
 *   - the QR code, drawn at exactly the size and quiet zone the picture uses,
 *     decoded back with OpenCV — including at the sizes a phone screenshot and
 *     a WeChat re-compress leave it at.
 *
 * The picture itself is checked by eye and in the simulator; this is the part
 * that can rot without anyone looking.
 */
import { execFileSync } from 'node:child_process'
import { SHARE_H, SHARE_URL, SHARE_W, shareLayout } from '../src/ui/cards/shareCard'
import type { Box } from '../src/ui/cards/shareCard'
import { qrMatrix } from '../src/engine/qr'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// ---- everything is on the picture -----------------------------------------
{
  console.log('=== 版面 ===')
  const L = shareLayout()
  const named: [string, Box][] = [
    ...L.seats.map((b, i) => [`第 ${i + 1} 个位置`, b] as [string, Box]),
    ['教练', L.coach], ['两个数字', L.stats], ['二维码', L.qr], ['抬头', L.header], ['页脚', L.footer],
  ]
  const out = named.filter(([, b]) => b.x < 0 || b.y < 0 || b.x + b.w > L.width || b.y + b.h > L.height)
  check('没有东西画到画布外面', out.length === 0, out.map(([n]) => n).join('、'))

  // the header may sit above the seats but must not reach them
  const clash: string[] = []
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      // the coach plate holds a card inside it by design; nothing else nests
      if (overlaps(named[i][1], named[j][1])) clash.push(`${named[i][0]} × ${named[j][0]}`)
    }
  }
  check('没有两块压在一起', clash.length === 0, clash.join('、'))

  const gaps = L.seats.slice(1).map((b, i) => b.x - (L.seats[i].x + L.seats[i].w))
  check('五个位置等宽等距', new Set(L.seats.map((b) => b.w)).size === 1 && new Set(gaps).size === 1,
    `宽 ${L.seats[0].w} · 间距 ${gaps[0]}`)
  check('五个位置在一条线上', new Set(L.seats.map((b) => b.y)).size === 1)
  const right = L.seats[4].x + L.seats[4].w
  check('左右留白一样', L.seats[0].x === L.width - right, `${L.seats[0].x} vs ${L.width - right}`)
  check('二维码是正方形', L.qr.w === L.qr.h, `${L.qr.w}×${L.qr.h}`)
  check('下半部分三块排得下', L.coach.x + L.coach.w < L.stats.x && L.stats.x + L.stats.w < L.qr.x)
  check('底下还有地方写落款', L.footer.y > L.qr.y + L.qr.h + 60, `页脚 ${L.footer.y}，二维码底 ${L.qr.y + L.qr.h}`)
  check('画布是竖的，适合发出去', SHARE_H > SHARE_W && SHARE_W === L.width, `${SHARE_W}×${SHARE_H}`)
  // the height used to be a constant and left four hundred empty pixels
  // above the footer; it follows the content now
  const bottom = Math.max(L.footer.y + L.footer.h, L.qr.y + L.qr.h)
  check('底下没有一大片空白', L.height - bottom < 60, `空 ${L.height - bottom}px`)
  check('教练那张卡和五个位置一个形状',
    Math.abs((L.coach.h - 64) / (L.coach.w - 32) - L.seats[0].h / L.seats[0].w) < 0.05,
    `${((L.coach.h - 64) / (L.coach.w - 32)).toFixed(2)} vs ${(L.seats[0].h / L.seats[0].w).toFixed(2)}`)
}

// ---- the code on it scans --------------------------------------------------
const hasCv2 = (() => {
  try { execFileSync('python3', ['-c', 'import cv2'], { stdio: 'ignore' }); return true } catch { return false }
})()

if (!hasCv2) {
  console.log('\n（没装 opencv-python，跳过扫码）')
} else {
  console.log('\n=== 图上的码扫得出来 ===')
  const L = shareLayout()
  const m = qrMatrix(SHARE_URL, 'Q')
  // the same arithmetic paintQr does, so this is the code as it is printed
  const quiet = 2
  const cell = Math.floor((L.qr.w - 28) / (m.length + quiet * 2))
  check('每格至少 6 像素', cell >= 6, `${cell}px 一格，${m.length} 格`)
  check('连白边一起放得进二维码那块', cell * (m.length + quiet * 2) <= L.qr.w,
    `${cell * (m.length + quiet * 2)} ≤ ${L.qr.w}`)

  const decode = `
import sys, json, numpy as np, cv2
rows, cell, quiet, resize = json.loads(sys.argv[1])
n = len(rows)
side = (n + quiet * 2) * cell
img = np.full((side, side), 255, np.uint8)
for y, row in enumerate(rows):
    for x, ch in enumerate(row):
        if ch == '1':
            y0, x0 = (y + quiet) * cell, (x + quiet) * cell
            img[y0:y0 + cell, x0:x0 + cell] = 0
if resize != 1.0:
    img = cv2.resize(img, None, fx=resize, fy=resize, interpolation=cv2.INTER_AREA)
    img = cv2.copyMakeBorder(img, 8, 8, 8, 8, cv2.BORDER_CONSTANT, value=255)
print(json.dumps(cv2.QRCodeDetector().detectAndDecode(img)[0]))
`
  const rows = m.map((r) => r.map((c) => (c ? '1' : '0')).join(''))
  const read = (scale: number) => JSON.parse(
    execFileSync('python3', ['-c', decode, JSON.stringify([rows, cell, quiet, scale])], { encoding: 'utf8' }),
  ) as string
  check('原尺寸扫得出来', read(1) === SHARE_URL, read(1) || '扫不出来')
  // a phone screenshot of the picture, and a chat app's re-compress after it
  for (const scale of [0.5, 0.34, 0.25]) {
    check(`缩到 ${Math.round(scale * 100)}% 还扫得出来`, read(scale) === SHARE_URL, read(scale) || '扫不出来')
  }
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
