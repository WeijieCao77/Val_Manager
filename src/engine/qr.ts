/**
 * A QR code, small enough to keep.
 *
 * The share image has to carry vctgames.com back to whoever is looking at it,
 * and a picture saved to a phone's camera roll has no links in it. So the
 * address is drawn into the picture as a QR code.
 *
 * Written here rather than pulled in: the page loads no third-party script
 * (CSP, and the whole client is one bundle), and a generator that phones an
 * API would put the player's URL through somebody else's server to draw a
 * square. Byte mode only, versions 1 to 10, which covers any address this
 * game will ever print.
 *
 * scripts/check_qr.ts renders every version and every error-correction level
 * and compares the module matrix against segno's, so the tables below are
 * checked rather than trusted — the tables are the whole risk in a QR encoder,
 * and a wrong one produces a square that looks perfect and scans as nothing.
 */

export type EccLevel = 'L' | 'M' | 'Q' | 'H'


/**
 * Block structure, by version and level: error-correction codewords per
 * block, then the blocks themselves as [count, dataCodewords] pairs.
 */
const BLOCKS: Record<EccLevel, [number, [number, number][]][]> = {
  L: [
    [0, []],
    [7, [[1, 19]]], [10, [[1, 34]]], [15, [[1, 55]]], [20, [[1, 80]]], [26, [[1, 108]]],
    [18, [[2, 68]]], [20, [[2, 78]]], [24, [[2, 97]]], [30, [[2, 116]]], [18, [[2, 68], [2, 69]]],
  ],
  M: [
    [0, []],
    [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
    [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]],
    [26, [[4, 43], [1, 44]]],
  ],
  Q: [
    [0, []],
    [13, [[1, 13]]], [22, [[1, 22]]], [18, [[2, 17]]], [26, [[2, 24]]], [18, [[2, 15], [2, 16]]],
    [24, [[4, 19]]], [18, [[2, 14], [4, 15]]], [22, [[4, 18], [2, 19]]], [20, [[4, 16], [4, 17]]],
    [24, [[6, 19], [2, 20]]],
  ],
  H: [
    [0, []],
    [17, [[1, 9]]], [28, [[1, 16]]], [22, [[2, 13]]], [16, [[4, 9]]], [22, [[2, 11], [2, 12]]],
    [28, [[4, 15]]], [26, [[4, 13], [1, 14]]], [26, [[4, 14], [2, 15]]], [24, [[4, 12], [4, 13]]],
    [28, [[6, 15], [2, 16]]],
  ],
}

/** centres of the alignment patterns, by version */
const ALIGN: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
]

const ECC_BITS: Record<EccLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 }

// ---- GF(256), the field Reed-Solomon works in --------------------------
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

/**
 * The generator polynomial for `n` error-correction codewords: the product of
 * (x - a^i) for i under n, highest degree first and monic — building it the
 * other way round gives the same coefficients reversed, which is not a
 * generator at all and produces a symbol whose data is perfect and whose
 * error correction is noise.
 */
function generator(n: number): number[] {
  let poly = [1]
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= mul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

/** the `n` error-correction codewords for one block of data */
function ecOf(data: number[], n: number): number[] {
  const gen = generator(n)
  const rem = new Array<number>(n).fill(0)
  for (const byte of data) {
    const factor = byte ^ rem[0]
    rem.shift()
    rem.push(0)
    if (factor !== 0) for (let i = 0; i < n; i++) rem[i] ^= mul(gen[i + 1], factor)
  }
  return rem
}

// ---- the bit stream ------------------------------------------------------
const utf8 = (s: string): number[] => [...new TextEncoder().encode(s)]

const dataCapacity = (version: number, level: EccLevel): number =>
  BLOCKS[level][version][1].reduce((n, [count, size]) => n + count * size, 0)

/** the smallest version that holds these bytes, or 0 when none does */
function versionFor(bytes: number, level: EccLevel): number {
  for (let v = 1; v <= 10; v++) {
    const countBits = v < 10 ? 8 : 16
    const bits = 4 + countBits + bytes * 8
    if (bits <= dataCapacity(v, level) * 8) return v
  }
  return 0
}

function codewords(text: string, version: number, level: EccLevel): number[] {
  const bytes = utf8(text)
  const capacity = dataCapacity(version, level)
  const bits: number[] = []
  const push = (value: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1)
  }
  push(0b0100, 4)                         // byte mode
  push(bytes.length, version < 10 ? 8 : 16)
  for (const b of bytes) push(b, 8)
  // terminator, then out to a whole byte
  for (let i = 0; i < 4 && bits.length < capacity * 8; i++) bits.push(0)
  while (bits.length % 8) bits.push(0)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0))
  }
  // the two pad bytes the standard names, alternating
  for (let i = 0; data.length < capacity; i++) data.push(i % 2 === 0 ? 0xec : 0x11)

  // split into blocks, then interleave data and error correction
  const [ecPerBlock, groups] = BLOCKS[level][version]
  const blocks: { data: number[]; ec: number[] }[] = []
  let at = 0
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      const part = data.slice(at, at + size)
      at += size
      blocks.push({ data: part, ec: ecOf(part, ecPerBlock) })
    }
  }
  const out: number[] = []
  const widest = Math.max(...blocks.map((b) => b.data.length))
  for (let i = 0; i < widest; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i])
  for (let i = 0; i < ecPerBlock; i++) for (const b of blocks) out.push(b.ec[i])
  return out
}

