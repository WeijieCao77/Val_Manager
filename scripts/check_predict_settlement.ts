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
  playoffPlayed, playoffFinal,
} from '../src/engine/predict'
import { CHAMPIONS_2026_PLAYOFFS as PO, PLAYOFF_KEY, P_SLOTS } from '../src/engine/predictPlayoffs'

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

// ================= 淘汰赛 =================
// The real playoffs, copied from vlr.gg/event/matches/2766 on 2026-10-19 and
// checked line by line against thespike.gg's results page for the event (the
// same fourteen scorelines); Wikipedia has LOUD 3–1 Vitality in the final.
// [stage, team, score, team, score], names as vlr writes them.
const PO_PLAYED: [string, string, number, string, number][] = [
  ['Upper Quarterfinals', 'NRG', 2, 'T1', 0],
  ['Upper Quarterfinals', 'Paper Rex', 0, 'LOUD', 2],
  ['Upper Quarterfinals', '100 Thieves', 0, 'G2 Esports', 2],
  ['Upper Quarterfinals', 'Team Vitality', 2, 'Nongshim RedForce', 1],
  ['Lower Round 1', 'T1', 2, 'Paper Rex', 1],
  ['Lower Round 1', '100 Thieves', 2, 'Nongshim RedForce', 1],
  ['Upper Semifinals', 'NRG', 1, 'LOUD', 2],
  ['Upper Semifinals', 'G2 Esports', 0, 'Team Vitality', 2],
  ['Lower Round 2', 'NRG', 0, '100 Thieves', 2],
  ['Lower Round 2', 'G2 Esports', 2, 'T1', 1],
  ['Upper Final', 'Team Vitality', 1, 'LOUD', 2],
  ['Lower Round 3', '100 Thieves', 2, 'G2 Esports', 1],
  ['Lower Final', 'Team Vitality', 3, '100 Thieves', 1],
  ['Grand Final', 'LOUD', 3, 'Team Vitality', 1],
]
// the grand final started 2026-10-18 06:40 UTC (thespike), best of five
const GF_STARTED = Date.parse('2026-10-18T06:40:00Z')
const poNow = Date.parse('2026-10-19T00:00:00Z')
{
  const games = PO_PLAYED.map(([stage, a, sa, b, sb]) => {
    const bo = stage === 'Lower Final' || stage === 'Grand Final' ? 5 : 3
    if (sa === sb || Math.max(sa, sb) !== (bo + 1) / 2) throw new Error(`${stage} ${a}–${b}: not a finished BO${bo}`)
    return { stage, a: tagOf(a), b: tagOf(b), win: sa > sb ? tagOf(a) : tagOf(b), lose: sa > sb ? tagOf(b) : tagOf(a) }
  })
  check('淘汰赛 14 场队名都认得', games.every(m => !m.a.startsWith('?') && !m.b.startsWith('?')))
  // 100T and G2 met twice (quarterfinal, lower round 3), so a match is found by who met whom in which round
  const meet = (stage: string, x?: string, y?: string) =>
    games.find(m => m.stage === stage && ((m.a === x && m.b === y) || (m.a === y && m.b === x)))
  // the draw from the group places: A1–C2, B1–D2, D1–A2, C1–B2
  const R = PREDICT_RESULTS[EV.id]
  const draw = [[R.A.first, R.C.second], [R.B.first, R.D.second], [R.D.first, R.A.second], [R.C.first, R.B.second]]
  check('发布的八强对阵就是小组名次交叉出来的那四场', JSON.stringify(PO.quarters) === JSON.stringify(draw), JSON.stringify(PO.quarters))
  // walk the bracket by hand, each match found among vlr's scorelines by who met whom
  const [q1, q2, q3, q4] = draw.map(([x, y]) => meet('Upper Quarterfinals', x, y))
  const s1 = meet('Upper Semifinals', q1?.win, q2?.win), s2 = meet('Upper Semifinals', q3?.win, q4?.win)
  const l1a = meet('Lower Round 1', q1?.lose, q2?.lose), l1b = meet('Lower Round 1', q3?.lose, q4?.lose)
  const l2a = meet('Lower Round 2', s2?.lose, l1a?.win), l2b = meet('Lower Round 2', s1?.lose, l1b?.win)
  const uf = meet('Upper Final', s1?.win, s2?.win), l3 = meet('Lower Round 3', l2a?.win, l2b?.win)
  const lf = meet('Lower Final', uf?.lose, l3?.win), gf = meet('Grand Final', uf?.win, lf?.win)
  const bySlot = { q1, q2, q3, q4, s1, s2, l1a, l1b, l2a, l2b, uf, l3, lf, gf }
  const missing = Object.entries(bySlot).filter(([, m]) => !m).map(([k]) => k)
  check('按对阵手推的 14 场都在 vlr 的赛果里，轮次对得上，一场不多一场不少',
    missing.length === 0 && new Set(Object.values(bySlot)).size === 14, missing.join(' '))
  const derived = Object.fromEntries(Object.entries(bySlot).map(([k, m]) => [k, m!.win])) as Record<string, string>
  const shipped = playoffPlayed(PO, poNow)
  check('发布的 14 场胜者与 vlr 一致', !!shipped && P_SLOTS.every(k => shipped[k] === derived[k]) && Object.keys(shipped).length === 14,
    `${JSON.stringify(shipped)} vs ${JSON.stringify(derived)}`)
  const champion = gf!.win, runnerUp = gf!.lose, third = lf!.lose, fourth = l3!.lose
  check('冠军 LOUD、亚军 VIT、季军 100T、殿军 G2', `${champion} ${runnerUp} ${third} ${fourth}` === 'LOUD VIT 100T G2')
  check('引擎结算的冠亚军就是这两队', JSON.stringify(playoffFinal(PO, poNow)) === JSON.stringify({ champion, runnerUp }))
  const confirmedAt = Date.parse('2026-10-18T12:00:00Z')
  check('赛果在总决赛开打之后确认，此刻已生效', playoffPlayed(PO, confirmedAt) !== null && confirmedAt > GF_STARTED
    && P_SLOTS.every(k => PO.at[k] < confirmedAt))
  check('确认时刻之前不结算、不能领', playoffPlayed(PO, confirmedAt - 1) === null && playoffFinal(PO, confirmedAt - 1) === null)

  // ---- every bracket a player could have saved, against the rule text on the page:
  //  冠亚全对 3 十连 · 冠军对 2 十连 · 亚军对 1 十连 · 决赛两队都中但颠倒 5 选拔 · 只中一支决赛队 3 选拔
  const ruleText = (c?: string, r?: string) => {
    if (c === champion && r === runnerUp) return { elite: 0, ten: 3 }
    if (c === champion) return { elite: 0, ten: 2 }
    if (r === runnerUp) return { elite: 0, ten: 1 }
    const hit = [c, r].filter(t => t && (t === champion || t === runnerUp)).length
    return hit === 2 ? { elite: 5, ten: 0 } : hit === 1 ? { elite: 3, ten: 0 } : { elite: 0, ten: 0 }
  }
  // who plays each slot on a set of picks, by hand again (a pick that is not one of the two sides counts as none)
  const sidesBy = (p: Record<string, string>) => {
    const s: Record<string, [string?, string?]> = {}
    const win = (k: string) => (s[k]?.[0] && s[k]?.[1] && s[k]!.includes(p[k]) ? p[k] : undefined)
    const lose = (k: string) => { const w = win(k); return w ? (w === s[k]![0] ? s[k]![1] : s[k]![0]) : undefined }
    draw.forEach(([x, y], i) => { s[`q${i + 1}`] = [x, y] })
    s.s1 = [win('q1'), win('q2')]; s.s2 = [win('q3'), win('q4')]
    s.l1a = [lose('q1'), lose('q2')]; s.l1b = [lose('q3'), lose('q4')]
    s.l2a = [lose('s2'), win('l1a')]; s.l2b = [lose('s1'), win('l1b')]
    s.uf = [win('s1'), win('s2')]; s.l3 = [win('l2a'), win('l2b')]
    s.lf = [lose('uf'), win('l3')]; s.gf = [win('uf'), win('lf')]
    return { s, champ: win('gf'), second: lose('gf') }
  }
  const order = ['q1', 'q2', 'q3', 'q4', 's1', 's2', 'l1a', 'l1b', 'l2a', 'l2b', 'uf', 'l3', 'lf', 'gf']
  const full: Record<string, string>[] = []
  const walk = (i: number, cur: Record<string, string>) => {
    if (i === order.length) { full.push(cur); return }
    for (const t of sidesBy(cur).s[order[i]]) if (t) walk(i + 1, { ...cur, [order[i]]: t })
  }
  walk(0, {})
  // and partial ones: every full bracket with a different slot left out, the rest kept as typed
  const partial = full.filter((_, i) => i % 7 === 0).map((b, i) => {
    const drop = order[i % order.length]
    const { [drop]: _gone, ...rest } = b
    return rest
  })
  let mismatch = 0, scoreMiss = 0, claimMiss = 0, paid = 0
  const tally: Record<string, number> = {}
  const before = PO.deadline - 60_000
  for (const picks of [...full, ...partial]) {
    const hand = sidesBy(picks)
    const want = ruleText(hand.champ, hand.second)
    if (picks === full[0] || full.includes(picks)) tally[`${want.ten}十连/${want.elite}选拔`] = (tally[`${want.ten}十连/${want.elite}选拔`] ?? 0) + 1
    // matches right by hand: a pick only stands if the team is in that match on the picks before it
    const stands = (k: string) => { const sd = hand.s[k]; return !!sd?.[0] && !!sd?.[1] && sd.includes(picks[k]) }
    const right = order.filter(k => stands(k) && picks[k] === derived[k]).length
    const sc = predictScore(PO.id, { [PLAYOFF_KEY]: { picks, at: before } }, poNow)
    const placesRight = Number(hand.champ === champion) + Number(hand.second === runnerUp)
    if (!sc || sc.correct !== right || sc.total !== 14 || sc.places !== placesRight) { scoreMiss++; if (scoreMiss < 4) console.log('   score', JSON.stringify(picks), sc, right) }
    const g = newGacha('VM-SETTLE-PO', '结算', '2026-09-20')
    const was = { elite: g.packs.elite ?? 0, ten: g.packs.ten ?? 0 }
    const saved = runAction(g, 'predict', { event: PO.id, group: PLAYOFF_KEY, picks }, { now: before, today: '2026-10-07', seed: 1 })
    const env = { now: poNow, today: '2026-10-19', seed: 1 }
    const c1 = runAction(g, 'predict_claim', { event: PO.id, group: PLAYOFF_KEY }, env)
    const c2 = runAction(g, 'predict_claim', { event: PO.id, group: PLAYOFF_KEY }, env)
    const got = c1.ok ? (c1.result as { reward: { elite: number; ten: number } }).reward : { elite: 0, ten: 0 }
    if (JSON.stringify(got) !== JSON.stringify(want)) { mismatch++; if (mismatch < 4) console.log('   ', JSON.stringify(picks), got, want) }
    const ok = saved.ok && c1.ok === (want.ten + want.elite > 0) && !c2.ok
      && (g.packs.ten ?? 0) === was.ten + want.ten && (g.packs.elite ?? 0) === was.elite + want.elite
      && (c1.ok ? g.predict?.[PO.id]?.[PLAYOFF_KEY]?.claimedAt === poNow : !g.predict?.[PO.id]?.[PLAYOFF_KEY]?.claimedAt)
    if (!ok) { claimMiss++; if (claimMiss < 4) console.log('   claim', JSON.stringify(picks), c1, c2, g.packs) }
    if (c1.ok) paid++
  }
  check(`淘汰赛 ${full.length} 种完整预测 + ${partial.length} 种缺一场的预测，奖励档位与规则原文一致`,
    full.length === 16384 && mismatch === 0, `${mismatch} 处不一致`)
  check('淘汰赛每种预测的猜对场次、冠亚军名次与手算一致', scoreMiss === 0, `${scoreMiss} 处不一致`)
  check('淘汰赛走真实领取：只领一次，入库数量正好，记下领取时间', claimMiss === 0, `${claimMiss} 处不一致；${paid} 种有奖`)
  console.log('     ', Object.entries(tally).map(([k, n]) => `${k}×${n}`).join('  '))
  {
    const g = newGacha('VM-SETTLE-PO-LATE', '结算', '2026-09-20')
    g.predict = { [PO.id]: { [PLAYOFF_KEY]: { picks: derived, at: PO.deadline } } }
    const ten0 = g.packs.ten ?? 0
    const r = runAction(g, 'predict_claim', { event: PO.id, group: PLAYOFF_KEY }, { now: poNow, today: '2026-10-19', seed: 1 })
    check('截止后才有的满分淘汰赛预测：不能领、不计分', !r.ok && (g.packs.ten ?? 0) === ten0
      && predictScore(PO.id, g.predict[PO.id], poNow) === null, `${r.ok ? '' : r.why} ten ${ten0}→${g.packs.ten}`)
  }
  {
    const g = newGacha('VM-SETTLE-PO-BOTH', '结算', '2026-09-20')
    const C = EV.groups.find(x => x.key === 'C')!
    runAction(g, 'predict', { event: EV.id, group: 'C', picks: PREDICT_RESULTS[EV.id].C.winners }, { now: lockAt(C) - 60_000, today: '2026-09-24', seed: 1 })
    runAction(g, 'predict', { event: PO.id, group: PLAYOFF_KEY, picks: derived }, { now: before, today: '2026-10-07', seed: 1 })
    const ten0 = g.packs.ten ?? 0
    const env = { now: poNow, today: '2026-10-19', seed: 1 }
    const a = runAction(g, 'predict_claim', { event: PO.id, group: PLAYOFF_KEY }, env)
    const b = runAction(g, 'predict_claim', { event: EV.id, group: 'C' }, env)
    const again = [runAction(g, 'predict_claim', { event: PO.id, group: PLAYOFF_KEY }, env), runAction(g, 'predict_claim', { event: EV.id, group: 'C' }, env)]
    check('同一账号的小组赛奖励和淘汰赛奖励各领各的，各只领一次（3 + 2 个十连包）',
      a.ok && b.ok && again.every(r => !r.ok) && (g.packs.ten ?? 0) === ten0 + 5, JSON.stringify(g.packs))
  }

  // ---- through the real server: two taps at once, a replayed request, a client save trying to undo the claim
  process.env.PHONE_GATE = '0'
  const { CARD_SCHEMA, makeCardApi, normalizeId } = await import('../cards-api.js')
  const db = new PGlite(), sql = makeSql(db)
  try {
    await db.exec(CARD_SCHEMA)
    const id = normalizeId('VM-PRED-PXCA-2222-3333-4444') as string
    const h = createHash('sha256').update(id).digest('hex')
    const g0 = newGacha(id, '领奖', '2026-09-20')
    runAction(g0, 'predict', { event: PO.id, group: PLAYOFF_KEY, picks: derived }, { now: before, today: '2026-10-07', seed: 1 })
    await sql`insert into card_accounts (id_hash, name, state) values (${h}, '领奖', ${sql.json(g0)})`
    const res = () => ({ code: 0, body: {} as any })
    const api = makeCardApi(sql, {
      rateLimited: () => false, readBody: async (req: { body: string }) => req.body,
      json: (r: { code: number; body: unknown }, code: number, body: unknown) => { r.code = code; r.body = body },
    } as never)
    const act = async (requestId: string) => {
      const r = res()
      await api.route({ method: 'POST', body: JSON.stringify({ id, action: 'predict_claim', args: { event: PO.id, group: PLAYOFF_KEY }, client: {}, requestId }) } as never, r as never, '/api/card/act', 'settle')
      return r.body
    }
    const ten0 = g0.packs.ten ?? 0
    const [x, y] = await Promise.all([act('claim-tap-one-0000001'), act('claim-tap-two-0000002')])
    const replay = await act('claim-tap-one-0000001')
    const read = async () => (await sql`select state from card_accounts where id_hash = ${h}` as unknown as { state: any }[])[0].state
    let st = await read()
    check('服务器：同时点两次只有一次领到，3 个十连包只入库一次', [x, y].filter(r => r?.ok).length === 1 && (st.packs.ten ?? 0) === ten0 + 3
      && !!st.predict[PO.id][PLAYOFF_KEY].claimedAt, `${JSON.stringify([x?.ok, x?.why, y?.ok, y?.why])} ten=${st.packs.ten}`)
    check('服务器：重发同一个请求号只回放结果，不再发', (st.packs.ten ?? 0) === ten0 + 3 && (replay?.ok ? true : !!replay?.why), JSON.stringify(replay?.why ?? replay?.ok))
    // a client save that sends the predictions back without claimedAt
    const r = res()
    const cur = await sql`select rev from card_accounts where id_hash = ${h}` as unknown as { rev: number }[]
    const forged = { ...st, packs: { ...st.packs, ten: 0 }, predict: { [PO.id]: { [PLAYOFF_KEY]: { picks: derived, at: before } } } }
    await api.route({ method: 'POST', body: JSON.stringify({ id, client: forged, baseRev: cur[0].rev }) } as never, r as never, '/api/card/save', 'settle')
    st = await read()
    const third = await act('claim-tap-three-000003')
    st = await read()
    check('服务器：客户端存档抹不掉领取记录，再领被拒', !third?.ok && (st.packs.ten ?? 0) === ten0 + 3 && !!st.predict[PO.id][PLAYOFF_KEY].claimedAt,
      `${third?.why} ten=${st.packs.ten}`)
  } finally { await db.close() }
}

console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
