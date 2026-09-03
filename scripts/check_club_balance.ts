/**
 * Does a full club beat everything? (2026-09-03, after the title credit)
 *
 *   npx tsx scripts/check_club_balance.ts [seeds]
 *
 * The worry: somebody collects NRG's five, and no other five can touch them.
 * Every top club's best five (by role, from its own cards) plays every other
 * club's best five over many bo3 with different seeds; the strongest club's
 * win rate against the field — and its worst single match-up — is what says
 * whether the card mode still has a contest in it.
 */
import { ALL_CARDS, SQUAD_SLOTS, cardById, isPlayerCard, isCoachCard, squadRating } from '../src/engine/cards'
import type { Card, PlayerCard, Squad } from '../src/engine/cards'
import { playRivalMatch } from '../src/engine/arena'
import type { RivalSquad } from '../src/engine/arena'

const SEEDS = Number(process.argv[2] ?? 40)   // 20 is too few: a 92% pairing reads 100% at 20
const players = ALL_CARDS.filter((c): c is PlayerCard => isPlayerCard(c) && c.rarity !== 'mythic')
const coaches = ALL_CARDS.filter(isCoachCard)

/** The club's best legal five: each slot takes the strongest card that can play it. */
function clubSquad(tag: string): Squad | null {
  const pool = players.filter((c) => c.clubTag === tag).sort((a, b) => b.rating - a.rating)
  if (pool.length < 5) return null
  const used = new Set<string>()
  const slots = SQUAD_SLOTS.map((role) => {
    const pick = pool.find((c) => !used.has(c.id) && (role === '自由人' || c.roles.includes(role)))
      ?? pool.find((c) => !used.has(c.id))
    if (pick) used.add(pick.id)
    return pick?.id ?? null
  })
  const coach = coaches.find((c) => c.clubTag === tag)?.id ?? null
  return { slots, coach }
}

/** The best five money could buy: strongest card per slot across every club. */
function dreamSquad(): Squad {
  const used = new Set<string>()
  const sorted = [...players].sort((a, b) => b.rating - a.rating)
  const slots = SQUAD_SLOTS.map((role) => {
    const pick = sorted.find((c) => !used.has(c.id) && (role === '自由人' || c.roles.includes(role)))!
    used.add(pick.id)
    return pick.id
  })
  const coach = [...coaches].sort((a, b) => b.rating - a.rating)[0]?.id ?? null
  return { slots, coach }
}

const tags = [...new Set(players.map((c) => c.clubTag).filter(Boolean))] as string[]
const squads = tags.map((tag) => ({ tag, squad: clubSquad(tag)! })).filter((x) => x.squad)
  .map((x) => ({ ...x, rating: squadRating(x.squad) }))
  .sort((a, b) => b.rating - a.rating)
const top = squads.slice(0, 12)
top.push({ tag: 'DREAM', squad: dreamSquad(), rating: squadRating(dreamSquad()) })

const rival = (x: { tag: string; squad: Squad }): RivalSquad => ({
  name: x.tag, tag: x.tag, slots: x.squad.slots, coach: x.squad.coach, levels: {}, div: 1, points: 2000,
})
const level = () => 0
const wins: Record<string, Record<string, number>> = {}
for (const a of top) {
  wins[a.tag] = {}
  for (const b of top) {
    if (a === b) continue
    let w = 0
    for (let s = 1; s <= SEEDS; s++) {
      const r = playRivalMatch(a.squad as never, level, rival(b), 3, s * 7919 + a.tag.length * 13 + b.tag.length)
      if (r.win) w++
    }
    wins[a.tag][b.tag] = w / SEEDS
  }
}
const names = (s: Squad) => s.slots.map((id) => (id ? (cardById(id) as Card as PlayerCard).ign : '-')).join('/')
console.log('club   rating  vs field   worst match-up      best five')
for (const a of top) {
  const row = Object.entries(wins[a.tag])
  const avg = row.reduce((s, [, v]) => s + v, 0) / row.length
  const worst = row.reduce((m, x) => (x[1] < m[1] ? x : m), row[0])
  console.log(`${a.tag.padEnd(6)} ${String(Math.round(a.rating)).padStart(5)}   ${(avg * 100).toFixed(0).padStart(4)}%     ${(worst[1] * 100).toFixed(0).padStart(3)}% vs ${worst[0].padEnd(6)}   ${names(a.squad)}`)
}
const clubs = top.filter((x) => x.tag !== 'DREAM')
const fieldOf = (a: { tag: string }) => {
  const row = clubs.filter((b) => b.tag !== a.tag).map((b) => wins[a.tag][b.tag])
  return row.reduce((s, v) => s + v, 0) / row.length
}
const strongest = clubs.reduce((m, a) => (fieldOf(a) > fieldOf(m) ? a : m), clubs[0])
const pairs = clubs.flatMap((a) => clubs.filter((b) => b !== a).map((b) => ({ a: a.tag, b: b.tag, w: wins[a.tag][b.tag] })))
const steepest = pairs.reduce((m, x) => (x.w > m.w ? x : m), pairs[0])
const landslide = steepest.w
console.log(`\n${strongest.tag} against the other ${clubs.length - 1} clubs: ${(fieldOf(strongest) * 100).toFixed(0)}%  ·  steepest club pairing: ${steepest.a} over ${steepest.b} ${(landslide * 100).toFixed(0)}%`)
console.log(`gap top→12th: ${Math.round(top[0].rating)} → ${Math.round(top[11].rating)}`)

// What "still a contest" means, in numbers: the best full club wins about
// seven in ten against the other top clubs, not nine, and no top-twelve
// pairing is a foregone conclusion. Measured at SPREAD 0.5 on 2026-09-03:
// 71% and 92%. Before the squeeze: 83% and 95%+.
let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
check('最强的整队对其他顶级整队，赢不到四分之三', fieldOf(strongest) <= 0.76, `${(fieldOf(strongest) * 100).toFixed(0)}%`)
check('顶级整队之间没有一对是十拿九稳', landslide <= 0.95, `${steepest.a} over ${steepest.b} ${(landslide * 100).toFixed(0)}%`)
const mirror = (() => { let w = 0; for (let s = 1; s <= SEEDS; s++) if (playRivalMatch(top[0].squad as never, level, rival(top[0]), 3, s * 31).win) w++; return w / SEEDS })()
check('同一套五人对自己大致五五开', mirror >= 0.3 && mirror <= 0.7, `${(mirror * 100).toFixed(0)}%`)
console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
