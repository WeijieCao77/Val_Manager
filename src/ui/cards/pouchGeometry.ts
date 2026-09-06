import { BufferGeometry, Float32BufferAttribute } from 'three'

export const POUCH_CUT = 1.12
const HALF_HEIGHT = 1.6
const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Two curved skins with shared perimeter walls, pinched together at the seals. */
export function pouchGeometry(count: number, top: boolean) {
  const nx = 80, ny = top ? 20 : 100
  const lo = top ? POUCH_CUT : -HALF_HEIGHT
  const hi = top ? HALF_HEIGHT : POUCH_CUT
  const positions: number[] = [], uv: number[] = [], indices: number[] = []
  const depth = .105 + Math.min(10, count) * .009
  const vertex = (u: number, y: number, side: number) => {
    const x = u * 2 - 1
    const edge = 1 - Math.abs(x)
    const end = HALF_HEIGHT - Math.abs(y)
    // A broad card-sized centre, then a tight shoulder leading into the weld.
    const fillX = smooth(.025, .24, edge)
    const fillY = smooth(.12, .4, end)
    const puff = depth * fillX * fillY * (1 - .07 * x * x)
    const seam = .009 + .004 * Math.cos(x * 138) * (1 - smooth(.03, .13, end))
    // Irregular creases live near the shoulders; the printed centre stays legible.
    const shoulder = Math.exp(-Math.pow((edge - .13) / .12, 2))
    const folds = x < 0
      ? [[-1.08, .8, .07, .038], [-.47, -1.1, .055, .029], [.22, .7, .09, .035], [.91, -1.8, .065, .04]]
      : [[-1.18, -.9, .055, .028], [-.68, 1.4, .08, .038], [.04, -1, .065, .025], [.68, 1.6, .07, .039]]
    let wrinkle = 0
    for (const [centre, slope, width, amplitude] of folds) {
      const t = (y - centre + edge * slope) / width
      wrinkle += (1 - 2 * t * t) * Math.exp(-t * t) * amplitude
    }
    wrinkle *= shoulder * fillY
    const corner = Math.exp(-Math.pow((end - .28) / .16, 2))
      * Math.pow(Math.abs(x), 3) * Math.sin(x * 17 + y * 8) * .018
    const z = side * (seam + puff + wrinkle + corner)
    const outline = 1 + .008 * Math.sin(y * 8) + .005 * Math.sin(y * 17 + 2)
    const roundedCorner = .025 * (1 - smooth(0, .1, end)) * Math.pow(Math.abs(x), 14)
    return [x * (outline - roundedCorner), y, z]
  }
  for (const side of [1, -1]) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const u = i / nx
        const jag = .002 * Math.sin(u * 83) + .001 * Math.sin(u * 177)
        const cutWeight = top ? 1 - j / ny : j / ny
        const y = lo + (hi - lo) * j / ny + jag * cutWeight
        positions.push(...vertex(u, y, side))
        uv.push(side === 1 ? u : 1 - u, (y + HALF_HEIGHT) / (2 * HALF_HEIGHT))
      }
    }
  }
  const size = (nx + 1) * (ny + 1)
  const geometry = new BufferGeometry()
  for (let side = 0; side < 2; side++) {
    const start = indices.length
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = side * size + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1
      if (side === 0) indices.push(a, b, d, a, d, c)
      else indices.push(a, d, b, a, c, d)
    }
    geometry.addGroup(start, indices.length - start, side)
  }
  const start = indices.length
  // Walk the perimeter counter-clockwise and stitch front to back.
  const rim: number[] = []
  for (let i = 0; i <= nx; i++) rim.push(i)
  for (let j = 1; j <= ny; j++) rim.push(j * (nx + 1) + nx)
  for (let i = nx - 1; i >= 0; i--) rim.push(ny * (nx + 1) + i)
  for (let j = ny - 1; j > 0; j--) rim.push(j * (nx + 1))
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i], b = rim[(i + 1) % rim.length]
    indices.push(a, a + size, b + size, a, b + size, b)
  }
  geometry.addGroup(start, indices.length - start, 2)
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
