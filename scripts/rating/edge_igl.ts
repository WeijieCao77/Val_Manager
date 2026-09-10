/**
 * The engine's own arithmetic for a caller, read off deterministically.
 *
 *   npx tsx scripts/rating/edge_igl.ts
 *
 * Win rates from a few hundred bo3s carry ±2 points of noise per cell, which
 * is the size of the effects being compared. buildLineup returns the strength
 * edge the sim actually uses, so the value of a 指挥 point and of an overall
 * point can be read exactly, then turned into a round-win probability through
 * the sim's own logistic (1 / (1 + e^(−diff/30))). Manager mode is read
 * directly; the arena path is the same engine after its compression
 * (attributes 0.6 toward 70, overall 0.6 toward 80), so it is read as the
 * manager path with compressed inputs.
 */
import { createNewGame } from '../../src/engine/world'
import { WORLD_TEAMS } from '../../src/engine/teams'
import { buildLineup } from '../../src/engine/match'
import { squadOf, callerOf } from '../../src/engine/roster'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) }, key: () => null, clear: () => store.clear(), get length() { return store.size },
}
const state = createNewGame(WORLD_TEAMS[0].id, '测试', 777)
const tier1 = Object.values(state.teams).filter((t) => t.tier === 1).sort((a, b) => b.rating - a.rating)
const pick = tier1.find((t) => callerOf(state, t.id))!
const opp = tier1.find((t) => t.id !== pick.id)!
for (const p of squadOf(state, pick.id)) { p.form = 70; p.morale = 70; p.fatigue = 0; p.injuredUntil = 0 }
const caller = callerOf(state, pick.id)!
const other = squadOf(state, pick.id).find((p) => p.id !== caller.id)!
const strength = () => { const l = buildLineup(state, pick.id, 'Ascent', opp.id); return { common: l.atk - (l.edge.tacticsAtk ?? 0), base: l.edge.base, igl: l.edge.igl, atk: l.atk } }
const roundP = (diff: number) => 1 / (1 + Math.exp(-diff / 30))
const snap = { co: caller.overall, ci: caller.attrs.igl, oo: other.overall, oi: other.attrs.igl }
const reset = () => { caller.overall = snap.co; caller.attrs.igl = snap.ci; other.overall = snap.oo; other.attrs.igl = snap.oi }
console.log(`${pick.tag} 对 ${opp.tag}，Ascent，主指挥 ${caller.ign}（总评 ${caller.overall}，指挥 ${caller.attrs.igl}），对照队员 ${other.ign}（总评 ${other.overall}）`)
const rows: [string, () => void][] = [
  ['主指挥 指挥 +10', () => { caller.attrs.igl = Math.min(99, caller.attrs.igl + 10) }],
  ['主指挥 总评 +5', () => { caller.overall += 5 }],
  ['主指挥 总评 +5（arena 压缩后 +3）', () => { caller.overall += 3 }],
  ['主指挥 指挥 +10（arena 压缩后 +6）', () => { caller.attrs.igl = Math.min(99, caller.attrs.igl + 6) }],
  ['非指挥 指挥 +10', () => { other.attrs.igl = Math.min(99, other.attrs.igl + 10) }],
  ['非指挥 总评 +5', () => { other.overall += 5 }],
]
reset(); const b = strength()
console.log(`基准：base ${b.base.toFixed(2)}，指挥加成 ${b.igl.toFixed(2)}，进攻强度 ${b.atk.toFixed(2)}`)
for (const [name, apply] of rows) {
  reset(); apply(); const s = strength()
  const d = s.atk - b.atk
  console.log(`${name.padEnd(30)} Δ强度 ${d >= 0 ? '+' : ''}${d.toFixed(2)}  （base ${(s.base - b.base) >= 0 ? '+' : ''}${(s.base - b.base).toFixed(2)}, 指挥 ${(s.igl - b.igl) >= 0 ? '+' : ''}${(s.igl - b.igl).toFixed(2)}）  一回合胜率 ${((roundP(d) - 0.5) * 100).toFixed(2)} 个百分点`)
}
reset()
