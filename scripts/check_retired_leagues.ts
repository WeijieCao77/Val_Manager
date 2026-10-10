/**
 * 传奇联赛 and 全系列赛 (owner, 2026-10-10).
 *
 *   npx tsx scripts/check_retired_leagues.ts [matches]
 *
 * - 传奇联赛: five retired starters, nothing less, and the two-retired cap
 *   does not apply there; promotions pay 退役选手包;
 * - 全系列赛: at least one live 普卡, one 首尔/曼谷 card and one retired card,
 *   and the cap of two retired still holds;
 * - the server refuses a five that does not qualify, without taking 体力;
 * - each keeps its own record;
 * - the handicap is the measured one: a middling gold retired five plays the
 *   clubs as the open ladder's middling gold five does.
 */
import { runAction } from '../src/engine/cardActions'
import {
  LEAGUE_RULES, STAMINA_MAX, ladderOf, ladderPool, leagueEntry, newGacha, recordLadder, staminaNow,
} from '../src/engine/gacha'
import { playArenaMatch } from '../src/engine/arena'
import { Rng } from '../src/engine/rng'
import {
  BANGKOK_CARDS, PLAYER_CARDS, RETIRED_CARDS, SEOUL_CARDS, SQUAD_SLOTS, isPlayerCard, personOf, squadPaper,
} from '../src/engine/cards'
import type { PlayerCard, Squad } from '../src/engine/cards'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) }, key: () => null, clear: () => store.clear(), get length() { return store.size },
}
let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  ${detail}` : ''}`)
  if (!ok) bad++
}
const DAY = '2026-10-10'
const env = (seed = 7) => ({ today: DAY, now: Date.parse(`${DAY}T12:00:00+08:00`), seed })
const five = (pool: readonly PlayerCard[]) => {
  const used = new Set<string>()
  return SQUAD_SLOTS.map((slot) => {
    const p = pool.find((c) => !used.has(personOf(c)) && (slot === '自由人' || c.roles.includes(slot)))
    if (!p) return null
    used.add(personOf(p))
    return p.id
  })
}
const plain = (l: readonly unknown[]) => (l.filter(isPlayerCard) as PlayerCard[]).filter((c) => c.rarity !== 'mythic').sort((a, b) => b.rating - a.rating)
const live = plain(PLAYER_CARDS.filter((c) => !c.event))
const ret = plain(RETIRED_CARDS)
const ev = plain([...SEOUL_CARDS, ...BANGKOK_CARDS])
const sq = (slots: (string | null)[]): Squad => ({ slots, coach: null })

const allRetired = sq(five(ret))
const fourRetired = sq([...five(ret).slice(0, 4), live[0].id])
const mixed = sq(five([ret[0], ev[0], ...live]))
const noEvent = sq(five([ret[0], ...live]))
const threeRet = sq(five([ret[0], ret[1], ret[2], ev[0], ...live]))

check(leagueEntry(allRetired, 'retired').ok, '传奇联赛：五名退役选手放行')
const w4 = leagueEntry(fourRetired, 'retired')
check(!w4.ok && w4.why.includes('不是退役卡'), '传奇联赛：少一个都不行，说出是谁', w4.ok ? '' : w4.why)
check(!leagueEntry(allRetired, 'open').ok && !leagueEntry(allRetired, 'mixed').ok, '五名退役选手进不了其他天梯')
check(leagueEntry(mixed, 'mixed').ok, '全系列赛：三类各一放行')
const wn = leagueEntry(noEvent, 'mixed')
check(!wn.ok && wn.why.includes('首尔或曼谷卡'), '全系列赛：缺哪类说哪类', wn.ok ? '' : wn.why)
check(!leagueEntry(threeRet, 'mixed').ok, '全系列赛：退役选手仍最多两名')

// the server is the door
const g = newGacha('RLEAGUE', '审计', DAY)
for (const id of [...ret, ...live.slice(0, 40), ...ev.slice(0, 10)].map((c) => c.id)) g.cards[id] = { id, level: 0, dupes: 0, seen: 1, got: DAY }
g.squad = { slots: [...fourRetired.slots], coach: null }
const before = staminaNow(g, env().now)
const refused = runAction(g, 'ladder', { league: 'retired' }, env())
check(!refused.ok && staminaNow(g, env().now) === before, '服务器拒绝不合格的五人，不扣体力')
g.squad = { slots: [...allRetired.slots], coach: null }
g.daily.stamina = STAMINA_MAX
const ran = runAction(g, 'ladder', { league: 'retired' }, env(11))
check(ran.ok, '传奇联赛能实际开打', ran.ok ? '' : (ran as { why: string }).why)
check(ladderOf(g, 'retired').wins + ladderOf(g, 'retired').losses === 1 && g.ladder.wins + g.ladder.losses === 0, '战绩各算各的')

// promotions pay the retired pack
const h = newGacha('RPROMO', '审计', DAY)
const got: string[] = []
for (let i = 0; i < 40; i++) { const o = recordLadder(h, true, 80, 'retired'); if (o.pack) got.push(o.pack) }
check(got.length > 0 && got.every((p) => p === 'retired' || p === 'scout') && got.includes('retired'), '传奇联赛升段送退役选手包', got.join(','))
const k = newGacha('RPROMO2', '审计', DAY)
const open: string[] = []
for (let i = 0; i < 40; i++) { const o = recordLadder(k, true, 80, 'open'); if (o.pack) open.push(o.pack) }
check(!open.includes('retired'), '公开赛升段奖励不变', open.join(','))

// the handicap: 30 random gold fives of each pool against 钻石's clubs, each at
// its own ladder's handicap — a retired five in 传奇联赛 should do about what a
// live five does on the open ladder (one five is too noisy to judge by)
const N = Number(process.argv[2] ?? 30)
const pool = ladderPool(4)
const rng = new Rng(4242)
const fiveFrom = (cards: PlayerCard[]): Squad => {
  const used = new Set<string>()
  const sh = rng.shuffle(cards.slice())
  return { slots: SQUAD_SLOTS.map((slot) => { const p = sh.find((c) => !used.has(personOf(c)) && (slot === '自由人' || c.roles.includes(slot)))!; used.add(personOf(p)); return p.id }), coach: null }
}
const rate = (fives: Squad[], bump: number) => {
  let w = 0, n = 0
  fives.forEach((s, k) => { for (let i = 0; i < 40; i++) { n++; if (playArenaMatch(s, () => 0, pool[(i + k) % pool.length], 3, 7000 + k * 97 + i, bump).win) w++ } })
  return w / n
}
const liveFives = Array.from({ length: N }, () => fiveFrom(live.filter((c) => c.rarity === 'gold')))
const retFives = Array.from({ length: N }, () => fiveFrom(ret.filter((c) => c.rarity === 'gold')))
const a = rate(liveFives, LEAGUE_RULES.open.oppBump), b = rate(retFives, LEAGUE_RULES.retired.oppBump)
const paper = (fs: Squad[]) => (fs.reduce((x, s) => x + squadPaper(s).score, 0) / fs.length).toFixed(1)
check(Math.abs(a - b) < 0.06, '传奇联赛的退役金卡五人和公开赛的现役金卡五人在钻石胜率相当',
  `纸面 ${paper(retFives)} / ${paper(liveFives)}，胜率 ${(b * 100).toFixed(1)}% / ${(a * 100).toFixed(1)}%（传奇联赛对手 ${LEAGUE_RULES.retired.oppBump}）`)

if (bad) { console.log(`${bad} failed`); process.exit(1) }
console.log('全部通过')
