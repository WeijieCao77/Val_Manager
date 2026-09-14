/**
 * A save's ceilings are its own.
 *
 *   npx tsx scripts/check_potential_jitter.ts
 *
 * 2026-09-14, from the group: 「潜力值每个档都是固定的，玩多了很无聊」.
 * A new save now offsets every player's potential by a small amount drawn
 * from its own seed: within ±3, never below his overall, never past 99,
 * mean zero. The same seed gives the same world; a different seed gives a
 * different one; an existing save is not re-rolled on load.
 */
const mem: Record<string, string> = {}
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = v },
  removeItem: (k: string) => { delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
}
import { createNewGame, POTENTIAL_JITTER } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { exportSave, importSave } from '../src/engine/save'
import raw from '../src/data/world.json'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const base = new Map((raw.players as { id: string; potential: number; overall: number }[]).map((p) => [p.id, p]))
const team = WORLD_TEAMS[0].id
const a = createNewGame(team, '审计', 1)
const a2 = createNewGame(team, '审计', 1)
const b = createNewGame(team, '审计', 2)

const ids = [...base.keys()]
const diffs = ids.map((id) => a.players[id].potential - base.get(id)!.potential)
check('同一个种子两次开档，潜力一样', ids.every((id) => a.players[id].potential === a2.players[id].potential))
const changed = ids.filter((id) => a.players[id].potential !== b.players[id].potential).length
check('不同种子的档潜力不一样', changed > ids.length * 0.4, `${changed}/${ids.length} 人不同`)
check(`偏差都在 ±${POTENTIAL_JITTER.max} 以内`, diffs.every((d) => Math.abs(d) <= POTENTIAL_JITTER.max))
const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length
check('平均偏差接近 0（99 的人只能往下，所以略负）', Math.abs(mean) < 0.6, mean.toFixed(2))
check('从来不低于当前能力', ids.every((id) => a.players[id].potential >= a.players[id].overall))
check('从来不超过 99', ids.every((id) => a.players[id].potential <= 99))
const moved = diffs.filter((d) => d !== 0).length
check('大约一半的人动了', moved > ids.length * 0.35 && moved < ids.length * 0.85, `${moved}/${ids.length}`)
const top = ids.filter((id) => base.get(id)!.potential >= 97)
check('数据里潜力 97+ 的人在某个档里会掉到 96 以下', top.some((id) => a.players[id].potential <= 95 || b.players[id].potential <= 95))
// prospects too
const pros = Object.values(a.players).filter((p) => !base.has(p.id))
const prosB = pros.filter((p) => b.players[p.id] && b.players[p.id].potential !== p.potential).length
check('自由人新秀的潜力也按档浮动，且不超过 97', prosB > 0 && pros.every((p) => p.potential <= 97 && p.potential >= p.overall), `${prosB}/${pros.length}`)
// an existing save is not re-rolled
const back = importSave(exportSave(a))
check('读档不重新摇', ids.every((id) => back.players[id].potential === a.players[id].potential))
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
