/**
 * 总决赛的 2 ban 1 选优先权，以及胜者组决赛的赛制长度。
 *
 *   npx tsx scripts/check_veto_edge.ts
 *
 * 两件事：
 *   胜者组决赛是 BO3。Kickoff 的模板里它曾经写死 bo:5，其余赛制早就是默认的
 *   BO3 了，所以只有那一处不一致。
 *   从胜者组决赛上来的队伍进总决赛，先 ban 两张图、再选下第一张。总决赛的 A
 *   方在模板里就是胜者组决赛的胜者，所以优先权就是「A 方连走前三步」。
 */
import { DOUBLE_4, DOUBLE_8, KUF, MASTERS_8, STAGE_8, TRIPLE_12, UBF } from '../src/engine/bracket'
import { poolFor, runVeto, vetoEdge, vetoSteps } from '../src/engine/match'
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { setupSeason } from '../src/engine/season'
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

// ------------------------------------------------------------- 赛制长度
for (const [label, tpl] of [
  ['Kickoff', TRIPLE_12], ['八强双败', DOUBLE_8], ['四强双败', DOUBLE_4], ['大师赛', MASTERS_8], ['分站赛', STAGE_8],
] as const) {
  const slots = tpl.flat().filter((r) => r.name === KUF || r.name === UBF).flatMap((r) => r.slots)
  if (!slots.length) continue
  // bo 不写就是外面传进来的默认值 3；写死 5 才是问题
  check(`${label} 的胜者组决赛不是 BO5`, slots.every((s) => s.bo !== 5),
    slots.map((s) => `bo=${s.bo ?? '默认(3)'}`).join(' '))
}
// 败者组决赛和总决赛应当仍是 BO5
for (const [label, tpl] of [['八强双败', DOUBLE_8], ['大师赛', MASTERS_8]] as const) {
  const finals = tpl.flat().filter((r) => r.name === '败者组决赛' || r.name === '总决赛')
  check(`${label} 的败者组决赛和总决赛仍是 BO5`,
    finals.length === 2 && finals.every((r) => r.slots.every((s) => s.bo === 5)))
}

// ------------------------------------------------------------- 优先权归属
check('只有总决赛给优先权', vetoEdge('KO:6:总决赛') && !vetoEdge('KO:5:败者组决赛') &&
  !vetoEdge('KO:4:胜者组决赛') && !vetoEdge(undefined))

const edge = vetoSteps(5, true)
check('带优先权时前三步都归 A 方', edge.slice(0, 3).every((s) => s.actor === 0),
  edge.map((s) => `${s.actor === 0 ? 'A' : 'B'}-${s.action}`).join(' '))
check('前两步是 ban、第三步是 pick', edge[0].action === 'ban' && edge[1].action === 'ban' && edge[2].action === 'pick')
check('第三步之后回到轮流、由 B 先', edge.slice(3).every((s, i) => s.actor === (i % 2 === 0 ? 1 : 0)))
check('不带优先权时严格轮流', vetoSteps(5, false).every((s, i) => s.actor === (i % 2) as 0 | 1))
for (const bo of [1, 3, 5] as const) {
  const st = vetoSteps(bo, true)
  check(`BO${bo} 带优先权时 A 方 ban 掉两张`,
    st.filter((s) => s.action === 'ban' && s.actor === 0).length >= 2)
}

// ------------------------------------------------------- 跑一次真的 veto
const me = WORLD_TEAMS[0]
const g: GameState = createNewGame(me.id, '审计', 20260909)
setupSeason(g)
const ids = Object.keys(g.teams).slice(0, 2)
const pool = poolFor(g)
const plain = runVeto(g, ids[0], ids[1], 5, pool, new Rng(1))
const gf = runVeto(g, ids[0], ids[1], 5, pool, new Rng(1), true)
const nameA = g.teams[ids[0]].name
const firstTwoBans = gf.log.filter((l) => l.includes('ban 掉')).slice(0, 2)
check('总决赛里头两个 ban 都是 A 方投的',
  firstTwoBans.length === 2 && firstTwoBans.every((l) => l.startsWith(nameA)), firstTwoBans.join(' / '))
const firstPick = gf.log.find((l) => l.includes('选下'))
check('第一张图由 A 方选下', !!firstPick && firstPick.startsWith(nameA), firstPick ?? '(没有 pick)')
check('两种 veto 都凑满 5 张图', plain.maps.length === 5 && gf.maps.length === 5,
  `平时 ${plain.maps.length} / 总决赛 ${gf.maps.length}`)
check('图不重复', new Set(gf.maps).size === gf.maps.length)
check('日志里写明了优先权', gf.log.some((l) => l.includes('2 ban 1 选')))

console.log(bad ? `\n${bad} 项不通过` : '\n全部通过')
process.exit(bad ? 1 : 0)
