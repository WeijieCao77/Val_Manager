/**
 * What a caller is worth in BOTH engines, across several matchups.
 *
 *   npx tsx scripts/rating/sim_igl2.ts [seeds]
 *
 * Manager mode (simulateMatch): tier-one pairs at three strength gaps; the
 * caller's 指挥 +15, his overall +5, both, and the same moves on a non-caller.
 * Card mode (playRivalMatch): club card squads from the same clubs; the arena
 * clones each seated card from the world player and squeezes attributes toward
 * a pivot, so the same +15 / +5 are applied to the WORLD source before seating
 * and measured through that path. One number at a time, same seeds.
 */
import { createNewGame, WORLD_PLAYERS } from '../../src/engine/world'
import { WORLD_TEAMS } from '../../src/engine/teams'
import { simulateMatch } from '../../src/engine/match'
import { squadOf, callerOf } from '../../src/engine/roster'
import { Rng } from '../../src/engine/rng'
import { playRivalMatch } from '../../src/engine/arena'
import { ALL_CARDS, isPlayerCard, isCoachCard, SQUAD_SLOTS } from '../../src/engine/cards'
import type { PlayerCard, CoachCard, Squad } from '../../src/engine/cards'
import type { RivalSquad } from '../../src/engine/arena'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) }, key: () => null, clear: () => store.clear(), get length() { return store.size },
}
const N = Number(process.argv[2] ?? 150)
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

// ---------------------------------------------------------------- manager mode
console.log(`== 经理模式 simulateMatch，${N} 场 bo3 每格 ==`)
const state = createNewGame(WORLD_TEAMS[0].id, '测试', 777)
const tier1 = Object.values(state.teams).filter((t) => t.tier === 1).sort((a, b) => b.rating - a.rating)
for (const id of tier1.map((t) => t.id)) for (const p of squadOf(state, id)) { p.form = 70; p.morale = 70; p.fatigue = 0; p.injuredUntil = 0 }
const pairs: [typeof tier1[0], typeof tier1[0], string][] = []
const byGap = (gap: number) => {
  let best: [typeof tier1[0], typeof tier1[0]] | null = null, bd = 99
  for (const a of tier1) for (const b of tier1) {
    if (a === b || !callerOf(state, a.id)) continue
    const d = Math.abs((a.rating - b.rating) - gap)
    if (d < bd) { bd = d; best = [a, b] }
  }
  return best!
}
for (const [gap, label] of [[0, '势均力敌'], [-4, '弱 4 分'], [4, '强 4 分']] as [number, string][]) {
  const [a, b] = byGap(gap); pairs.push([a, b, label])
}
function winRate(aId: string, bId: string): number {
  let w = 0
  for (let i = 0; i < N; i++) { const r = simulateMatch(state, aId, bId, 3, new Rng(1000 + i * 7919)); if (r.mapsWonA > r.mapsWonB) w++ }
  return w / N
}
type Case = [string, (caller: ReturnType<typeof callerOf> & object, other: ReturnType<typeof callerOf> & object) => void]
const cases: Case[] = [
  ['基准', () => {}],
  ['主指挥 指挥+15', (c) => { c.attrs.igl += 15 }],
  ['主指挥 总评+5', (c) => { c.overall += 5 }],
  ['主指挥 两者', (c) => { c.overall += 5; c.attrs.igl += 15 }],
  ['非指挥 指挥+15', (_c, o) => { o.attrs.igl += 15 }],
  ['非指挥 总评+5', (_c, o) => { o.overall += 5 }],
]
console.log(`${'对阵'.padEnd(18)} ${cases.map((c) => c[0].padEnd(14)).join('')}`)
for (const [a, b, label] of pairs) {
  const caller = callerOf(state, a.id)!
  const other = squadOf(state, a.id).find((p) => p.id !== caller.id)!
  const snap = [caller, other].map((p) => ({ p, overall: p.overall, igl: p.attrs.igl }))
  const out: string[] = []
  let base = 0
  for (const [name, apply] of cases) {
    for (const s of snap) { s.p.overall = s.overall; s.p.attrs.igl = s.igl }
    apply(caller, other)
    const w = winRate(a.id, b.id)
    if (name === '基准') base = w
    out.push((name === '基准' ? pct(w) : `${(w - base) * 100 >= 0 ? '+' : ''}${((w - base) * 100).toFixed(1)}`).padEnd(14))
  }
  for (const s of snap) { s.p.overall = s.overall; s.p.attrs.igl = s.igl }
  console.log(`${`${a.tag} v ${b.tag} ${label}`.padEnd(18)} ${out.join('')}   (主指挥 ${caller.ign} 指挥 ${caller.attrs.igl} 总评 ${caller.overall})`)
}

