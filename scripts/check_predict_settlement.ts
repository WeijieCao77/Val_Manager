/**
 * 赛事预测 settlement: the shipped results are the real ones, and every
 * possible set of picks is paid and scored the way the published rules say.
 *
 * Nothing here reuses the engine's bracket code: the results are re-derived
 * from the scorelines as vlr.gg printed them, and the tiers from the rule text
 * on the predict page, then compared with what the engine pays and ranks.
 *
 *   npx tsx scripts/check_predict_settlement.ts
 */
process.env.ENGINE_FROM_SOURCE = '1'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { newGacha } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import {
  CHAMPIONS_2026 as EV, PREDICT_RESULTS, confirmedResult, predictionReward, predictScore, predictBoard, lockAt,
} from '../src/engine/predict'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

// ---- the real group stage, copied from vlr.gg/event/matches/2766 (C, D on 2026-10-03; A, B on 2026-10-04)
// [stage, team, score, team, score] — names as vlr writes them
const PLAYED: Record<string, [string, string, number, string, number][]> = {
  A: [
    ['Opening', '100 Thieves', 2, 'T1', 0],
    ['Opening', 'JD Gaming', 0, 'FUT Esports', 2],
    ["Winner's", '100 Thieves', 2, 'FUT Esports', 0],
    ['Elimination', 'T1', 2, 'JD Gaming', 1],
    ['Decider', 'FUT Esports', 0, 'T1', 2],
  ],
  B: [
    ['Opening', 'Global Esports', 1, 'Team Vitality', 2],
    ['Opening', 'LOUD', 2, 'EDward Gaming', 0],
    ["Winner's", 'Team Vitality', 2, 'LOUD', 0],
    ['Elimination', 'Global Esports', 2, 'EDward Gaming', 0],
    ['Decider', 'LOUD', 2, 'Global Esports', 0],
  ],
  C: [
    ['Opening', 'Team Liquid', 1, 'Paper Rex', 2],
    ['Opening', 'TYLOO', 0, 'G2 Esports', 2],
    ["Winner's", 'G2 Esports', 1, 'Paper Rex', 2],
    ['Elimination', 'TYLOO', 1, 'Team Liquid', 2],
    ['Decider', 'G2 Esports', 2, 'Team Liquid', 0],
  ],
  D: [
    ['Opening', 'Nongshim RedForce', 0, 'NRG', 2],
    ['Opening', 'Karmine Corp', 2, 'Xi Lai Gaming', 0],
    ["Winner's", 'Karmine Corp', 1, 'NRG', 2],
    ['Elimination', 'Xi Lai Gaming', 0, 'Nongshim RedForce', 2],
    ['Decider', 'Karmine Corp', 1, 'Nongshim RedForce', 2],
  ],
}
// what vlr's group page and prize table say came of it
const PLACED: Record<string, [string, string, string, string]> = {
  A: ['100T', 'T1', 'FUT', 'JDG'],
  B: ['VIT', 'LOUD', 'GE', 'EDG'],
  C: ['PRX', 'G2', 'TL', 'TYL'],
  D: ['NRG', 'NS', 'KC', 'XLG'],
}

const tagOf = (name: string) => Object.values(EV.teams).find(t => t.name === name)?.tag ?? `?${name}`
const nowAfter = Date.parse('2026-10-04T16:00:00Z')

