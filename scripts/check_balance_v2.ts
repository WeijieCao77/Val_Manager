/**
 * The score curve (v3 since 2026-09-20) and the BO5 ladder — the everyday regression.
 *
 *   npx tsx scripts/check_balance_v2.ts [series=1500]
 *
 * The 20,000-series confirmation is scripts/balance/confirm.ts; this is the
 * part of it cheap enough to run on every push: the curve's shape, proved on
 * the formula and not on dice; the old version still bit for bit what it was;
 * every card that can be owned walks on as a man of its own at the level it
 * holds; the ladder is one first-to-three series paid for once; and a coarse
 * statistical fence round the owner's targets.
 */
import assert from 'node:assert/strict'
import {
  ARENA_TEAM, BALANCE_VERSION, GAP_CURVES, buildArena, cardStrengths, playRivalMatch,
} from '../src/engine/arena'
import type { RivalSquad } from '../src/engine/arena'
import {
  ALL_CARDS, SQUAD_SLOTS, isPlayerCard, personOf, squadPaper, growthOf,
} from '../src/engine/cards'
import type { PlayerCard } from '../src/engine/cards'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import { LADDER_BO, STAMINA_COST, newGacha, staminaNow } from '../src/engine/gacha'
import type { GachaState, LeagueKind } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import { buildPool, pairsAt, row, run, pct } from './balance/lib'

const N = Number(process.argv[2] ?? 1500)
let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

// ---- 1. the curve, as mathematics
{
  const E = GAP_CURVES[BALANCE_VERSION]
  check('当前数值版本是 3', BALANCE_VERSION === 3)
  check('E(0) = 0', E(0) === 0)
  let mono = true, jump = 0, slopeMin = Infinity, slopeMax = 0
  const h = 0.001
  for (let d = 0; d < 40; d += h) {
    const a = E(d), b = E(d + h)
    if (b < a - 1e-12) mono = false
    jump = Math.max(jump, b - a)
    slopeMin = Math.min(slopeMin, (b - a) / h); slopeMax = Math.max(slopeMax, (b - a) / h)
  }
  check('0–40 分单调不减', mono)
  // a step at an integer would show as one h-interval worth a whole point
  check('没有跳档：千分之一分最多改变 0.003 强度', jump <= 0.003, `最大 ${jump.toFixed(5)}`)
  check('斜率始终为正且有界', slopeMin > 0.8 && slopeMax < 2.1, `${slopeMin.toFixed(3)} – ${slopeMax.toFixed(3)}`)
  for (const d of [2, 3, 5]) {
    const l = E(d - 1e-9), r = E(d + 1e-9)
    assert(Math.abs(l - r) < 1e-6, `E 在 ${d} 处不连续`)
  }
  check('1.9/2/2.1、2.9/3/3.1、4.9/5/5.1 两侧连续且递增',
    [[1.9, 2, 2.1], [2.9, 3, 3.1], [4.9, 5, 5.1]].every(([a, b, c]) => E(a) < E(b) && E(b) < E(c)))

  // the pair's mean strength is the old one, whatever the gap; the gap is E, split evenly
  let centreOk = true, antiOk = true
  for (const [a, b] of [[98.885, 101.885], [83, 104], [70.2, 70.2], [91.4, 86.15], [60, 99.9]]) {
    for (const v of [2, 3]) {
      const [sa, sb] = cardStrengths(a, b, v)
      const centre = 80 + ((a + b) / 2 - 80) * 0.35
      if (Math.abs((sa + sb) / 2 - centre) > 1e-9) centreOk = false
      if (Math.abs(Math.abs(sa - sb) - GAP_CURVES[v](Math.abs(a - b))) > 1e-9) centreOk = false
      const [rb, ra] = cardStrengths(b, a, v)
      if (Math.abs(ra - sa) > 1e-9 || Math.abs(rb - sb) > 1e-9) antiOk = false
    }
  }
  // a cup that started on version 2 finishes on it: the curve of 09-18, to the last bit
  const sp = (x: number) => (x > 30 ? x : Math.log1p(Math.exp(x)))
  let v2 = true
  for (let d = 0; d < 40; d += 0.0137) {
    if (GAP_CURVES[2](d) !== 0.36 * d + (1.48 - 0.36) * 0.5 * (sp((d - 2.9) / 0.5) - sp(-2.9 / 0.5))) v2 = false
  }
  check('版本 2 与 09-18 上线的曲线逐位相同', v2)
  // version 3 is steeper than version 2 at every gap: no score difference got cheaper
  let steeper = true
  for (let d = 0.05; d < 40; d += 0.05) if (GAP_CURVES[3](d) <= GAP_CURVES[2](d)) steeper = false
  check('版本 3 在每个分差上都比版本 2 更看重分差', steeper)
  check('双方平均强度 = 80 + (均分 − 80) × 0.35，强度差 = E(d)', centreOk)
  check('交换双方，强度跟着人走', antiOk)

  // version 1 is the arithmetic that was live, term for term
  let v1 = true
  for (const [a, b] of [[98.885, 101.885], [83, 104], [70.2, 70.2], [91.4, 86.15], [101.005, 97.605]]) {
    const gap = a - b
    const extra = Math.sign(gap) * 0.65 * Math.max(0, Math.abs(gap) - 3)
    const [sa, sb] = cardStrengths(a, b, 1)
    if (sa !== 80 + (a - 80) * 0.35 + extra / 2 || sb !== 80 + (b - 80) * 0.35 - extra / 2) v1 = false
  }
  check('版本 1 与上线至今的算式逐位相同', v1)
  let threw = false
  try { cardStrengths(90, 80, 7) } catch { threw = true }
  check('不认识的版本直接报错，不悄悄换曲线', threw)
}

