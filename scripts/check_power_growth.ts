/**
 * Levels are worth the same in a match as on the card. Uncoached +0 cards
 * preserve the original state; coached fixtures include the 2026-09-14 fix.
 *
 *   npx tsx scripts/check_power_growth.ts
 *
 * 2026-09-13, the 双数字 decision (analysis/power_balance_recheck.md): the
 * face shows the base rating with the level beside it, 战力 shows what the
 * two add up to at a hundred per point, and the arena adds the levels after
 * its squeeze so nothing rounds or caps them away. The acceptance list:
 *
 *   - the base rating is fixed: no level changes what the face says
 *   - a player's or coach's level is +100 战力, five levels +500
 *   - uncoached +0 arena state is byte-for-byte what the old engine built
 *   - a level is counted once: +0.5 overall and +0.6 per attribute, flat
 *   - every level on every one of the player cards changes the match state
 *   - an old save's levels are read as they are, no migration needed
 *   - five levels on a five beat the same five at +0 more often than not
 */
import { createHash } from 'node:crypto'
import { buildArena, playRivalMatch, ARENA_TEAM } from '../src/engine/arena'
import {
  ALL_CARDS, COACH_LEVEL_LIFT, MAX_LEVEL, POWER_PER_LEVEL, POWER_PER_SQUAD_POINT, cardPower, growthOf,
  isCoachCard, isPlayerCard, ratingAt, squadPaper, squadPower, squadRating,
} from '../src/engine/cards'
import { migrateGacha, newGacha, levelOf } from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'
import { Rng } from '../src/engine/rng'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}
;(globalThis as never as { fetch: unknown }).fetch = undefined

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const players = ALL_CARDS.filter(isPlayerCard)
const coaches = ALL_CARDS.filter(isCoachCard)

// ---- 战力: a hundred a point, a hundred a level, for players and coaches
{
  let off = 0
  for (const c of players) {
    for (let l = 0; l <= MAX_LEVEL; l++) {
      if (cardPower(c, l) !== 100 * c.rating + POWER_PER_LEVEL * l) off++
    }
    if (cardPower(c, MAX_LEVEL + 3) !== cardPower(c, MAX_LEVEL)) off++
    if (ratingAt(c.rating, MAX_LEVEL) !== c.rating + MAX_LEVEL) off++
  }
  check(`${players.length} 张选手卡：每级战力 +${POWER_PER_LEVEL}，满级 +${POWER_PER_LEVEL * MAX_LEVEL}，规则评分不再封 99`, off === 0, `${off} 处不对`)
  const grows = coaches.every((c) => cardPower(c, MAX_LEVEL) === 100 * c.rating + POWER_PER_LEVEL * MAX_LEVEL)
  check(`${coaches.length} 张教练卡：每级战力 +${POWER_PER_LEVEL}，和选手一样`, grows)
  check('growthOf 只认 0～5 级', growthOf(-2) === 0 && growthOf(3) === 3 && growthOf(9) === MAX_LEVEL)
}

