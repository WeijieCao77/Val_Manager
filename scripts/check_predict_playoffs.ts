/**
 * 赛事预测 · 淘汰赛: the bracket is the one Champions is really played on, it
 * opens only on the real eight, closes at its deadline, and pays and scores
 * the way the page says.
 *
 *   npx tsx scripts/check_predict_playoffs.ts
 */
import { newGacha, migrateGacha, mergeClientFields } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import {
  CHAMPIONS_2026 as EV, PREDICT_RESULTS, PLAYOFF_RESULTS, playoffReady, playoffPlayed, playoffFinal, predictScore,
  predictBoard, PREDICT_EVENT_IDS,
} from '../src/engine/predict'
import {
  CHAMPIONS_2026_PLAYOFFS as PO, P_SLOTS, PLAYOFF_KEY, cleanPlayoffPicks, playoffSides, playoffPlacing, playedWinners,
} from '../src/engine/predictPlayoffs'
import type { PPicks, PlayoffEvent } from '../src/engine/predictPlayoffs'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

// ---- the bracket: Champions 2025 and 2024 as vlr shows them (read 2026-10-03), played through FEEDS
// [slot, team, team, winner] with vlr's names shortened; the quarterfinals in vlr's order
const PAST: Record<string, [string, string, string, string][]> = {
  2025: [
    ['q1', 'FNC', 'DRX', 'FNC'], ['q2', 'PRX', 'G2', 'PRX'], ['q3', 'TH', 'MIBR', 'MIBR'], ['q4', 'NRG', 'GX', 'NRG'],
    ['s1', 'FNC', 'PRX', 'FNC'], ['s2', 'MIBR', 'NRG', 'NRG'], ['uf', 'FNC', 'NRG', 'NRG'],
    ['l1a', 'DRX', 'G2', 'DRX'], ['l1b', 'TH', 'GX', 'TH'], ['l2a', 'MIBR', 'DRX', 'DRX'], ['l2b', 'PRX', 'TH', 'PRX'],
    ['l3', 'DRX', 'PRX', 'DRX'], ['lf', 'FNC', 'DRX', 'FNC'], ['gf', 'NRG', 'FNC', 'NRG'],
  ],
  2024: [
    ['q1', 'DRX', 'SEN', 'SEN'], ['q2', 'TE', 'EDG', 'EDG'], ['q3', 'G2', 'LEV', 'LEV'], ['q4', 'TH', 'FNC', 'TH'],
    ['s1', 'SEN', 'EDG', 'EDG'], ['s2', 'LEV', 'TH', 'LEV'], ['uf', 'EDG', 'LEV', 'EDG'],
    ['l1a', 'DRX', 'TE', 'DRX'], ['l1b', 'G2', 'FNC', 'FNC'], ['l2a', 'TH', 'DRX', 'TH'], ['l2b', 'SEN', 'FNC', 'SEN'],
    ['l3', 'TH', 'SEN', 'TH'], ['lf', 'LEV', 'TH', 'TH'], ['gf', 'EDG', 'TH', 'EDG'],
  ],
}
for (const [year, rows] of Object.entries(PAST)) {
  const q = rows.slice(0, 4).map(r => [r[1], r[2]] as [string, string])
  const ev: PlayoffEvent = { ...PO, quarters: q }
  const winners = Object.fromEntries(rows.map(r => [r[0], r[3]])) as PPicks
  const s = playoffSides(ev, winners)
  const wrong = rows.filter(([k, a, b]) => !s[k as keyof typeof s].includes(a) || !s[k as keyof typeof s].includes(b))
  check(`冠军赛 ${year} 的 14 场按这套对阵走得通，每场双方都对`, wrong.length === 0, wrong.map(r => r[0]).join(' '))
  check(`冠军赛 ${year} 的赛果全部保留`, Object.keys(cleanPlayoffPicks(ev, winners)).length === 14)
  const p = playoffPlacing(ev, winners)
  check(`冠军赛 ${year} 冠亚季殿`, year === '2025'
    ? p.champion === 'NRG' && p.runnerUp === 'FNC' && p.third === 'DRX' && p.fourth === 'PRX'
    : p.champion === 'EDG' && p.runnerUp === 'TH' && p.third === 'LEV' && p.fourth === 'SEN', JSON.stringify(p))
}
check('14 场，BO5 只有败者组决赛和总决赛', P_SLOTS.length === 14 && P_SLOTS.filter(k => PO.bo[k] === 5).join() === 'lf,gf')
check('每场都排在它依赖的比赛之后', P_SLOTS.every(k => {
  const feeds: Record<string, string[]> = { s1: ['q1', 'q2'], s2: ['q3', 'q4'], l1a: ['q1', 'q2'], l1b: ['q3', 'q4'],
    l2a: ['s2', 'l1a'], l2b: ['s1', 'l1b'], uf: ['s1', 's2'], l3: ['l2a', 'l2b'], lf: ['uf', 'l3'], gf: ['uf', 'lf'] }
  return (feeds[k] ?? []).every(f => PO.at[f as keyof typeof PO.at] < PO.at[k])
}))
check('北京时间 10 月 7 日 16:00 截止，在第一场八强之前', PO.deadline === Date.parse('2026-10-07T08:00Z') && PO.deadline < Math.min(...P_SLOTS.map(k => PO.at[k])))
check('淘汰赛的预测能存，排行接口认得它', PREDICT_EVENT_IDS.includes(PO.id) && PREDICT_EVENT_IDS.includes(EV.id))