// ---------------------------------------------------------------- card mode
console.log(`\n== 开瓦包 arena playRivalMatch，${N} 个种子 bo3 每格（属性经 arena 压缩）==`)
const players = ALL_CARDS.filter((c): c is PlayerCard => isPlayerCard(c) && c.rarity !== 'mythic' && !c.event)
const coaches = ALL_CARDS.filter((c): c is CoachCard => isCoachCard(c) && !c.legend)
function clubSquad(tag: string): Squad | null {
  const mine = players.filter((c) => c.clubTag === tag).sort((a, b) => b.rating - a.rating)
  if (mine.length < 5) return null
  const used = new Set<string>()
  const slots = SQUAD_SLOTS.map((role) => {
    const pick = mine.find((c) => !used.has(c.id) && (role === '自由人' || c.roles.includes(role))) ?? mine.find((c) => !used.has(c.id))
    if (pick) used.add(pick.id)
    return pick?.id ?? null
  })
  return { slots, coach: coaches.find((c) => c.clubTag === tag)?.id ?? null }
}
const rivalOf = (tag: string, sq: Squad): RivalSquad => ({ name: tag, tag, slots: sq.slots, coach: sq.coach, levels: {}, div: 1, points: 2000 })
const worldOf = (playerId: string) => WORLD_PLAYERS.find((p) => p.id === playerId)!
function arenaWin(mine: Squad, rival: RivalSquad): number {
  let w = 0
  for (let s = 1; s <= N; s++) { if (playRivalMatch(mine as never, () => 0, rival, 3, s * 7919 + 17).win) w++ }
  return w / N
}
console.log(`${'对阵'.padEnd(18)} ${cases.map((c) => c[0].padEnd(14)).join('')}`)
for (const [a, b, label] of pairs) {
  const sa = clubSquad(a.tag), sb = clubSquad(b.tag)
  if (!sa || !sb) { console.log(`${a.tag} v ${b.tag}: 卡组不足五人`); continue }
  const seated = sa.slots.filter((x): x is string => !!x).map((id) => players.find((c) => c.id === id)!)
  const callerCard = seated.filter((c) => worldOf(c.playerId)?.isIgl).sort((x, y) => (worldOf(y.playerId).attrs.igl - worldOf(x.playerId).attrs.igl))[0]
  if (!callerCard) { console.log(`${a.tag}: 卡组里没有指挥`); continue }
  const otherCard = seated.find((c) => c !== callerCard)!
  // the arena seats the CARD (card.rating, card.attrs), not the world player's
  // current numbers, so the moves are made on the cards
  const wc = worldOf(callerCard.playerId)
  const asPlayer = (c: PlayerCard) => ({ get overall() { return c.rating }, set overall(v: number) { c.rating = v }, attrs: c.attrs })
  const pc = asPlayer(callerCard), po = asPlayer(otherCard)
  const snap = [callerCard, otherCard].map((c) => ({ c, rating: c.rating, igl: c.attrs.igl }))
  const out: string[] = []
  let base = 0
  for (const [name, apply] of cases) {
    for (const s of snap) { s.c.rating = s.rating; s.c.attrs.igl = s.igl }
    apply(pc as never, po as never)
    const w = arenaWin(sa, rivalOf(b.tag, sb))
    if (name === '基准') base = w
    out.push((name === '基准' ? pct(w) : `${(w - base) * 100 >= 0 ? '+' : ''}${((w - base) * 100).toFixed(1)}`).padEnd(14))
  }
  for (const s of snap) { s.c.rating = s.rating; s.c.attrs.igl = s.igl }
  console.log(`${`${a.tag} v ${b.tag} ${label}`.padEnd(18)} ${out.join('')}   (指挥卡 ${callerCard.ign} 指挥 ${callerCard.attrs.igl} 卡面 ${callerCard.rating}，世界 isIgl ${wc.isIgl})`)
}
