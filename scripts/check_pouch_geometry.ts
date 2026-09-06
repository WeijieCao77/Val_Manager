import assert from 'node:assert/strict'
import { pouchGeometry, POUCH_CUT } from '../src/ui/cards/pouchGeometry'

for (const count of [1, 3, 10]) {
  const cutRims: string[][] = []
  for (const top of [false, true]) {
    const geometry = pouchGeometry(count, top)
    const positions = geometry.getAttribute('position')
    const normals = geometry.getAttribute('normal')
    const index = geometry.getIndex()!
    const edges = new Map<string, { count: number; winding: number }>()
    for (let i = 0; i < index.count; i += 3) {
      const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
      for (let j = 0; j < 3; j++) {
        const a = triangle[j], b = triangle[(j + 1) % 3]
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`
        const edge = edges.get(key) ?? { count: 0, winding: 0 }
        edge.count++; edge.winding += a < b ? 1 : -1; edges.set(key, edge)
      }
    }
    for (const edge of edges.values()) {
      assert.equal(edge.count, 2, 'Every edge must join exactly two triangles: no open side flaps')
      assert.equal(edge.winding, 0, 'Adjacent triangles must agree on inside/outside')
    }
    const cut: string[] = []
    let centreDepth = 0, sealDepth = 0
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i)
      assert.ok([x, y, z, normals.getX(i), normals.getY(i), normals.getZ(i)].every(Number.isFinite))
      if (Math.abs(y - POUCH_CUT) < .004) cut.push([x, y, z].map(n => n.toFixed(5)).join(','))
      if (Math.abs(y) < .1 && Math.abs(x) < .1) centreDepth = Math.max(centreDepth, Math.abs(z))
      if (Math.abs(y) > 1.57) sealDepth = Math.max(sealDepth, Math.abs(z))
    }
    if (!top) assert.ok(centreDepth > sealDepth * 5, 'The body must bulge while the heat seals stay thin')
    cutRims.push(cut.sort())
    geometry.dispose()
  }
  assert.deepEqual(cutRims[0], cutRims[1], 'Tear strip and body must meet without a gap before opening')
}
console.log('Pouch geometry: closed skins, consistent normals, matching tear seam and compressed seals passed.')