// ---- opening: closed until all four groups are confirmed and the draw is the real eight
const realQuarters = PO.quarters
const savedResults = JSON.stringify(PREDICT_RESULTS[EV.id])
const before = Date.parse('2026-10-06T00:00Z')
const env = (now: number) => ({ now, today: new Date(now).toISOString().slice(0, 10), seed: 1 })
const fresh = (n: number) => newGacha(`VM-PLAY-OFFS-0000-0000-000${n}`, '淘汰赛', '2026-09-20')
// a stand-in finish for A and B and a draw over the eight, test-only
const FAKE_AB = {
  A: { winners: { o1: '100T', o2: 'FUT', w: '100T', e: 'T1', d: 'T1' }, first: '100T', second: 'T1', confirmedAt: Date.parse('2026-10-04T15:00Z') },
  B: { winners: { o1: 'VIT', o2: 'LOUD', w: 'VIT', e: 'GE', d: 'GE' }, first: 'VIT', second: 'GE', confirmedAt: Date.parse('2026-10-04T15:00Z') },
}
const DRAW: [string, string][] = [['100T', 'GE'], ['PRX', 'NS'], ['VIT', 'T1'], ['NRG', 'G2']]
try {
  {
    const g = fresh(1)
    const r = runAction(g, 'predict', { event: PO.id, group: PLAYOFF_KEY, picks: { q1: '100T' } }, env(before))
    check('对阵没定时不能存', !r.ok && !g.predict?.[PO.id], r.ok ? '' : r.why)
  }
  PO.quarters = DRAW
  check('小组赛没全部结算，有对阵也不开放', !playoffReady(PO, before))
  Object.assign(PREDICT_RESULTS[EV.id], FAKE_AB)
  check('四组结算、对阵是真实八强，开放', playoffReady(PO, before))
  PO.quarters = [['100T', 'GE'], ['PRX', 'NS'], ['VIT', 'T1'], ['NRG', 'TL']]
  check('对阵里有被淘汰的队，不开放', !playoffReady(PO, before))
  PO.quarters = [['100T', 'GE'], ['PRX', 'NS'], ['VIT', 'T1'], ['NRG', 'NRG']]
  check('对阵里一队出现两次，不开放', !playoffReady(PO, before))
  PO.quarters = DRAW

  // ---- saving and the deadline
  const full: PPicks = { q1: '100T', q2: 'PRX', q3: 'VIT', q4: 'NRG', s1: 'PRX', s2: 'NRG', l1a: 'GE', l1b: 'G2',
    l2a: 'GE', l2b: '100T', uf: 'NRG', l3: '100T', lf: 'PRX', gf: 'NRG' }
  check('一整张合法的预测 14 场都留得住', Object.keys(cleanPlayoffPicks(PO, full)).length === 14)
  const g = fresh(2)
  const ok = runAction(g, 'predict', { event: PO.id, group: PLAYOFF_KEY, picks: full }, env(before))
  check('截止前能存', ok.ok && JSON.stringify(g.predict?.[PO.id]?.[PLAYOFF_KEY]?.picks) === JSON.stringify(full))
  const late = runAction(g, 'predict', { event: PO.id, group: PLAYOFF_KEY, picks: { q1: 'GE' } }, env(PO.deadline))
  check('截止整点拒绝，原预测保留', !late.ok && g.predict?.[PO.id]?.[PLAYOFF_KEY]?.picks.q1 === '100T')
  check('截止前 1 毫秒还能存', runAction(fresh(3), 'predict', { event: PO.id, group: PLAYOFF_KEY, picks: full }, env(PO.deadline - 1)).ok)
  check('组别写错就拒绝', !runAction(fresh(4), 'predict', { event: PO.id, group: 'A', picks: full }, env(before)).ok)
  check('改了八强，后面依赖它的都作废', JSON.stringify(cleanPlayoffPicks(PO, { ...full, q1: 'GE' }))
    === JSON.stringify({ q1: 'GE', q2: 'PRX', q3: 'VIT', q4: 'NRG', s1: 'PRX', s2: 'NRG', l1b: 'G2', uf: 'NRG' }), JSON.stringify(cleanPlayoffPicks(PO, { ...full, q1: 'GE' })))
  const kept = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
  mergeClientFields(kept, { predict: { [PO.id]: { [PLAYOFF_KEY]: { picks: { q1: 'GE' }, at: 0 } } } } as never)
  check('迁移存档后淘汰赛预测原样保留，客户端写不进', JSON.stringify(kept.predict?.[PO.id]?.[PLAYOFF_KEY]?.picks) === JSON.stringify(full)
    && JSON.stringify(kept.predict?.[EV.id]) === JSON.stringify(g.predict?.[EV.id]))

  // ---- results come in match by match
  const real: PPicks = { q1: '100T', q2: 'NS', q3: 'T1', q4: 'NRG', s1: '100T', s2: 'NRG', l1a: 'PRX', l1b: 'G2',
    l2a: 'PRX', l2b: 'G2', uf: 'NRG', l3: 'PRX', lf: 'PRX', gf: 'PRX' }
  check('一套假想赛果本身走得通', Object.keys(cleanPlayoffPicks(PO, real)).length === 14)
  const after = (slot: keyof PPicks) => PO.at[slot] + 4 * 3600_000
  const upTo = (n: number) => Object.fromEntries(
    [...P_SLOTS].sort((a, b) => PO.at[a] - PO.at[b]).slice(0, n).map(k => [k, real[k]])) as PPicks
  PLAYOFF_RESULTS[PO.id] = { winners: upTo(2), confirmedAt: after('q2') }
  check('赛果确认前不算', playoffPlayed(PO, after('q2') - 1) === null)
  check('打完两场：两场算分', JSON.stringify(predictScore(PO.id, g.predict?.[PO.id], after('q2'))) === JSON.stringify({ correct: 1, total: 2, places: 0 }),
    JSON.stringify(predictScore(PO.id, g.predict?.[PO.id], after('q2'))))
  check('没打完不能领', !runAction(g, 'predict_claim', { event: PO.id, group: PLAYOFF_KEY }, env(after('q2'))).ok)
  PLAYOFF_RESULTS[PO.id] = { winners: { ...upTo(2), gf: 'PRX' }, confirmedAt: after('q2') }
  check('写了还没打的比赛，整份赛果作废', playoffPlayed(PO, after('q2')) === null)
  PLAYOFF_RESULTS[PO.id] = { winners: { ...upTo(2), q3: 'NRG' }, confirmedAt: after('q4') }
  check('胜者不在这场里，整份赛果作废', playoffPlayed(PO, after('q4')) === null)
  PLAYOFF_RESULTS[PO.id] = { winners: real, confirmedAt: after('gf') }
  const done = after('gf')
  check('打完 14 场：冠军 PRX、亚军 NRG', JSON.stringify(playoffFinal(PO, done)) === JSON.stringify({ champion: 'PRX', runnerUp: 'NRG' }))
  // hand count of `full` against `real`: q1 q4 s2 l1b uf lf = 6
  check('全部打完的正确率', JSON.stringify(predictScore(PO.id, g.predict?.[PO.id], done)) === JSON.stringify({ correct: 6, total: 14, places: 0 }),
    JSON.stringify(predictScore(PO.id, g.predict?.[PO.id], done)))

  // ---- every champion / runner-up a saved bracket can arrive at, against the rule text
  const rule = (c: string | null, r: string | null) => {
    if (c === 'PRX' && r === 'NRG') return { elite: 0, ten: 3 }
    if (c === 'PRX') return { elite: 0, ten: 2 }
    if (r === 'NRG') return { elite: 0, ten: 1 }
    const hit = [c, r].filter(x => x === 'PRX' || x === 'NRG').length
    return hit === 2 ? { elite: 5, ten: 0 } : hit === 1 ? { elite: 3, ten: 0 } : { elite: 0, ten: 0 }
  }
  // every bracket: 2^14 full ones
  let n = 0, miss = 0, paid = 0
  const tally: Record<string, number> = {}
  const walk = (i: number, cur: PPicks) => {
    if (i === P_SLOTS.length) {
      n++
      const p = playoffPlacing(PO, cur)
      const want = rule(p.champion, p.runnerUp)
      tally[`${want.ten}十连/${want.elite}选拔`] = (tally[`${want.ten}十连/${want.elite}选拔`] ?? 0) + 1
      // the real path for one in 64, every tier still covered many times over
      if (n % 64 === 0 || want.ten === 3 || want.elite === 5) {
        const acc = fresh(5)
        runAction(acc, 'predict', { event: PO.id, group: PLAYOFF_KEY, picks: cur }, env(before))
        const b = { ten: acc.packs.ten ?? 0, elite: acc.packs.elite ?? 0 }
        const c1 = runAction(acc, 'predict_claim', { event: PO.id, group: PLAYOFF_KEY }, env(done))
        const c2 = runAction(acc, 'predict_claim', { event: PO.id, group: PLAYOFF_KEY }, env(done))
        if (c1.ok !== (want.ten + want.elite > 0) || c2.ok || (acc.packs.ten ?? 0) !== b.ten + want.ten
          || (acc.packs.elite ?? 0) !== b.elite + want.elite) miss++
        if (c1.ok) paid++
      }
      return
    }
    const k = P_SLOTS[i]
    for (const t of playoffSides(PO, cur)[k]) if (t) walk(i + 1, { ...cur, [k]: t })
  }
  walk(0, {})
  check(`${n} 种完整预测的档位与规则一致，抽查的都走真实领取、只领一次`, n === 16384 && miss === 0, `${miss} 处不一致，领到 ${paid}`)
  console.log('     ', Object.entries(tally).map(([k, v]) => `${k}×${v}`).join('  '))
  {
    const acc = fresh(6)
    acc.predict = { [PO.id]: { [PLAYOFF_KEY]: { picks: real, at: PO.deadline } } }
    check('截止后才有的预测不能领、不计分', !runAction(acc, 'predict_claim', { event: PO.id, group: PLAYOFF_KEY }, env(done)).ok
      && predictScore(PO.id, acc.predict[PO.id], done) === null)
  }
  const rows = predictBoard(PO.id, [
    { id: 'a', name: 'a', saved: { [PLAYOFF_KEY]: { picks: real, at: 1 } } },
    { id: 'b', name: 'b', saved: g.predict?.[PO.id] },
    { id: 'c', name: 'c', saved: { [PLAYOFF_KEY]: { picks: {}, at: 1 } } },
  ], done)
  check('淘汰赛排行', JSON.stringify(rows.map(r => [r.id, r.rank, r.correct, r.total, r.places])) === JSON.stringify([['a', 1, 14, 14, 2], ['b', 2, 6, 14, 0]]),
    JSON.stringify(rows))
  check('playedWinners 不看实际赛程外的键', playedWinners(PO, { winners: { ...real, zz: 'PRX' } as PPicks, confirmedAt: done }, done) === null)
} finally {
  PO.quarters = realQuarters
  PLAYOFF_RESULTS[PO.id] = null
  for (const k of Object.keys(PREDICT_RESULTS[EV.id])) delete PREDICT_RESULTS[EV.id][k]
  Object.assign(PREDICT_RESULTS[EV.id], JSON.parse(savedResults))
}

console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