// ---- the matrix ----------------------------------------------------------
type Grid = { on: boolean; fixed: boolean }[][]

function blank(size: number): Grid {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => ({ on: false, fixed: false })))
}

function place(grid: Grid, x: number, y: number, on: boolean, fixed = true): void {
  if (y < 0 || x < 0 || y >= grid.length || x >= grid.length) return
  grid[y][x] = { on, fixed }
}

function finder(grid: Grid, x0: number, y0: number): void {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const inRing = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6
        && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4))
      place(grid, x0 + dx, y0 + dy, inRing)
    }
  }
}

/**
 * Where the two copies of format bit `i` go, as [x, y].
 *
 * The copy beside the top-left finder steps over the two timing modules at
 * (6,8) and (8,6) — writing through them is the classic way to produce a
 * symbol that is correct everywhere except the one row a reader starts from.
 */
function formatCells(size: number, i: number): [number, number][] {
  const near: [number, number] = i < 6 ? [i, 8]
    : i === 6 ? [7, 8]
      : i === 7 ? [8, 8]
        : i === 8 ? [8, 7]
          : [8, 14 - i]
  // seven modules up the left of the bottom-left finder, then eight along
  // row 8 beside the top-right one. Splitting it 8 and 7 instead puts a
  // format bit through the always-dark module and leaves (size-8, 8) looking
  // like a data module, which shifts every codeword after it by one bit.
  const far: [number, number] = i < 7 ? [8, size - 1 - i] : [size - 15 + i, 8]
  return [near, far]
}

/** BCH(15,5) format information, and the mask the standard applies to it */
function formatBits(level: EccLevel, mask: number): number {
  const data = (ECC_BITS[level] << 3) | mask
  let rem = data << 10
  for (let i = 14; i >= 10; i--) if (rem & (1 << i)) rem ^= 0b10100110111 << (i - 10)
  return ((data << 10) | rem) ^ 0b101010000010010
}

/**
 * BCH(18,6) version information, for version 7 and up.
 *
 * The generator is thirteen bits — x^12+x^11+x^10+x^9+x^8+x^5+x^2+1. Writing
 * the ten-bit format generator here instead leaves versions 7 to 10 with a
 * version block that no reader accepts, and versions 1 to 6, which carry no
 * version block at all, perfectly fine — which is exactly how it hides.
 */
function versionBits(version: number): number {
  let rem = version << 12
  for (let i = 17; i >= 12; i--) if (rem & (1 << i)) rem ^= 0b1111100100101 << (i - 12)
  return (version << 12) | rem
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

/**
 * The standard's four penalty rules, lower is better.
 *
 * The third rule — a 1:1:3:1:1 dark/light run with four light modules on one
 * side — is the one every encoder reads slightly differently, because the
 * quiet zone around the symbol is light too. The reading here is the one segno
 * uses: a run that starts at the very edge, or has four clear modules on
 * either side once clipped to the symbol, counts. Requiring the whole eleven
 * modules to sit inside instead picks a visibly different mask.
 */
const N3_CORE = [1, 0, 1, 1, 1, 0, 1]

function n3Score(seq: number[]): number {
  const n = seq.length
  let count = 0
  let from = 0
  for (;;) {
    let idx = -1
    for (let i = from; i + 7 <= n; i++) {
      if (N3_CORE.every((v, k) => seq[i + k] === v)) { idx = i; break }
    }
    if (idx < 0) break
    let offset = idx + 7
    const clear = (a: number, b: number) => !seq.slice(Math.max(a, 0), Math.min(b, n)).some(Boolean)
    if (idx === 0 || idx === n - 7 || clear(idx - 4, idx) || clear(offset, offset + 4)) count += 40
    else offset = idx + 4
    from = offset
  }
  return count
}

function penalty(m: boolean[][]): number {
  const n = m.length
  let score = 0
  const runs = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      let run = 1
      for (let j = 1; j < n; j++) {
        if (get(i, j) === get(i, j - 1)) { run++; continue }
        if (run >= 5) score += run - 2
        run = 1
      }
      if (run >= 5) score += run - 2
    }
  }
  runs((i, j) => m[i][j])
  runs((i, j) => m[j][i])
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const v = m[y][x]
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3
    }
  }
  for (let i = 0; i < n; i++) {
    score += n3Score(m[i].map((v) => (v ? 1 : 0)))
    score += n3Score(m.map((r) => (r[i] ? 1 : 0)))
  }
  const dark = m.flat().filter(Boolean).length
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10
  return score
}