for (const group of EV.groups) {
  const shipped = PREDICT_RESULTS[EV.id]?.[group.key]
  const played = PLAYED[group.key]
  if (!played) {
    check(`${group.key} 组未打完，没有赛果，也不能领奖`, !shipped && !confirmedResult(EV.id, group, Date.parse('2026-12-31T00:00Z')))
    continue
  }
  // re-derive each slot from the scorelines: who met whom decides which match it was
  const won = played.map(([stage, a, sa, b, sb]) => {
    if (sa === sb || Math.max(sa, sb) !== 2) throw new Error(`${group.key} ${stage}: not a finished BO3`)
    return { stage, a: tagOf(a), b: tagOf(b), win: sa > sb ? tagOf(a) : tagOf(b), lose: sa > sb ? tagOf(b) : tagOf(a) }
  })
  const meet = (x: string, y: string) => won.find(m => (m.a === x && m.b === y) || (m.a === y && m.b === x))
  const [t0, t1, t2, t3] = group.teams
  const o1 = meet(t0, t1), o2 = meet(t2, t3)
  const w = o1 && o2 ? meet(o1.win, o2.win) : undefined
  const e = o1 && o2 ? meet(o1.lose, o2.lose) : undefined
  const d = w && e ? meet(w.lose, e.win) : undefined
  check(`${group.key} 组五场都在 vlr 的赛果里，阶段对得上`,
    !!(o1 && o2 && w && e && d) && o1.stage === 'Opening' && o2.stage === 'Opening' && w.stage === "Winner's"
      && e.stage === 'Elimination' && d.stage === 'Decider')
  if (!(o1 && o2 && w && e && d)) continue
  const derived = { o1: o1.win, o2: o2.win, w: w.win, e: e.win, d: d.win }
  check(`${group.key} 组发布的每场胜者与 vlr 一致`, JSON.stringify(shipped?.winners) === JSON.stringify(derived),
    `${JSON.stringify(shipped?.winners)} vs ${JSON.stringify(derived)}`)
  const [p1, p2, p3, p4] = PLACED[group.key]
  check(`${group.key} 组第一 ${p1}、第二 ${p2}（胜者组决赛胜者、决胜局胜者）`,
    shipped?.first === p1 && shipped?.second === p2 && w.win === p1 && d.win === p2 && d.lose === p3 && e.lose === p4)
  check(`${group.key} 组赛果在决胜局之后确认，此刻已生效`,
    !!shipped && shipped.confirmedAt > group.at.d && shipped.confirmedAt <= nowAfter && !!confirmedResult(EV.id, group, nowAfter))
  check(`${group.key} 组赛果生效前不能领`, !confirmedResult(EV.id, group, shipped!.confirmedAt - 1))

  // ---- every set of picks, against the rule text
  // the rule text, re-implemented from the predict page:
  //  两队名次全对 2 十连 · 一队名次对 1 十连 · 两队都中名次颠倒 5 选拔 · 只中一队名次不对 3 选拔
  const ruleText = (first?: string, second?: string) => {
    const exact = Number(first === p1) + Number(second === p2)
    const inTwo = [first, second].filter(t => t && (t === p1 || t === p2)).length
    if (exact === 2) return { elite: 0, ten: 2 }
    if (exact === 1) return { elite: 0, ten: 1 }
    if (inTwo === 2) return { elite: 5, ten: 0 }
    if (inTwo === 1) return { elite: 3, ten: 0 }
    return { elite: 0, ten: 0 }
  }
  // every subset of slots picked, every winner for each: 3^5 boards, most of them partial
  const boards: Record<string, string>[] = []
  const walk = (i: number, cur: Record<string, string>) => {
    if (i === 5) { boards.push({ ...cur }); return }
    const k = ['o1', 'o2', 'w', 'e', 'd'][i]
    // who plays slot k on these picks, worked out by hand
    const sideOf = (): [string, string] | null => {
      const lose = (m: string, x: string, y: string) => cur[m] === x ? y : cur[m] === y ? x : undefined
      if (k === 'o1') return [t0, t1]
      if (k === 'o2') return [t2, t3]
      if (k === 'w') return cur.o1 && cur.o2 ? [cur.o1, cur.o2] : null
      if (k === 'e') return cur.o1 && cur.o2 ? [lose('o1', t0, t1)!, lose('o2', t2, t3)!] : null
      const wl = cur.w && cur.o1 && cur.o2 ? lose('w', cur.o1, cur.o2) : undefined
      return wl && cur.e ? [wl, cur.e] : null
    }
    walk(i + 1, cur)
    const pair = sideOf()
    if (pair) for (const t of pair) walk(i + 1, { ...cur, [k]: t })
  }
  walk(0, {})
  let paid = 0, mismatch = 0, scoreMiss = 0, claimMiss = 0
  const tally: Record<string, number> = {}
  for (const picks of boards) {
    const first = picks.w
    const second = picks.d
    const want = ruleText(first, second)
    const got = predictionReward(group, picks, shipped!)
    if (JSON.stringify(got) !== JSON.stringify(want)) { mismatch++; if (mismatch < 4) console.log('   ', JSON.stringify(picks), got, want) }
    tally[`${want.ten}十连/${want.elite}选拔`] = (tally[`${want.ten}十连/${want.elite}选拔`] ?? 0) + 1
    // matches right, counted by hand
    const right = (['o1', 'o2', 'w', 'e', 'd'] as const).filter(k => picks[k] === derived[k]).length
    const placesRight = Number(first === p1) + Number(second === p2)
    const sc = predictScore(EV.id, { [group.key]: { picks, at: lockAt(group) - 1 } }, nowAfter)
    const settledGroups = Object.keys(PLAYED).length
    const scoreOk = Object.keys(picks).length === 0 ? sc === null
      : !!sc && sc.correct === right && sc.places === placesRight && sc.total === 5 * settledGroups
    if (!scoreOk) { scoreMiss++; if (scoreMiss < 4) console.log('   score', JSON.stringify(picks), sc, right) }
    // and through the real action: save before the deadline, claim after the result
    const g = newGacha('VM-SETTLE-' + group.key, '结算', '2026-09-20')
    const before = { elite: g.packs.elite ?? 0, ten: g.packs.ten ?? 0 }
    const saved = runAction(g, 'predict', { event: EV.id, group: group.key, picks }, { now: lockAt(group) - 60_000, today: '2026-09-24', seed: 1 })
    const env = { now: nowAfter, today: '2026-10-04', seed: 1 }
    const c1 = runAction(g, 'predict_claim', { event: EV.id, group: group.key }, env)
    const c2 = runAction(g, 'predict_claim', { event: EV.id, group: group.key }, env)
    const ok = saved.ok && c1.ok === (want.ten + want.elite > 0) && !c2.ok
      && (g.packs.ten ?? 0) === before.ten + want.ten && (g.packs.elite ?? 0) === before.elite + want.elite
    if (!ok) { claimMiss++; if (claimMiss < 4) console.log('   claim', JSON.stringify(picks), c1, g.packs) }
    if (c1.ok) paid++
  }
  check(`${group.key} 组 ${boards.length} 种预测（含只填一半的）的奖励档位与规则原文一致`, mismatch === 0, `${mismatch} 处不一致`)
  check(`${group.key} 组每种预测的猜对场次、名次与手算一致`, scoreMiss === 0, `${scoreMiss} 处不一致`)
  check(`${group.key} 组走真实领取：只领一次，入库数量正好`, claimMiss === 0, `${claimMiss} 处不一致；${paid} 种有奖`)
  console.log('     ', Object.entries(tally).map(([k, n]) => `${k}×${n}`).join('  '))
}

