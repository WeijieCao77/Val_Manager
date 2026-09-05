/**
 * 自动组队 brings a caller, and a five without one is worth less.
 *
 * The button used to fill five seats by rating and position and never look
 * at who calls; the builder had warned 「阵容里没有指挥，中局决策会吃亏」
 * over a number that ignored it. Four collections: a caller rated well below
 * the rest, no caller at all, a caller ranked past the sixty-card bench, and
 * the same man owned as a legend and as an ordinary card.
 */
import { newGacha, autoSquad } from '../src/engine/gacha'
import { NO_IGL_PENALTY, PLAYER_CARDS, chemistry, personOf, squadRating } from '../src/engine/cards'
import type { GachaState } from '../src/engine/gacha'
import type { PlayerCard } from '../src/engine/cards'

let bad = 0
const check = (ok: boolean, what: string) => { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${what}`) }
const own = (g: GachaState, cards: PlayerCard[]) => {
  for (const c of cards) g.cards[c.id] = { id: c.id, level: 0, dupes: 0, seen: 1, got: '2026-09-05' }
}
const byRating = [...PLAYER_CARDS].sort((a, b) => b.rating - a.rating)
const distinct = (cards: PlayerCard[], n: number, skip = new Set<string>()) => {
  const out: PlayerCard[] = []
  const seen = new Set<string>()
  for (const c of cards) {
    const p = personOf(c)
    if (seen.has(p) || skip.has(p)) continue
    seen.add(p); out.push(c)
    if (out.length === n) break
  }
  return out
}
const seated = (g: GachaState) => g.squad.slots.map((id) => PLAYER_CARDS.find((c) => c.id === id)).filter((c): c is PlayerCard => !!c)
const describe = (g: GachaState) => seated(g).map((c) => `${c.ign} ${c.rating}${c.isIgl ? ' IGL' : ''}`).join(', ')

console.log('a caller rated well below the rest')
{
  const g = newGacha('t1', 'igl', '2026-09-05')
  const top = distinct(byRating.filter((c) => !c.isIgl), 8)
  const igl = byRating.filter((c) => c.isIgl && c.rating <= 84 && !c.legend)[0]
  own(g, [...top, igl])
  g.squad = autoSquad(g)
  console.log('   ', describe(g))
  check(seated(g).length === 5, 'five seated')
  check(seated(g).some((c) => c.isIgl), `the ${igl.rating}-rated caller ${igl.ign} is in, among ${top[0].rating}s`)
  check(!chemistry(g.squad).noIgl, 'the builder no longer says 没有人喊指挥')
}

console.log('no caller owned')
{
  const g = newGacha('t2', 'igl', '2026-09-05')
  const top = distinct(byRating.filter((c) => !c.isIgl), 8)
  own(g, top)
  g.squad = autoSquad(g)
  console.log('   ', describe(g))
  check(seated(g).length === 5, 'five seated anyway')
  const r = squadRating(g.squad)
  check(chemistry(g.squad).noIgl && NO_IGL_PENALTY === 3, `rating ${r}, three under what the same five would be with a caller (penalty ${NO_IGL_PENALTY})`)
}

console.log('the only caller ranks past the sixty-card bench')
{
  const g = newGacha('t3', 'igl', '2026-09-05')
  const igl = byRating.filter((c) => c.isIgl && c.rating <= 80 && !c.legend)[0]
  const above = distinct(byRating.filter((c) => !c.isIgl && c.rating > igl.rating), 70, new Set([personOf(igl)]))
  own(g, [...above, igl])
  const rank = [...above, igl].sort((a, b) => b.rating - a.rating).indexOf(igl) + 1
  g.squad = autoSquad(g)
  console.log('   ', describe(g))
  check(rank > 60, `${igl.ign} (${igl.rating}) is card #${rank} of ${above.length + 1}`)
  check(seated(g).some((c) => c.isIgl), 'and he is seated all the same')
}

console.log('the same man as a legend and as an ordinary card')
{
  const g = newGacha('t4', 'igl', '2026-09-05')
  const legend = PLAYER_CARDS.find((c) => c.legend && PLAYER_CARDS.some((o) => !o.legend && personOf(o) === personOf(c)))!
  const plain = PLAYER_CARDS.find((o) => !o.legend && personOf(o) === personOf(legend))!
  const others = distinct(byRating, 6, new Set([personOf(legend)]))
  own(g, [legend, plain, ...others])
  g.squad = autoSquad(g)
  console.log('   ', describe(g))
  const persons = seated(g).map(personOf)
  check(new Set(persons).size === persons.length, `${legend.ign} is on the server once, not twice`)
}
console.log(bad ? `\n${bad} problem(s)` : '\nall good')
process.exit(bad ? 1 : 0)
