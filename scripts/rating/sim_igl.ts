/**
 * What the engine pays for a caller today, measured rather than read off the formula.
 *
 *   npx tsx scripts/rating/sim_igl.ts [matches]
 *
 * The card overall of a main caller is about to carry a caller weight. If the
 * engine then reads that overall as combat strength AND pays the caller bonus
 * on top, the same thing is paid twice. This runs one evenly matched tier-one
 * pair through bo3s and moves one number at a time: the caller's 指挥, the
 * caller's overall, both, a non-caller's 指挥 (must be worth nothing), and five
 * men all flagged as callers (must not stack).
 */
import { createNewGame } from '../../src/engine/world'
import { WORLD_TEAMS } from '../../src/engine/teams'
import { simulateMatch } from '../../src/engine/match'
import { squadOf, callerOf } from '../../src/engine/roster'
import { Rng } from '../../src/engine/rng'
import type { Player } from '../../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) }, key: () => null, clear: () => store.clear(), get length() { return store.size },
}
const N = Number(process.argv[2] ?? 400)
const state = createNewGame(WORLD_TEAMS[0].id, '测试', 777)
const tier1 = Object.values(state.teams).filter((t) => t.tier === 1).sort((a, b) => b.rating - a.rating)
let A = tier1[0], B = tier1[1]
for (let i = 1; i < tier1.length; i++) {
  if (Math.abs(tier1[i].rating - tier1[i - 1].rating) < Math.abs(A.rating - B.rating)) { A = tier1[i - 1]; B = tier1[i] }
}
for (const id of [A.id, B.id]) for (const p of squadOf(state, id)) { p.form = 70; p.morale = 70; p.fatigue = 0; p.injuredUntil = 0 }
const caller = callerOf(state, A.id)!
const others = squadOf(state, A.id).filter((p) => p.id !== caller.id)
console.log(`${A.tag} vs ${B.tag}, caller ${caller.ign} (overall ${caller.overall}, 指挥 ${caller.attrs.igl}), ${N} bo3 each`)

const snapshot = (ps: Player[]) => ps.map((p) => ({ p, overall: p.overall, igl: p.attrs.igl, isIgl: p.isIgl }))
const restore = (s: ReturnType<typeof snapshot>) => { for (const x of s) { x.p.overall = x.overall; x.p.attrs.igl = x.igl; x.p.isIgl = x.isIgl } }
function winRate(): number {
  let w = 0
  for (let i = 0; i < N; i++) { const r = simulateMatch(state, A.id, B.id, 3, new Rng(1000 + i * 7919)); if (r.mapsWonA > r.mapsWonB) w++ }
  return w / N
}
const cases: [string, () => void][] = [
  ['基准', () => {}],
  ['主指挥 指挥 +15', () => { caller.attrs.igl += 15 }],
  ['主指挥 总评 +5', () => { caller.overall += 5 }],
  ['主指挥 总评 +5 且 指挥 +15（卡面总评被当作战强度、再拿指挥加成）', () => { caller.overall += 5; caller.attrs.igl += 15 }],
  ['非指挥队员 指挥 +15', () => { others[0].attrs.igl += 15 }],
  ['五人全部标为指挥、指挥 90', () => { for (const p of squadOf(state, A.id)) { p.isIgl = true; p.attrs.igl = 90 } }],
  ['一名非指挥队员 总评 +5', () => { others[0].overall += 5 }],
]
const base = snapshot(squadOf(state, A.id))
const rows: string[] = []
let ref = 0
for (const [name, apply] of cases) {
  restore(base); apply()
  const w = winRate()
  if (name === '基准') ref = w
  rows.push(`${name.padEnd(46)} ${(w * 100).toFixed(1)}%  (${((w - ref) * 100 >= 0 ? '+' : '')}${((w - ref) * 100).toFixed(1)})`)
}
restore(base)
console.log(rows.join('\n'))
