/**
 * One man cannot start and coach the same five (2026-10-10).
 *
 *   npx tsx scripts/check_coach_is_player.ts
 *
 * ColdFish (向鹏志) and Biank (钟剑飞) each have a player card and a coach card.
 * Matched by vlr id, not handle: potter (EG coach / Thai player) and Autumn
 * (EDG coach / Australian player) are two people each and stay allowed.
 * The server refuses such a five; a five saved before the rule (a rival, a
 * cup registration) plays without the coach rather than with him twice.
 */
import assert from 'node:assert/strict'
import { playRivalMatch } from '../src/engine/arena'
import { squadForPlay } from '../src/engine/cardActions'
import { COACH_CARDS, PLAYER_CARDS, coachAsPlayer, isPlayerCard, personOf } from '../src/engine/cards'
import { newGacha } from '../src/engine/gacha'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) }, key: () => null, clear: () => store.clear(), get length() { return store.size },
}
const coach = (name: string) => COACH_CARDS.find((c) => c.name === name && c.id.startsWith('c:'))!
const player = (ign: string, nat: string) => PLAYER_CARDS.find((c) => isPlayerCard(c) && !c.event && c.ign.toLowerCase() === ign.toLowerCase() && c.nat === nat)!
const others = PLAYER_CARDS.filter((c) => !c.event && c.rarity !== 'mythic').slice(0, 10)

const account = (starter: string, coachId: string) => {
  const g = newGacha('COACHMAN', '审计', '2026-10-10')
  const five = [starter, ...others.filter((c) => personOf(c) !== starter).slice(0, 4).map((c) => c.id)]
  for (const id of [...five, coachId]) g.cards[id] = { id, level: 0, dupes: 0, seen: 1 }
  g.squad = { slots: five, coach: coachId }
  return g
}

for (const [name, nat] of [['ColdFish', 'cn'], ['Biank', 'cn']] as const) {
  const c = coach(name), p = player(name, nat)
  assert(c && p, `${name}: both cards exist`)
  assert.equal(coachAsPlayer(c), personOf(p), `${name}: the coach is the player`)
  const r = squadForPlay(account(p.id, c.id))
  assert(!r.ok && r.why.includes('不能既首发又当教练'), `${name}: refused`)
  // a saved five with both plays as if he were only on the floor
  const g = account(p.id, c.id)
  const res = playRivalMatch(g.squad, () => 0, { slots: g.squad.slots, coach: null, name: 'X', tag: 'X', levels: {}, div: 0, points: 0 }, 3, 5)
  const bare = playRivalMatch({ ...g.squad, coach: null }, () => 0, { slots: g.squad.slots, coach: null, name: 'X', tag: 'X', levels: {}, div: 0, points: 0 }, 3, 5)
  assert.equal(JSON.stringify(res.result.maps), JSON.stringify(bare.result.maps), `${name}: the saved five plays without the coach`)
  console.log(`ok   ${name}：同一个人，首发和教练只能选一个`)
}
for (const [name, ign, nat] of [['potter', 'potter', 'th'], ['Autumn', 'Autumn', 'au']] as const) {
  const c = coach(name), p = player(ign, nat)
  assert.equal(coachAsPlayer(c), null, `${name}: a different man`)
  assert(squadForPlay(account(p.id, c.id)).ok, `${name}: allowed`)
  console.log(`ok   ${name}：同名不同人，照常`)
}
console.log('全部通过')