// ---- 2. every card that can be owned takes the field as himself
{
  const players = ALL_CARDS.filter((c): c is PlayerCard => isPlayerCard(c))
  const fillersFor = (c: PlayerCard, slot: number) => {
    const people = new Set([personOf(c)])
    return SQUAD_SLOTS.map((role, i) => {
      if (i === slot) return c.id
      const f = players.find((x) => !people.has(personOf(x)) && x.rarity !== 'mythic' && !x.event
        && (role === '自由人' || x.roles.includes(role)))!
      people.add(personOf(f))
      return f.id
    })
  }
  let short: string[] = [], levelLost: string[] = [], kinds = { ordinary: 0, event: 0, seoul: 0, mythic: 0 }
  for (const c of players) {
    const slot = Math.max(0, SQUAD_SLOTS.findIndex((r) => c.roles.includes(r)))
    const slots = fillersFor(c, slot)
    const at = (lv: number) => buildArena({ slots, coach: null }, (id) => (id === c.id ? lv : 0), 7).state
    const s0 = at(0), s5 = at(5)
    const roster = s0.teams[ARENA_TEAM].roster
    if (roster.length !== 5 || !s0.players[`A${slot}`]) short.push(c.id)
    else if (Math.abs(s5.players[`A${slot}`].overall - s0.players[`A${slot}`].overall - growthOf(5) * 0.5) > 1e-9
      && s0.players[`A${slot}`].overall + growthOf(5) * 0.5 <= 99) levelLost.push(c.id)
    if (c.rarity === 'mythic') kinds.mythic++
    else if (c.seoul) kinds.seoul++
    else if (c.event) kinds.event++
    else kinds.ordinary++
  }
  check(`${players.length} 张选手卡全部五人入场（普通 ${kinds.ordinary} / 历史 ${kinds.event} / 首尔 ${kinds.seoul} / 彩卡 ${kinds.mythic}）`,
    short.length === 0, short.slice(0, 6).join(' '))
  check('coldfish (p:P513)、Biank (p:P440) 在场', !short.includes('p:P513') && !short.includes('p:P440')
    && players.some((c) => c.id === 'p:P513') && players.some((c) => c.id === 'p:P440'))
  check('每张卡的等级都带进了比赛', levelLost.length === 0, levelLost.slice(0, 6).join(' '))
}

// ---- 3. same seed, same series; the curve is the only thing a version changes; other modes never see it
{
  const a = CUP_TEAMS[3], b = CUP_TEAMS[40]
  const rival: RivalSquad = { name: b.name, tag: b.tag, slots: b.squad.slots, coach: b.squad.coach, levels: {}, div: 4, points: 0 }
  const one = playRivalMatch(a.squad, () => 0, rival, 5, 4242, undefined, true)
  const two = playRivalMatch(a.squad, () => 0, rival, 5, 4242, undefined, true)
  check('同一种子同一结果', JSON.stringify(one.result.maps) === JSON.stringify(two.result.maps))
  check('战报带赛制和数值版本', one.bo === 5 && one.balance === BALANCE_VERSION)
  check('BO5 先赢三张图', Math.max(one.mapsWon, one.mapsLost) === 3 && one.mapsWon + one.mapsLost <= 5)
  // 首尔征途 and the challenges pass no curve: swapping the curve under them changes nothing
  const before = playRivalMatch(a.squad, () => 0, rival, 3, 99)
  const keep = GAP_CURVES[BALANCE_VERSION]
  GAP_CURVES[BALANCE_VERSION] = (d) => 9 * d
  const after = playRivalMatch(a.squad, () => 0, rival, 3, 99)
  GAP_CURVES[BALANCE_VERSION] = keep
  check('不走分差曲线的玩法（首尔征途、挑战）与曲线无关',
    before.balance === undefined && JSON.stringify(before.result.maps) === JSON.stringify(after.result.maps))
}

