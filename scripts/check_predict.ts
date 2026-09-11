/**
 * 赛事预测: the Champions Shanghai groups flow the way the real bracket does,
 * the picks are the server's, and a group closes at its first match.
 *
 *   npx tsx scripts/check_predict.ts
 */
import { migrateGacha, mergeClientFields, newGacha, SERVER_KEYS } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import { WORLD_TEAMS } from '../src/engine/teams'
import {
  CHAMPIONS_2026, cleanPicks, lockAt, picksOf, sides, standing, SLOTS,
} from '../src/engine/predict'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const EV = CHAMPIONS_2026
const groups = EV.groups
const C = groups.find((g) => g.key === 'C')!
const env = (iso: string) => ({ now: Date.parse(iso), today: iso.slice(0, 10), seed: 3 })

// ---- the field and the calendar
const tags = groups.flatMap((g) => g.teams)
check('4 个组，16 支队，每支只在一个组', groups.length === 4 && tags.length === 16 && new Set(tags).size === 16)
check('每支队都是游戏里的俱乐部，简称对得上',
  tags.every((t) => WORLD_TEAMS.find((w) => w.id === EV.teams[t]?.clubId)?.tag === t),
  tags.filter((t) => WORLD_TEAMS.find((w) => w.id === EV.teams[t]?.clubId)?.tag !== t).join(' '))
check('每组先打两场首轮，再打胜者组决赛和败者组首轮，决胜局最后',
  groups.every((g) => Math.max(g.at.o1, g.at.o2) < Math.min(g.at.w, g.at.e) && Math.max(g.at.w, g.at.e) < g.at.d))
check('C 组最先开赛：北京时间 9 月 24 日 17:00 锁定', lockAt(C) === Date.parse('2026-09-24T09:00Z'), new Date(lockAt(C)).toISOString())
check('小组赛 10 月 4 日打完', Math.max(...groups.map((g) => g.at.d)) === Date.parse('2026-10-04T12:00Z'))

// ---- the bracket inside a group
{
  const p = { o1: 'PRX', o2: 'G2', w: 'PRX', e: 'TL', d: 'TL' }
  const s = sides(C, p)
  check('首轮胜者进胜者组决赛，负者进败者组首轮',
    JSON.stringify(s.w) === '["PRX","G2"]' && JSON.stringify(s.e) === '["TL","TYL"]', JSON.stringify(s))
  check('决胜局是胜者组决赛负者对败者组首轮胜者', JSON.stringify(s.d) === '["G2","TL"]', JSON.stringify(s.d))
  const st = standing(C, p)
  check('PRX 第一、TL 第二出线，G2 第三，TYL 第四',
    st.first === 'PRX' && st.second === 'TL' && st.third === 'G2' && st.fourth === 'TYL', JSON.stringify(st))
  check('改了首轮，依赖它的后续预测都作废',
    JSON.stringify(cleanPicks(C, { ...p, o1: 'TL' })) === '{"o1":"TL","o2":"G2"}', JSON.stringify(cleanPicks(C, { ...p, o1: 'TL' })))
  check('选一支不在这场的队不算', JSON.stringify(cleanPicks(C, { o1: 'EDG', w: 'PRX' })) === '{}')
  check('五场全选完才有完整名次', SLOTS.length === 5 && standing(C, { o1: 'PRX' }).first === null)
}

// ---- the server keeps the picks and the clock
{
  const g = newGacha('VM-TEST-PRED-0000-0000-0001', '审计', '2026-09-20')
  const full = { o1: 'PRX', o2: 'G2', w: 'PRX', e: 'TL', d: 'TL' }
  const r = runAction(g, 'predict', { event: EV.id, group: 'C', picks: full }, env('2026-09-20T00:00:00Z'))
  check('开赛前可以保存', r.ok && JSON.stringify(picksOf(g, EV.id, 'C')) === JSON.stringify(full), JSON.stringify(picksOf(g, EV.id, 'C')))
  const late = runAction(g, 'predict', { event: EV.id, group: 'C', picks: { o1: 'TL' } }, env('2026-09-24T09:00:00Z'))
  check('第一场开赛后改不了，原来的预测还在', !late.ok && picksOf(g, EV.id, 'C').o1 === 'PRX', late.ok ? '' : late.why)
  const other = runAction(g, 'predict', { event: EV.id, group: 'A', picks: { o1: 'T1' } }, env('2026-09-24T09:00:00Z'))
  check('A 组还没开赛，照样能存', other.ok && picksOf(g, EV.id, 'A').o1 === 'T1')
  check('没有这个组就拒绝', !runAction(g, 'predict', { event: EV.id, group: 'Z', picks: {} }, env('2026-09-20T00:00:00Z')).ok)
  check('没有这个赛事就拒绝', !runAction(g, 'predict', { event: 'masters-9', group: 'A', picks: {} }, env('2026-09-20T00:00:00Z')).ok)

  check('预测是服务端字段', (SERVER_KEYS as readonly string[]).includes('predict'))
  const server = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
  mergeClientFields(server, { predict: { [EV.id]: { C: { picks: { o1: 'TL' }, at: 0 } } } } as never)
  check('客户端存档写不进预测', picksOf(server, EV.id, 'C').o1 === 'PRX')
  check('迁移存档后预测原样保留', JSON.stringify(picksOf(server, EV.id, 'C')) === JSON.stringify(full))
}

// ---- old and hand-edited saves
{
  const j = newGacha('VM-TEST-PRED-0000-0000-0002', '审计', '2026-09-20')
  ;(j as unknown as { predict: unknown }).predict = {
    [EV.id]: { C: { picks: { o1: 'EDG', w: 'PRX' }, at: 'x' }, Q: { picks: { o1: 'T1' }, at: 1 } },
    'masters-9': { A: { picks: { o1: 'T1' }, at: 1 } },
  }
  check('存档里对不上赛程的预测被清掉', migrateGacha(j, j.id).predict === undefined)
  const old = newGacha('VM-TEST-PRED-0000-0000-0003', '审计', '2026-09-01')
  check('旧存档没有这个字段也能读', migrateGacha(old, old.id).predict === undefined && JSON.stringify(picksOf(old, EV.id, 'A')) === '{}')
}

console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