// ---- the +0 state: original uncoached fixtures, coached fixtures updated for
// the continuous three-attribute coaching fix on 2026-09-14.
// Two of the six were re-pinned on 2026-09-18: Hopedawn (P529) and QiuYe
// (P527) got their real birthdates from 号角 (20 → 24 and 18 → 23), and age is
// part of a bond. Their ratings and attributes did not move — only `bonds`.
const PINNED: Record<string, string> = {
  'p:P529,p:P313,p:P238,p:P532,p:P518|c:nokaze37': '6b96eb4ef77c',
  'p:P260,p:P65,p:P360,p:P266,p:P536|-': 'a0240f257957',
  // re-pinned 2026-09-18: Shao's flag went from vlr's blank "un" to Russia, and a shared flag is part of a bond
  'L:shao-copenhagen-2022,s24:3021,p:P113,p:P301,p:P257|L:muggle-champions-2024': '1c1ce08e3d50',
  'p:P227,p:P382,p:P95,p:P300,p:P48|-': '595896154188',
  'p:P262,p:P227,p:P16,p:P2,p:P267|c:Ann': '32470f4bdca0',
  'p:P117,s24:15559,p:P489,p:P527,p:P114|-': 'e27e63094203',
}
type Seated = { overall: number; attrs: Record<string, number>; isIgl?: boolean }
function seated(slots: string[], coach: string | null, level: (id: string) => number): { ps: Seated[]; hash: string } {
  const { state } = buildArena({ slots, coach }, level, 99)
  const team = state.teams[ARENA_TEAM]
  const ps = team.roster.map((id) => { const p = state.players[id]; return { overall: p.overall, attrs: p.attrs as Record<string, number>, isIgl: p.isIgl } })
  const hash = createHash('sha1').update(JSON.stringify({ ps, bonds: state.bonds, coach: team.coach })).digest('hex').slice(0, 12)
  return { ps, hash }
}
{
  let same = 0
  for (const [key, want] of Object.entries(PINNED)) {
    const [ids, coach] = key.split('|')
    const { hash } = seated(ids.split(','), coach === '-' ? null : coach, () => 0)
    if (hash === want) same++
    else console.log(`     ${key}: ${hash} ≠ ${want}`)
  }
  check('六套 +0 入场基线一致（无教练保留旧值，有教练含连续属性修复）', same === Object.keys(PINNED).length, `${same}/${Object.keys(PINNED).length}`)
}

// ---- one level, counted once: +0.5 overall, +0.6 an attribute, before the 99 wall
{
  let cells = 0, off = 0, walls = 0
  for (const key of Object.keys(PINNED)) {
    const [ids, coach] = key.split('|')
    const slots = ids.split(',')
    const zero = seated(slots, coach === '-' ? null : coach, () => 0).ps
    for (let l = 1; l <= MAX_LEVEL; l++) {
      // the players' levels only — the coach's are measured on their own below
      const at = seated(slots, coach === '-' ? null : coach, (id) => (id === coach ? 0 : l)).ps
      at.forEach((p, i) => {
        const z = zero[i]
        const wantOv = Math.min(99, z.overall + 0.5 * l)
        cells++
        if (Math.abs(p.overall - wantOv) > 1e-9) off++
        if (wantOv === 99) walls++
        for (const k of Object.keys(z.attrs)) {
          const want = Math.min(99, z.attrs[k] + 0.6 * l)
          cells++
          if (Math.abs(p.attrs[k] - want) > 1e-9) off++
        }
      })
    }
  }
  check(`每一级都只算一次：总评 +0.5、属性 +0.6（${cells} 项）`, off === 0, `${off} 项不对`)
  check('这六套里没有一张卡的总评顶到 99', walls === 0, `${walls} 次顶到`)
}

// ---- no level on any player card is thrown away
{
  const bench = ['p:P260', 'p:P65', 'p:P360', 'p:P266'] // four to stand beside the card under test
  let dead = 0, tested = 0
  const example: string[] = []
  for (const c of players) {
    const slots = [c.id, ...bench.filter((b) => b !== c.id)].slice(0, 5)
    let prev: number | null = null
    for (let l = 0; l <= MAX_LEVEL; l++) {
      const { ps } = seated(slots, null, (id) => (id === c.id ? l : 0))
      const me = ps[0]
      if (!me) break
      if (prev !== null) {
        tested++
        if (me.overall <= prev) { dead++; if (example.length < 3) example.push(`${c.ign} +${l}`) }
      }
      prev = me.overall
    }
  }
  check(`${players.length} 张选手卡逐级升，${tested} 次升级每次总评都涨`, dead === 0, `${dead} 次没动${example.length ? '：' + example.join('、') : ''}`)
}