// ---- 4. the ladder: one BO5, paid for once, on every path
{
  const today = '2026-09-18'
  const now = Date.parse('2026-09-18T04:00:00Z')
  const account = (team: typeof CUP_TEAMS[number], div: number): GachaState => {
    const g = newGacha('VM-TEST', '测试', today)
    const ids = [...team.squad.slots, team.squad.coach].filter((x): x is string => !!x)
    g.cards = Object.fromEntries(ids.map((c) => [c, { id: c, level: 0, dupes: 0, seen: 1, got: today }])) as GachaState['cards']
    g.squad = structuredClone(team.squad)
    g.ladder = { ...g.ladder, div, stars: 1, best: div }
    g.daily.staminaAt = now
    return g
  }
  const top = CUP_TEAMS.slice().sort((x, y) => y.rating - x.rating)[0]
  const other = CUP_TEAMS.slice().sort((x, y) => y.rating - x.rating)[4]
  const rival: RivalSquad = { name: '对手', tag: 'RVL', slots: other.squad.slots, coach: other.squad.coach, levels: {}, div: 4, points: 300 }
  const paths: [string, number, RivalSquad | null, LeagueKind][] = [
    ['真人对手', 4, rival, 'open'], ['俱乐部替补对手', 4, null, 'open'], ['低段位俱乐部', 1, null, 'open'],
  ]
  for (const [name, div, r, league] of paths) {
    const g = account(top, div)
    const stamina = staminaNow(g, now), played = g.ladder.wins + g.ladder.losses
    const out = runAction(g, 'ladder', { league }, { now, today, seed: 20260918, rival: r })
    assert(out.ok, `${name}: ${!out.ok && out.why}`)
    const res = (out.result as { res: { bo?: number; mapsWon: number; mapsLost: number; win: boolean; opp?: unknown } }).res
    check(`天梯·${name}：BO${LADDER_BO}，${res.mapsWon}–${res.mapsLost}`,
      res.bo === 5 && Math.max(res.mapsWon, res.mapsLost) === 3 && res.win === (res.mapsWon === 3) && !!res.opp === !!r)
    check(`天梯·${name}：体力只扣一次，胜负只记一场`,
      stamina - staminaNow(g, now) === STAMINA_COST.ladder && g.ladder.wins + g.ladder.losses === played + 1)
  }
}

// ---- 5. a coarse fence round the targets (the tight one is the 20,000-series confirmation)
{
  const pool = buildPool(0x5a17, 40)
  const fence: [number, 3 | 5, number, number][] = [
    // v3, the owner's BO3 targets of 2026-09-20: +1 54.5, +2 57.5, +3 60, +5 72, +10 94; a BO5 reads a little above
    [0, 3, 0.45, 0.55], [1, 3, 0.50, 0.58], [2, 3, 0.535, 0.615], [3, 3, 0.565, 0.645], [5, 3, 0.68, 0.76], [10, 3, 0.90, 0.97],
    [0, 5, 0.45, 0.55], [3, 5, 0.60, 0.68], [5, 5, 0.71, 0.79], [10, 5, 0.945, 0.995],
  ]
  for (const [gap, bo, lo, hi] of fence) {
    const pairs = pairsAt(pool, gap === 0 ? 0.06 : gap, gap === 0 ? 0.06 : 0.12, 120, 5 + gap)
    const r = row(run(pairs, bo, N, `quick:${gap}`, BALANCE_VERSION))
    check(`BO${bo} 领先 ${gap} 分：${pct(r.rate)}（${pct(r.lo)}–${pct(r.hi)}）`, r.rate >= lo && r.rate <= hi, `要 ${pct(lo, 0)}–${pct(hi, 0)}`)
  }
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