// ---- a save after the deadline earns nothing, even with the right picks
{
  const C = EV.groups.find(g => g.key === 'C')!
  const perfect = PREDICT_RESULTS[EV.id].C.winners
  check('截止后才有的预测不计分', predictScore(EV.id, { C: { picks: perfect, at: lockAt(C) } }, nowAfter) === null)
  check('截止前的满分预测：只猜 C 组，5/20 场', JSON.stringify(predictScore(EV.id, { C: { picks: perfect, at: 1 } }, nowAfter))
    === JSON.stringify({ correct: 5, total: 20, places: 2 }))
  check('结算前看不到分数', predictScore(EV.id, { C: { picks: perfect, at: 1 } }, Date.parse('2026-10-03T10:00Z')) === null)
}

// ---- the board: ties share a rank, the order inside a tie is places then id
{
  const C = PREDICT_RESULTS[EV.id].C.winners, D = PREDICT_RESULTS[EV.id].D.winners
  const acc = (id: string, saved: unknown) => ({ id, name: id, saved })
  const rows = predictBoard(EV.id, [
    acc('e', { C: { picks: { o1: 'TL' }, at: 1 } }), // 0
    acc('a', { C: { picks: C, at: 1 }, D: { picks: D, at: 1 } }), // 10
    acc('b', { C: { picks: C, at: 1 } }), // 5, places 2
    acc('c', { D: { picks: { o1: 'NRG', o2: 'KC', w: 'KC', e: 'NS', d: 'NS' }, at: 1 }, C: { picks: { o1: 'PRX' }, at: 1 } }), // 5, places 1
    acc('f', { A: { picks: { o1: '100T' }, at: 1 } }), // 1: A's opener
    acc('g', 'junk'),
  ], nowAfter)
  check('排行：猜对多的在前，同分并列，没预测的场次算错（四组 20 场）',
    JSON.stringify(rows.map(r => [r.id, r.rank, r.correct, r.total, r.places]))
      === JSON.stringify([['a', 1, 10, 20, 4], ['b', 2, 5, 20, 2], ['c', 2, 5, 20, 1], ['f', 4, 1, 20, 0], ['e', 5, 0, 20, 0]]),
    JSON.stringify(rows.map(r => [r.id, r.rank, r.correct, r.places])))
}

