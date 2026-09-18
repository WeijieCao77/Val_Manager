/** Exhaustive field-size structural check; no production writes. */
import assert from 'node:assert/strict'
import { pairSwissRound, planPlayoff, firstRoundLines, planSwissCup, type SwissSeat } from '../src/engine/openCupSwiss'
const started = performance.now()
let matches = 0
for (let n = 4; n <= 4096; n++) {
  const seats: SwissSeat[] = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, wins: 0, losses: 0, byes: 0, floats: 0, met: [] }))
  const byId = new Map(seats.map((e) => [e.id, e]))
  for (let r = 0; r < 3; r++) {
    const active = seats.filter((s) => s.wins < 2 && s.losses < 2)
    if (!active.length) break
    const p = pairSwissRound(seats, n * 101, r)
    if (n < 40 || [267, 1024, 4096].includes(n)) assert.deepEqual(p, pairSwissRound(seats.slice().reverse(), n * 101, r))
    const seen = [...p.pairs.flat(), ...(p.bye ? [p.bye] : [])]
    assert.equal(seen.length, active.length, `missing n=${n} round=${r}`)
    assert.equal(new Set(seen).size, active.length)
    for (const [a, b] of p.pairs) {
      assert.notEqual(a, b)
      const A = byId.get(a)!, B = byId.get(b)!
      assert.ok(A.wins < 2 && A.losses < 2 && B.wins < 2 && B.losses < 2)
      const flip = (Number(a.slice(1)) + n + r) % 2
      ;(flip ? B : A).wins++; (flip ? A : B).losses++
      A.met.push(b); B.met.push(a); matches++
    }
    if (p.bye) { const e = byId.get(p.bye)!; e.wins++; e.byes++ }
    for (const id of p.floated) byId.get(id)!.floats++
    if (r === 0) assert.ok(seats.every((s) => s.losses < 2))
  }
  assert.ok(seats.every((s) => s.wins === 2 || s.losses === 2), `not terminal n=${n}`)
  const qualifiers = seats.filter((s) => s.wins === 2)
  const p = planPlayoff(qualifiers.map((s) => ({ id: s.id, swissWins: s.wins, swissLosses: s.losses, realWins: s.wins - s.byes, mapDiff: 0, met: s.met })), n)
  assert.equal(p.playIn.length + p.size, qualifiers.length)
  assert.equal(new Set([...p.lines.filter(Boolean), ...p.playIn.flatMap((m) => [m.hi, m.lo])]).size, qualifiers.length)
  for (const m of p.playIn) p.lines[m.line - 1] = m.hi
  assert.equal(new Set(p.lines).size, p.size)
  if (p.size > 1) assert.equal(firstRoundLines(p.size).flat().length, p.size)
  const clock = planSwissCup(n)
  assert.ok((clock.reserved - 1) * clock.stepSec <= 105 * 60)
}
console.log(`PASS all 4..4096 field sizes, ${matches} Swiss pairings, ${(performance.now()-started).toFixed(0)}ms`)
