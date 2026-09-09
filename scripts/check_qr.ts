/**
 * The QR code in the share image is a real QR code. (2026-09-09)
 *
 *   npx tsx scripts/check_qr.ts
 *
 * A hand-written encoder is a pile of tables — block structure per version and
 * level, alignment centres, the two BCH codes — and every one of them fails
 * the same way: a square that looks perfect, prints perfectly, and scans as
 * nothing. So none of it is trusted here. Every version 1-10 at every error
 * correction level is encoded and compared module for module against segno's,
 * and the picture the game actually draws is then decoded back with OpenCV.
 *
 * Needs python3 with segno (and cv2 for the decode). Without them it says so
 * and passes, rather than turning the audit red on somebody's machine that
 * happens not to have them.
 */
import { execFileSync } from 'node:child_process'
import { CAPACITY, qrMatrix, qrVersionFor } from '../src/engine/qr'
import type { EccLevel } from '../src/engine/qr'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const has = (mod: string) => {
  try {
    execFileSync('python3', ['-c', `import ${mod}`], { stdio: 'ignore' })
    return true
  } catch { return false }
}

const LEVELS: EccLevel[] = ['L', 'M', 'Q', 'H']
const show = (m: boolean[][]) => m.map((r) => r.map((c) => (c ? '1' : '0')).join('')).join('\n')

// ---- against segno, module for module --------------------------------------
//
// Only on payloads that fill the symbol exactly, with no pad bytes. Two
// encoders may legally disagree about what goes after the terminator — segno
// writes a zero byte there where the standard's 11101100/00010001 pair would
// also do — and no reader looks at those bytes, so comparing them would
// compare a free choice rather than the encoding. An exact fit still puts
// every table through its paces: block structure, Reed-Solomon, the zig-zag,
// mask selection and both BCH codes.
if (!has('segno')) {
  console.log('（没装 segno，跳过对照；pip install segno 之后这一段才有意义）')
} else {
  console.log('=== 和 segno 逐格对照（不留空位的载荷）===')
  const script = `
import sys, json, segno
out = []
for text, level in json.loads(sys.argv[1]):
    q = segno.make(text, error=level, mode='byte', boost_error=False, micro=False)
    out.append({'v': q.version, 'rows': [''.join('1' if m else '0' for m in row) for row in q.matrix]})
print(json.dumps(out))
`
  // the length that leaves exactly four bits for the terminator and no pad
  const exactFit = (version: number, level: EccLevel) =>
    CAPACITY[level][version] - (version < 10 ? 2 : 3)
  const want: [string, string][] = []
  const mine: { v: number; level: EccLevel; rows: string }[] = []
  for (const level of LEVELS) {
    for (let v = 1; v <= 10; v++) {
      // a payload with some shape to it, so a placement bug cannot hide in a
      // run of identical bytes
      const n = exactFit(v, level)
      const text = Array.from({ length: n }, (_, i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[(i * 7 + v * 3) % 36]).join('')
      if (qrVersionFor(text, level) !== v) { check(`v${v} ${level} 正好填满`, false, `选到了 v${qrVersionFor(text, level)}`); continue }
      want.push([text, level])
      mine.push({ v, level, rows: show(qrMatrix(text, level)) })
    }
  }
  const got = JSON.parse(
    execFileSync('python3', ['-c', script, JSON.stringify(want)], { encoding: 'utf8', maxBuffer: 1 << 26 }),
  ) as { v: number; rows: string[] }[]
  for (const level of LEVELS) {
    const rows = mine.map((m, i) => ({ ...m, got: got[i] })).filter((m) => m.level === level)
    const wrong = rows.filter((r) => r.got.v !== r.v || r.got.rows.join('\n') !== r.rows).map((r) => `v${r.v}`)
    check(`${level} 级：十个版本都和 segno 一模一样`, wrong.length === 0,
      wrong.length ? `不一致：${wrong.join('、')}` : `${rows.length} 个版本`)
  }
  const versions = new Set(mine.map((m) => m.v))
  check('1 到 10 每个版本都试过', [...Array(10)].every((_, i) => versions.has(i + 1)),
    [...versions].sort((a, b) => a - b).join(','))
}

// ---- and the picture decodes ----------------------------------------------
if (!has('cv2')) {
  console.log('（没装 opencv-python，跳过解码）')
} else {
  console.log('\n=== 画出来再扫回来 ===')
  const URL = 'https://vctgames.com'
  const decode = `
import sys, json, numpy as np, cv2
rows = json.loads(sys.argv[1])
scale, quiet = 8, 4
n = len(rows)
img = np.full(((n + quiet * 2) * scale, (n + quiet * 2) * scale), 255, np.uint8)
for y, row in enumerate(rows):
    for x, ch in enumerate(row):
        if ch == '1':
            y0, x0 = (y + quiet) * scale, (x + quiet) * scale
            img[y0:y0 + scale, x0:x0 + scale] = 0
print(json.dumps(cv2.QRCodeDetector().detectAndDecode(img)[0]))
`
  for (const level of LEVELS) {
    const rows = show(qrMatrix(URL, level)).split('\n')
    const read = JSON.parse(
      execFileSync('python3', ['-c', decode, JSON.stringify(rows)], { encoding: 'utf8' }),
    ) as string
    check(`${level} 级的码扫出来就是那个网址`, read === URL, read || '扫不出来')
  }
  // the level the share image uses, at the size it uses, with a logo-sized
  // hole punched in the middle — Q recovers a quarter of the symbol, which is
  // what makes that hole safe
  const rows = show(qrMatrix(URL, 'Q')).split('\n')
  const punched = rows.map((r, y) => [...r].map((c, x) => {
    const mid = rows.length / 2
    return Math.abs(x - mid) < rows.length * 0.09 && Math.abs(y - mid) < rows.length * 0.09 ? '0' : c
  }).join(''))
  const read = JSON.parse(
    execFileSync('python3', ['-c', decode, JSON.stringify(punched)], { encoding: 'utf8' }),
  ) as string
  check('中间挖掉一小块还扫得出来', read === URL, read || '扫不出来')
}

// ---- the shape of the thing ------------------------------------------------
{
  console.log('\n=== 基本形状 ===')
  const m = qrMatrix('https://vctgames.com', 'Q')
  check('是正方形', m.every((r) => r.length === m.length), `${m.length}×${m.length}`)
  check('边长是 4v+17', (m.length - 17) % 4 === 0)
  const finder = (x0: number, y0: number) =>
    m[y0 + 3][x0 + 3] && m[y0][x0] && !m[y0 + 1][x0 + 1] && m[y0 + 6][x0 + 6]
  check('三个角上有定位图案', finder(0, 0) && finder(m.length - 7, 0) && finder(0, m.length - 7))
  check('固定为黑的那一格是黑的', m[m.length - 8][8])
  const dark = m.flat().filter(Boolean).length / (m.length * m.length)
  check('黑白大致各半', dark > 0.35 && dark < 0.65, `${(dark * 100).toFixed(0)}% 黑`)
  let threw = ''
  try { qrMatrix('x'.repeat(2000)) } catch (e) { threw = (e as Error).message }
  check('塞不下的时候是报错，不是悄悄截断', threw.includes('will not fit'), threw)
  check('同样的输入出同样的码', show(qrMatrix('abc')) === show(qrMatrix('abc')))
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