// ---- a coach's levels reach the match: a fifth of a point on every card, counted once
{
  const ids = ['p:P227', 'p:P382', 'p:P95', 'p:P300', 'p:P48']
  const coach = 'c:Ann'
  let off = 0, cells = 0
  const zero = seated(ids, coach, () => 0).ps
  for (let l = 1; l <= MAX_LEVEL; l++) {
    // only the coach is levelled: the players stay at +0
    const at = seated(ids, coach, (id) => (id === coach ? l : 0)).ps
    at.forEach((p, i) => {
      const z = zero[i]
      cells++
      if (Math.abs(p.overall - Math.min(99, z.overall + COACH_LEVEL_LIFT * l * 0.5)) > 1e-9) off++
      for (const k of Object.keys(z.attrs)) {
        const nerve = k === 'clutch' ? 0.35 * l * 0.6 : 0
        cells++
        if (Math.abs(p.attrs[k] - Math.min(99, z.attrs[k] + COACH_LEVEL_LIFT * l * 0.6 + nerve)) > 1e-9) off++
      }
    })
  }
  check(`教练每级给全队总评 +${COACH_LEVEL_LIFT * 0.5}、属性 +${(COACH_LEVEL_LIFT * 0.6).toFixed(2)}，残局另加 0.21（${cells} 项）`, off === 0, `${off} 项不对`)
  const lvl = (id: string) => (id === coach ? MAX_LEVEL : 0)
  const paper0 = squadPaper({ slots: ids, coach }, () => 0)
  const paper5 = squadPaper({ slots: ids, coach }, lvl)
  check('纸面上教练 +5 = 教练项 +1，阵容战力 +500', Math.abs(paper5.lift - paper0.lift - 1) < 1e-9
    && squadPower({ slots: ids, coach }, lvl) - squadPower({ slots: ids, coach }, () => 0) === 500)
}

// ---- 阵容战力 is the paper score at five hundred a point, and one level shows
{
  const ids = ['p:P227', 'p:P382', 'p:P95', 'p:P300', 'p:P48']
  const sq = { slots: ids, coach: null }
  const p = squadPaper(sq, () => 0)
  check('阵容战力 = 未取整阵容分 × 500', squadPower(sq) === Math.round(p.score * POWER_PER_SQUAD_POINT) && POWER_PER_SQUAD_POINT === 500)
  check('阵容分还是四舍五入的那个数', squadRating(sq) === Math.round(p.score))
  const one = squadPower(sq, (id) => (id === ids[0] ? 1 : 0))
  check('一张卡升一级，阵容战力 +100，阵容分未必动', one - squadPower(sq) === 100)
  check('空卡组两个数都是 0', squadPower({ slots: [null, null, null, null, null], coach: null }) === 0 && squadRating({ slots: [null, null, null, null, null], coach: null }) === 0)
}

// ---- an old save: the level it holds is the level the arena reads
{
  const g = newGacha('VM-GROW-GROW-GROW-GROW-GROW', '旧存档', '2026-08-01')
  const ids = ['p:P227', 'p:P382', 'p:P95', 'p:P300', 'p:P48']
  for (const id of ids) g.cards[id] = { id, level: 0, dupes: 0, seen: 1 } as GachaState['cards'][string]
  g.cards['p:P227'].level = 3
  const m = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
  const card = players.find((c) => c.id === 'p:P227')!
  check('旧存档里的 +3 直接生效：战力 +300', cardPower(card, levelOf(m, 'p:P227')) === cardPower(card, 0) + 300)
  const zero = seated(ids, null, () => 0).ps[0]
  const mine = seated(ids, null, (id) => levelOf(m, id)).ps[0]
  check('旧存档的 +3 进了竞技场：总评 +1.5', Math.abs(mine.overall - (zero.overall + 1.5)) < 1e-9, `${zero.overall} → ${mine.overall}`)
}

// ---- and it is worth something on the day
{
  const ids = ['p:P227', 'p:P382', 'p:P95', 'p:P300', 'p:P48']
  const rng = new Rng(7)
  let wins = 0
  const N = 300
  for (let i = 0; i < N; i++) {
    const seed = rng.next() * 2 ** 32 >>> 0
    const flip = i % 2 === 1
    const res = playRivalMatch(
      { slots: ids, coach: null }, () => (flip ? 0 : MAX_LEVEL),
      { slots: ids, coach: null, levels: flip ? Object.fromEntries(ids.map((id) => [id, MAX_LEVEL])) : {}, name: '对面', tag: 'B' },
      3, seed, undefined, false,
    )
    if (res.win !== flip) wins++
  }
  check(`同一套五人，+5 对 +0 打 ${N} 场 BO3 赢得更多`, wins / N > 0.55 && wins / N < 0.85, `${(100 * wins / N).toFixed(1)}%`)
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