// ---- /api/card/predict_top off a real table: suspect accounts stay off, the caller gets their own row
{
  const { CARD_SCHEMA, makeCardApi } = await import('../cards-api.js')
  const db = new PGlite(), sql = makeSql(db)
  const realNow = Date.now
  try {
    await db.exec(CARD_SCHEMA)
    const C = PREDICT_RESULTS[EV.id].C.winners, D = PREDICT_RESULTS[EV.id].D.winners
    const put = async (n: number, name: string, predict: unknown, suspect = false) => {
      const id = `VM-PRED-TXP0-0000-0000-000${n}`
      const g = newGacha(id, name, '2026-09-20') as ReturnType<typeof newGacha> & { predict?: unknown }
      if (predict) g.predict = { [EV.id]: predict }
      const h = createHash('sha256').update(id).digest('hex')
      await sql`insert into card_accounts (id_hash, name, state, suspect) values (${h}, ${name}, ${sql.json(g)}, ${suspect})`
      return id
    }
    await put(1, '全对', { C: { picks: C, at: 1 }, D: { picks: D, at: 1 } })
    const half = await put(2, '半对', { C: { picks: C, at: 1 } })
    await put(3, '可疑', { C: { picks: C, at: 1 }, D: { picks: D, at: 1 } }, true)
    await put(4, '没预测', null)
    const api = makeCardApi(sql, {
      rateLimited: () => false, readBody: async (req: { body: string }) => req.body,
      json: (res: { body?: unknown }, _code: number, body: unknown) => { res.body = body },
    } as never)
    Date.now = () => nowAfter
    const res: { body?: any } = {}
    await api.route({ method: 'POST', body: JSON.stringify({ id: half, event: EV.id }) } as never, res, '/api/card/predict_top', 'settle')
    const b = res.body
    check('接口：两人上榜，可疑账号与没预测的不上', b?.ok && b.players === 2 && b.total === 20
      && JSON.stringify(b.rows.map((r: any) => [r.rank, r.name, r.correct, r.me])) === JSON.stringify([[1, '全对', 10, false], [2, '半对', 5, true]]),
      JSON.stringify(b))
    check('接口：自己的名次单独返回，不回传账号 ID', b?.mine?.rank === 2 && b.mine.correct === 5 && !JSON.stringify(b).includes('VM-PRED'))
  } finally { Date.now = realNow; await db.close() }
}

console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