/**
 * The modules of a QR code for `text`, true where the module is dark.
 *
 * Throws when the text does not fit a version-10 symbol, which for byte mode
 * at level M is 271 bytes — far past any URL, and a throw is better than a
 * square that silently drops the end of an address.
 */
export function qrMatrix(text: string, level: EccLevel = 'M', only?: number): boolean[][] {
  const bytes = utf8(text).length
  const version = versionFor(bytes, level)
  if (!version) throw new Error(`qr: ${bytes} bytes will not fit a version-10 ${level} symbol`)
  const size = version * 4 + 17
  const grid = blank(size)

  finder(grid, 0, 0)
  finder(grid, size - 7, 0)
  finder(grid, 0, size - 7)
  for (let i = 8; i < size - 8; i++) {
    place(grid, i, 6, i % 2 === 0)
    place(grid, 6, i, i % 2 === 0)
  }
  for (const cy of ALIGN[version]) {
    for (const cx of ALIGN[version]) {
      // the three corners already hold a finder
      if ((cx <= 8 && cy <= 8) || (cx <= 8 && cy >= size - 9) || (cx >= size - 9 && cy <= 8)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          place(grid, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }
  // The format, version and always-dark modules are only RESERVED here, and
  // written at the end. They must be light while the masks are scored — the
  // standard evaluates a symbol that does not carry them yet — and leaving
  // the dark module dark, or the version block filled in, is enough to pick a
  // different mask on about one symbol in ten.
  place(grid, 8, size - 8, false)
  for (let i = 0; i < 15; i++) for (const [x, y] of formatCells(size, i)) place(grid, x, y, false)
  const versionModules: [number, number][] = []
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      for (const [x, y] of [
        [i % 3 + size - 11, Math.floor(i / 3)],
        [Math.floor(i / 3), i % 3 + size - 11],
      ] as [number, number][]) {
        place(grid, x, y, false)
        versionModules.push([x, y])
      }
    }
  }

  // the data, up the right-hand side and back down, two columns at a time
  const stream = codewords(text, version, level)
  let bit = 0
  let up = true
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5                       // the vertical timing column
    for (let step = 0; step < size; step++) {
      const y = up ? size - 1 - step : step
      for (const x of [right, right - 1]) {
        if (grid[y][x].fixed) continue
        const byte = stream[bit >> 3] ?? 0
        grid[y][x] = { on: ((byte >> (7 - (bit & 7))) & 1) === 1, fixed: false }
        bit++
      }
    }
    up = !up
  }

  // Eight masks, and the one the penalty rules like best — scored BEFORE the
  // format information is written, which the standard is explicit about
  // (18004:2015 §7.8) and which changes the answer on about a third of
  // symbols: fifteen modules that are the same under every mask still shift
  // the run and 1:1:3:1:1 counts around them.
  let best: boolean[][] | null = null
  let bestMask = 0
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    if (only !== undefined && mask !== only) continue
    const m = grid.map((row, y) => row.map((cell, x) => cell.on !== (!cell.fixed && MASKS[mask](x, y))))
    const score = penalty(m)
    if (score < bestScore) { bestScore = score; best = m; bestMask = mask }
  }
  const bits = formatBits(level, bestMask)
  for (let i = 0; i < 15; i++) {
    // format information goes down most-significant bit first
    const on = ((bits >> (14 - i)) & 1) === 1
    for (const [x, y] of formatCells(size, i)) best![y][x] = on
  }
  if (version >= 7) {
    const vb = versionBits(version)
    // version information goes down least-significant bit first, both copies
    for (let i = 0; i < 18; i++) {
      const on = ((vb >> i) & 1) === 1
      best![versionModules[i * 2][1]][versionModules[i * 2][0]] = on
      best![versionModules[i * 2 + 1][1]][versionModules[i * 2 + 1][0]] = on
    }
  }
  best![size - 8][8] = true
  return best!
}

/** The smallest version that would hold this text, for a caller sizing a box. */
export const qrVersionFor = (text: string, level: EccLevel = 'M'): number =>
  versionFor(utf8(text).length, level)

/** Data codewords per version and level — scripts/check_qr.ts sizes its
 *  exact-fit payloads from this. */
export const CAPACITY: Record<EccLevel, number[]> = {
  L: BLOCKS.L.map((_, v) => (v ? dataCapacity(v, 'L') : 0)),
  M: BLOCKS.M.map((_, v) => (v ? dataCapacity(v, 'M') : 0)),
  Q: BLOCKS.Q.map((_, v) => (v ? dataCapacity(v, 'Q') : 0)),
  H: BLOCKS.H.map((_, v) => (v ? dataCapacity(v, 'H') : 0)),
}
